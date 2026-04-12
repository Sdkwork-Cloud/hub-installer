import { HubInstallerError } from "./errors";

const OPENCLAW_PROFILE_TO_SOFTWARE = new Map<string, string>([
  ["installer-script", "openclaw"],
  ["default", "openclaw"],
  ["recommended", "openclaw"],
  ["script", "openclaw"],
  ["git", "openclaw-git"],
  ["installer-git", "openclaw-git"],
  ["installer-script-git", "openclaw-git"],
  ["cli-script", "openclaw-cli-script"],
  ["installer-cli-script", "openclaw-cli-script"],
  ["npm", "openclaw-npm"],
  ["pnpm", "openclaw-pnpm"],
  ["source", "openclaw-source"],
  ["bun", "openclaw-bun"],
  ["docker", "openclaw-docker"],
  ["podman", "openclaw-podman"],
  ["ansible", "openclaw-ansible"],
  ["nix", "openclaw-nix"]
]);
const OPENCLAW_CHANNEL_ALIASES = new Map<string, string>([
  ["stable", "latest"],
  ["latest", "latest"],
  ["beta", "beta"],
  ["dev", "dev"]
]);

const CODEX_METHOD_ALIASES = new Map<string, string>([
  ["source", "source-build"],
  ["source-build", "source-build"],
  ["build", "source-build"],
  ["dotslash", "dotslash-release"],
  ["release", "dotslash-release"],
  ["dotslash-release", "dotslash-release"]
]);

const NODEJS_METHOD_ALIASES = new Map<string, string>([
  ["package", "os-package"],
  ["os-package", "os-package"],
  ["fnm", "fnm"],
  ["nvm", "nvm"]
]);

const PYTHON_METHOD_ALIASES = new Map<string, string>([
  ["package", "os-package"],
  ["os-package", "os-package"],
  ["pyenv", "pyenv"],
  ["uv", "uv"]
]);

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

const OPENCLAW_BASE_ALIASES = new Set(["openclaw", "claw", "open-claw"]);
const CODEX_ALIASES = new Set(["codex", "openai-codex", "codex-cli"]);
const NODEJS_ALIASES = new Set(["nodejs", "node", "node-lts"]);
const PYTHON_ALIASES = new Set(["python", "python3", "cpython"]);

type RegistryShortcutInput = {
  softwareName: string;
  methodArgument?: string;
  methodOption?: string;
  profileOption?: string;
  channelOption?: string;
  onboardOption?: string;
  softwareVersionOption?: string;
  nodeVersionOption?: string;
  pythonVersionOption?: string;
  userVariables?: Record<string, string>;
};

export type RegistryShortcutResolution = {
  softwareName: string;
  variables: Record<string, string>;
};

function normalizeToken(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function normalizeRawToken(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new HubInstallerError(
      "INVALID_ARGUMENT",
      `Invalid ${label}: value cannot be empty.`
    );
  }
  return normalized;
}

function deriveNodejsMajorVersion(version: string): string | undefined {
  const match = /^v?(\d+)/i.exec(version.trim());
  return match?.[1];
}

function derivePythonWindowsPackageId(version: string): string | undefined {
  const match = /^v?(\d+)\.(\d+)/i.exec(version.trim());
  if (!match) {
    return undefined;
  }
  return `Python.Python.${match[1]}.${match[2]}`;
}

function parseBooleanToken(value: string, label: string): boolean {
  const token = normalizeToken(value);
  if (!token) {
    throw new HubInstallerError(
      "INVALID_ARGUMENT",
      `Invalid ${label}: expected true/false.`
    );
  }

  if (TRUE_VALUES.has(token)) {
    return true;
  }

  if (FALSE_VALUES.has(token)) {
    return false;
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Invalid ${label}: "${value}". Supported values: true, false.`
  );
}

function isOpenclawFamily(softwareName: string): boolean {
  const normalized = normalizeToken(softwareName);
  if (!normalized) {
    return false;
  }
  return OPENCLAW_BASE_ALIASES.has(normalized) || normalized.startsWith("openclaw-");
}

function isCodexFamily(softwareName: string): boolean {
  const normalized = normalizeToken(softwareName);
  return normalized ? CODEX_ALIASES.has(normalized) : false;
}

function isNodejsFamily(softwareName: string): boolean {
  const normalized = normalizeToken(softwareName);
  return normalized ? NODEJS_ALIASES.has(normalized) : false;
}

function isPythonFamily(softwareName: string): boolean {
  const normalized = normalizeToken(softwareName);
  return normalized ? PYTHON_ALIASES.has(normalized) : false;
}

function resolveOpenclawProfile(
  profile: string | undefined,
  label: string
): string | undefined {
  const profileToken = normalizeToken(profile);
  if (!profileToken) {
    return undefined;
  }

  const mapped = OPENCLAW_PROFILE_TO_SOFTWARE.get(profileToken);
  if (mapped) {
    return mapped;
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Unsupported ${label} "${profile}". Supported OpenClaw profiles: ${[
      ...OPENCLAW_PROFILE_TO_SOFTWARE.keys()
    ].join(", ")}.`
  );
}

