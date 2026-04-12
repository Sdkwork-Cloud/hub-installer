import { HubInstallerError } from "../errors";
import { SUPPORTED_PLATFORMS } from "../types";
import {
  type ArtifactBase,
  DATA_ITEM_KINDS,
  DATA_ITEM_UNINSTALL_POLICIES,
  INSTALLATION_METHOD_TYPES,
  LIFECYCLE_STAGES,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SHELLS,
  MIGRATION_STRATEGY_MODES,
  type CommandArtifact,
  type DependencyCheck,
  type GitArtifact,
  type HubInstallManifest,
  type HuggingFaceArtifact,
  type ManifestDataItem,
  type ManifestDataLayoutDescriptor,
  type ManifestArtifact,
  type ManifestCommand,
  type ManifestCondition,
  type ManifestDependency,
  type ManifestInstallationDescriptor,
  type ManifestInstallationDirectories,
  type ManifestInstallationDirectory,
  type ManifestInstallationMethod,
  type ManifestMetadata,
  type ManifestMigrationDescriptor,
  type ManifestMigrationStrategy,
  type PackageArtifact,
  type PackageInstallByPlatform,
  type PackageInstallRequest
} from "./types";

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new HubInstallerError("INVALID_MANIFEST", message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, fieldPath: string): UnknownRecord {
  if (!isRecord(value)) {
    fail(`${fieldPath} must be an object.`);
  }
  return value;
}

function expectString(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${fieldPath} must be a non-empty string.`);
  }
  return value;
}

function expectStringAllowEmpty(value: unknown, fieldPath: string): string {
  if (typeof value !== "string") {
    fail(`${fieldPath} must be a string.`);
  }
  return value;
}

function expectStringArray(value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${fieldPath} must be an array of strings.`);
  }
  return value.map((entry, index) => expectString(entry, `${fieldPath}[${index}]`));
}

function expectStringMap(value: unknown, fieldPath: string): Record<string, string> {
  const data = expectRecord(value, fieldPath);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(data)) {
    result[key] = expectStringAllowEmpty(entry, `${fieldPath}.${key}`);
  }
  return result;
}

