import { spawnSync } from "node:child_process";
import { HubInstallerError } from "../errors";
import type { SupportedPlatform } from "../types";
import { detectHostPlatform } from "./platform";
import type { EffectiveRuntimePlatform } from "./install-policy";

export type ContainerRuntimePreference = "auto" | "host" | "wsl";
export type ContainerRuntime = Exclude<ContainerRuntimePreference, "auto">;

export interface RuntimeOptions {
  effectiveRuntimePlatform?: EffectiveRuntimePlatform;
  containerRuntime?: ContainerRuntimePreference;
  wslDistribution?: string;
  dockerContext?: string;
  dockerHost?: string;
}

export interface ExecutionContext {
  hostPlatform: SupportedPlatform;
  targetPlatform: SupportedPlatform;
  effectiveRuntimePlatform: EffectiveRuntimePlatform;
  containerRuntime?: ContainerRuntime;
  wslDistribution?: string;
  dockerContext?: string;
  dockerHost?: string;
  runtimeHomeDir?: string;
}

export interface RuntimeProbe {
  commandExists(command: string): boolean;
  listWslDistros(): string[];
  wslCommandExists(distro: string | undefined, command: string): boolean;
  dockerAvailableOnHost(): boolean;
  wslDockerAvailable(distro: string | undefined): boolean;
  wslHomeDir(distro: string | undefined): string | undefined;
}

export function resolveExecutionContext(
  targetPlatform: SupportedPlatform,
  options: RuntimeOptions = {}
): ExecutionContext {
  return resolveExecutionContextWithProbe(
    detectHostPlatform(),
    targetPlatform,
    options,
    createSystemRuntimeProbe()
  );
}

export function resolveExecutionContextWithProbe(
  hostPlatform: SupportedPlatform,
  targetPlatform: SupportedPlatform,
  options: RuntimeOptions,
  probe: RuntimeProbe
): ExecutionContext {
  const explicitWslDistribution = options.wslDistribution?.trim() || undefined;
  const candidateWslDistros = probe
    .listWslDistros()
    .filter((distribution) => !isSystemWslDistribution(distribution));
  const distroWithBash =
    candidateWslDistros.find((distribution) =>
      probe.wslCommandExists(distribution, "bash")
    ) ?? candidateWslDistros[0];
  const distroWithDocker = candidateWslDistros.find((distribution) =>
    probe.wslDockerAvailable(distribution)
  );
  const resolvedWslDistribution =
    explicitWslDistribution ??
    (options.containerRuntime === "auto" || options.containerRuntime === "wsl"
      ? distroWithDocker ?? distroWithBash
      : distroWithBash);

  const effectiveRuntimePlatform =
    options.effectiveRuntimePlatform ??
    resolveEffectiveRuntimePlatform(
      hostPlatform,
      targetPlatform,
      options.containerRuntime,
      distroWithDocker ? { distroWithDocker } : {}
    );

  if (effectiveRuntimePlatform === "wsl" && !resolvedWslDistribution) {
    throw new HubInstallerError(
      "WSL_RUNTIME_UNAVAILABLE",
      "effective runtime platform wsl requires an installed WSL distribution"
    );
  }

  const containerRuntime = resolveContainerRuntime(
    effectiveRuntimePlatform,
    options.containerRuntime,
    probe
  );

  validateContainerRuntimeConfiguration(
    effectiveRuntimePlatform,
    containerRuntime,
    resolvedWslDistribution,
    probe
  );
  const runtimeHomeDir =
    effectiveRuntimePlatform === "wsl"
      ? probe.wslHomeDir(resolvedWslDistribution)
      : undefined;

  return {
    hostPlatform,
    targetPlatform,
    effectiveRuntimePlatform,
    ...(containerRuntime ? { containerRuntime } : {}),
    ...(effectiveRuntimePlatform === "wsl" && resolvedWslDistribution
      ? { wslDistribution: resolvedWslDistribution }
      : {}),
    ...(options.dockerContext ? { dockerContext: options.dockerContext } : {}),
    ...(options.dockerHost ? { dockerHost: options.dockerHost } : {}),
    ...(runtimeHomeDir ? { runtimeHomeDir } : {})
  };
}

