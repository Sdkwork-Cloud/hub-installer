import path from "node:path";
import type { SupportedPlatform, InstallScope, InstallControlLevel } from "../types";

export type EffectiveRuntimePlatform = SupportedPlatform | "wsl";

export interface ResolveInstallPolicyInput {
  platform: SupportedPlatform;
  softwareName: string;
  installerHome: string;
  installScope?: InstallScope;
  installRoot?: string;
  workRoot?: string;
  binDir?: string;
  dataRoot?: string;
  installControlLevel?: InstallControlLevel;
  effectiveRuntimePlatform?: EffectiveRuntimePlatform;
  env?: Record<string, string | undefined>;
}

export interface ResolvedInstallPolicy {
  installerHome: string;
  installScope: InstallScope;
  installRoot: string;
  workRoot: string;
  binDir: string;
  dataRoot: string;
  installControlLevel: InstallControlLevel;
  effectiveRuntimePlatform: EffectiveRuntimePlatform;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "software";
}

function toWindowsSegment(value: string): string {
  return toSlug(value)
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

function deriveHomeDir(installerHome: string): string {
  return path.dirname(path.dirname(installerHome));
}

function normalizePathForRuntime(
  value: string | undefined,
  runtimePlatform: EffectiveRuntimePlatform
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (runtimePlatform === "windows") {
    return trimmed.replace(/\//g, "\\");
  }

  if (runtimePlatform === "wsl") {
    const normalized = trimmed.replace(/\\/g, "/");
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

  return trimmed.replace(/\\/g, "/");
}

function resolveUnixPolicy(input: ResolveInstallPolicyInput): Omit<ResolvedInstallPolicy, "installControlLevel" | "effectiveRuntimePlatform"> {
  const slug = toSlug(input.softwareName);
  const homeDir = deriveHomeDir(input.installerHome);
  const installScope = input.installScope ?? "system";

  if (installScope === "user") {
    return {
      installerHome: input.installerHome,
      installScope,
      installRoot: input.installRoot ?? path.posix.join(homeDir.replace(/\\/g, "/"), ".local", "opt", slug),
      workRoot: input.workRoot ?? path.posix.join(input.installerHome.replace(/\\/g, "/"), "state", "sources", slug),
      binDir: input.binDir ?? path.posix.join(homeDir.replace(/\\/g, "/"), ".local", "bin"),
      dataRoot: input.dataRoot ?? path.posix.join(homeDir.replace(/\\/g, "/"), ".local", "share", slug)
    };
  }

  return {
    installerHome: input.installerHome,
    installScope,
    installRoot: input.installRoot ?? path.posix.join("/opt", slug),
    workRoot: input.workRoot ?? path.posix.join(input.installerHome.replace(/\\/g, "/"), "state", "sources", slug),
    binDir: input.binDir ?? "/usr/local/bin",
    dataRoot: input.dataRoot ?? path.posix.join("/var", "lib", slug)
  };
}

function resolveWindowsPolicy(input: ResolveInstallPolicyInput): Omit<ResolvedInstallPolicy, "installControlLevel" | "effectiveRuntimePlatform"> {
  const segment = toWindowsSegment(input.softwareName);
  const installScope = input.installScope ?? "system";
  const env = input.env ?? {};
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programData = env.ProgramData ?? "C:\\ProgramData";
  const localAppData = env.LocalAppData ?? path.join(deriveHomeDir(input.installerHome), "AppData", "Local");

  if (installScope === "user") {
    const installRoot = input.installRoot ?? path.join(localAppData, "Programs", segment);
    return {
      installerHome: input.installerHome,
      installScope,
      installRoot,
      workRoot: input.workRoot ?? path.join(input.installerHome, "state", "sources", toSlug(input.softwareName)),
      binDir: input.binDir ?? path.join(installRoot, "bin"),
      dataRoot: input.dataRoot ?? path.join(localAppData, segment)
    };
  }

  const installRoot = input.installRoot ?? path.join(programFiles, segment);
  return {
    installerHome: input.installerHome,
    installScope,
    installRoot,
    workRoot: input.workRoot ?? path.join(input.installerHome, "state", "sources", toSlug(input.softwareName)),
    binDir: input.binDir ?? path.join(installRoot, "bin"),
    dataRoot: input.dataRoot ?? path.join(programData, segment)
  };
}

function resolveWslPolicy(input: ResolveInstallPolicyInput): Omit<ResolvedInstallPolicy, "installControlLevel" | "effectiveRuntimePlatform"> {
  const slug = toSlug(input.softwareName);
  const homeDir = deriveHomeDir(input.installerHome).replace(/\\/g, "/");
  const installScope = input.installScope ?? "user";

  if (installScope === "system") {
    return {
      installerHome: input.installerHome,
      installScope,
      installRoot: input.installRoot ?? path.posix.join("/opt", slug),
      workRoot:
        input.workRoot ?? path.posix.join(input.installerHome.replace(/\\/g, "/"), "state", "sources", slug),
      binDir: input.binDir ?? "/usr/local/bin",
      dataRoot: input.dataRoot ?? path.posix.join("/var", "lib", slug)
    };
  }

  return {
    installerHome: input.installerHome,
    installScope,
    installRoot: input.installRoot ?? path.posix.join(homeDir, ".local", "opt", slug),
    workRoot:
      input.workRoot ?? path.posix.join(input.installerHome.replace(/\\/g, "/"), "state", "sources", slug),
    binDir: input.binDir ?? path.posix.join(homeDir, ".local", "bin"),
    dataRoot: input.dataRoot ?? path.posix.join(homeDir, ".local", "share", slug)
  };
}

export function resolveInstallPolicy(input: ResolveInstallPolicyInput): ResolvedInstallPolicy {
  const effectiveRuntimePlatform = input.effectiveRuntimePlatform ?? input.platform;
  const installControlLevel = input.installControlLevel ?? "managed";
  const normalizedInstallRoot = normalizePathForRuntime(input.installRoot, effectiveRuntimePlatform);
  const normalizedWorkRoot = normalizePathForRuntime(input.workRoot, effectiveRuntimePlatform);
  const normalizedBinDir = normalizePathForRuntime(input.binDir, effectiveRuntimePlatform);
  const normalizedDataRoot = normalizePathForRuntime(input.dataRoot, effectiveRuntimePlatform);
  const normalizedInput: ResolveInstallPolicyInput = {
    ...input,
    installerHome:
      normalizePathForRuntime(input.installerHome, effectiveRuntimePlatform) ?? input.installerHome,
    ...(normalizedInstallRoot !== undefined ? { installRoot: normalizedInstallRoot } : {}),
    ...(normalizedWorkRoot !== undefined ? { workRoot: normalizedWorkRoot } : {}),
    ...(normalizedBinDir !== undefined ? { binDir: normalizedBinDir } : {}),
    ...(normalizedDataRoot !== undefined ? { dataRoot: normalizedDataRoot } : {})
  };

  const resolved =
    effectiveRuntimePlatform === "wsl"
      ? resolveWslPolicy(normalizedInput)
      : input.platform === "windows"
        ? resolveWindowsPolicy(normalizedInput)
        : resolveUnixPolicy(normalizedInput);

  return {
    ...resolved,
    installControlLevel,
    effectiveRuntimePlatform
  };
}