function expectBoolean(value: unknown, fieldPath: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${fieldPath} must be a boolean.`);
  }
  return value;
}

function parseCondition(value: unknown, fieldPath: string): ManifestCondition {
  const data = expectRecord(value, fieldPath);
  const output: ManifestCondition = {};

  if (data.platforms !== undefined) {
    const platforms = expectStringArray(data.platforms, `${fieldPath}.platforms`);
    for (const platform of platforms) {
      if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
        fail(`${fieldPath}.platforms contains unsupported platform "${platform}".`);
      }
    }
    output.platforms = platforms as (typeof SUPPORTED_PLATFORMS)[number][];
  }

  if (data.env !== undefined) {
    output.env = expectStringMap(data.env, `${fieldPath}.env`);
  }

  if (data.commandExists !== undefined) {
    output.commandExists = expectString(data.commandExists, `${fieldPath}.commandExists`);
  }

  if (data.fileExists !== undefined) {
    output.fileExists = expectString(data.fileExists, `${fieldPath}.fileExists`);
  }

  return output;
}

function parseCommand(value: unknown, fieldPath: string): ManifestCommand {
  const data = expectRecord(value, fieldPath);
  const command: ManifestCommand = {
    run: expectString(data.run, `${fieldPath}.run`)
  };

  if (data.id !== undefined) {
    command.id = expectString(data.id, `${fieldPath}.id`);
  }

  if (data.description !== undefined) {
    command.description = expectString(data.description, `${fieldPath}.description`);
  }

  if (data.shell !== undefined) {
    const shell = expectString(data.shell, `${fieldPath}.shell`);
    if (!MANIFEST_SHELLS.includes(shell as (typeof MANIFEST_SHELLS)[number])) {
      fail(`${fieldPath}.shell must be one of: ${MANIFEST_SHELLS.join(", ")}.`);
    }
    command.shell = shell as (typeof MANIFEST_SHELLS)[number];
  }

  if (data.cwd !== undefined) {
    command.cwd = expectString(data.cwd, `${fieldPath}.cwd`);
  }

  if (data.env !== undefined) {
    command.env = expectStringMap(data.env, `${fieldPath}.env`);
  }

  if (data.timeoutMs !== undefined) {
    if (typeof data.timeoutMs !== "number" || !Number.isFinite(data.timeoutMs) || data.timeoutMs <= 0) {
      fail(`${fieldPath}.timeoutMs must be a positive number.`);
    }
    command.timeoutMs = data.timeoutMs;
  }

  if (data.continueOnError !== undefined) {
    if (typeof data.continueOnError !== "boolean") {
      fail(`${fieldPath}.continueOnError must be a boolean.`);
    }
    command.continueOnError = data.continueOnError;
  }

  if (data.elevated !== undefined) {
    if (typeof data.elevated !== "boolean") {
      fail(`${fieldPath}.elevated must be a boolean.`);
    }
    command.elevated = data.elevated;
  }

  if (data.when !== undefined) {
    command.when = parseCondition(data.when, `${fieldPath}.when`);
  }

  return command;
}

function parseCommandList(value: unknown, fieldPath: string): ManifestCommand[] {
  if (!Array.isArray(value)) {
    fail(`${fieldPath} must be an array of command objects.`);
  }
  return value.map((entry, index) => parseCommand(entry, `${fieldPath}[${index}]`));
}

function parseDependencyCheck(value: unknown, fieldPath: string): DependencyCheck {
  const data = expectRecord(value, fieldPath);
  const type = expectString(data.type, `${fieldPath}.type`);

  switch (type) {
    case "command":
      return {
        type,
        name: expectString(data.name, `${fieldPath}.name`)
      };
    case "file":
      return {
        type,
        path: expectString(data.path, `${fieldPath}.path`)
      };
    case "env": {
      const check: DependencyCheck = {
        type,
        name: expectString(data.name, `${fieldPath}.name`)
      };
      if (data.equals !== undefined) {
        check.equals = expectString(data.equals, `${fieldPath}.equals`);
      }
      return check;
    }
    case "platform": {
      const platforms = expectStringArray(data.platforms, `${fieldPath}.platforms`);
      for (const platform of platforms) {
        if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
          fail(`${fieldPath}.platforms contains unsupported platform "${platform}".`);
        }
      }
      return {
        type,
        platforms: platforms as (typeof SUPPORTED_PLATFORMS)[number][]
      };
    }
    default:
      fail(`${fieldPath}.type "${type}" is unsupported.`);
  }
}

function parseDependency(value: unknown, fieldPath: string): ManifestDependency {
  const data = expectRecord(value, fieldPath);
  const dependency: ManifestDependency = {
    id: expectString(data.id, `${fieldPath}.id`),
    check: parseDependencyCheck(data.check, `${fieldPath}.check`)
  };

  if (data.description !== undefined) {
    dependency.description = expectString(data.description, `${fieldPath}.description`);
  }

  if (data.required !== undefined) {
    if (typeof data.required !== "boolean") {
      fail(`${fieldPath}.required must be a boolean.`);
    }
    dependency.required = data.required;
  }

  if (data.install !== undefined) {
    dependency.install = parseCommandList(data.install, `${fieldPath}.install`);
  }

  return dependency;
}

function parsePackageInstallRequest(value: unknown, fieldPath: string): PackageInstallRequest {
  const data = expectRecord(value, fieldPath);
  const source = expectString(data.source, `${fieldPath}.source`);
  const output: PackageInstallRequest = { source };

  for (const key of [
    "sourceChecksum",
    "format",
    "archiveEntry",
    "archiveCommand",
    "androidDeviceId",
    "iosDeviceId",
    "cwd"
  ]) {
    if (data[key] !== undefined) {
      output[key as keyof PackageInstallRequest] = expectString(
        data[key],
        `${fieldPath}.${key}`
      ) as never;
    }
  }

  if (data.platform !== undefined) {
    const platform = expectString(data.platform, `${fieldPath}.platform`);
    if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
      fail(`${fieldPath}.platform "${platform}" is unsupported.`);
    }
    output.platform = platform as (typeof SUPPORTED_PLATFORMS)[number];
  }

  if (data.installerArgs !== undefined) {
    output.installerArgs = expectStringArray(data.installerArgs, `${fieldPath}.installerArgs`);
  }

  if (data.managerArgs !== undefined) {
    output.managerArgs = expectStringArray(data.managerArgs, `${fieldPath}.managerArgs`);
  }

  if (data.timeoutMs !== undefined) {
    if (typeof data.timeoutMs !== "number" || !Number.isFinite(data.timeoutMs) || data.timeoutMs <= 0) {
      fail(`${fieldPath}.timeoutMs must be a positive number.`);
    }
    output.timeoutMs = data.timeoutMs;
  }

  for (const key of ["dryRun", "verbose", "sudo", "iosSimulator"]) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== "boolean") {
        fail(`${fieldPath}.${key} must be a boolean.`);
      }
      output[key as keyof PackageInstallRequest] = data[key] as never;
    }
  }

  return output;
}

function parsePackageInstallByPlatform(value: unknown, fieldPath: string): PackageInstallByPlatform {
  const data = expectRecord(value, fieldPath);
  const byPlatformRaw = expectRecord(data.byPlatform, `${fieldPath}.byPlatform`);
  const byPlatform: PackageInstallByPlatform["byPlatform"] = {};
  for (const [platform, installRequest] of Object.entries(byPlatformRaw)) {
    if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
      fail(`${fieldPath}.byPlatform contains unsupported platform "${platform}".`);
    }
    byPlatform[platform as (typeof SUPPORTED_PLATFORMS)[number]] = parsePackageInstallRequest(
      installRequest,
      `${fieldPath}.byPlatform.${platform}`
    );
  }

  const output: PackageInstallByPlatform = { byPlatform };
  if (data.fallback !== undefined) {
    output.fallback = parsePackageInstallRequest(data.fallback, `${fieldPath}.fallback`);
  }
  return output;
}

function parseArtifactBase(data: UnknownRecord, fieldPath: string): ArtifactBase {
  const base: ArtifactBase = {
    id: expectString(data.id, `${fieldPath}.id`)
  };

  if (data.title !== undefined) {
    base.title = expectString(data.title, `${fieldPath}.title`);
  }

  if (data.description !== undefined) {
    base.description = expectString(data.description, `${fieldPath}.description`);
  }

  if (data.enabled !== undefined) {
    if (typeof data.enabled !== "boolean") {
      fail(`${fieldPath}.enabled must be a boolean.`);
    }
    base.enabled = data.enabled;
  }

  if (data.when !== undefined) {
    base.when = parseCondition(data.when, `${fieldPath}.when`);
  }

  if (data.preInstall !== undefined) {
    base.preInstall = parseCommandList(data.preInstall, `${fieldPath}.preInstall`);
  }

  if (data.postInstall !== undefined) {
    base.postInstall = parseCommandList(data.postInstall, `${fieldPath}.postInstall`);
  }

  if (data.configure !== undefined) {
    base.configure = parseCommandList(data.configure, `${fieldPath}.configure`);
  }

  return base;
}

function parsePackageArtifact(data: UnknownRecord, fieldPath: string): PackageArtifact {
  const base = parseArtifactBase(data, fieldPath);
  if (data.install === undefined) {
    fail(`${fieldPath}.install is required for package artifact.`);
  }

  let install: PackageArtifact["install"];
  const installRecord = expectRecord(data.install, `${fieldPath}.install`);
  if ("byPlatform" in installRecord) {
    install = parsePackageInstallByPlatform(installRecord, `${fieldPath}.install`);
  } else {
    install = parsePackageInstallRequest(installRecord, `${fieldPath}.install`);
  }

  return {
    ...base,
    type: "package",
    install
  };
}

function parseGitArtifact(data: UnknownRecord, fieldPath: string): GitArtifact {
  const base = parseArtifactBase(data, fieldPath);
  const artifact: GitArtifact = {
    ...base,
    type: "git",
    repository: expectString(data.repository, `${fieldPath}.repository`),
    destination: expectString(data.destination, `${fieldPath}.destination`)
  };

  if (data.ref !== undefined) {
    artifact.ref = expectString(data.ref, `${fieldPath}.ref`);
  }

  if (data.cloneDepth !== undefined) {
    if (
      typeof data.cloneDepth !== "number" ||
      !Number.isFinite(data.cloneDepth) ||
      data.cloneDepth <= 0
    ) {
      fail(`${fieldPath}.cloneDepth must be a positive number.`);
    }
    artifact.cloneDepth = data.cloneDepth;
  }

  if (data.strategy !== undefined) {
    const strategy = expectString(data.strategy, `${fieldPath}.strategy`);
    if (!["clone-or-pull", "clone-only", "pull-only"].includes(strategy)) {
      fail(`${fieldPath}.strategy must be clone-or-pull, clone-only, or pull-only.`);
    }
    artifact.strategy = strategy as NonNullable<GitArtifact["strategy"]>;
  }

  if (data.submodules !== undefined) {
    if (typeof data.submodules !== "boolean") {
      fail(`${fieldPath}.submodules must be a boolean.`);
    }
    artifact.submodules = data.submodules;
  }

  if (data.lfs !== undefined) {
    if (typeof data.lfs !== "boolean") {
      fail(`${fieldPath}.lfs must be a boolean.`);
    }
    artifact.lfs = data.lfs;
  }

  if (data.build !== undefined) {
    artifact.build = parseCommandList(data.build, `${fieldPath}.build`);
  }

  return artifact;
}

function parseHuggingFaceArtifact(data: UnknownRecord, fieldPath: string): HuggingFaceArtifact {
  const base = parseArtifactBase(data, fieldPath);
  const artifact: HuggingFaceArtifact = {
    ...base,
    type: "huggingface",
    repoId: expectString(data.repoId, `${fieldPath}.repoId`),
    destination: expectString(data.destination, `${fieldPath}.destination`)
  };

  if (data.revision !== undefined) {
    artifact.revision = expectString(data.revision, `${fieldPath}.revision`);
  }

  if (data.method !== undefined) {
    const method = expectString(data.method, `${fieldPath}.method`);
    if (!["git-lfs", "huggingface-cli"].includes(method)) {
      fail(`${fieldPath}.method must be git-lfs or huggingface-cli.`);
    }
    artifact.method = method as NonNullable<HuggingFaceArtifact["method"]>;
  }

  if (data.tokenEnv !== undefined) {
    artifact.tokenEnv = expectString(data.tokenEnv, `${fieldPath}.tokenEnv`);
  }

  if (data.include !== undefined) {
    artifact.include = expectStringArray(data.include, `${fieldPath}.include`);
  }

  if (data.exclude !== undefined) {
    artifact.exclude = expectStringArray(data.exclude, `${fieldPath}.exclude`);
  }

  return artifact;
}

function parseCommandArtifact(data: UnknownRecord, fieldPath: string): CommandArtifact {
  const base = parseArtifactBase(data, fieldPath);
  return {
    ...base,
    type: "command",
    commands: parseCommandList(data.commands, `${fieldPath}.commands`)
  };
}

function parseArtifact(value: unknown, fieldPath: string): ManifestArtifact {
  const data = expectRecord(value, fieldPath);
  const type = expectString(data.type, `${fieldPath}.type`);

  switch (type) {
    case "package":
      return parsePackageArtifact(data, fieldPath);
    case "git":
      return parseGitArtifact(data, fieldPath);
    case "huggingface":
      return parseHuggingFaceArtifact(data, fieldPath);
    case "command":
      return parseCommandArtifact(data, fieldPath);
    default:
      fail(`${fieldPath}.type "${type}" is unsupported.`);
  }
}

function parseMetadata(value: unknown): ManifestMetadata {
  const data = expectRecord(value, "metadata");
  const metadata: ManifestMetadata = {
    name: expectString(data.name, "metadata.name")
  };

  for (const field of ["version", "description", "homepage"]) {
    if (data[field] !== undefined) {
      metadata[field as keyof ManifestMetadata] = expectString(data[field], `metadata.${field}`) as never;
    }
  }

  if (data.maintainers !== undefined) {
    metadata.maintainers = expectStringArray(data.maintainers, "metadata.maintainers");
  }

  return metadata;
}

function parseInstallationMethod(
  value: unknown,
  fieldPath: string
): ManifestInstallationMethod {
  const data = expectRecord(value, fieldPath);
  const type = expectString(data.type, `${fieldPath}.type`);

  if (!INSTALLATION_METHOD_TYPES.includes(type as (typeof INSTALLATION_METHOD_TYPES)[number])) {
    fail(
      `${fieldPath}.type must be one of: ${INSTALLATION_METHOD_TYPES.join(", ")}.`
    );
  }

  const method: ManifestInstallationMethod = {
    id: expectString(data.id, `${fieldPath}.id`),
    label: expectString(data.label, `${fieldPath}.label`),
    type: type as (typeof INSTALLATION_METHOD_TYPES)[number],
    summary: expectString(data.summary, `${fieldPath}.summary`)
  };

  if (data.supported !== undefined) {
    method.supported = expectBoolean(data.supported, `${fieldPath}.supported`);
  }

  if (data.documentationUrl !== undefined) {
    method.documentationUrl = expectString(data.documentationUrl, `${fieldPath}.documentationUrl`);
  }

  if (data.notes !== undefined) {
    method.notes = expectStringArray(data.notes, `${fieldPath}.notes`);
  }

  return method;
}

function parseInstallationDirectory(
  value: unknown,
  fieldPath: string
): ManifestInstallationDirectory {
  const data = expectRecord(value, fieldPath);
  const directory: ManifestInstallationDirectory = {
    path: expectString(data.path, `${fieldPath}.path`)
  };

  if (data.id !== undefined) {
    directory.id = expectString(data.id, `${fieldPath}.id`);
  }

  if (data.customizable !== undefined) {
    directory.customizable = expectBoolean(data.customizable, `${fieldPath}.customizable`);
  }

  if (data.purpose !== undefined) {
    directory.purpose = expectString(data.purpose, `${fieldPath}.purpose`);
  }

  return directory;
}

function parseInstallationDirectories(
  value: unknown,
  fieldPath: string
): ManifestInstallationDirectories {
  const data = expectRecord(value, fieldPath);
  const directories: ManifestInstallationDirectories = {};

  if (data.installRoot !== undefined) {
    directories.installRoot = parseInstallationDirectory(
      data.installRoot,
      `${fieldPath}.installRoot`
    );
  }

  if (data.workRoot !== undefined) {
    directories.workRoot = parseInstallationDirectory(data.workRoot, `${fieldPath}.workRoot`);
  }

  if (data.binDir !== undefined) {
    directories.binDir = parseInstallationDirectory(data.binDir, `${fieldPath}.binDir`);
  }

  if (data.dataRoot !== undefined) {
    directories.dataRoot = parseInstallationDirectory(data.dataRoot, `${fieldPath}.dataRoot`);
  }

  if (data.additional !== undefined) {
    if (!Array.isArray(data.additional)) {
      fail(`${fieldPath}.additional must be an array of directory objects.`);
    }
    directories.additional = data.additional.map((entry, index) =>
      parseInstallationDirectory(entry, `${fieldPath}.additional[${index}]`)
    );
  }

  return directories;
}

function parseInstallationDescriptor(
  value: unknown,
  fieldPath: string
): ManifestInstallationDescriptor {
  const data = expectRecord(value, fieldPath);
  const descriptor: ManifestInstallationDescriptor = {
    method: parseInstallationMethod(data.method, `${fieldPath}.method`)
  };

  if (data.alternatives !== undefined) {
    if (!Array.isArray(data.alternatives)) {
      fail(`${fieldPath}.alternatives must be an array.`);
    }
    descriptor.alternatives = data.alternatives.map((entry, index) =>
      parseInstallationMethod(entry, `${fieldPath}.alternatives[${index}]`)
    );
  }

  if (data.directories !== undefined) {
    descriptor.directories = parseInstallationDirectories(
      data.directories,
      `${fieldPath}.directories`
    );
  }

  return descriptor;
}

function parseDataItem(value: unknown, fieldPath: string): ManifestDataItem {
  const data = expectRecord(value, fieldPath);
  const kind = expectString(data.kind, `${fieldPath}.kind`);

  if (!DATA_ITEM_KINDS.includes(kind as (typeof DATA_ITEM_KINDS)[number])) {
    fail(`${fieldPath}.kind must be one of: ${DATA_ITEM_KINDS.join(", ")}.`);
  }

  const item: ManifestDataItem = {
    id: expectString(data.id, `${fieldPath}.id`),
    title: expectString(data.title, `${fieldPath}.title`),
    kind: kind as (typeof DATA_ITEM_KINDS)[number]
  };

  if (data.path !== undefined) {
    item.path = expectString(data.path, `${fieldPath}.path`);
  }

  if (data.description !== undefined) {
    item.description = expectString(data.description, `${fieldPath}.description`);
  }

  if (data.includes !== undefined) {
    item.includes = expectStringArray(data.includes, `${fieldPath}.includes`);
  }

  if (data.sensitive !== undefined) {
    item.sensitive = expectBoolean(data.sensitive, `${fieldPath}.sensitive`);
  }

  if (data.backupByDefault !== undefined) {
    item.backupByDefault = expectBoolean(data.backupByDefault, `${fieldPath}.backupByDefault`);
  }

  if (data.uninstallByDefault !== undefined) {
    const uninstallByDefault = expectString(
      data.uninstallByDefault,
      `${fieldPath}.uninstallByDefault`
    );
    if (
      !DATA_ITEM_UNINSTALL_POLICIES.includes(
        uninstallByDefault as (typeof DATA_ITEM_UNINSTALL_POLICIES)[number]
      )
    ) {
      fail(
        `${fieldPath}.uninstallByDefault must be one of: ${DATA_ITEM_UNINSTALL_POLICIES.join(", ")}.`
      );
    }
    item.uninstallByDefault =
      uninstallByDefault as (typeof DATA_ITEM_UNINSTALL_POLICIES)[number];
  }

  return item;
}

function parseDataLayoutDescriptor(
  value: unknown,
  fieldPath: string
): ManifestDataLayoutDescriptor {
  const data = expectRecord(value, fieldPath);
  if (!Array.isArray(data.items) || data.items.length === 0) {
    fail(`${fieldPath}.items must be a non-empty array.`);
  }

  return {
    items: data.items.map((entry, index) => parseDataItem(entry, `${fieldPath}.items[${index}]`))
  };
}

function parseMigrationStrategy(
  value: unknown,
  fieldPath: string
): ManifestMigrationStrategy {
  const data = expectRecord(value, fieldPath);
  const mode = expectString(data.mode, `${fieldPath}.mode`);

  if (!MIGRATION_STRATEGY_MODES.includes(mode as (typeof MIGRATION_STRATEGY_MODES)[number])) {
    fail(`${fieldPath}.mode must be one of: ${MIGRATION_STRATEGY_MODES.join(", ")}.`);
  }

  const strategy: ManifestMigrationStrategy = {
    id: expectString(data.id, `${fieldPath}.id`),
    source: expectString(data.source, `${fieldPath}.source`),
    title: expectString(data.title, `${fieldPath}.title`),
    mode: mode as (typeof MIGRATION_STRATEGY_MODES)[number],
    summary: expectString(data.summary, `${fieldPath}.summary`)
  };

  if (data.supported !== undefined) {
    strategy.supported = expectBoolean(data.supported, `${fieldPath}.supported`);
  }

  if (data.documentationUrl !== undefined) {
    strategy.documentationUrl = expectString(
      data.documentationUrl,
      `${fieldPath}.documentationUrl`
    );
  }

  if (data.previewCommands !== undefined) {
    strategy.previewCommands = parseCommandList(
      data.previewCommands,
      `${fieldPath}.previewCommands`
    );
  }

  if (data.applyCommands !== undefined) {
    strategy.applyCommands = parseCommandList(data.applyCommands, `${fieldPath}.applyCommands`);
  }

  if (data.dataItemIds !== undefined) {
    strategy.dataItemIds = expectStringArray(data.dataItemIds, `${fieldPath}.dataItemIds`);
  }

  if (data.warnings !== undefined) {
    strategy.warnings = expectStringArray(data.warnings, `${fieldPath}.warnings`);
  }

  return strategy;
}

function parseMigrationDescriptor(
  value: unknown,
  fieldPath: string
): ManifestMigrationDescriptor {
  const data = expectRecord(value, fieldPath);
  if (!Array.isArray(data.strategies) || data.strategies.length === 0) {
    fail(`${fieldPath}.strategies must be a non-empty array.`);
  }

  return {
    strategies: data.strategies.map((entry, index) =>
      parseMigrationStrategy(entry, `${fieldPath}.strategies[${index}]`)
    )
  };
}

export function validateManifest(input: unknown): HubInstallManifest {
  const data = expectRecord(input, "manifest");
  const schemaVersion = expectString(data.schemaVersion, "schemaVersion");

  if (schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail(
      `schemaVersion "${schemaVersion}" is unsupported. Expected "${MANIFEST_SCHEMA_VERSION}".`
    );
  }

  const manifest: HubInstallManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    metadata: parseMetadata(data.metadata),
    artifacts: []
  };

  if (data.platforms !== undefined) {
    const platforms = expectStringArray(data.platforms, "platforms");
    for (const platform of platforms) {
      if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
        fail(`platforms contains unsupported platform "${platform}".`);
      }
    }
    manifest.platforms = platforms as (typeof SUPPORTED_PLATFORMS)[number][];
  }

  if (data.variables !== undefined) {
    manifest.variables = expectStringMap(data.variables, "variables");
  }

  if (data.defaults !== undefined) {
    const defaultsRaw = expectRecord(data.defaults, "defaults");
    const defaults: HubInstallManifest["defaults"] = {};
    if (defaultsRaw.sudo !== undefined) {
      if (typeof defaultsRaw.sudo !== "boolean") {
        fail("defaults.sudo must be a boolean.");
      }
      defaults.sudo = defaultsRaw.sudo;
    }
    if (defaultsRaw.timeoutMs !== undefined) {
      if (
        typeof defaultsRaw.timeoutMs !== "number" ||
        !Number.isFinite(defaultsRaw.timeoutMs) ||
        defaultsRaw.timeoutMs <= 0
      ) {
        fail("defaults.timeoutMs must be a positive number.");
      }
      defaults.timeoutMs = defaultsRaw.timeoutMs;
    }
    if (defaultsRaw.cwd !== undefined) {
      defaults.cwd = expectString(defaultsRaw.cwd, "defaults.cwd");
    }
    if (defaultsRaw.env !== undefined) {
      defaults.env = expectStringMap(defaultsRaw.env, "defaults.env");
    }
    if (defaultsRaw.continueOnError !== undefined) {
      if (typeof defaultsRaw.continueOnError !== "boolean") {
        fail("defaults.continueOnError must be a boolean.");
      }
      defaults.continueOnError = defaultsRaw.continueOnError;
    }
    manifest.defaults = defaults;
  }

  if (data.dependencies !== undefined) {
    if (!Array.isArray(data.dependencies)) {
      fail("dependencies must be an array.");
    }
    manifest.dependencies = data.dependencies.map((entry, index) =>
      parseDependency(entry, `dependencies[${index}]`)
    );
  }

  if (data.lifecycle !== undefined) {
    const lifecycleRaw = expectRecord(data.lifecycle, "lifecycle");
    const lifecycle: HubInstallManifest["lifecycle"] = {};

    for (const [stage, commands] of Object.entries(lifecycleRaw)) {
      if (!LIFECYCLE_STAGES.includes(stage as (typeof LIFECYCLE_STAGES)[number])) {
        fail(`lifecycle.${stage} is not a valid lifecycle stage.`);
      }
      lifecycle[stage as (typeof LIFECYCLE_STAGES)[number]] = parseCommandList(
        commands,
        `lifecycle.${stage}`
      );
    }
    manifest.lifecycle = lifecycle;
  }

  if (data.installation !== undefined) {
    manifest.installation = parseInstallationDescriptor(data.installation, "installation");
  }

  if (data.dataLayout !== undefined) {
    manifest.dataLayout = parseDataLayoutDescriptor(data.dataLayout, "dataLayout");
  }

  if (data.migration !== undefined) {
    manifest.migration = parseMigrationDescriptor(data.migration, "migration");
  }

  if (!Array.isArray(data.artifacts) || data.artifacts.length === 0) {
    fail("artifacts must be a non-empty array.");
  }

  manifest.artifacts = data.artifacts.map((entry, index) => parseArtifact(entry, `artifacts[${index}]`));

  return manifest;
}
