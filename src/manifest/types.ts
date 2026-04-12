import type {
  InstallRequest,
  SupportedPlatform,
  InstallScope,
  InstallControlLevel
} from "../types";
import type {
  ContainerRuntime,
  ContainerRuntimePreference,
  RuntimeProbe
} from "../core/runtime";

export const MANIFEST_SCHEMA_VERSION = "1.0" as const;
export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION;

export const LIFECYCLE_STAGES = [
  "preflight",
  "preInstall",
  "install",
  "postInstall",
  "configure",
  "healthcheck",
  "backup",
  "uninstall"
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const MANIFEST_SHELLS = ["auto", "bash", "powershell", "cmd"] as const;
export type ManifestShell = (typeof MANIFEST_SHELLS)[number];

export const INSTALLATION_METHOD_TYPES = [
  "script",
  "package",
  "source",
  "container",
  "binary",
  "wsl",
  "manual"
] as const;
export type InstallationMethodType = (typeof INSTALLATION_METHOD_TYPES)[number];

export const DATA_ITEM_KINDS = ["file", "directory", "database", "secret", "log"] as const;
export type ManifestDataItemKind = (typeof DATA_ITEM_KINDS)[number];

export const DATA_ITEM_UNINSTALL_POLICIES = ["preserve", "remove", "manual"] as const;
export type ManifestDataItemUninstallPolicy = (typeof DATA_ITEM_UNINSTALL_POLICIES)[number];

export const MIGRATION_STRATEGY_MODES = ["command", "manual", "script"] as const;
export type ManifestMigrationStrategyMode = (typeof MIGRATION_STRATEGY_MODES)[number];

export interface ManifestCondition {
  platforms?: SupportedPlatform[];
  env?: Record<string, string>;
  commandExists?: string;
  fileExists?: string;
}

export interface ManifestCommand {
  id?: string;
  description?: string;
  run: string;
  shell?: ManifestShell;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  continueOnError?: boolean;
  elevated?: boolean;
  when?: ManifestCondition;
}

export type DependencyCheck =
  | {
      type: "command";
      name: string;
    }
  | {
      type: "file";
      path: string;
    }
  | {
      type: "env";
      name: string;
      equals?: string;
    }
  | {
      type: "platform";
      platforms: SupportedPlatform[];
    };

export interface ManifestDependency {
  id: string;
  description?: string;
  required?: boolean;
  check: DependencyCheck;
  install?: ManifestCommand[];
}

export interface ArtifactBase {
  id: string;
  title?: string;
  description?: string;
  enabled?: boolean;
  when?: ManifestCondition;
  preInstall?: ManifestCommand[];
  postInstall?: ManifestCommand[];
  configure?: ManifestCommand[];
}

export type PackageInstallRequest = Omit<InstallRequest, "platform"> & {
  platform?: SupportedPlatform;
};

export interface PackageInstallByPlatform {
  byPlatform: Partial<Record<SupportedPlatform, PackageInstallRequest>>;
  fallback?: PackageInstallRequest;
}

export interface PackageArtifact extends ArtifactBase {
  type: "package";
  install: PackageInstallRequest | PackageInstallByPlatform;
}

export interface GitArtifact extends ArtifactBase {
  type: "git";
  repository: string;
  destination: string;
  ref?: string;
  cloneDepth?: number;
  strategy?: "clone-or-pull" | "clone-only" | "pull-only";
  submodules?: boolean;
  lfs?: boolean;
  build?: ManifestCommand[];
}

export interface HuggingFaceArtifact extends ArtifactBase {
  type: "huggingface";
  repoId: string;
  destination: string;
  revision?: string;
  method?: "git-lfs" | "huggingface-cli";
  tokenEnv?: string;
  include?: string[];
  exclude?: string[];
}

export interface CommandArtifact extends ArtifactBase {
  type: "command";
  commands: ManifestCommand[];
}

export type ManifestArtifact =
  | PackageArtifact
  | GitArtifact
  | HuggingFaceArtifact
  | CommandArtifact;

export interface ManifestDefaults {
  sudo?: boolean;
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
}

export interface ManifestMetadata {
  name: string;
  version?: string;
  description?: string;
  homepage?: string;
  maintainers?: string[];
}

export interface ManifestInstallationMethod {
  id: string;
  label: string;
  type: InstallationMethodType;
  summary: string;
  supported?: boolean;
  documentationUrl?: string;
  notes?: string[];
}

export interface ManifestInstallationDirectory {
  id?: string;
  path: string;
  customizable?: boolean;
  purpose?: string;
}

export interface ManifestInstallationDirectories {
  installRoot?: ManifestInstallationDirectory;
  workRoot?: ManifestInstallationDirectory;
  binDir?: ManifestInstallationDirectory;
  dataRoot?: ManifestInstallationDirectory;
  additional?: ManifestInstallationDirectory[];
}

export interface ManifestInstallationDescriptor {
  method: ManifestInstallationMethod;
  alternatives?: ManifestInstallationMethod[];
  directories?: ManifestInstallationDirectories;
}

export interface ManifestDataItem {
  id: string;
  title: string;
  kind: ManifestDataItemKind;
  path?: string;
  description?: string;
  includes?: string[];
  sensitive?: boolean;
  backupByDefault?: boolean;
  uninstallByDefault?: ManifestDataItemUninstallPolicy;
}

export interface ManifestDataLayoutDescriptor {
  items: ManifestDataItem[];
}

export interface ManifestMigrationStrategy {
  id: string;
  source: string;
  title: string;
  mode: ManifestMigrationStrategyMode;
  summary: string;
  supported?: boolean;
  documentationUrl?: string;
  previewCommands?: ManifestCommand[];
  applyCommands?: ManifestCommand[];
  dataItemIds?: string[];
  warnings?: string[];
}

export interface ManifestMigrationDescriptor {
  strategies: ManifestMigrationStrategy[];
}

export interface HubInstallManifest {
  schemaVersion: ManifestSchemaVersion;
  metadata: ManifestMetadata;
  platforms?: SupportedPlatform[];
  variables?: Record<string, string>;
  defaults?: ManifestDefaults;
  dependencies?: ManifestDependency[];
  lifecycle?: Partial<Record<LifecycleStage, ManifestCommand[]>>;
  installation?: ManifestInstallationDescriptor;
  dataLayout?: ManifestDataLayoutDescriptor;
  migration?: ManifestMigrationDescriptor;
  artifacts: ManifestArtifact[];
}

export interface LoadedManifest {
  manifest: HubInstallManifest;
  absolutePath: string;
  baseDirectory: string;
  sourceInput: string;
  sourceKind: "file" | "directory" | "url";
  resolvedFrom?: string;
}

export interface ApplyManifestOptions {
  platform?: SupportedPlatform;
  dryRun?: boolean;
  verbose?: boolean;
  progress?: boolean;
  sudo?: boolean;
  timeoutMs?: number;
  cwd?: string;
  softwareName?: string;
  installerHome?: string;
  installScope?: InstallScope;
  installRoot?: string;
  workRoot?: string;
  binDir?: string;
  dataRoot?: string;
  installControlLevel?: InstallControlLevel;
  effectiveRuntimePlatform?: SupportedPlatform | "wsl";
  containerRuntime?: ContainerRuntimePreference;
  wslDistribution?: string;
  dockerContext?: string;
  dockerHost?: string;
  variables?: Record<string, string>;
  configPath?: string;
  manifestCacheDir?: string;
  manifestFetchTimeoutMs?: number;
  runtimeProbe?: RuntimeProbe;
}

export interface StageReport {
  stage: string;
  success: boolean;
  durationMs: number;
  totalSteps: number;
  failedSteps: number;
}

export interface ArtifactReport {
  artifactId: string;
  artifactType: ManifestArtifact["type"];
  success: boolean;
  durationMs: number;
  detail?: string;
}

export interface ApplyManifestResult {
  manifestName: string;
  manifestPath: string;
  manifestSourceInput: string;
  manifestSourceKind: LoadedManifest["sourceKind"];
  platform: SupportedPlatform;
  installerHome: string;
  resolvedInstallScope: InstallScope;
  resolvedInstallRoot: string;
  resolvedWorkRoot: string;
  resolvedBinDir: string;
  resolvedDataRoot: string;
  installControlLevel: InstallControlLevel;
  effectiveRuntimePlatform: SupportedPlatform | "wsl";
  containerRuntime?: ContainerRuntime;
  wslDistribution?: string;
  success: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stageReports: StageReport[];
  artifactReports: ArtifactReport[];
}

export type BackupTarget = "data" | "install" | "work";
export type BackupTargetStatus = "copied" | "missing";
export type UninstallTargetStatus = "removed" | "missing" | "preserved";

export interface BackupTargetReport {
  target: BackupTarget;
  status: BackupTargetStatus;
}

export interface UninstallTargetReport {
  target: BackupTarget;
  status: UninstallTargetStatus;
}

export interface BackupManifestOptions extends ApplyManifestOptions {
  targets?: BackupTarget[];
  sessionId?: string;
}

export interface BackupManifestResult {
  manifestName: string;
  manifestPath: string;
  manifestSourceInput: string;
  manifestSourceKind: LoadedManifest["sourceKind"];
  platform: SupportedPlatform;
  installerHome: string;
  resolvedInstallScope: InstallScope;
  resolvedInstallRoot: string;
  resolvedWorkRoot: string;
  resolvedBinDir: string;
  resolvedDataRoot: string;
  installControlLevel: InstallControlLevel;
  effectiveRuntimePlatform: SupportedPlatform | "wsl";
  containerRuntime?: ContainerRuntime;
  wslDistribution?: string;
  installRecordFile: string;
  installRecordFound: boolean;
  backupSessionDir: string;
  success: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stageReports: StageReport[];
  targetReports: BackupTargetReport[];
}

export interface UninstallManifestOptions extends ApplyManifestOptions {
  purgeData?: boolean;
  backupBeforeUninstall?: boolean;
  backupTargets?: BackupTarget[];
  backupSessionId?: string;
}

export interface UninstallManifestResult {
  manifestName: string;
  manifestPath: string;
  manifestSourceInput: string;
  manifestSourceKind: LoadedManifest["sourceKind"];
  platform: SupportedPlatform;
  installerHome: string;
  resolvedInstallScope: InstallScope;
  resolvedInstallRoot: string;
  resolvedWorkRoot: string;
  resolvedBinDir: string;
  resolvedDataRoot: string;
  installControlLevel: InstallControlLevel;
  effectiveRuntimePlatform: SupportedPlatform | "wsl";
  containerRuntime?: ContainerRuntime;
  wslDistribution?: string;
  installRecordFile: string;
  installRecordFound: boolean;
  purgeData: boolean;
  success: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stageReports: StageReport[];
  targetReports: UninstallTargetReport[];
  backupResult?: BackupManifestResult;
}