function mergeVariables(
  shortcutVariables: Record<string, string>,
  userVariables: Record<string, string> | undefined
): Record<string, string> {
  if (!userVariables) {
    return shortcutVariables;
  }
  return { ...shortcutVariables, ...userVariables };
}

function resolveMethodAlias(
  token: string,
  aliases: Map<string, string>,
  label: string,
  software: string
): string {
  const resolved = aliases.get(token);
  if (resolved) {
    return resolved;
  }

  throw new HubInstallerError(
    "INVALID_ARGUMENT",
    `Unsupported ${label} "${token}" for ${software}. Supported values: ${[
      ...aliases.keys()
    ].join(", ")}.`
  );
}

export function hasRegistryShortcutOptions(options: {
  method?: string;
  profile?: string;
  channel?: string;
  onboard?: string;
  softwareVersion?: string;
  nodeVersion?: string;
  pythonVersion?: string;
}): boolean {
  return Boolean(
    options.method ||
      options.profile ||
      options.channel ||
      options.onboard ||
      options.softwareVersion ||
      options.nodeVersion ||
      options.pythonVersion
  );
}

export function resolveRegistryInstallShortcuts(
  input: RegistryShortcutInput
): RegistryShortcutResolution {
  let resolvedSoftwareName = input.softwareName;
  const variables: Record<string, string> = {};
  const methodArgumentRaw = normalizeRawToken(input.methodArgument, "method argument");
  const unifiedVersion = normalizeRawToken(input.softwareVersionOption, "--software-version");
  const nodeVersionOption = normalizeRawToken(input.nodeVersionOption, "--node-version");
  const pythonVersionOption = normalizeRawToken(input.pythonVersionOption, "--python-version");

  const openclawFamily = isOpenclawFamily(input.softwareName);

  let methodFromArg = normalizeToken(methodArgumentRaw);
  let profileFromArg: string | undefined;
  let channelFromArg: string | undefined;
  let nodeVersionFromArg: string | undefined;
  let pythonVersionFromArg: string | undefined;
  let codexVersionFromArg: string | undefined;

  if (openclawFamily && methodFromArg) {
    if (!input.profileOption) {
      const mapped = OPENCLAW_PROFILE_TO_SOFTWARE.get(methodFromArg);
      if (mapped) {
        profileFromArg = methodFromArg;
        methodFromArg = undefined;
      }
    }

    if (!profileFromArg && !input.channelOption && methodFromArg) {
      const mappedChannel = OPENCLAW_CHANNEL_ALIASES.get(methodFromArg);
      if (mappedChannel) {
        channelFromArg = mappedChannel;
        methodFromArg = undefined;
      } else if (!input.methodOption && !input.softwareVersionOption) {
        channelFromArg = normalizeToken(methodArgumentRaw) ?? methodArgumentRaw;
        methodFromArg = undefined;
      }
    }
  }

  const resolvedProfileSoftware = resolveOpenclawProfile(
    input.profileOption ?? profileFromArg,
    "--profile"
  );
  if (resolvedProfileSoftware) {
    resolvedSoftwareName = resolvedProfileSoftware;
  }

  const methodToken = normalizeToken(input.methodOption) ?? methodFromArg;

  if (methodToken) {
    if (openclawFamily || isOpenclawFamily(resolvedSoftwareName)) {
      const methodMappedProfile = resolveOpenclawProfile(methodToken, "--method");
      if (methodMappedProfile) {
        resolvedSoftwareName = methodMappedProfile;
      }
    } else if (isCodexFamily(resolvedSoftwareName)) {
      if (CODEX_METHOD_ALIASES.has(methodToken)) {
        variables.codex_install_method = resolveMethodAlias(
          methodToken,
          CODEX_METHOD_ALIASES,
          "--method",
          resolvedSoftwareName
        );
      } else if (!input.methodOption && methodArgumentRaw && methodFromArg === methodToken) {
        codexVersionFromArg = methodArgumentRaw;
      } else {
        throw new HubInstallerError(
          "INVALID_ARGUMENT",
          `Unsupported --method "${methodToken}" for ${resolvedSoftwareName}. Supported values: ${[
            ...CODEX_METHOD_ALIASES.keys()
          ].join(", ")}.`
        );
      }
    } else if (isNodejsFamily(resolvedSoftwareName)) {
      if (NODEJS_METHOD_ALIASES.has(methodToken)) {
        variables.nodejs_install_method = resolveMethodAlias(
          methodToken,
          NODEJS_METHOD_ALIASES,
          "--method",
          resolvedSoftwareName
        );
      } else if (!input.methodOption && methodArgumentRaw && methodFromArg === methodToken) {
        nodeVersionFromArg = methodArgumentRaw;
      } else {
        throw new HubInstallerError(
          "INVALID_ARGUMENT",
          `Unsupported --method "${methodToken}" for ${resolvedSoftwareName}. Supported values: ${[
            ...NODEJS_METHOD_ALIASES.keys()
          ].join(", ")}.`
        );
      }
    } else if (isPythonFamily(resolvedSoftwareName)) {
      if (PYTHON_METHOD_ALIASES.has(methodToken)) {
        variables.python_install_method = resolveMethodAlias(
          methodToken,
          PYTHON_METHOD_ALIASES,
          "--method",
          resolvedSoftwareName
        );
      } else if (!input.methodOption && methodArgumentRaw && methodFromArg === methodToken) {
        pythonVersionFromArg = methodArgumentRaw;
      } else {
        throw new HubInstallerError(
          "INVALID_ARGUMENT",
          `Unsupported --method "${methodToken}" for ${resolvedSoftwareName}. Supported values: ${[
            ...PYTHON_METHOD_ALIASES.keys()
          ].join(", ")}.`
        );
      }
    } else {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        `--method only supports OpenClaw/Codex/Node.js/Python shortcuts. Use --var for "${resolvedSoftwareName}".`
      );
    }
  }

  if (input.channelOption || channelFromArg || (unifiedVersion && isOpenclawFamily(resolvedSoftwareName))) {
    if (!isOpenclawFamily(resolvedSoftwareName)) {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        `--channel only supports OpenClaw profiles.`
      );
    }
    const channelToken =
      normalizeToken(input.channelOption) ??
      normalizeToken(unifiedVersion) ??
      channelFromArg;
    if (!channelToken) {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        "Invalid --channel value."
      );
    }
    const resolvedChannel = OPENCLAW_CHANNEL_ALIASES.get(channelToken) ?? channelToken;
    variables.openclaw_channel = resolvedChannel;
  }

  if (input.onboardOption !== undefined) {
    if (!isOpenclawFamily(resolvedSoftwareName)) {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        `--onboard only supports OpenClaw profiles.`
      );
    }
    variables.openclaw_onboard = parseBooleanToken(input.onboardOption, "--onboard")
      ? "true"
      : "false";
  }

  const resolvedNodeVersion =
    nodeVersionOption ??
    nodeVersionFromArg ??
    (unifiedVersion && isNodejsFamily(resolvedSoftwareName) ? unifiedVersion : undefined);
  if (resolvedNodeVersion) {
    if (!isNodejsFamily(resolvedSoftwareName)) {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        input.nodeVersionOption
          ? `--node-version only supports Node.js profile installs.`
          : `--software-version only supports OpenClaw/Codex/Node.js/Python shortcuts.`
      );
    }
    variables.nodejs_version = resolvedNodeVersion;
    const major = deriveNodejsMajorVersion(resolvedNodeVersion);
    if (major) {
      variables.nodejs_version_major = major;
    }
  }

  const resolvedPythonVersion =
    pythonVersionOption ??
    pythonVersionFromArg ??
    (unifiedVersion && isPythonFamily(resolvedSoftwareName) ? unifiedVersion : undefined);
  if (resolvedPythonVersion) {
    if (!isPythonFamily(resolvedSoftwareName)) {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        input.pythonVersionOption
          ? `--python-version only supports Python profile installs.`
          : `--software-version only supports OpenClaw/Codex/Node.js/Python shortcuts.`
      );
    }
    variables.python_version = resolvedPythonVersion;
    const windowsPackageId = derivePythonWindowsPackageId(resolvedPythonVersion);
    if (windowsPackageId) {
      variables.python_windows_package_id = windowsPackageId;
    }
  }

  const resolvedCodexVersion =
    codexVersionFromArg ??
    (unifiedVersion && isCodexFamily(resolvedSoftwareName) ? unifiedVersion : undefined);
  if (resolvedCodexVersion) {
    if (!isCodexFamily(resolvedSoftwareName)) {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        `--software-version only supports OpenClaw/Codex/Node.js/Python shortcuts.`
      );
    }
    variables.codex_git_ref = resolvedCodexVersion;
    variables.codex_release_tag = resolvedCodexVersion;
  }

  if (unifiedVersion) {
    const supportsUnifiedVersion =
      isOpenclawFamily(resolvedSoftwareName) ||
      isCodexFamily(resolvedSoftwareName) ||
      isNodejsFamily(resolvedSoftwareName) ||
      isPythonFamily(resolvedSoftwareName);
    if (!supportsUnifiedVersion) {
      throw new HubInstallerError(
        "INVALID_ARGUMENT",
        `--software-version only supports OpenClaw/Codex/Node.js/Python shortcuts.`
      );
    }
  }

  return {
    softwareName: resolvedSoftwareName,
    variables: mergeVariables(variables, input.userVariables)
  };
}
