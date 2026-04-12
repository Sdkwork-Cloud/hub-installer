import type { Command } from "commander";
import { pickDefined } from "./core/pick-defined";
import { HubInstallerError } from "./errors";
import type { ApplyManifestOptions } from "./manifest";

type InstallPolicyCliOptions = {
  config?: string;
  installerHome?: string;
  installScope?: string;
  installRoot?: string;
  workRoot?: string;
  binDir?: string;
  dataRoot?: string;
  effectiveRuntimePlatform?: string;
  containerRuntime?: string;
  wslDistribution?: string;
  dockerContext?: string;
  dockerHost?: string;
};

function parseInstallScopeOption(
  value: string | undefined
): ApplyManifestOptions["installScope"] | undefined {
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
    `Invalid install scope "${value}". Expected "system" or "user".`
  );
}

function parseEffectiveRuntimePlatformOption(
  value: string | undefined
): ApplyManifestOptions["effectiveRuntimePlatform"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "windows" ||
    normalized === "macos" ||
    normalized === "ubuntu" ||
    normalized === "android" ||
    normalized === "ios" ||
    normalized === "wsl"
  ) {
    return normalized as ApplyManifestOptions["effectiveRuntimePlatform"];
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Invalid effective runtime platform "${value}". Expected one of: windows, macos, ubuntu, android, ios, wsl.`
  );
}

function parseContainerRuntimeOption(
  value: string | undefined
): ApplyManifestOptions["containerRuntime"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "auto" || normalized === "host" || normalized === "wsl") {
    return normalized as ApplyManifestOptions["containerRuntime"];
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Invalid container runtime "${value}". Expected one of: auto, host, wsl.`
  );
}

export function collectInstallPolicyOptions(
  options: InstallPolicyCliOptions
): Pick<
  ApplyManifestOptions,
  | "configPath"
  | "installerHome"
  | "installScope"
  | "installRoot"
  | "workRoot"
  | "binDir"
  | "dataRoot"
  | "effectiveRuntimePlatform"
  | "containerRuntime"
  | "wslDistribution"
  | "dockerContext"
  | "dockerHost"
> {
  return pickDefined({
    configPath: options.config,
    installerHome: options.installerHome,
    installScope: parseInstallScopeOption(options.installScope),
    installRoot: options.installRoot,
    workRoot: options.workRoot,
    binDir: options.binDir,
    dataRoot: options.dataRoot,
    effectiveRuntimePlatform: parseEffectiveRuntimePlatformOption(options.effectiveRuntimePlatform),
    containerRuntime: parseContainerRuntimeOption(options.containerRuntime),
    wslDistribution: options.wslDistribution,
    dockerContext: options.dockerContext,
    dockerHost: options.dockerHost
  });
}

export function addInstallPolicyOptions<T extends Command>(command: T): T {
  return command
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
    .option("--docker-host <value>", "Docker host override for manifest execution") as T;
}
