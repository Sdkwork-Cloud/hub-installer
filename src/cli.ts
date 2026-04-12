import { Command } from "commander";
import { detectHostPlatform } from "./core/platform";
import { detectPackageFormat, resolveSourceReference } from "./core/source";
import { InstallerEngine } from "./core/engine";
import {
  applyManifestFile,
  backupManifestFile,
  uninstallManifestFile,
  loadManifestFromSource
} from "./manifest";
import {
  backupSoftwareFromRegistry,
  getDefaultRegistrySource,
  getRegistryEntry,
  installSoftwareFromRegistry,
  listRegistryEntries,
  runRegistryDoctor,
  uninstallSoftwareFromRegistry,
  type DoctorTarget,
  type RegistryDoctorReport
} from "./registry";
import { HubInstallerError } from "./errors";
import {
  SUPPORTED_FORMATS,
  SUPPORTED_PLATFORMS,
  type InstallExecutionResult,
  type InstallPlan
} from "./types";
import { detectInstallMode } from "./cli-install-mode";
import { normalizeCliArgv } from "./cli-argv";
import { collectInstallPolicyOptions } from "./cli-install-policy";
import {
  formatApplyResult,
  formatBackupResult,
  formatRegistryBackupResult,
  formatRegistryInstallResult,
  formatRegistryUninstallResult,
  formatUninstallResult
} from "./cli-output";
import { pickDefined } from "./core/pick-defined";
import {
  hasRegistryShortcutOptions,
  resolveRegistryInstallShortcuts
} from "./cli-registry-shortcuts";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectBackupTarget(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function normalizeBackupTargets(input: string[] | undefined, label: string): Array<"data" | "install" | "work"> | undefined {
  if (!input || input.length === 0) {
    return undefined;
  }

  const normalized = new Set<"data" | "install" | "work">();

  for (const rawValue of input) {
    const value = rawValue.trim().toLowerCase();
    if (!value) {
      continue;
    }

    if (value === "all") {
      normalized.add("data");
      normalized.add("install");
      normalized.add("work");
      continue;
    }

    if (value === "data" || value === "install" || value === "work") {
      normalized.add(value);
      continue;
    }

    throw new HubInstallerError(
      "INVALID_ARGUMENT",
      `Invalid ${label}: "${rawValue}". Expected data, install, work, or all.`
    );
  }

  return [...normalized];
}

function parseOptionalNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HubInstallerError(
      "INVALID_ARGUMENT",
      `Invalid ${label}: "${value}". Expected a positive number.`
    );
  }
  return parsed;
}

function collectKeyValue(value: string, previous: Record<string, string>): Record<string, string> {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0) {
    throw new HubInstallerError(
      "INVALID_ARGUMENT",
      `Invalid --var value "${value}". Expected key=value format.`
    );
  }

  const key = value.slice(0, separatorIndex).trim();
  const rawValue = value.slice(separatorIndex + 1);

  if (!key) {
    throw new HubInstallerError(
      "INVALID_ARGUMENT",
      `Invalid --var value "${value}". Variable key cannot be empty.`
    );
  }

  return {
    ...previous,
    [key]: rawValue
  };
}

function formatPlan(plan: InstallPlan): string {
  const lines: string[] = [];
  lines.push(`Platform: ${plan.request.platform}`);
  lines.push(`Format: ${plan.request.format}`);
  lines.push(`Source: ${plan.request.source}`);
  lines.push("");
  lines.push("Steps:");
  for (const [index, step] of plan.steps.entries()) {
    const suffix = step.shell ? " (shell)" : "";
    lines.push(`  ${index + 1}. ${step.description}${suffix}`);
    const commandLine = step.shell
      ? step.command
      : [step.command, ...(step.args ?? [])].join(" ");
    lines.push(`     ${commandLine}`);
  }

  if (plan.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of plan.notes) {
      lines.push(`  - ${note}`);
    }
  }

  return lines.join("\n");
}

function truncateForDisplay(value: string, maxLength = 600): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function formatExecutionResult(result: InstallExecutionResult): string {
  const lines: string[] = [];
  lines.push(`Platform: ${result.plan.request.platform}`);
  lines.push(`Format: ${result.plan.request.format}`);
  lines.push(`Success: ${result.success ? "yes" : "no"}`);
  lines.push(`Duration: ${result.durationMs}ms`);
  if (!result.success) {
    const firstFailedStep = result.steps.find(
      (step) => !step.success && !step.step.continueOnError
    );
    if (firstFailedStep) {
      lines.push(
        `Failure: step "${firstFailedStep.step.description}" (id=${firstFailedStep.step.id}, exit=${firstFailedStep.exitCode ?? "unknown"})`
      );
    }
  }
  lines.push("");
  lines.push("Executed steps:");

  for (const [index, step] of result.steps.entries()) {
    const status = step.success ? "OK" : "FAILED";
    const skipped = step.skipped ? " (dry-run)" : "";
    lines.push(`  ${index + 1}. [${status}] ${step.step.description}${skipped} (id: ${step.step.id})`);
    lines.push(`     ${step.commandLine}`);
    if (step.stderr) {
      lines.push(`     stderr: ${truncateForDisplay(step.stderr)}`);
    }
  }

  return lines.join("\n");
}

function formatValidateResult(payload: {
  manifestPath: string;
  sourceInput: string;
  sourceKind: string;
  name: string;
  version?: string;
  platforms: string[];
  dependencies: number;
  artifacts: number;
  lifecycleStages: string[];
}): string {
  const lines: string[] = [];
  lines.push(`Manifest: ${payload.name}`);
  lines.push(`Path: ${payload.manifestPath}`);
  lines.push(`Source Input: ${payload.sourceInput}`);
  lines.push(`Source Kind: ${payload.sourceKind}`);
  lines.push(`Version: ${payload.version ?? "n/a"}`);
  lines.push(`Platforms: ${payload.platforms.join(", ")}`);
  lines.push(`Dependencies: ${payload.dependencies}`);
  lines.push(`Artifacts: ${payload.artifacts}`);
  lines.push(`Lifecycle stages: ${payload.lifecycleStages.join(", ") || "none"}`);
  return lines.join("\n");
}

