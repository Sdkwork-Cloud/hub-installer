import path from "node:path";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import {
  resolveInstallerDirectories,
  type InstallerDirectories
} from "../core/installer-home";
import {
  readInstallRecord,
  resolveBackupRootDirectory,
  resolveBackupSessionDirectory,
  resolveInstallRecordFile,
  writeInstallRecord,
  type InstallRecord
} from "../core/install-records";
import { loadHubConfigFile, resolveHubConfig } from "../core/hub-config";
import {
  resolveInstallPolicy,
  type EffectiveRuntimePlatform,
  type ResolvedInstallPolicy
} from "../core/install-policy";
import { detectHostPlatform } from "../core/platform";
import { pickDefined } from "../core/pick-defined";
import { executePlan } from "../core/runner";
import {
  normalizePathForRuntime,
  resolveExecutionContext,
  resolveExecutionContextWithProbe,
  resolveHostPathForRuntime,
  type ContainerRuntime,
  type ContainerRuntimePreference,
  type ExecutionContext
} from "../core/runtime";
import { InstallerEngine } from "../core/engine";
import { HubInstallerError } from "../errors";
import type {
  InstallPlan,
  InstallRequest,
  InstallStep,
  ResolvedInstallRequest,
  InstallScope,
  InstallControlLevel,
  SupportedPlatform
} from "../types";
import { conditionMatches, commandExists, toInstallStep } from "./command";
import { loadManifestFromSource } from "./loader";
import { buildRuntimeVariables, renderTemplateDeep } from "./template";
import {
  LIFECYCLE_STAGES,
  type ApplyManifestOptions,
  type ApplyManifestResult,
  type ArtifactReport,
  type BackupManifestOptions,
  type BackupManifestResult,
  type BackupTarget,
  type BackupTargetReport,
  type DependencyCheck,
  type GitArtifact,
  type HuggingFaceArtifact,
  type HubInstallManifest,
  type LoadedManifest,
  type ManifestArtifact,
  type ManifestCommand,
  type ManifestDependency,
  type PackageArtifact,
  type PackageInstallByPlatform,
  type PackageInstallRequest,
  type StageReport,
  type UninstallManifestOptions,
  type UninstallManifestResult,
  type UninstallTargetReport
} from "./types";

interface ResolvedApplyOptions {
  dryRun: boolean;
  verbose: boolean;
  progress: boolean;
  sudo: boolean;
  timeoutMs?: number;
  timeoutMsResolved?: number;
  cwd: string;
}

interface ResolvedApplyRuntime {
  softwareName: string;
  installerDirectories: InstallerDirectories;
  hostInstallerHome: string;
  hostInstallerDirectories: InstallerDirectories;
  installPolicy: ResolvedInstallPolicy;
  executionContext: ExecutionContext;
  runtimeVariables: Record<string, string>;
}

interface ResolvedOperationState {
  installScope: InstallScope;
  installRoot: string;
  workRoot: string;
  binDir: string;
  dataRoot: string;
  installControlLevel: InstallControlLevel;
  effectiveRuntimePlatform: SupportedPlatform | "wsl";
}

interface ResolvedManifestOperationContext extends ResolvedApplyRuntime {
  installRecord?: InstallRecord;
  runtimeInstallRecordFile: string;
  installRecordFile: string;
  resolvedState: ResolvedOperationState;
}

interface RuntimeVariableExtras {
  backupRoot?: string;
  backupSessionDir?: string;
  backupDataDir?: string;
  backupInstallDir?: string;
  backupWorkDir?: string;
  installRecordFile?: string;
  installStatus?: string;
}

function createSyntheticRequest(
  platform: ResolvedInstallRequest["platform"],
  cwd: string,
  timeoutMs: number | undefined
): ResolvedInstallRequest {
  return {
    source: "manifest:commands",
    sourceRef: {
      kind: "file",
      path: cwd
    },
    platform,
    format: "manager",
    cwd,
    ...pickDefined({
      timeoutMs
    })
  };
}

function createPlan(
  request: ResolvedInstallRequest,
  steps: InstallStep[]
): InstallPlan {
  return {
    request,
    steps,
    notes: []
  };
}

function toQuoted(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function isManagerSource(value: string): boolean {
  return /^(winget|choco|brew|apt|snap):\/\//i.test(value);
}

function isLikelyUrl(value: string): boolean {
  return /^(https?|file):\/\//i.test(value);
}

function parseInstallControlLevel(value: string | undefined): InstallControlLevel | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "managed" || value === "partial" || value === "opaque") {
    return value;
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Invalid install control level "${value}". Expected managed, partial, or opaque.`
  );
}

function parseEffectiveRuntimePlatform(
  value: string | undefined,
  platform: SupportedPlatform
): EffectiveRuntimePlatform | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "wsl") {
    return "wsl";
  }

  if (
    value === "windows" ||
    value === "macos" ||
    value === "ubuntu" ||
    value === "android" ||
    value === "ios"
  ) {
    return value;
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Invalid effective runtime platform "${value}" for target platform "${platform}".`
  );
}

