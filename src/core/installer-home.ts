import os from "node:os";
import path from "node:path";

export interface ResolveInstallerHomeInput {
  homeDir?: string;
  installerHomeOverride?: string;
}

export interface InstallerDirectories {
  home: string;
  configDir: string;
  cacheDir: string;
  registryCacheDir: string;
  manifestCacheDir: string;
  packageCacheDir: string;
  stateDir: string;
  sourcesDir: string;
  tempDir: string;
  installRecordsDir: string;
  logsDir: string;
  configFile: string;
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function normalizeCrossPlatformPath(value: string): string {
  if (isWindowsAbsolutePath(value)) {
    return path.win32.normalize(value);
  }

  if (value.startsWith("/")) {
    return path.posix.normalize(value);
  }

  return path.resolve(value);
}

function joinInstallerPath(base: string, ...segments: string[]): string {
  if (isWindowsAbsolutePath(base)) {
    return path.win32.join(base, ...segments);
  }

  if (base.startsWith("/")) {
    return path.posix.join(base, ...segments);
  }

  return path.join(base, ...segments);
}

export function resolveInstallerHome(input: ResolveInstallerHomeInput = {}): string {
  if (input.installerHomeOverride) {
    return normalizeCrossPlatformPath(input.installerHomeOverride);
  }

  const homeDir = input.homeDir ?? os.homedir();
  return joinInstallerPath(normalizeCrossPlatformPath(homeDir), ".sdkwork", "hub-installer");
}

export function resolveInstallerDirectories(
  input: ResolveInstallerHomeInput = {}
): InstallerDirectories {
  const home = resolveInstallerHome(input);
  const configDir = joinInstallerPath(home, "config");
  const cacheDir = joinInstallerPath(home, "cache");
  const stateDir = joinInstallerPath(home, "state");

  return {
    home,
    configDir,
    cacheDir,
    registryCacheDir: joinInstallerPath(cacheDir, "registry"),
    manifestCacheDir: joinInstallerPath(cacheDir, "manifests"),
    packageCacheDir: joinInstallerPath(cacheDir, "packages"),
    stateDir,
    sourcesDir: joinInstallerPath(stateDir, "sources"),
    tempDir: joinInstallerPath(stateDir, "tmp"),
    installRecordsDir: joinInstallerPath(stateDir, "install-records"),
    logsDir: joinInstallerPath(home, "logs"),
    configFile: joinInstallerPath(configDir, "config.json")
  };
}