function formatRegistryListResult(payload: {
  registrySourceInput: string;
  registryResolvedPath: string;
  registryName: string;
  registryVersion?: string;
  entries: Array<{
    name: string;
    aliases: string[];
    description?: string;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`Registry: ${payload.registryName}`);
  lines.push(`Source Input: ${payload.registrySourceInput}`);
  lines.push(`Resolved Path: ${payload.registryResolvedPath}`);
  lines.push(`Version: ${payload.registryVersion ?? "n/a"}`);
  lines.push(`Entries: ${payload.entries.length}`);
  lines.push("");
  for (const entry of payload.entries) {
    lines.push(`- ${entry.name}${entry.aliases.length > 0 ? ` (aliases: ${entry.aliases.join(", ")})` : ""}`);
    if (entry.description) {
      lines.push(`  ${entry.description}`);
    }
  }
  return lines.join("\n");
}

function formatRegistryEntryResult(payload: {
  registrySourceInput: string;
  registryResolvedPath: string;
  registryName: string;
  platform: string;
  name: string;
  aliases: string[];
  description?: string;
  tags: string[];
  manifestSource: string;
  variables: Record<string, string>;
}): string {
  const lines: string[] = [];
  lines.push(`Registry: ${payload.registryName}`);
  lines.push(`Source Input: ${payload.registrySourceInput}`);
  lines.push(`Resolved Path: ${payload.registryResolvedPath}`);
  lines.push(`Platform: ${payload.platform}`);
  lines.push(`Software: ${payload.name}`);
  lines.push(`Aliases: ${payload.aliases.join(", ") || "none"}`);
  lines.push(`Tags: ${payload.tags.join(", ") || "none"}`);
  lines.push(`Manifest Source: ${payload.manifestSource}`);
  if (payload.description) {
    lines.push(`Description: ${payload.description}`);
  }
  if (Object.keys(payload.variables).length > 0) {
    lines.push("Variables:");
    for (const [key, value] of Object.entries(payload.variables)) {
      lines.push(`  ${key}=${value}`);
    }
  }
  return lines.join("\n");
}

function formatRegistryValidateResult(payload: {
  registrySourceInput: string;
  registryResolvedPath: string;
  registryName: string;
  registryVersion?: string;
  entries: number;
}): string {
  const lines: string[] = [];
  lines.push(`Registry: ${payload.registryName}`);
  lines.push(`Source Input: ${payload.registrySourceInput}`);
  lines.push(`Resolved Path: ${payload.registryResolvedPath}`);
  lines.push(`Version: ${payload.registryVersion ?? "n/a"}`);
  lines.push(`Entries: ${payload.entries}`);
  return lines.join("\n");
}

function normalizeDoctorTarget(input: string | undefined): DoctorTarget {
  const token = input?.trim().toLowerCase();
  if (!token || token === "all") {
    return "all";
  }

  if (token === "openclaw" || token === "claw" || token === "open-claw") {
    return "openclaw";
  }
  if (token === "codex" || token === "codex-cli" || token === "openai-codex") {
    return "codex";
  }
  if (token === "nodejs" || token === "node" || token === "node-lts") {
    return "nodejs";
  }
  if (token === "python" || token === "python3" || token === "cpython") {
    return "python";
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Unsupported doctor target "${input}". Supported values: all, openclaw, codex, nodejs, python.`
  );
}

function formatDoctorReport(report: RegistryDoctorReport): string {
  const lines: string[] = [];
  lines.push(`Doctor target: ${report.target}`);
  lines.push(`Registry: ${report.registry.name}`);
  lines.push(`Registry Source Input: ${report.registry.sourceInput}`);
  lines.push(`Registry Resolved Path: ${report.registry.resolvedPath}`);
  lines.push(`Registry Version: ${report.registry.version ?? "n/a"}`);
  lines.push(`Runtime checks: ${report.runtime.enabled ? "enabled" : "disabled"}`);
  if (report.runtime.platform) {
    lines.push(`Runtime platform: ${report.runtime.platform}`);
  }
  lines.push(`Success: ${report.success ? "yes" : "no"}`);
  lines.push("");
  lines.push("Checks:");

  for (const check of report.checks) {
    const status = check.success ? "OK" : "FAILED";
    lines.push(`  - [${status}] (${check.target}) ${check.id}`);
    lines.push(`    ${check.message}`);
    if (check.detail) {
      lines.push(`    detail: ${check.detail}`);
    }
    if (check.recommendation && !check.success) {
      lines.push(`    recommendation: ${check.recommendation}`);
    }
  }

  return lines.join("\n");
}

function exitWithError(error: unknown): never {
  if (error instanceof HubInstallerError) {
    console.error(`Error [${error.code}]: ${error.message}`);
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  console.error("Unknown error");
  process.exit(1);
}

async function main(): Promise<void> {
  const program = new Command();
  const engine = new InstallerEngine();

  program
    .name("hub-installer")
    .description("Cross-platform software installer (Node.js + TypeScript)")
    .version("0.1.0");
  program.showSuggestionAfterError(true);
  program.showHelpAfterError(true);

  program
    .command("detect")
    .description("Detect host platform and optionally package format from source")
    .argument("[source]", "installation source path or manager URI")
    .option("--json", "print JSON output")
    .action((source: string | undefined, options: { json?: boolean }) => {
      try {
        const platform = detectHostPlatform();
        const payload: Record<string, unknown> = { platform };

        if (source) {
          const sourceRef = resolveSourceReference(source);
          const format = detectPackageFormat(source, sourceRef);
          payload.source = source;
          payload.format = format;
          payload.sourceType = sourceRef.kind;
        }

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        console.log(`Platform: ${String(payload.platform)}`);
        if (source) {
          console.log(`Format: ${String(payload.format)}`);
          console.log(`Source Type: ${String(payload.sourceType)}`);
        }
      } catch (error) {
        exitWithError(error);
      }
    });

  program
    .command("plan")
    .description("Create an installation plan without execution")
    .argument("<source>", "installation source path or manager URI")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("-f, --format <format>", `package format (${SUPPORTED_FORMATS.join(", ")})`)
    .option("--checksum <sha256>", "expected SHA-256 for remote package source")
    .option("--installer-arg <arg>", "installer argument (repeatable)", collect, [])
    .option("--manager-arg <arg>", "manager argument (repeatable)", collect, [])
    .option("--archive-entry <path>", "archive entry script/binary relative path")
    .option("--archive-command <command>", "custom command executed in extracted archive directory")
    .option("--android-device <id>", "android device serial ID for adb")
    .option("--ios-device <id>", "iOS simulator/device ID")
    .option("--ios-simulator", "install IPA to simulator using xcrun simctl")
    .option("--cwd <path>", "working directory")
    .option("--timeout <ms>", "step timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        source: string,
        options: {
          platform?: string;
          format?: string;
          checksum?: string;
          installerArg?: string[];
          managerArg?: string[];
          archiveEntry?: string;
          archiveCommand?: string;
          androidDevice?: string;
          iosDevice?: string;
          iosSimulator?: boolean;
          cwd?: string;
          timeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const plan = await engine.createPlan({
            source,
            dryRun: true,
            ...pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              format: options.format as (typeof SUPPORTED_FORMATS)[number] | undefined,
              sourceChecksum: options.checksum,
              installerArgs: options.installerArg,
              managerArgs: options.managerArg,
              archiveEntry: options.archiveEntry,
              archiveCommand: options.archiveCommand,
              androidDeviceId: options.androidDevice,
              iosDeviceId: options.iosDevice,
              iosSimulator: options.iosSimulator,
              cwd: options.cwd,
              timeoutMs: parseOptionalNumber(options.timeout, "--timeout")
            })
          });

          if (options.json) {
            console.log(JSON.stringify(plan, null, 2));
            return;
          }

          console.log(formatPlan(plan));
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  program
    .command("install")
    .description("Install from source URI/path or install software by name from registry")
    .argument("<source>", "installation source path/uri or software name")
    .argument(
      "[method]",
      "optional method/profile shortcut for built-in software (openclaw/codex/nodejs/python)"
    )
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("-f, --format <format>", `package format (${SUPPORTED_FORMATS.join(", ")})`)
    .option("--installer-arg <arg>", "installer argument (repeatable)", collect, [])
    .option("--manager-arg <arg>", "manager argument (repeatable)", collect, [])
    .option("--archive-entry <path>", "archive entry script/binary relative path")
    .option("--archive-command <command>", "custom command executed in extracted archive directory")
    .option("--android-device <id>", "android device serial ID for adb")
    .option("--ios-device <id>", "iOS simulator/device ID")
    .option("--ios-simulator", "install IPA to simulator using xcrun simctl")
    .option("--sudo", "use sudo for steps that require elevated privileges")
    .option("--dry-run", "print and simulate execution")
    .option("--verbose", "stream command output")
    .option("--cwd <path>", "working directory")
    .option("--timeout <ms>", "step timeout in milliseconds")
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--manifest-cache-dir <path>", "cache directory for remote manifest downloads")
    .option(
      "--manifest-fetch-timeout <ms>",
      "remote manifest fetch timeout in milliseconds"
    )
    .option("--config <path>", "hub-installer config file path")
    .option("--installer-home <path>", "hub-installer state root (~/.sdkwork/hub-installer)")
    .option("--install-scope <scope>", "install scope (system or user)")
    .option("--install-root <path>", "final software install root")
    .option("--work-root <path>", "software work/source directory")
    .option("--bin-dir <path>", "binary output directory")
    .option("--data-root <path>", "software data directory")
    .option(
      "--effective-runtime-platform <platform>",
      "runtime platform override (windows, macos, ubuntu, android, ios, wsl)"
    )
    .option("--container-runtime <runtime>", "container runtime override (auto, host, wsl)")
    .option("--wsl-distribution <name>", "explicit WSL distribution for WSL execution")
    .option("--docker-context <name>", "Docker context override for manifest execution")
    .option("--docker-host <value>", "Docker host override for manifest execution")
    .option(
      "--method <method>",
      "built-in method shortcut (openclaw profile, codex_install_method, nodejs_install_method, python_install_method)"
    )
    .option("--profile <profile>", "OpenClaw profile shortcut (docker, npm, source, ...)")
    .option("--channel <channel>", "OpenClaw channel shortcut (latest, beta, dev)")
    .option("--onboard <bool>", "OpenClaw onboarding shortcut (true/false)")
    .option(
      "--software-version <version>",
      "built-in unified version shortcut (openclaw_channel / codex_git_ref+codex_release_tag / nodejs_version / python_version)"
    )
    .option("--node-version <version>", "Node.js shortcut for nodejs_version")
    .option("--python-version <version>", "Python shortcut for python_version")
    .option("--var <key=value>", "template variable override (repeatable)", collectKeyValue, {})
    .option("--download-cache-dir <path>", "cache directory for remote package downloads")
    .option("--download-timeout <ms>", "remote package download timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        source: string,
        method: string | undefined,
        options: {
          platform?: string;
          format?: string;
          installerArg?: string[];
          managerArg?: string[];
          archiveEntry?: string;
          archiveCommand?: string;
          androidDevice?: string;
          iosDevice?: string;
          iosSimulator?: boolean;
          sudo?: boolean;
          dryRun?: boolean;
          verbose?: boolean;
          cwd?: string;
          timeout?: string;
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          manifestCacheDir?: string;
          manifestFetchTimeout?: string;
          config?: string;
          installerHome?: string;
          installScope?: string;
          installRoot?: string;
          workRoot?: string;
          binDir?: string;
          dataRoot?: string;
          effectiveRuntimePlatform?: string;
          method?: string;
          profile?: string;
          channel?: string;
          onboard?: string;
          softwareVersion?: string;
          nodeVersion?: string;
          pythonVersion?: string;
          var?: Record<string, string>;
          downloadCacheDir?: string;
          downloadTimeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const installMode = detectInstallMode(source);
          const installPolicyOptions = collectInstallPolicyOptions(options);
          const platform = options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined;
          const timeoutMs = parseOptionalNumber(options.timeout, "--timeout");
          const hasShortcutMethodArgument = Boolean(method?.trim());
          const hasShortcutOption = hasRegistryShortcutOptions(
            pickDefined({
              method: options.method,
              profile: options.profile,
              channel: options.channel,
              onboard: options.onboard,
              softwareVersion: options.softwareVersion,
              nodeVersion: options.nodeVersion,
              pythonVersion: options.pythonVersion
            })
          );

          if (installMode !== "registry" && (hasShortcutMethodArgument || hasShortcutOption)) {
            throw new HubInstallerError(
              "INVALID_ARGUMENT",
              "method/profile/channel/onboard/software-version/node-version/python-version shortcuts are only supported when installing software by registry name."
            );
          }

          if (installMode === "package" && Object.keys(installPolicyOptions).length > 0) {
            throw new HubInstallerError(
              "INVALID_ARGUMENT",
              "config/installer-home/install-scope/install-root/work-root/bin-dir/data-root/effective-runtime-platform/container-runtime/wsl-distribution/docker-context/docker-host options are only supported for registry and manifest installs."
            );
          }

          switch (installMode) {
            case "registry": {
              const shortcutResolved = resolveRegistryInstallShortcuts({
                softwareName: source,
                ...pickDefined({
                  methodArgument: method,
                  methodOption: options.method,
                  profileOption: options.profile,
                  channelOption: options.channel,
                  onboardOption: options.onboard,
                  softwareVersionOption: options.softwareVersion,
                  nodeVersionOption: options.nodeVersion,
                  pythonVersionOption: options.pythonVersion,
                  userVariables: options.var
                })
              });

              const result = await installSoftwareFromRegistry(
                shortcutResolved.softwareName,
                pickDefined({
                  platform,
                  registrySource: options.registry,
                  registryCacheDir: options.registryCacheDir,
                  registryFetchTimeoutMs: parseOptionalNumber(
                    options.registryFetchTimeout,
                    "--registry-fetch-timeout"
                  ),
                  manifestCacheDir: options.manifestCacheDir,
                  manifestFetchTimeoutMs: parseOptionalNumber(
                    options.manifestFetchTimeout,
                    "--manifest-fetch-timeout"
                  ),
                  dryRun: options.dryRun,
                  verbose: options.verbose,
                  progress: !options.json,
                  sudo: options.sudo,
                  cwd: options.cwd,
                  timeoutMs,
                  configPath: options.config,
                  ...installPolicyOptions,
                  variables: shortcutResolved.variables
                })
              );

              const payload = {
                registrySourceInput: result.registry.sourceInput,
                registryResolvedPath: result.registry.resolvedPath,
                registryName: result.registry.name,
                softwareName: result.software.name,
                manifestSource: result.software.manifestSource,
                applyResult: result.applyResult,
                ...pickDefined({
                  registryVersion: result.registry.version
                })
              };

              if (options.json) {
                console.log(JSON.stringify(payload, null, 2));
              } else {
                console.log(formatRegistryInstallResult(payload));
              }

              process.exit(result.applyResult.success ? 0 : 1);
              return;
            }
            case "manifest": {
              const result = await applyManifestFile(
                source,
                pickDefined({
                  platform,
                  dryRun: options.dryRun,
                  verbose: options.verbose,
                  progress: !options.json,
                  sudo: options.sudo,
                  cwd: options.cwd,
                  timeoutMs,
                  configPath: options.config,
                  ...installPolicyOptions,
                  variables: options.var,
                  manifestCacheDir: options.manifestCacheDir,
                  manifestFetchTimeoutMs: parseOptionalNumber(
                    options.manifestFetchTimeout,
                    "--manifest-fetch-timeout"
                  )
                })
              );

              if (options.json) {
                console.log(JSON.stringify(result, null, 2));
              } else {
                console.log(formatApplyResult(result));
              }

              process.exit(result.success ? 0 : 1);
              return;
            }
            default: {
              const result = await engine.install({
                source,
                ...pickDefined({
                  platform,
                  format: options.format as (typeof SUPPORTED_FORMATS)[number] | undefined,
                  installerArgs: options.installerArg,
                  managerArgs: options.managerArg,
                  archiveEntry: options.archiveEntry,
                  archiveCommand: options.archiveCommand,
                  androidDeviceId: options.androidDevice,
                  iosDeviceId: options.iosDevice,
                  iosSimulator: options.iosSimulator,
                  dryRun: options.dryRun,
                  verbose: options.verbose,
                  progress: !options.json,
                  sudo: options.sudo,
                  cwd: options.cwd,
                  timeoutMs,
                  downloadCacheDir: options.downloadCacheDir,
                  downloadTimeoutMs: parseOptionalNumber(options.downloadTimeout, "--download-timeout")
                })
              });

              if (options.json) {
                console.log(JSON.stringify(result, null, 2));
              } else {
                console.log(formatExecutionResult(result));
              }

              process.exit(result.success ? 0 : 1);
              return;
            }
          }
        } catch (error) {
          if (
            detectInstallMode(source) === "registry" &&
            error instanceof HubInstallerError &&
            error.code === "REGISTRY_NOT_FOUND" &&
            !options.registry
          ) {
            const defaultSource = (() => {
              try {
                return getDefaultRegistrySource();
              } catch {
                return "registry/software-registry.yaml";
              }
            })();
            console.error(
              `Error [REGISTRY_NOT_FOUND]: ${error.message} Try --registry ${defaultSource}`
            );
            process.exit(1);
          }
          exitWithError(error);
        }
      }
    );

  program
    .command("list")
    .alias("ls")
    .description("List installable software from registry (shortcut)")
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        options: {
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const result = await listRegistryEntries(
            options.registry,
            pickDefined({
              cacheDir: options.registryCacheDir,
              fetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              )
            })
          );

          const payload = {
            registrySourceInput: result.loadedRegistry.sourceInput,
            registryResolvedPath: result.loadedRegistry.absolutePath,
            registryName: result.loadedRegistry.registry.metadata.name,
            entries: result.entries.map((entry) => ({
              name: entry.name,
              aliases: entry.aliases ?? [],
              ...pickDefined({
                description: entry.description
              })
            })),
            ...pickDefined({
              registryVersion: result.loadedRegistry.registry.metadata.version
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          console.log(formatRegistryListResult(payload));
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  program
    .command("info")
    .description("Show software details from registry (shortcut)")
    .argument("<software>", "software name or alias")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        softwareName: string,
        options: {
          platform?: string;
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const result = await getRegistryEntry(
            softwareName,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              source: options.registry,
              cacheDir: options.registryCacheDir,
              fetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              )
            })
          );

          const payload = {
            registrySourceInput: result.loadedRegistry.sourceInput,
            registryResolvedPath: result.loadedRegistry.absolutePath,
            registryName: result.loadedRegistry.registry.metadata.name,
            platform: result.platform,
            name: result.entry.name,
            aliases: result.entry.aliases ?? [],
            tags: result.entry.tags ?? [],
            manifestSource: result.manifestSource,
            variables: result.entry.variables ?? {},
            ...pickDefined({
              description: result.entry.description
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          console.log(formatRegistryEntryResult(payload));
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  program
    .command("doctor")
    .description("Run built-in installer consistency checks (openclaw/codex/nodejs/python)")
    .argument("[software]", "doctor target (all, openclaw, codex, nodejs, python)", "all")
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--manifest-cache-dir <path>", "cache directory for remote manifest downloads")
    .option(
      "--manifest-fetch-timeout <ms>",
      "remote manifest fetch timeout in milliseconds"
    )
    .option(
      "--runtime",
      "include local host runtime prerequisite checks (commands/WSL)"
    )
    .option("--json", "print JSON output")
    .action(
      async (
        software: string,
        options: {
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          manifestCacheDir?: string;
          manifestFetchTimeout?: string;
          runtime?: boolean;
          json?: boolean;
        }
      ) => {
        try {
          const target = normalizeDoctorTarget(software);
          const report = await runRegistryDoctor(
            target,
            pickDefined({
              registrySource: options.registry,
              registryCacheDir: options.registryCacheDir,
              registryFetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              ),
              manifestCacheDir: options.manifestCacheDir,
              manifestFetchTimeoutMs: parseOptionalNumber(
                options.manifestFetchTimeout,
                "--manifest-fetch-timeout"
              ),
              runtime: options.runtime
            })
          );

          if (options.json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            console.log(formatDoctorReport(report));
          }

          process.exit(report.success ? 0 : 1);
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  program
    .command("validate")
    .description("Validate a hub-installer manifest file")
    .argument("<manifestSource>", "manifest source path/directory/url")
    .option("--cache-dir <path>", "cache directory for remote manifest downloads")
    .option("--fetch-timeout <ms>", "remote manifest fetch timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        manifestSource: string,
        options: {
          cacheDir?: string;
          fetchTimeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const loaded = await loadManifestFromSource(
            manifestSource,
            pickDefined({
              cacheDir: options.cacheDir,
              fetchTimeoutMs: parseOptionalNumber(options.fetchTimeout, "--fetch-timeout")
            })
          );
          const manifest = loaded.manifest;
          const payload = {
            manifestPath: loaded.absolutePath,
            sourceInput: loaded.sourceInput,
            sourceKind: loaded.sourceKind,
            name: manifest.metadata.name,
            platforms: manifest.platforms ?? [...SUPPORTED_PLATFORMS],
            dependencies: manifest.dependencies?.length ?? 0,
            artifacts: manifest.artifacts.length,
            lifecycleStages: Object.keys(manifest.lifecycle ?? {}),
            ...pickDefined({
              version: manifest.metadata.version
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          console.log(formatValidateResult(payload));
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  program
    .command("apply")
    .description("Apply a hub-installer manifest file and execute full lifecycle")
    .argument("<manifestSource>", "manifest source path/directory/url")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--dry-run", "simulate execution")
    .option("--verbose", "stream command output")
    .option("--sudo", "use sudo for elevated steps")
    .option("--cwd <path>", "override working directory")
    .option("--timeout <ms>", "default timeout for lifecycle command steps")
    .option("--cache-dir <path>", "cache directory for remote manifest downloads")
    .option("--fetch-timeout <ms>", "remote manifest fetch timeout in milliseconds")
    .option("--config <path>", "hub-installer config file path")
    .option("--installer-home <path>", "hub-installer state root (~/.sdkwork/hub-installer)")
    .option("--install-scope <scope>", "install scope (system or user)")
    .option("--install-root <path>", "final software install root")
    .option("--work-root <path>", "software work/source directory")
    .option("--bin-dir <path>", "binary output directory")
    .option("--data-root <path>", "software data directory")
    .option(
      "--effective-runtime-platform <platform>",
      "runtime platform override (windows, macos, ubuntu, android, ios, wsl)"
    )
    .option("--container-runtime <runtime>", "container runtime override (auto, host, wsl)")
    .option("--wsl-distribution <name>", "explicit WSL distribution for WSL execution")
    .option("--docker-context <name>", "Docker context override for manifest execution")
    .option("--docker-host <value>", "Docker host override for manifest execution")
    .option("--var <key=value>", "template variable override (repeatable)", collectKeyValue, {})
    .option("--json", "print JSON output")
    .action(
      async (
        manifestSource: string,
        options: {
          platform?: string;
          dryRun?: boolean;
          verbose?: boolean;
          sudo?: boolean;
          cwd?: string;
          timeout?: string;
          cacheDir?: string;
          fetchTimeout?: string;
          config?: string;
          installerHome?: string;
          installScope?: string;
          installRoot?: string;
          workRoot?: string;
          binDir?: string;
          dataRoot?: string;
          effectiveRuntimePlatform?: string;
          var?: Record<string, string>;
          json?: boolean;
        }
      ) => {
        try {
          const result = await applyManifestFile(
            manifestSource,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              dryRun: options.dryRun,
              verbose: options.verbose,
              progress: !options.json,
              sudo: options.sudo,
              cwd: options.cwd,
              timeoutMs: parseOptionalNumber(options.timeout, "--timeout"),
              ...collectInstallPolicyOptions(options),
              variables: options.var,
              manifestCacheDir: options.cacheDir,
              manifestFetchTimeoutMs: parseOptionalNumber(options.fetchTimeout, "--fetch-timeout")
            })
          );

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatApplyResult(result));
          }

          process.exit(result.success ? 0 : 1);
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  program
    .command("backup")
    .description("Back up managed install/data/work roots for a hub-installer manifest")
    .argument("<manifestSource>", "manifest source path/directory/url")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--target <target>", "backup target (data, install, work, all)", collectBackupTarget, [])
    .option("--session-id <id>", "deterministic backup session id")
    .option("--dry-run", "simulate execution")
    .option("--verbose", "stream command output")
    .option("--sudo", "use sudo for elevated steps")
    .option("--cwd <path>", "override working directory")
    .option("--timeout <ms>", "default timeout for lifecycle command steps")
    .option("--cache-dir <path>", "cache directory for remote manifest downloads")
    .option("--fetch-timeout <ms>", "remote manifest fetch timeout in milliseconds")
    .option("--config <path>", "hub-installer config file path")
    .option("--installer-home <path>", "hub-installer state root (~/.sdkwork/hub-installer)")
    .option("--install-scope <scope>", "install scope (system or user)")
    .option("--install-root <path>", "final software install root")
    .option("--work-root <path>", "software work/source directory")
    .option("--bin-dir <path>", "binary output directory")
    .option("--data-root <path>", "software data directory")
    .option(
      "--effective-runtime-platform <platform>",
      "runtime platform override (windows, macos, ubuntu, android, ios, wsl)"
    )
    .option("--container-runtime <runtime>", "container runtime override (auto, host, wsl)")
    .option("--wsl-distribution <name>", "explicit WSL distribution for WSL execution")
    .option("--docker-context <name>", "Docker context override for manifest execution")
    .option("--docker-host <value>", "Docker host override for manifest execution")
    .option("--var <key=value>", "template variable override (repeatable)", collectKeyValue, {})
    .option("--json", "print JSON output")
    .action(
      async (
        manifestSource: string,
        options: {
          platform?: string;
          target?: string[];
          sessionId?: string;
          dryRun?: boolean;
          verbose?: boolean;
          sudo?: boolean;
          cwd?: string;
          timeout?: string;
          cacheDir?: string;
          fetchTimeout?: string;
          config?: string;
          installerHome?: string;
          installScope?: string;
          installRoot?: string;
          workRoot?: string;
          binDir?: string;
          dataRoot?: string;
          effectiveRuntimePlatform?: string;
          var?: Record<string, string>;
          json?: boolean;
        }
      ) => {
        try {
          const result = await backupManifestFile(
            manifestSource,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              targets: normalizeBackupTargets(options.target, "--target"),
              sessionId: options.sessionId,
              dryRun: options.dryRun,
              verbose: options.verbose,
              progress: !options.json,
              sudo: options.sudo,
              cwd: options.cwd,
              timeoutMs: parseOptionalNumber(options.timeout, "--timeout"),
              configPath: options.config,
              ...collectInstallPolicyOptions(options),
              variables: options.var,
              manifestCacheDir: options.cacheDir,
              manifestFetchTimeoutMs: parseOptionalNumber(options.fetchTimeout, "--fetch-timeout")
            })
          );

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatBackupResult(result));
          }

          process.exit(result.success ? 0 : 1);
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  program
    .command("uninstall")
    .description("Uninstall a managed application described by a hub-installer manifest")
    .argument("<manifestSource>", "manifest source path/directory/url")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--purge-data", "remove data root in addition to install/work roots")
    .option("--backup-before-uninstall", "run backup before uninstall")
    .option(
      "--backup-target <target>",
      "backup target before uninstall (data, install, work, all)",
      collectBackupTarget,
      []
    )
    .option("--backup-session-id <id>", "deterministic backup session id")
    .option("--dry-run", "simulate execution")
    .option("--verbose", "stream command output")
    .option("--sudo", "use sudo for elevated steps")
    .option("--cwd <path>", "override working directory")
    .option("--timeout <ms>", "default timeout for lifecycle command steps")
    .option("--cache-dir <path>", "cache directory for remote manifest downloads")
    .option("--fetch-timeout <ms>", "remote manifest fetch timeout in milliseconds")
    .option("--config <path>", "hub-installer config file path")
    .option("--installer-home <path>", "hub-installer state root (~/.sdkwork/hub-installer)")
    .option("--install-scope <scope>", "install scope (system or user)")
    .option("--install-root <path>", "final software install root")
    .option("--work-root <path>", "software work/source directory")
    .option("--bin-dir <path>", "binary output directory")
    .option("--data-root <path>", "software data directory")
    .option(
      "--effective-runtime-platform <platform>",
      "runtime platform override (windows, macos, ubuntu, android, ios, wsl)"
    )
    .option("--container-runtime <runtime>", "container runtime override (auto, host, wsl)")
    .option("--wsl-distribution <name>", "explicit WSL distribution for WSL execution")
    .option("--docker-context <name>", "Docker context override for manifest execution")
    .option("--docker-host <value>", "Docker host override for manifest execution")
    .option("--var <key=value>", "template variable override (repeatable)", collectKeyValue, {})
    .option("--json", "print JSON output")
    .action(
      async (
        manifestSource: string,
        options: {
          platform?: string;
          purgeData?: boolean;
          backupBeforeUninstall?: boolean;
          backupTarget?: string[];
          backupSessionId?: string;
          dryRun?: boolean;
          verbose?: boolean;
          sudo?: boolean;
          cwd?: string;
          timeout?: string;
          cacheDir?: string;
          fetchTimeout?: string;
          config?: string;
          installerHome?: string;
          installScope?: string;
          installRoot?: string;
          workRoot?: string;
          binDir?: string;
          dataRoot?: string;
          effectiveRuntimePlatform?: string;
          var?: Record<string, string>;
          json?: boolean;
        }
      ) => {
        try {
          const result = await uninstallManifestFile(
            manifestSource,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              purgeData: options.purgeData,
              backupBeforeUninstall: options.backupBeforeUninstall,
              backupTargets: normalizeBackupTargets(options.backupTarget, "--backup-target"),
              backupSessionId: options.backupSessionId,
              dryRun: options.dryRun,
              verbose: options.verbose,
              progress: !options.json,
              sudo: options.sudo,
              cwd: options.cwd,
              timeoutMs: parseOptionalNumber(options.timeout, "--timeout"),
              configPath: options.config,
              ...collectInstallPolicyOptions(options),
              variables: options.var,
              manifestCacheDir: options.cacheDir,
              manifestFetchTimeoutMs: parseOptionalNumber(options.fetchTimeout, "--fetch-timeout")
            })
          );

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(formatUninstallResult(result));
          }

          process.exit(result.success ? 0 : 1);
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  const registryCommand = program
    .command("registry")
    .description("Manage software registry and install software by name");

  registryCommand
    .command("validate")
    .description("Validate a software registry source")
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        options: {
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const result = await listRegistryEntries(
            options.registry,
            pickDefined({
              cacheDir: options.registryCacheDir,
              fetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              )
            })
          );

          const payload = {
            registrySourceInput: result.loadedRegistry.sourceInput,
            registryResolvedPath: result.loadedRegistry.absolutePath,
            registryName: result.loadedRegistry.registry.metadata.name,
            entries: result.entries.length,
            ...pickDefined({
              registryVersion: result.loadedRegistry.registry.metadata.version
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          console.log(formatRegistryValidateResult(payload));
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  registryCommand
    .command("list")
    .description("List software entries from registry")
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        options: {
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const result = await listRegistryEntries(
            options.registry,
            pickDefined({
              cacheDir: options.registryCacheDir,
              fetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              )
            })
          );

          const payload = {
            registrySourceInput: result.loadedRegistry.sourceInput,
            registryResolvedPath: result.loadedRegistry.absolutePath,
            registryName: result.loadedRegistry.registry.metadata.name,
            entries: result.entries.map((entry) => ({
              name: entry.name,
              aliases: entry.aliases ?? [],
              ...pickDefined({
                description: entry.description
              })
            })),
            ...pickDefined({
              registryVersion: result.loadedRegistry.registry.metadata.version
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          console.log(formatRegistryListResult(payload));
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  registryCommand
    .command("show")
    .description("Show a software entry from registry")
    .argument("<software>", "software name or alias")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--json", "print JSON output")
    .action(
      async (
        softwareName: string,
        options: {
          platform?: string;
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          json?: boolean;
        }
      ) => {
        try {
          const result = await getRegistryEntry(
            softwareName,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              source: options.registry,
              cacheDir: options.registryCacheDir,
              fetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              )
            })
          );

          const payload = {
            registrySourceInput: result.loadedRegistry.sourceInput,
            registryResolvedPath: result.loadedRegistry.absolutePath,
            registryName: result.loadedRegistry.registry.metadata.name,
            platform: result.platform,
            name: result.entry.name,
            aliases: result.entry.aliases ?? [],
            tags: result.entry.tags ?? [],
            manifestSource: result.manifestSource,
            variables: result.entry.variables ?? {},
            ...pickDefined({
              description: result.entry.description
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
            return;
          }

          console.log(formatRegistryEntryResult(payload));
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  registryCommand
    .command("install")
    .description("Install software by name from registry")
    .argument("<software>", "software name or alias")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--cache-dir <path>", "cache directory for remote manifest downloads")
    .option("--fetch-timeout <ms>", "remote manifest fetch timeout in milliseconds")
    .option("--dry-run", "simulate execution")
    .option("--verbose", "stream command output")
    .option("--sudo", "use sudo for elevated steps")
    .option("--cwd <path>", "override working directory")
    .option("--timeout <ms>", "default timeout for lifecycle command steps")
    .option("--config <path>", "hub-installer config file path")
    .option("--installer-home <path>", "hub-installer state root (~/.sdkwork/hub-installer)")
    .option("--install-scope <scope>", "install scope (system or user)")
    .option("--install-root <path>", "final software install root")
    .option("--work-root <path>", "software work/source directory")
    .option("--bin-dir <path>", "binary output directory")
    .option("--data-root <path>", "software data directory")
    .option(
      "--effective-runtime-platform <platform>",
      "runtime platform override (windows, macos, ubuntu, android, ios, wsl)"
    )
    .option("--container-runtime <runtime>", "container runtime override (auto, host, wsl)")
    .option("--wsl-distribution <name>", "explicit WSL distribution for WSL execution")
    .option("--docker-context <name>", "Docker context override for manifest execution")
    .option("--docker-host <value>", "Docker host override for manifest execution")
    .option("--var <key=value>", "template variable override (repeatable)", collectKeyValue, {})
    .option("--json", "print JSON output")
    .action(
      async (
        softwareName: string,
        options: {
          platform?: string;
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          cacheDir?: string;
          fetchTimeout?: string;
          dryRun?: boolean;
          verbose?: boolean;
          sudo?: boolean;
          cwd?: string;
          timeout?: string;
          config?: string;
          installerHome?: string;
          installScope?: string;
          installRoot?: string;
          workRoot?: string;
          binDir?: string;
          dataRoot?: string;
          effectiveRuntimePlatform?: string;
          var?: Record<string, string>;
          json?: boolean;
        }
      ) => {
        try {
          const result = await installSoftwareFromRegistry(
            softwareName,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              registrySource: options.registry,
              registryCacheDir: options.registryCacheDir,
              registryFetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              ),
              manifestCacheDir: options.cacheDir,
              manifestFetchTimeoutMs: parseOptionalNumber(options.fetchTimeout, "--fetch-timeout"),
              dryRun: options.dryRun,
              verbose: options.verbose,
              progress: !options.json,
              sudo: options.sudo,
              cwd: options.cwd,
              timeoutMs: parseOptionalNumber(options.timeout, "--timeout"),
              ...collectInstallPolicyOptions(options),
              variables: options.var
            })
          );

          const payload = {
            registrySourceInput: result.registry.sourceInput,
            registryResolvedPath: result.registry.resolvedPath,
            registryName: result.registry.name,
            softwareName: result.software.name,
            manifestSource: result.software.manifestSource,
            applyResult: result.applyResult,
            ...pickDefined({
              registryVersion: result.registry.version
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else {
            console.log(formatRegistryInstallResult(payload));
          }

          process.exit(result.applyResult.success ? 0 : 1);
        } catch (error) {
          if (
            error instanceof HubInstallerError &&
            error.code === "REGISTRY_NOT_FOUND" &&
            !options.registry
          ) {
            const defaultSource = (() => {
              try {
                return getDefaultRegistrySource();
              } catch {
                return "registry/software-registry.yaml";
              }
            })();
            console.error(
              `Error [REGISTRY_NOT_FOUND]: ${error.message} Try --registry ${defaultSource}`
            );
            process.exit(1);
          }
          exitWithError(error);
        }
      }
    );

  registryCommand
    .command("backup")
    .description("Back up software by name from registry")
    .argument("<software>", "software name or alias")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--cache-dir <path>", "cache directory for remote manifest downloads")
    .option("--fetch-timeout <ms>", "remote manifest fetch timeout in milliseconds")
    .option("--target <target>", "backup target (data, install, work, all)", collectBackupTarget, [])
    .option("--session-id <id>", "deterministic backup session id")
    .option("--dry-run", "simulate execution")
    .option("--verbose", "stream command output")
    .option("--sudo", "use sudo for elevated steps")
    .option("--cwd <path>", "override working directory")
    .option("--timeout <ms>", "default timeout for lifecycle command steps")
    .option("--config <path>", "hub-installer config file path")
    .option("--installer-home <path>", "hub-installer state root (~/.sdkwork/hub-installer)")
    .option("--install-scope <scope>", "install scope (system or user)")
    .option("--install-root <path>", "final software install root")
    .option("--work-root <path>", "software work/source directory")
    .option("--bin-dir <path>", "binary output directory")
    .option("--data-root <path>", "software data directory")
    .option(
      "--effective-runtime-platform <platform>",
      "runtime platform override (windows, macos, ubuntu, android, ios, wsl)"
    )
    .option("--container-runtime <runtime>", "container runtime override (auto, host, wsl)")
    .option("--wsl-distribution <name>", "explicit WSL distribution for WSL execution")
    .option("--docker-context <name>", "Docker context override for manifest execution")
    .option("--docker-host <value>", "Docker host override for manifest execution")
    .option("--var <key=value>", "template variable override (repeatable)", collectKeyValue, {})
    .option("--json", "print JSON output")
    .action(
      async (
        softwareName: string,
        options: {
          platform?: string;
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          cacheDir?: string;
          fetchTimeout?: string;
          target?: string[];
          sessionId?: string;
          dryRun?: boolean;
          verbose?: boolean;
          sudo?: boolean;
          cwd?: string;
          timeout?: string;
          config?: string;
          installerHome?: string;
          installScope?: string;
          installRoot?: string;
          workRoot?: string;
          binDir?: string;
          dataRoot?: string;
          effectiveRuntimePlatform?: string;
          var?: Record<string, string>;
          json?: boolean;
        }
      ) => {
        try {
          const result = await backupSoftwareFromRegistry(
            softwareName,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              registrySource: options.registry,
              registryCacheDir: options.registryCacheDir,
              registryFetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              ),
              manifestCacheDir: options.cacheDir,
              manifestFetchTimeoutMs: parseOptionalNumber(options.fetchTimeout, "--fetch-timeout"),
              targets: normalizeBackupTargets(options.target, "--target"),
              sessionId: options.sessionId,
              dryRun: options.dryRun,
              verbose: options.verbose,
              progress: !options.json,
              sudo: options.sudo,
              cwd: options.cwd,
              timeoutMs: parseOptionalNumber(options.timeout, "--timeout"),
              configPath: options.config,
              ...collectInstallPolicyOptions(options),
              variables: options.var
            })
          );

          const payload = {
            registrySourceInput: result.registry.sourceInput,
            registryResolvedPath: result.registry.resolvedPath,
            registryName: result.registry.name,
            softwareName: result.software.name,
            manifestSource: result.software.manifestSource,
            backupResult: result.backupResult,
            ...pickDefined({
              registryVersion: result.registry.version
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else {
            console.log(formatRegistryBackupResult(payload));
          }

          process.exit(result.backupResult.success ? 0 : 1);
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  registryCommand
    .command("uninstall")
    .description("Uninstall software by name from registry")
    .argument("<software>", "software name or alias")
    .option("-p, --platform <platform>", `target platform (${SUPPORTED_PLATFORMS.join(", ")})`)
    .option("--registry <source>", "registry source path/directory/url")
    .option("--registry-cache-dir <path>", "cache directory for remote registry downloads")
    .option("--registry-fetch-timeout <ms>", "remote registry fetch timeout in milliseconds")
    .option("--cache-dir <path>", "cache directory for remote manifest downloads")
    .option("--fetch-timeout <ms>", "remote manifest fetch timeout in milliseconds")
    .option("--purge-data", "remove data root in addition to install/work roots")
    .option("--backup-before-uninstall", "run backup before uninstall")
    .option(
      "--backup-target <target>",
      "backup target before uninstall (data, install, work, all)",
      collectBackupTarget,
      []
    )
    .option("--backup-session-id <id>", "deterministic backup session id")
    .option("--dry-run", "simulate execution")
    .option("--verbose", "stream command output")
    .option("--sudo", "use sudo for elevated steps")
    .option("--cwd <path>", "override working directory")
    .option("--timeout <ms>", "default timeout for lifecycle command steps")
    .option("--config <path>", "hub-installer config file path")
    .option("--installer-home <path>", "hub-installer state root (~/.sdkwork/hub-installer)")
    .option("--install-scope <scope>", "install scope (system or user)")
    .option("--install-root <path>", "final software install root")
    .option("--work-root <path>", "software work/source directory")
    .option("--bin-dir <path>", "binary output directory")
    .option("--data-root <path>", "software data directory")
    .option(
      "--effective-runtime-platform <platform>",
      "runtime platform override (windows, macos, ubuntu, android, ios, wsl)"
    )
    .option("--container-runtime <runtime>", "container runtime override (auto, host, wsl)")
    .option("--wsl-distribution <name>", "explicit WSL distribution for WSL execution")
    .option("--docker-context <name>", "Docker context override for manifest execution")
    .option("--docker-host <value>", "Docker host override for manifest execution")
    .option("--var <key=value>", "template variable override (repeatable)", collectKeyValue, {})
    .option("--json", "print JSON output")
    .action(
      async (
        softwareName: string,
        options: {
          platform?: string;
          registry?: string;
          registryCacheDir?: string;
          registryFetchTimeout?: string;
          cacheDir?: string;
          fetchTimeout?: string;
          purgeData?: boolean;
          backupBeforeUninstall?: boolean;
          backupTarget?: string[];
          backupSessionId?: string;
          dryRun?: boolean;
          verbose?: boolean;
          sudo?: boolean;
          cwd?: string;
          timeout?: string;
          config?: string;
          installerHome?: string;
          installScope?: string;
          installRoot?: string;
          workRoot?: string;
          binDir?: string;
          dataRoot?: string;
          effectiveRuntimePlatform?: string;
          var?: Record<string, string>;
          json?: boolean;
        }
      ) => {
        try {
          const result = await uninstallSoftwareFromRegistry(
            softwareName,
            pickDefined({
              platform: options.platform as (typeof SUPPORTED_PLATFORMS)[number] | undefined,
              registrySource: options.registry,
              registryCacheDir: options.registryCacheDir,
              registryFetchTimeoutMs: parseOptionalNumber(
                options.registryFetchTimeout,
                "--registry-fetch-timeout"
              ),
              manifestCacheDir: options.cacheDir,
              manifestFetchTimeoutMs: parseOptionalNumber(options.fetchTimeout, "--fetch-timeout"),
              purgeData: options.purgeData,
              backupBeforeUninstall: options.backupBeforeUninstall,
              backupTargets: normalizeBackupTargets(options.backupTarget, "--backup-target"),
              backupSessionId: options.backupSessionId,
              dryRun: options.dryRun,
              verbose: options.verbose,
              progress: !options.json,
              sudo: options.sudo,
              cwd: options.cwd,
              timeoutMs: parseOptionalNumber(options.timeout, "--timeout"),
              configPath: options.config,
              ...collectInstallPolicyOptions(options),
              variables: options.var
            })
          );

          const payload = {
            registrySourceInput: result.registry.sourceInput,
            registryResolvedPath: result.registry.resolvedPath,
            registryName: result.registry.name,
            softwareName: result.software.name,
            manifestSource: result.software.manifestSource,
            uninstallResult: result.uninstallResult,
            ...pickDefined({
              registryVersion: result.registry.version
            })
          };

          if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
          } else {
            console.log(formatRegistryUninstallResult(payload));
          }

          process.exit(result.uninstallResult.success ? 0 : 1);
        } catch (error) {
          exitWithError(error);
        }
      }
    );

  await program.parseAsync(normalizeCliArgv(process.argv));
}

main().catch((error) => {
  exitWithError(error);
});