function parseContainerRuntimePreference(
  value: string | undefined
): ContainerRuntimePreference | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "auto" || value === "host" || value === "wsl") {
    return value;
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Invalid container runtime "${value}". Expected auto, host, or wsl.`
  );
}

function resolveSoftwareName(
  loadedManifest: LoadedManifest,
  options: ApplyManifestOptions
): string {
  return (
    options.softwareName ??
    options.variables?.hub_software_name ??
    loadedManifest.manifest.variables?.hub_software_name ??
    loadedManifest.manifest.metadata.name
  );
}

function buildOperationRuntimeVariables(
  softwareName: string,
  installerDirectories: InstallerDirectories,
  executionContext: ExecutionContext,
  state: ResolvedOperationState,
  extras: RuntimeVariableExtras = {}
): Record<string, string> {
  return {
    installerHome: installerDirectories.home,
    installerConfigDir: installerDirectories.configDir,
    installerCacheDir: installerDirectories.cacheDir,
    installerRegistryCacheDir: installerDirectories.registryCacheDir,
    installerManifestCacheDir: installerDirectories.manifestCacheDir,
    installerPackageCacheDir: installerDirectories.packageCacheDir,
    installerStateDir: installerDirectories.stateDir,
    installerSourcesDir: installerDirectories.sourcesDir,
    installerTempDir: installerDirectories.tempDir,
    installerInstallRecordsDir: installerDirectories.installRecordsDir,
    installerLogDir: installerDirectories.logsDir,
    installerConfigFile: installerDirectories.configFile,
    hub_software_name: softwareName,
    hub_install_scope: state.installScope,
    hub_install_root: state.installRoot,
    hub_work_root: state.workRoot,
    hub_bin_dir: state.binDir,
    hub_data_root: state.dataRoot,
    hub_install_control_level: state.installControlLevel,
    hub_effective_runtime_platform: state.effectiveRuntimePlatform,
    hub_container_runtime: executionContext.containerRuntime ?? "",
    hub_wsl_distribution: executionContext.wslDistribution ?? "",
    hub_docker_context: executionContext.dockerContext ?? "",
    hub_docker_host: executionContext.dockerHost ?? "",
    hub_backup_root: extras.backupRoot ?? "",
    hub_backup_session_dir: extras.backupSessionDir ?? "",
    hub_backup_data_dir: extras.backupDataDir ?? "",
    hub_backup_install_dir: extras.backupInstallDir ?? "",
    hub_backup_work_dir: extras.backupWorkDir ?? "",
    hub_install_record_file: extras.installRecordFile ?? "",
    hub_install_status: extras.installStatus ?? ""
  };
}

function toResolvedOperationState(installPolicy: ResolvedInstallPolicy): ResolvedOperationState {
  return {
    installScope: installPolicy.installScope,
    installRoot: installPolicy.installRoot,
    workRoot: installPolicy.workRoot,
    binDir: installPolicy.binDir,
    dataRoot: installPolicy.dataRoot,
    installControlLevel: installPolicy.installControlLevel,
    effectiveRuntimePlatform: installPolicy.effectiveRuntimePlatform
  };
}

function normalizeRuntimeOverridePath(
  value: string | undefined,
  runtimePlatform: EffectiveRuntimePlatform
): string | undefined {
  if (!value) {
    return undefined;
  }

  return normalizePathForRuntime(value, runtimePlatform);
}

function mergeOperationState(
  installPolicy: ResolvedInstallPolicy,
  installRecord: InstallRecord | undefined,
  options: ApplyManifestOptions
): ResolvedOperationState {
  const runtimePlatform = installPolicy.effectiveRuntimePlatform;

  return {
    installScope:
      options.installScope ??
      installRecord?.installScope ??
      installPolicy.installScope,
    installRoot:
      normalizeRuntimeOverridePath(options.installRoot, runtimePlatform) ??
      installRecord?.installRoot ??
      installPolicy.installRoot,
    workRoot:
      normalizeRuntimeOverridePath(options.workRoot, runtimePlatform) ??
      installRecord?.workRoot ??
      installPolicy.workRoot,
    binDir:
      normalizeRuntimeOverridePath(options.binDir, runtimePlatform) ??
      installRecord?.binDir ??
      installPolicy.binDir,
    dataRoot:
      normalizeRuntimeOverridePath(options.dataRoot, runtimePlatform) ??
      installRecord?.dataRoot ??
      installPolicy.dataRoot,
    installControlLevel:
      options.installControlLevel ??
      installRecord?.installControlLevel ??
      installPolicy.installControlLevel,
    effectiveRuntimePlatform:
      options.effectiveRuntimePlatform ??
      installRecord?.effectiveRuntimePlatform ??
      installPolicy.effectiveRuntimePlatform
  };
}

function resolveApplyRuntime(
  loadedManifest: LoadedManifest,
  options: ApplyManifestOptions,
  platform: SupportedPlatform
): ResolvedApplyRuntime {
  const fileConfig = loadHubConfigFile({
    ...pickDefined({
      installerHome: options.installerHome,
      configPath: options.configPath
    }),
    env: process.env
  });
  const config = resolveHubConfig({
    cli: pickDefined({
      installerHome: options.installerHome,
      installScope: options.installScope,
      installRoot: options.installRoot,
      workRoot: options.workRoot,
      binDir: options.binDir,
      dataRoot: options.dataRoot
    }),
    file: fileConfig,
    env: process.env
  });
  const softwareName = resolveSoftwareName(loadedManifest, options);
  const effectiveRuntimePlatform =
    options.effectiveRuntimePlatform ??
    parseEffectiveRuntimePlatform(options.variables?.hub_effective_runtime_platform, platform) ??
    parseEffectiveRuntimePlatform(
      loadedManifest.manifest.variables?.hub_effective_runtime_platform,
      platform
    );
  const containerRuntime =
    options.containerRuntime ??
    parseContainerRuntimePreference(options.variables?.hub_container_runtime_preference) ??
    parseContainerRuntimePreference(
      loadedManifest.manifest.variables?.hub_container_runtime_preference
    );
  const executionContext = options.runtimeProbe
    ? resolveExecutionContextWithProbe(
        detectHostPlatform(),
        platform,
        pickDefined({
          effectiveRuntimePlatform,
          containerRuntime,
          wslDistribution:
            options.wslDistribution ??
            options.variables?.hub_wsl_distribution ??
            loadedManifest.manifest.variables?.hub_wsl_distribution,
          dockerContext:
            options.dockerContext ??
            options.variables?.hub_docker_context ??
            loadedManifest.manifest.variables?.hub_docker_context,
          dockerHost:
            options.dockerHost ??
            options.variables?.hub_docker_host ??
            loadedManifest.manifest.variables?.hub_docker_host
        }),
        options.runtimeProbe
      )
    : resolveExecutionContext(
        platform,
        pickDefined({
          effectiveRuntimePlatform,
          containerRuntime,
          wslDistribution:
            options.wslDistribution ??
            options.variables?.hub_wsl_distribution ??
            loadedManifest.manifest.variables?.hub_wsl_distribution,
          dockerContext:
            options.dockerContext ??
            options.variables?.hub_docker_context ??
            loadedManifest.manifest.variables?.hub_docker_context,
          dockerHost:
            options.dockerHost ??
            options.variables?.hub_docker_host ??
            loadedManifest.manifest.variables?.hub_docker_host
        })
      );
  const hostInstallerDirectories = resolveInstallerDirectories(
    pickDefined({
      installerHomeOverride: config.installerHome
    })
  );
  const runtimeInstallerHome =
    executionContext.effectiveRuntimePlatform === "wsl" &&
    !config.installerHome &&
    executionContext.runtimeHomeDir
      ? path.posix.join(executionContext.runtimeHomeDir, ".sdkwork", "hub-installer")
      : normalizePathForRuntime(
          config.installerHome ?? hostInstallerDirectories.home,
          executionContext.effectiveRuntimePlatform
        );
  const installerDirectories = resolveInstallerDirectories({
    installerHomeOverride: runtimeInstallerHome
  });
  const hostInstallerHome = resolveHostPathForRuntime(
    installerDirectories.home,
    executionContext
  );
  const hostStateDirectories = resolveInstallerDirectories({
    installerHomeOverride: hostInstallerHome
  });
  const installPolicy = resolveInstallPolicy({
    platform,
    softwareName,
    installerHome: installerDirectories.home,
    ...pickDefined({
      installScope: config.installScope,
      installRoot: config.installRoot,
      workRoot: config.workRoot,
      binDir: config.binDir,
      dataRoot: config.dataRoot,
      installControlLevel:
        options.installControlLevel ??
        parseInstallControlLevel(options.variables?.hub_install_control_level) ??
        parseInstallControlLevel(loadedManifest.manifest.variables?.hub_install_control_level),
      effectiveRuntimePlatform: executionContext.effectiveRuntimePlatform,
      env: process.env
    })
  });

  return {
    softwareName,
    installerDirectories,
    hostInstallerHome,
    hostInstallerDirectories: hostStateDirectories,
    installPolicy,
    executionContext,
    runtimeVariables: buildOperationRuntimeVariables(
      softwareName,
      installerDirectories,
      executionContext,
      toResolvedOperationState(installPolicy)
    )
  };
}

async function resolveManifestOperationContext(
  loadedManifest: LoadedManifest,
  options: ApplyManifestOptions,
  platform: SupportedPlatform
): Promise<ResolvedManifestOperationContext> {
  const runtime = resolveApplyRuntime(loadedManifest, options, platform);
  const runtimeInstallRecordFile = resolveInstallRecordFile(
    runtime.installPolicy.installerHome,
    runtime.softwareName
  );
  const installRecordFile = resolveInstallRecordFile(
    runtime.hostInstallerHome,
    runtime.softwareName
  );
  const installRecord = await readInstallRecord(
    runtime.hostInstallerHome,
    runtime.softwareName
  );

  return {
    ...runtime,
    runtimeInstallRecordFile,
    installRecordFile,
    resolvedState: mergeOperationState(runtime.installPolicy, installRecord, options),
    ...pickDefined({
      installRecord
    })
  };
}

function resolveManifestPath(baseDirectory: string, maybeRelativePath: string): string {
  if (path.isAbsolute(maybeRelativePath)) {
    return maybeRelativePath;
  }
  return path.resolve(baseDirectory, maybeRelativePath);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function printProgressLine(
  enabled: boolean,
  message: string,
  options?: {
    error?: boolean;
  }
): void {
  if (!enabled) {
    return;
  }

  if (options?.error) {
    console.error(message);
    return;
  }

  console.log(message);
}

function resolvePackageInstallRequest(
  artifact: PackageArtifact,
  platform: ResolvedInstallRequest["platform"]
): PackageInstallRequest {
  if ("byPlatform" in artifact.install) {
    const byPlatform = artifact.install as PackageInstallByPlatform;
    const selected = byPlatform.byPlatform[platform] ?? byPlatform.fallback;
    if (!selected) {
      throw new HubInstallerError(
        "MANIFEST_INSTALL_TARGET_MISSING",
        `Artifact "${artifact.id}" has no install target for platform "${platform}".`
      );
    }
    return selected;
  }

  return artifact.install;
}

async function runManifestCommandStage(input: {
  stageName: string;
  commands: ManifestCommand[];
  request: ResolvedInstallRequest;
  options: ResolvedApplyOptions;
  executionContext: ExecutionContext;
  defaults: HubInstallManifest["defaults"];
  baseDirectory: string;
  stageReports: StageReport[];
}): Promise<void> {
  const started = Date.now();
  const runnableCommands: ManifestCommand[] = [];

  for (const command of input.commands) {
    if (
      await conditionMatches(command.when, {
        platform: input.request.platform,
        baseDirectory: input.baseDirectory,
        executionContext: input.executionContext
      })
    ) {
      runnableCommands.push(command);
    }
  }

  const steps = runnableCommands.map((command, index) =>
    toInstallStep(command, {
      index,
      defaultCwd: input.request.cwd ?? input.baseDirectory,
      baseDirectory: input.baseDirectory,
      ...pickDefined({
        defaults: input.defaults
      })
    })
  );

  printProgressLine(
    input.options.progress,
    `[STAGE] ${input.stageName} (${steps.length} step${steps.length === 1 ? "" : "s"})`
  );

  if (steps.length === 0) {
    const stageDurationMs = Date.now() - started;
    input.stageReports.push({
      stage: input.stageName,
      success: true,
      durationMs: stageDurationMs,
      totalSteps: 0,
      failedSteps: 0
    });
    printProgressLine(input.options.progress, `[STAGE:SKIP] ${input.stageName} (${stageDurationMs}ms)`);
    return;
  }

  const plan = createPlan(input.request, steps);
  const result = await executePlan(
    plan,
    pickDefined({
      dryRun: input.options.dryRun,
      verbose: input.options.verbose,
      progress: input.options.progress,
      sudo: input.options.sudo,
      timeoutMs: input.options.timeoutMsResolved,
      executionContext: input.executionContext
    })
  );
  const stageDurationMs = Date.now() - started;
  const failedSteps = result.steps.filter(
    (step) => !step.success && !step.step.continueOnError
  ).length;

  input.stageReports.push({
    stage: input.stageName,
    success: result.success,
    durationMs: stageDurationMs,
    totalSteps: result.steps.length,
    failedSteps
  });
  printProgressLine(
    input.options.progress,
    `[STAGE:${result.success ? "OK" : "FAIL"}] ${input.stageName} (${result.steps.length} steps, ${failedSteps} failed, ${stageDurationMs}ms)`
  );

  if (!result.success) {
    const failedStep = result.steps.find(
      (step) => !step.success && !step.step.continueOnError
    );
    const failedStepDetail = failedStep
      ? [
          `Failed step id: ${failedStep.step.id}`,
          `Failed step: ${failedStep.step.description}`,
          `Command: ${truncateText(failedStep.commandLine, 320)}`,
          `Exit code: ${failedStep.exitCode ?? "unknown"}`,
          failedStep.stderr ? `stderr: ${truncateText(failedStep.stderr, 640)}` : undefined
        ]
          .filter(Boolean)
          .join(" | ")
      : undefined;

    throw new HubInstallerError(
      "MANIFEST_STAGE_FAILED",
      [
        `Lifecycle stage "${input.stageName}" failed.`,
        failedStepDetail
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

async function checkDependency(
  check: DependencyCheck,
  platform: ResolvedInstallRequest["platform"],
  baseDirectory: string,
  executionContext: ExecutionContext
): Promise<boolean> {
  switch (check.type) {
    case "command":
      return commandExists(check.name, executionContext);
    case "file":
      return existsSync(
        resolveHostPathForRuntime(resolveManifestPath(baseDirectory, check.path), executionContext)
      );
    case "env":
      if (check.equals === undefined) {
        return Boolean(process.env[check.name]);
      }
      return (process.env[check.name] ?? "") === check.equals;
    case "platform":
      return check.platforms.includes(platform);
    default:
      return false;
  }
}

async function runDependency(
  dependency: ManifestDependency,
  context: {
    request: ResolvedInstallRequest;
    options: ResolvedApplyOptions;
    executionContext: ExecutionContext;
    defaults: HubInstallManifest["defaults"];
    baseDirectory: string;
    stageReports: StageReport[];
  }
): Promise<void> {
  const satisfied = await checkDependency(
    dependency.check,
    context.request.platform,
    context.baseDirectory,
    context.executionContext
  );
  if (satisfied) {
    return;
  }

  if (dependency.install && dependency.install.length > 0) {
    await runManifestCommandStage({
      stageName: `dependency:${dependency.id}`,
      commands: dependency.install,
      request: context.request,
      options: context.options,
      executionContext: context.executionContext,
      defaults: context.defaults,
      baseDirectory: context.baseDirectory,
      stageReports: context.stageReports
    });
  }

  const satisfiedAfterInstall = await checkDependency(
    dependency.check,
    context.request.platform,
    context.baseDirectory,
    context.executionContext
  );

  if (!satisfiedAfterInstall && dependency.required !== false) {
    throw new HubInstallerError(
      "DEPENDENCY_CHECK_FAILED",
      `Dependency "${dependency.id}" is not satisfied.`
    );
  }
}

async function runPackageArtifact(
  artifact: PackageArtifact,
  context: {
    platform: ResolvedInstallRequest["platform"];
    baseDirectory: string;
    options: ResolvedApplyOptions;
    installerEngine: InstallerEngine;
  }
): Promise<void> {
  const installRequest = resolvePackageInstallRequest(artifact, context.platform);
  const source = installRequest.source;
  const resolvedSource =
    isManagerSource(source) || isLikelyUrl(source)
      ? source
      : resolveManifestPath(context.baseDirectory, source);

  const request: InstallRequest = {
    ...installRequest,
    source: resolvedSource,
    platform: installRequest.platform ?? context.platform,
    dryRun: context.options.dryRun,
    verbose: context.options.verbose,
    progress: context.options.progress,
    sudo: installRequest.sudo ?? context.options.sudo,
    ...pickDefined({
      timeoutMs: installRequest.timeoutMs ?? context.options.timeoutMsResolved,
      cwd: installRequest.cwd
        ? resolveManifestPath(context.baseDirectory, installRequest.cwd)
        : context.options.cwd
    })
  };

  const result = await context.installerEngine.install(request);
  if (!result.success) {
    throw new HubInstallerError(
      "ARTIFACT_INSTALL_FAILED",
      `Package artifact "${artifact.id}" installation failed.`
    );
  }
}

function buildGitCommands(artifact: GitArtifact, baseDirectory: string): ManifestCommand[] {
  const destination = resolveManifestPath(baseDirectory, artifact.destination);
  const strategy = artifact.strategy ?? "clone-or-pull";
  const exists = existsSync(path.join(destination, ".git"));
  const commands: ManifestCommand[] = [];

  if (!exists) {
    if (strategy === "pull-only") {
      throw new HubInstallerError(
        "ARTIFACT_GIT_MISSING_REPO",
        `Git artifact "${artifact.id}" uses pull-only strategy but destination does not exist: ${destination}`
      );
    }

    const depthArg = artifact.cloneDepth ? ` --depth ${artifact.cloneDepth}` : "";
    commands.push({
      description: "Clone repository",
      run: `git clone${depthArg} ${toQuoted(artifact.repository)} ${toQuoted(destination)}`
    });
  } else if (strategy !== "clone-only") {
    commands.push({
      description: "Fetch remote updates",
      run: `git -C ${toQuoted(destination)} fetch --all --tags`
    });
    if (!artifact.ref) {
      commands.push({
        description: "Pull latest changes",
        run: `git -C ${toQuoted(destination)} pull --ff-only`
      });
    }
  }

  if (artifact.ref) {
    commands.push({
      description: "Checkout target ref",
      run: `git -C ${toQuoted(destination)} checkout ${toQuoted(artifact.ref)}`
    });
  }

  if (artifact.submodules) {
    commands.push({
      description: "Sync git submodules",
      run: `git -C ${toQuoted(destination)} submodule update --init --recursive`
    });
  }

  if (artifact.lfs) {
    commands.push({
      description: "Pull git-lfs assets",
      run: `git -C ${toQuoted(destination)} lfs pull`
    });
  }

  if (artifact.build && artifact.build.length > 0) {
    commands.push(...artifact.build);
  }

  return commands;
}

function buildHuggingFaceCommands(
  artifact: HuggingFaceArtifact,
  baseDirectory: string
): ManifestCommand[] {
  const destination = resolveManifestPath(baseDirectory, artifact.destination);
  const method = artifact.method ?? "git-lfs";
  const commands: ManifestCommand[] = [];

  if (method === "git-lfs") {
    const repoUrl = `https://huggingface.co/${artifact.repoId}`;
    const exists = existsSync(path.join(destination, ".git"));

    if (!exists) {
      commands.push({
        description: "Clone HuggingFace repository",
        run: `git clone ${toQuoted(repoUrl)} ${toQuoted(destination)}`
      });
    } else {
      commands.push({
        description: "Fetch HuggingFace repository updates",
        run: `git -C ${toQuoted(destination)} fetch --all --tags`
      });
    }

    if (artifact.revision) {
      commands.push({
        description: "Checkout HuggingFace revision",
        run: `git -C ${toQuoted(destination)} checkout ${toQuoted(artifact.revision)}`
      });
    }

    commands.push({
      description: "Download LFS blobs",
      run: `git -C ${toQuoted(destination)} lfs pull`
    });

    return commands;
  }

  const includeArgs = (artifact.include ?? [])
    .map((entry) => ` --include ${toQuoted(entry)}`)
    .join("");
  const excludeArgs = (artifact.exclude ?? [])
    .map((entry) => ` --exclude ${toQuoted(entry)}`)
    .join("");
  const revisionArg = artifact.revision ? ` --revision ${toQuoted(artifact.revision)}` : "";

  commands.push({
    description: "Download model via huggingface-cli",
    run:
      `huggingface-cli download ${toQuoted(artifact.repoId)} --local-dir ${toQuoted(destination)}` +
      `${revisionArg}${includeArgs}${excludeArgs}`
  });

  return commands;
}