function resolveEffectiveRuntimePlatform(
  hostPlatform: SupportedPlatform,
  targetPlatform: SupportedPlatform,
  containerRuntime: ContainerRuntimePreference | undefined,
  input: {
    distroWithDocker?: string;
  }
): EffectiveRuntimePlatform {
  if (hostPlatform === "windows" && containerRuntime === "wsl") {
    return "wsl";
  }

  if (hostPlatform === "windows" && containerRuntime === "host") {
    return "windows";
  }

  if (
    hostPlatform === "windows" &&
    containerRuntime === "auto" &&
    input.distroWithDocker
  ) {
    return "wsl";
  }

  return targetPlatform;
}

function resolveContainerRuntime(
  effectiveRuntimePlatform: EffectiveRuntimePlatform,
  preference: ContainerRuntimePreference | undefined,
  probe: RuntimeProbe
): ContainerRuntime | undefined {
  if (preference === "host" || preference === "wsl") {
    return preference;
  }

  if (preference === "auto") {
    if (effectiveRuntimePlatform === "wsl") {
      return "wsl";
    }

    if (probe.dockerAvailableOnHost()) {
      return "host";
    }

    return undefined;
  }

  return undefined;
}

function validateContainerRuntimeConfiguration(
  effectiveRuntimePlatform: EffectiveRuntimePlatform,
  containerRuntime: ContainerRuntime | undefined,
  wslDistribution: string | undefined,
  probe: RuntimeProbe
): void {
  if (containerRuntime === "wsl" && effectiveRuntimePlatform !== "wsl") {
    throw new HubInstallerError(
      "INVALID_RUNTIME_CONFIGURATION",
      `container runtime wsl requires WSL execution, got ${effectiveRuntimePlatform}`
    );
  }

  if (effectiveRuntimePlatform === "wsl" && containerRuntime === "wsl") {
    if (!wslDistribution) {
      throw new HubInstallerError(
        "WSL_RUNTIME_UNAVAILABLE",
        "WSL Docker runtime requires an installed WSL distribution"
      );
    }

    if (!probe.wslDockerAvailable(wslDistribution)) {
      throw new HubInstallerError(
        "WSL_DOCKER_UNAVAILABLE",
        `Docker is unavailable inside WSL distribution ${wslDistribution}`
      );
    }

    return;
  }

  if (containerRuntime === "host" && !probe.dockerAvailableOnHost()) {
    throw new HubInstallerError(
      "HOST_DOCKER_UNAVAILABLE",
      "container runtime host was requested but host Docker is unavailable"
    );
  }
}

function isSystemWslDistribution(distro: string): boolean {
  const normalized = distro.trim().toLowerCase();
  return normalized === "docker-desktop" || normalized === "docker-desktop-data";
}

