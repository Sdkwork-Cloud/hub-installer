import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveInstallerDirectories } from "./installer-home";
import { pickDefined } from "./pick-defined";
import { HubInstallerError } from "../errors";
import type { InstallScope } from "../types";

export interface HubInstallerConfig {
  installerHome?: string;
  installScope?: InstallScope;
  installRoot?: string;
  workRoot?: string;
  binDir?: string;
  dataRoot?: string;
}

interface ResolveHubConfigInput {
  cli?: Partial<HubInstallerConfig>;
  env?: Record<string, string | undefined>;
  file?: Partial<HubInstallerConfig>;
}

interface LoadHubConfigFileInput {
  installerHome?: string;
  configPath?: string;
  env?: Record<string, string | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function normalizePath(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  if (isWindowsAbsolutePath(normalized)) {
    return path.win32.normalize(normalized);
  }

  if (normalized.startsWith("/")) {
    return path.posix.normalize(normalized);
  }

  return path.resolve(normalized);
}

function parseInstallScope(
  value: string | undefined,
  sourceLabel: string
): InstallScope | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "system" || normalized === "user") {
    return normalized;
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Invalid install scope from ${sourceLabel}: "${value}". Expected "system" or "user".`
  );
}

function readEnvConfig(env: Record<string, string | undefined> | undefined): Partial<HubInstallerConfig> {
  if (!env) {
    return {};
  }

  return pickDefined({
    installerHome: normalizePath(env.HUB_INSTALLER_HOME),
    installScope: parseInstallScope(env.HUB_INSTALLER_INSTALL_SCOPE, "environment"),
    installRoot: normalizePath(env.HUB_INSTALLER_INSTALL_ROOT),
    workRoot: normalizePath(env.HUB_INSTALLER_WORK_ROOT),
    binDir: normalizePath(env.HUB_INSTALLER_BIN_DIR),
    dataRoot: normalizePath(env.HUB_INSTALLER_DATA_ROOT)
  });
}

function normalizeFileConfig(config: Partial<HubInstallerConfig> | undefined): Partial<HubInstallerConfig> {
  if (!config) {
    return {};
  }

  return pickDefined({
    installerHome: normalizePath(config.installerHome),
    installScope: parseInstallScope(config.installScope, "config file"),
    installRoot: normalizePath(config.installRoot),
    workRoot: normalizePath(config.workRoot),
    binDir: normalizePath(config.binDir),
    dataRoot: normalizePath(config.dataRoot)
  });
}

function normalizeCliConfig(config: Partial<HubInstallerConfig> | undefined): Partial<HubInstallerConfig> {
  if (!config) {
    return {};
  }

  return pickDefined({
    installerHome: normalizePath(config.installerHome),
    installScope: parseInstallScope(config.installScope, "cli"),
    installRoot: normalizePath(config.installRoot),
    workRoot: normalizePath(config.workRoot),
    binDir: normalizePath(config.binDir),
    dataRoot: normalizePath(config.dataRoot)
  });
}

export function resolveHubConfigFilePath(input: LoadHubConfigFileInput = {}): string {
  const explicitPath = normalizePath(input.configPath ?? input.env?.HUB_INSTALLER_CONFIG);
  if (explicitPath) {
    return explicitPath;
  }

  const installerHome = normalizePath(input.installerHome ?? input.env?.HUB_INSTALLER_HOME);
  return resolveInstallerDirectories(
    pickDefined({
      installerHomeOverride: installerHome
    })
  ).configFile;
}

export function loadHubConfigFile(input: LoadHubConfigFileInput = {}): Partial<HubInstallerConfig> {
  const configPath = resolveHubConfigFilePath(input);
  if (!existsSync(configPath)) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  } catch (error) {
    throw new HubInstallerError(
      "CONFIG_PARSE_FAILED",
      `Failed to parse hub-installer config file: ${configPath}`,
      error
    );
  }

  if (!isRecord(parsed)) {
    throw new HubInstallerError(
      "CONFIG_PARSE_FAILED",
      `Hub-installer config file must contain a JSON object: ${configPath}`
    );
  }

  return normalizeFileConfig(parsed as Partial<HubInstallerConfig>);
}

export function resolveHubConfig(input: ResolveHubConfigInput = {}): HubInstallerConfig {
  return {
    ...normalizeFileConfig(input.file),
    ...readEnvConfig(input.env),
    ...normalizeCliConfig(input.cli)
  };
}