async function runArtifact(
  artifact: ManifestArtifact,
  context: {
    request: ResolvedInstallRequest;
    options: ResolvedApplyOptions;
    executionContext: ExecutionContext;
    defaults: HubInstallManifest["defaults"];
    baseDirectory: string;
    installerEngine: InstallerEngine;
    stageReports: StageReport[];
    artifactReports: ArtifactReport[];
  }
): Promise<void> {
  const artifactStart = Date.now();
  printProgressLine(
    context.options.progress,
    `[ARTIFACT] ${artifact.id} (${artifact.type})`
  );

  try {
    if (artifact.enabled === false) {
      const artifactDurationMs = Date.now() - artifactStart;
      context.artifactReports.push({
        artifactId: artifact.id,
        artifactType: artifact.type,
        success: true,
        durationMs: artifactDurationMs,
        detail: "Skipped because enabled=false"
      });
      printProgressLine(
        context.options.progress,
        `[ARTIFACT:SKIP] ${artifact.id} (enabled=false, ${artifactDurationMs}ms)`
      );
      return;
    }

    const shouldRun = await conditionMatches(artifact.when, {
      platform: context.request.platform,
      baseDirectory: context.baseDirectory,
      executionContext: context.executionContext
    });

    if (!shouldRun) {
      const artifactDurationMs = Date.now() - artifactStart;
      context.artifactReports.push({
        artifactId: artifact.id,
        artifactType: artifact.type,
        success: true,
        durationMs: artifactDurationMs,
        detail: "Skipped by condition"
      });
      printProgressLine(
        context.options.progress,
        `[ARTIFACT:SKIP] ${artifact.id} (condition=false, ${artifactDurationMs}ms)`
      );
      return;
    }

    if (artifact.preInstall && artifact.preInstall.length > 0) {
      await runManifestCommandStage({
        stageName: `artifact:${artifact.id}:preInstall`,
        commands: artifact.preInstall,
        request: context.request,
        options: context.options,
        executionContext: context.executionContext,
        defaults: context.defaults,
        baseDirectory: context.baseDirectory,
        stageReports: context.stageReports
      });
    }

    if (artifact.type === "package") {
      await runPackageArtifact(artifact, {
        platform: context.request.platform,
        baseDirectory: context.baseDirectory,
        options: context.options,
        installerEngine: context.installerEngine
      });
    } else if (artifact.type === "git") {
      const commands = buildGitCommands(artifact, context.baseDirectory);
      await runManifestCommandStage({
        stageName: `artifact:${artifact.id}:git`,
        commands,
        request: context.request,
        options: context.options,
        executionContext: context.executionContext,
        defaults: context.defaults,
        baseDirectory: context.baseDirectory,
        stageReports: context.stageReports
      });
    } else if (artifact.type === "huggingface") {
      if (artifact.tokenEnv && !process.env[artifact.tokenEnv]) {
        throw new HubInstallerError(
          "MISSING_ENV",
          `HuggingFace artifact "${artifact.id}" requires env var "${artifact.tokenEnv}".`
        );
      }
      const commands = buildHuggingFaceCommands(artifact, context.baseDirectory);
      await runManifestCommandStage({
        stageName: `artifact:${artifact.id}:huggingface`,
        commands,
        request: context.request,
        options: context.options,
        executionContext: context.executionContext,
        defaults: context.defaults,
        baseDirectory: context.baseDirectory,
        stageReports: context.stageReports
      });
    } else if (artifact.type === "command") {
      await runManifestCommandStage({
        stageName: `artifact:${artifact.id}:command`,
        commands: artifact.commands,
        request: context.request,
        options: context.options,
        executionContext: context.executionContext,
        defaults: context.defaults,
        baseDirectory: context.baseDirectory,
        stageReports: context.stageReports
      });
    }

    if (artifact.postInstall && artifact.postInstall.length > 0) {
      await runManifestCommandStage({
        stageName: `artifact:${artifact.id}:postInstall`,
        commands: artifact.postInstall,
        request: context.request,
        options: context.options,
        executionContext: context.executionContext,
        defaults: context.defaults,
        baseDirectory: context.baseDirectory,
        stageReports: context.stageReports
      });
    }

    if (artifact.configure && artifact.configure.length > 0) {
      await runManifestCommandStage({
        stageName: `artifact:${artifact.id}:configure`,
        commands: artifact.configure,
        request: context.request,
        options: context.options,
        executionContext: context.executionContext,
        defaults: context.defaults,
        baseDirectory: context.baseDirectory,
        stageReports: context.stageReports
      });
    }

    const artifactDurationMs = Date.now() - artifactStart;
    context.artifactReports.push({
      artifactId: artifact.id,
      artifactType: artifact.type,
      success: true,
      durationMs: artifactDurationMs
    });
    printProgressLine(
      context.options.progress,
      `[ARTIFACT:OK] ${artifact.id} (${artifactDurationMs}ms)`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const artifactDurationMs = Date.now() - artifactStart;
    context.artifactReports.push({
      artifactId: artifact.id,
      artifactType: artifact.type,
      success: false,
      durationMs: artifactDurationMs,
      detail: message
    });
    printProgressLine(
      context.options.progress,
      `[ARTIFACT:FAIL] ${artifact.id} (${artifactDurationMs}ms)`,
      { error: true }
    );
    throw error;
  }
}

function renderAndPrepareManifest(
  loadedManifest: LoadedManifest,
  options: ApplyManifestOptions,
  platform: ResolvedInstallRequest["platform"],
  runtimeVariables: Record<string, string>
): HubInstallManifest {
  const variables = buildRuntimeVariables({
    baseDirectory: loadedManifest.baseDirectory,
    platform,
    ...pickDefined({
      runtimeVariables,
      manifestVariables: loadedManifest.manifest.variables,
      overrideVariables: options.variables,
      cwd: options.cwd
    })
  });

  return renderTemplateDeep(loadedManifest.manifest, variables);
}

async function runLifecycleStage(
  stageName: (typeof LIFECYCLE_STAGES)[number],
  context: {
    manifest: HubInstallManifest;
    request: ResolvedInstallRequest;
    options: ResolvedApplyOptions;
    executionContext: ExecutionContext;
    defaults: HubInstallManifest["defaults"];
    baseDirectory: string;
    stageReports: StageReport[];
  }
): Promise<void> {
  const commands = context.manifest.lifecycle?.[stageName] ?? [];
  if (commands.length === 0) {
    return;
  }

  await runManifestCommandStage({
    stageName: `lifecycle:${stageName}`,
    commands,
    request: context.request,
    options: context.options,
    executionContext: context.executionContext,
    defaults: context.defaults,
    baseDirectory: context.baseDirectory,
    stageReports: context.stageReports
  });
}

function resolveExecutionOptions(
  baseDirectory: string,
  defaults: HubInstallManifest["defaults"],
  options: ApplyManifestOptions
): ResolvedApplyOptions {
  const cwd = options.cwd
    ? resolveManifestPath(baseDirectory, options.cwd)
    : defaults?.cwd
      ? resolveManifestPath(baseDirectory, defaults.cwd)
      : baseDirectory;

  return {
    dryRun: options.dryRun ?? false,
    verbose: options.verbose ?? false,
    progress: options.progress ?? false,
    sudo: options.sudo ?? defaults?.sudo ?? false,
    cwd,
    ...pickDefined({
      timeoutMs: options.timeoutMs,
      timeoutMsResolved: options.timeoutMs ?? defaults?.timeoutMs
    })
  };
}

function normalizeBackupTargets(targets: BackupTarget[] | undefined): BackupTarget[] {
  const normalized = targets?.length ? targets : ["data"];
  return [...new Set(normalized)] as BackupTarget[];
}

function targetPathForState(state: ResolvedOperationState, target: BackupTarget): string {
  switch (target) {
    case "data":
      return state.dataRoot;
    case "install":
      return state.installRoot;
    case "work":
      return state.workRoot;
  }
}

function hostTargetPathForState(
  runtime: ResolvedManifestOperationContext,
  target: BackupTarget
): string {
  return resolveHostPathForRuntime(
    targetPathForState(runtime.resolvedState, target),
    runtime.executionContext
  );
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-zA-Z]:\//.test(normalized) || value.includes("\\")) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function isSameOrNestedPath(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeComparablePath(candidate);
  const normalizedParent = normalizeComparablePath(parent);

  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}/`)
  );
}

function joinPathLikeBase(base: string, ...segments: string[]): string {
  if (/^[a-zA-Z]:[\\/]/.test(base) || base.startsWith("\\\\")) {
    return path.win32.join(base, ...segments);
  }

  if (base.startsWith("/")) {
    return path.posix.join(base, ...segments);
  }

  return path.join(base, ...segments);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyPath(sourcePath: string, destinationPath: string): Promise<void> {
  const stats = await lstat(sourcePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, {
    recursive: stats.isDirectory(),
    force: true
  });
}

function buildBackupRuntimeExtras(
  installerHome: string,
  softwareName: string,
  sessionId: string,
  installRecordFile: string,
  installStatus: string
): RuntimeVariableExtras & { backupSessionDir: string } {
  const backupRoot = resolveBackupRootDirectory(installerHome, softwareName);
  const backupSessionDir = resolveBackupSessionDirectory(
    installerHome,
    softwareName,
    sessionId
  );

  return {
    backupRoot,
    backupSessionDir,
    backupDataDir: joinPathLikeBase(backupSessionDir, "data"),
    backupInstallDir: joinPathLikeBase(backupSessionDir, "install"),
    backupWorkDir: joinPathLikeBase(backupSessionDir, "work"),
    installRecordFile,
    installStatus
  };
}

async function copyBackupTarget(
  target: BackupTarget,
  sourcePath: string,
  backupSessionDir: string,
  dryRun: boolean
): Promise<BackupTargetReport> {
  const destinationPath = path.join(backupSessionDir, target);
  if (!(await pathExists(sourcePath))) {
    return {
      target,
      status: "missing"
    };
  }

  if (!dryRun) {
    await copyPath(sourcePath, destinationPath);
  }

  return {
    target,
    status: "copied"
  };
}

async function removeManagedTarget(
  target: BackupTarget,
  targetPath: string,
  preservedPaths: string[],
  dryRun: boolean
): Promise<UninstallTargetReport> {
  if (target === "data" && preservedPaths.includes(targetPath)) {
    return {
      target,
      status: "preserved"
    };
  }

  const overlapsPreservedPath = preservedPaths.some((preservedPath) =>
    isSameOrNestedPath(preservedPath, targetPath)
  );

  if (overlapsPreservedPath) {
    return {
      target,
      status: "preserved"
    };
  }

  if (!(await pathExists(targetPath))) {
    return {
      target,
      status: "missing"
    };
  }

  if (!dryRun) {
    await rm(targetPath, { recursive: true, force: true });
  }

  return {
    target,
    status: "removed"
  };
}

function buildInstallRecord(input: {
  loadedManifest: LoadedManifest;
  runtime: ResolvedManifestOperationContext;
  state: ResolvedOperationState;
  platform: SupportedPlatform;
  endedAt: string;
  status: InstallRecord["status"];
}): InstallRecord {
  const previousRecord = input.runtime.installRecord;
  const installedAt =
    input.status === "installed"
      ? previousRecord?.installedAt ?? input.endedAt
      : previousRecord?.installedAt;

  return {
    schemaVersion: "1.0",
    softwareName: input.runtime.softwareName,
    manifestName: input.loadedManifest.manifest.metadata.name,
    manifestPath: input.loadedManifest.absolutePath,
    manifestSourceInput: input.loadedManifest.sourceInput,
    manifestSourceKind: input.loadedManifest.sourceKind,
    platform: input.platform,
    effectiveRuntimePlatform: input.state.effectiveRuntimePlatform,
    installerHome: input.runtime.installPolicy.installerHome,
    installScope: input.state.installScope,
    installRoot: input.state.installRoot,
    workRoot: input.state.workRoot,
    binDir: input.state.binDir,
    dataRoot: input.state.dataRoot,
    installControlLevel: input.state.installControlLevel,
    status: input.status,
    updatedAt: input.endedAt,
    ...pickDefined({
      installedAt
    }),
    ...pickDefined({
      registry: previousRecord?.registry
    })
  };
}

export async function applyManifest(
  loadedManifest: LoadedManifest,
  options: ApplyManifestOptions = {}
): Promise<ApplyManifestResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const platform = options.platform ?? detectHostPlatform();
  const runtime = await resolveManifestOperationContext(loadedManifest, options, platform);
  const manifest = renderAndPrepareManifest(
    loadedManifest,
    options,
    platform,
    buildOperationRuntimeVariables(
      runtime.softwareName,
      runtime.installerDirectories,
      runtime.executionContext,
      runtime.resolvedState,
      {
        installRecordFile: runtime.runtimeInstallRecordFile,
        installStatus: runtime.installRecord?.status ?? ""
      }
    )
  );
  const defaults = manifest.defaults ?? {};
  const baseDirectory = loadedManifest.baseDirectory;

  if (manifest.platforms && !manifest.platforms.includes(platform)) {
    throw new HubInstallerError(
      "MANIFEST_PLATFORM_UNSUPPORTED",
      `Manifest "${manifest.metadata.name}" does not support platform "${platform}".`
    );
  }

  const optionsResolved = resolveExecutionOptions(baseDirectory, defaults, options);

  const syntheticRequest = createSyntheticRequest(
    platform,
    optionsResolved.cwd,
    optionsResolved.timeoutMsResolved
  );
  const stageReports: StageReport[] = [];
  const artifactReports: ArtifactReport[] = [];
  const installerEngine = new InstallerEngine();

  await runLifecycleStage("preflight", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  for (const dependency of manifest.dependencies ?? []) {
    await runDependency(dependency, {
      request: syntheticRequest,
      options: optionsResolved,
      executionContext: runtime.executionContext,
      defaults,
      baseDirectory,
      stageReports
    });
  }

  await runLifecycleStage("preInstall", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  await runLifecycleStage("install", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  for (const artifact of manifest.artifacts) {
    await runArtifact(artifact, {
      request: syntheticRequest,
      options: optionsResolved,
      executionContext: runtime.executionContext,
      defaults,
      baseDirectory,
      installerEngine,
      stageReports,
      artifactReports
    });
  }

  await runLifecycleStage("postInstall", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  await runLifecycleStage("configure", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  await runLifecycleStage("healthcheck", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  const ended = Date.now();
  const endedAt = new Date(ended).toISOString();
  const success =
    stageReports.every((stage) => stage.success) &&
    artifactReports.every((artifact) => artifact.success);

  if (success && !optionsResolved.dryRun) {
    await writeInstallRecord(
      runtime.hostInstallerHome,
      runtime.softwareName,
      buildInstallRecord({
        loadedManifest,
        runtime,
        state: runtime.resolvedState,
        platform,
        endedAt,
        status: "installed"
      })
    );
  }

  return {
    manifestName: manifest.metadata.name,
    manifestPath: loadedManifest.absolutePath,
    manifestSourceInput: loadedManifest.sourceInput,
    manifestSourceKind: loadedManifest.sourceKind,
    platform,
    installerHome: runtime.installPolicy.installerHome,
    resolvedInstallScope: runtime.resolvedState.installScope,
    resolvedInstallRoot: runtime.resolvedState.installRoot,
    resolvedWorkRoot: runtime.resolvedState.workRoot,
    resolvedBinDir: runtime.resolvedState.binDir,
    resolvedDataRoot: runtime.resolvedState.dataRoot,
    installControlLevel: runtime.resolvedState.installControlLevel,
    effectiveRuntimePlatform: runtime.resolvedState.effectiveRuntimePlatform,
    ...pickDefined({
      containerRuntime: runtime.executionContext.containerRuntime,
      wslDistribution: runtime.executionContext.wslDistribution
    }),
    success,
    startedAt,
    endedAt,
    durationMs: ended - started,
    stageReports,
    artifactReports
  };
}

export async function backupManifest(
  loadedManifest: LoadedManifest,
  options: BackupManifestOptions = {}
): Promise<BackupManifestResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const platform = options.platform ?? detectHostPlatform();
  const runtime = await resolveManifestOperationContext(loadedManifest, options, platform);
  const sessionId = options.sessionId ?? startedAt;
  const backupRuntime = buildBackupRuntimeExtras(
    runtime.installPolicy.installerHome,
    runtime.softwareName,
    sessionId,
    runtime.runtimeInstallRecordFile,
    runtime.installRecord?.status ?? ""
  );
  const hostBackupSessionDir = resolveBackupSessionDirectory(
    runtime.hostInstallerHome,
    runtime.softwareName,
    sessionId
  );
  const manifest = renderAndPrepareManifest(
    loadedManifest,
    options,
    platform,
    buildOperationRuntimeVariables(
      runtime.softwareName,
      runtime.installerDirectories,
      runtime.executionContext,
      runtime.resolvedState,
      backupRuntime
    )
  );
  const defaults = manifest.defaults ?? {};
  const baseDirectory = loadedManifest.baseDirectory;

  if (manifest.platforms && !manifest.platforms.includes(platform)) {
    throw new HubInstallerError(
      "MANIFEST_PLATFORM_UNSUPPORTED",
      `Manifest "${manifest.metadata.name}" does not support platform "${platform}".`
    );
  }

  const optionsResolved = resolveExecutionOptions(baseDirectory, defaults, options);
  const syntheticRequest = createSyntheticRequest(
    platform,
    optionsResolved.cwd,
    optionsResolved.timeoutMsResolved
  );
  const stageReports: StageReport[] = [];
  const targetReports: BackupTargetReport[] = [];

  await runLifecycleStage("backup", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  const targets = normalizeBackupTargets(options.targets);
  if (!optionsResolved.dryRun) {
    await mkdir(hostBackupSessionDir, { recursive: true });
  }

  for (const target of targets) {
    targetReports.push(
      await copyBackupTarget(
        target,
        hostTargetPathForState(runtime, target),
        hostBackupSessionDir,
        optionsResolved.dryRun
      )
    );
  }

  const ended = Date.now();
  const endedAt = new Date(ended).toISOString();

  return {
    manifestName: manifest.metadata.name,
    manifestPath: loadedManifest.absolutePath,
    manifestSourceInput: loadedManifest.sourceInput,
    manifestSourceKind: loadedManifest.sourceKind,
    platform,
    installerHome: runtime.installPolicy.installerHome,
    resolvedInstallScope: runtime.resolvedState.installScope,
    resolvedInstallRoot: runtime.resolvedState.installRoot,
    resolvedWorkRoot: runtime.resolvedState.workRoot,
    resolvedBinDir: runtime.resolvedState.binDir,
    resolvedDataRoot: runtime.resolvedState.dataRoot,
    installControlLevel: runtime.resolvedState.installControlLevel,
    effectiveRuntimePlatform: runtime.resolvedState.effectiveRuntimePlatform,
    ...pickDefined({
      containerRuntime: runtime.executionContext.containerRuntime,
      wslDistribution: runtime.executionContext.wslDistribution
    }),
    installRecordFile: runtime.installRecordFile,
    installRecordFound: Boolean(runtime.installRecord),
    backupSessionDir: hostBackupSessionDir,
    success: stageReports.every((stage) => stage.success),
    startedAt,
    endedAt,
    durationMs: ended - started,
    stageReports,
    targetReports
  };
}

export async function uninstallManifest(
  loadedManifest: LoadedManifest,
  options: UninstallManifestOptions = {}
): Promise<UninstallManifestResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const platform = options.platform ?? detectHostPlatform();
  const runtime = await resolveManifestOperationContext(loadedManifest, options, platform);
  const backupSessionId = options.backupSessionId ?? startedAt;
  const backupResult = options.backupBeforeUninstall
    ? await backupManifest(loadedManifest, {
        ...options,
        ...pickDefined({
          targets: options.backupTargets,
          sessionId: backupSessionId
        })
      })
    : undefined;
  const uninstallRuntimeExtras = options.backupBeforeUninstall
    ? buildBackupRuntimeExtras(
        runtime.installPolicy.installerHome,
        runtime.softwareName,
        backupSessionId,
        runtime.runtimeInstallRecordFile,
        runtime.installRecord?.status ?? ""
      )
    : {
        installRecordFile: runtime.runtimeInstallRecordFile,
        installStatus: runtime.installRecord?.status ?? ""
      };
  const manifest = renderAndPrepareManifest(
    loadedManifest,
    options,
    platform,
    buildOperationRuntimeVariables(
      runtime.softwareName,
      runtime.installerDirectories,
      runtime.executionContext,
      runtime.resolvedState,
      uninstallRuntimeExtras
    )
  );
  const defaults = manifest.defaults ?? {};
  const baseDirectory = loadedManifest.baseDirectory;

  if (manifest.platforms && !manifest.platforms.includes(platform)) {
    throw new HubInstallerError(
      "MANIFEST_PLATFORM_UNSUPPORTED",
      `Manifest "${manifest.metadata.name}" does not support platform "${platform}".`
    );
  }

  const optionsResolved = resolveExecutionOptions(baseDirectory, defaults, options);
  const syntheticRequest = createSyntheticRequest(
    platform,
    optionsResolved.cwd,
    optionsResolved.timeoutMsResolved
  );
  const stageReports: StageReport[] = [];

  await runLifecycleStage("uninstall", {
    manifest,
    request: syntheticRequest,
    options: optionsResolved,
    executionContext: runtime.executionContext,
    defaults,
    baseDirectory,
    stageReports
  });

  const hostDataRoot = hostTargetPathForState(runtime, "data");
  const hostInstallRoot = hostTargetPathForState(runtime, "install");
  const hostWorkRoot = hostTargetPathForState(runtime, "work");
  const dataPathExists = await pathExists(hostDataRoot);
  const preservedPaths = !options.purgeData && dataPathExists ? [hostDataRoot] : [];
  const targetReports: UninstallTargetReport[] = [
    await removeManagedTarget(
      "install",
      hostInstallRoot,
      preservedPaths,
      optionsResolved.dryRun
    ),
    await removeManagedTarget(
      "work",
      hostWorkRoot,
      preservedPaths,
      optionsResolved.dryRun
    ),
    options.purgeData
      ? await removeManagedTarget(
          "data",
          hostDataRoot,
          [],
          optionsResolved.dryRun
        )
      : {
          target: "data",
          status: dataPathExists ? "preserved" : "missing"
        }
  ];

  const ended = Date.now();
  const endedAt = new Date(ended).toISOString();
  const success = stageReports.every((stage) => stage.success);

  if (success && !optionsResolved.dryRun) {
    await writeInstallRecord(
      runtime.hostInstallerHome,
      runtime.softwareName,
      buildInstallRecord({
        loadedManifest,
        runtime,
        state: runtime.resolvedState,
        platform,
        endedAt,
        status: "uninstalled"
      })
    );
  }

  return {
    manifestName: manifest.metadata.name,
    manifestPath: loadedManifest.absolutePath,
    manifestSourceInput: loadedManifest.sourceInput,
    manifestSourceKind: loadedManifest.sourceKind,
    platform,
    installerHome: runtime.installPolicy.installerHome,
    resolvedInstallScope: runtime.resolvedState.installScope,
    resolvedInstallRoot: runtime.resolvedState.installRoot,
    resolvedWorkRoot: runtime.resolvedState.workRoot,
    resolvedBinDir: runtime.resolvedState.binDir,
    resolvedDataRoot: runtime.resolvedState.dataRoot,
    installControlLevel: runtime.resolvedState.installControlLevel,
    effectiveRuntimePlatform: runtime.resolvedState.effectiveRuntimePlatform,
    ...pickDefined({
      containerRuntime: runtime.executionContext.containerRuntime,
      wslDistribution: runtime.executionContext.wslDistribution
    }),
    installRecordFile: runtime.installRecordFile,
    installRecordFound: Boolean(runtime.installRecord),
    purgeData: options.purgeData ?? false,
    success,
    startedAt,
    endedAt,
    durationMs: ended - started,
    stageReports,
    targetReports,
    ...pickDefined({
      backupResult
    })
  };
}

async function loadManifestForExecution(
  manifestSource: string,
  options: ApplyManifestOptions = {}
): Promise<LoadedManifest> {
  const fileConfig = loadHubConfigFile({
    ...pickDefined({
      installerHome: options.installerHome,
      configPath: options.configPath
    }),
    env: process.env
  });
  const config = resolveHubConfig({
    cli: pickDefined({
      installerHome: options.installerHome
    }),
    file: fileConfig,
    env: process.env
  });
  const loadedManifest = await loadManifestFromSource(
    manifestSource,
    pickDefined({
      cacheDir:
        options.manifestCacheDir ??
        (config.installerHome
          ? resolveInstallerDirectories(
              pickDefined({
                installerHomeOverride: config.installerHome
              })
            ).manifestCacheDir
          : undefined),
      fetchTimeoutMs: options.manifestFetchTimeoutMs
    })
  );
  return loadedManifest;
}

export async function applyManifestFile(
  manifestSource: string,
  options: ApplyManifestOptions = {}
): Promise<ApplyManifestResult> {
  const loadedManifest = await loadManifestForExecution(manifestSource, options);
  return applyManifest(loadedManifest, options);
}

export async function backupManifestFile(
  manifestSource: string,
  options: BackupManifestOptions = {}
): Promise<BackupManifestResult> {
  const loadedManifest = await loadManifestForExecution(manifestSource, options);
  return backupManifest(loadedManifest, options);
}

export async function uninstallManifestFile(
  manifestSource: string,
  options: UninstallManifestOptions = {}
): Promise<UninstallManifestResult> {
  const loadedManifest = await loadManifestForExecution(manifestSource, options);
  return uninstallManifest(loadedManifest, options);
}