export function normalizePathForRuntime(
  value: string,
  runtimePlatform: EffectiveRuntimePlatform
): string {
  if (!value.trim()) {
    return "";
  }

  if (runtimePlatform === "windows") {
    return value.replace(/\//g, "\\");
  }

  if (runtimePlatform === "wsl") {
    return normalizeWindowsPathForWsl(value);
  }

  return value.replace(/\\/g, "/");
}

export function resolveHostPathForRuntime(
  value: string,
  context: ExecutionContext
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (
    context.hostPlatform === "windows" &&
    context.effectiveRuntimePlatform === "wsl"
  ) {
    return mapWslRuntimePathToWindowsHost(trimmed, context.wslDistribution);
  }

  if (context.hostPlatform === "windows") {
    return trimmed.replace(/\//g, "\\");
  }

  return trimmed.replace(/\\/g, "/");
}

function normalizeWindowsPathForWsl(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (
    normalized.length >= 2 &&
    normalized[1] === ":" &&
    /^[a-z]$/i.test(normalized[0] ?? "")
  ) {
    const drive = normalized[0]!.toLowerCase();
    const suffix = normalized.slice(2).replace(/^\/+/, "");
    return suffix ? `/mnt/${drive}/${suffix}` : `/mnt/${drive}`;
  }

  return normalized;
}

function mapWslRuntimePathToWindowsHost(
  value: string,
  wslDistribution: string | undefined
): string {
  const normalized = value.replace(/\\/g, "/");

  if (
    normalized.startsWith("/mnt/") &&
    normalized.length >= 7 &&
    /^[a-z]$/i.test(normalized[5] ?? "") &&
    normalized[6] === "/"
  ) {
    const drive = normalized[5]!.toUpperCase();
    const suffix = normalized.slice(7).replace(/\//g, "\\");
    return suffix ? `${drive}:\\${suffix}` : `${drive}:\\`;
  }

  if (normalized.length >= 2 && normalized[1] === ":") {
    return normalized.replace(/\//g, "\\");
  }

  if (normalized.startsWith("/")) {
    if (!wslDistribution) {
      throw new HubInstallerError(
        "WSL_RUNTIME_UNAVAILABLE",
        "WSL host path mapping requires a WSL distribution"
      );
    }

    const suffix = normalized.slice(1).replace(/\//g, "\\");
    return suffix
      ? `\\\\wsl$\\${wslDistribution}\\${suffix}`
      : `\\\\wsl$\\${wslDistribution}`;
  }

  return normalized.replace(/\//g, "\\");
}

function createSystemRuntimeProbe(): RuntimeProbe {
  return {
    commandExists(command) {
      if (process.platform === "win32") {
        return (
          spawnSync("where.exe", [command], {
            shell: false,
            stdio: "ignore"
          }).status === 0
        );
      }

      return (
        spawnSync("sh", ["-lc", `command -v ${command} >/dev/null 2>&1`], {
          shell: false,
          stdio: "ignore"
        }).status === 0
      );
    },
    listWslDistros() {
      if (process.platform !== "win32") {
        return [];
      }

      const result = spawnSync("wsl.exe", ["-l", "-q"], {
        shell: false
      });
      if (result.status !== 0) {
        return [];
      }

      return decodeCommandOutput(result.stdout)
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    },
    wslCommandExists(distro, command) {
      if (process.platform !== "win32") {
        return false;
      }

      const args = distro
        ? ["-d", distro, "--", "bash", "-lc", `command -v ${command} >/dev/null 2>&1`]
        : ["--", "bash", "-lc", `command -v ${command} >/dev/null 2>&1`];
      return (
        spawnSync("wsl.exe", args, {
          shell: false,
          stdio: "ignore"
        }).status === 0
      );
    },
    dockerAvailableOnHost() {
      if (!this.commandExists("docker")) {
        return false;
      }

      return (
        spawnSync("docker", ["info", "--format", "{{json .ID}}"], {
          shell: false,
          stdio: "ignore"
        }).status === 0
      );
    },
    wslDockerAvailable(distro) {
      if (process.platform !== "win32") {
        return false;
      }

      const args = distro
        ? ["-d", distro, "--", "bash", "-lc", "docker info >/dev/null 2>&1"]
        : ["--", "bash", "-lc", "docker info >/dev/null 2>&1"];
      return (
        spawnSync("wsl.exe", args, {
          shell: false,
          stdio: "ignore"
        }).status === 0
      );
    },
    wslHomeDir(distro) {
      if (process.platform !== "win32") {
        return undefined;
      }

      const args = distro
        ? ["-d", distro, "--", "bash", "-lc", "printf %s \"$HOME\""]
        : ["--", "bash", "-lc", "printf %s \"$HOME\""];
      const result = spawnSync("wsl.exe", args, {
        shell: false
      });
      if (result.status !== 0) {
        return undefined;
      }

      const value = decodeCommandOutput(result.stdout).trim();
      return value || undefined;
    }
  };
}

function decodeCommandOutput(value: string | Buffer | null | undefined): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    value.length >= 2 &&
    value.every((byte, index) => index % 2 === 0 || byte === 0)
  ) {
    return Buffer.from(value).toString("utf16le");
  }

  return Buffer.from(value).toString("utf8");
}
