export const SUPPORTED_PLATFORMS = [
  "windows",
  "macos",
  "ubuntu",
  "android",
  "ios"
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export const SUPPORTED_FORMATS = [
  "exe",
  "msi",
  "msix",
  "pkg",
  "dmg",
  "deb",
  "rpm",
  "appimage",
  "apk",
  "ipa",
  "zip",
  "tar",
  "manager"
] as const;

export type PackageFormat = (typeof SUPPORTED_FORMATS)[number];

export const SUPPORTED_PACKAGE_MANAGERS = [
  "winget",
  "choco",
  "brew",
  "apt",
  "snap"
] as const;

export type PackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];

export type InstallScope = "system" | "user";
export type InstallControlLevel = "managed" | "partial" | "opaque";
export type ShellKind = "bash" | "powershell" | "cmd";

export interface FileSource {
  kind: "file";
  path: string;
}

export interface ManagerSource {
  kind: "manager";
  manager: PackageManager;
  packageName: string;
}

export type SourceReference = FileSource | ManagerSource;

export interface InstallRequest {
  source: string;
  sourceChecksum?: string;
  platform?: SupportedPlatform;
  format?: PackageFormat;
  installerArgs?: string[];
  managerArgs?: string[];
  archiveEntry?: string;
  archiveCommand?: string;
  dryRun?: boolean;
  verbose?: boolean;
  sudo?: boolean;
  cwd?: string;
  timeoutMs?: number;
  downloadCacheDir?: string;
  downloadTimeoutMs?: number;
  androidDeviceId?: string;
  iosDeviceId?: string;
  iosSimulator?: boolean;
  progress?: boolean;
}

export interface ResolvedInstallRequest
  extends Omit<InstallRequest, "platform" | "format" | "source"> {
  source: string;
  platform: SupportedPlatform;
  format: PackageFormat;
  sourceRef: SourceReference;
}

export interface InstallStep {
  id: string;
  description: string;
  command: string;
  args?: string[];
  shell?: boolean;
  shellKind?: ShellKind;
  requiresElevation?: boolean;
  workingDirectory?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
  timeoutMs?: number;
}

export interface InstallPlan {
  request: ResolvedInstallRequest;
  steps: InstallStep[];
  notes: string[];
}

export interface StepExecutionResult {
  step: InstallStep;
  commandLine: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  exitCode: number | null;
  success: boolean;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
}

export interface InstallExecutionResult {
  plan: InstallPlan;
  success: boolean;
  steps: StepExecutionResult[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
}
