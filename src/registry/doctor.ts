import { loadManifestFromSource, type LoadManifestOptions } from "../manifest";
import type { HubInstallManifest } from "../manifest/types";
import { detectHostPlatform } from "../core/platform";
import { pickDefined } from "../core/pick-defined";
import { resolveSoftwareEntry } from "./resolver";
import { loadRegistry } from "./service";
import type { LoadedSoftwareRegistry } from "./types";
import type { SupportedPlatform } from "../types";
import { spawnSync } from "node:child_process";

export type DoctorTarget = "openclaw" | "codex" | "nodejs" | "python" | "all";

export interface RegistryDoctorOptions {
  registrySource?: string;
  registryCacheDir?: string;
  registryFetchTimeoutMs?: number;
  manifestCacheDir?: string;
  manifestFetchTimeoutMs?: number;
  runtime?: boolean;
  runtimePlatform?: SupportedPlatform;
  runtimeProbe?: RuntimeProbe;
}

export interface RegistryDoctorCheck {
  id: string;
  target: Exclude<DoctorTarget, "all">;
  success: boolean;
  message: string;
  detail?: string;
  recommendation?: string;
}

export interface RegistryDoctorReport {
  target: DoctorTarget;
  success: boolean;
  runtime: {
    enabled: boolean;
    platform?: SupportedPlatform;
  };
  registry: {
    sourceInput: string;
    resolvedPath: string;
    name: string;
    version?: string;
  };
  checks: RegistryDoctorCheck[];
}

const OPENCLAW_PROFILES = [
  "openclaw",
  "openclaw-git",
  "openclaw-cli-script",
  "openclaw-npm",
  "openclaw-pnpm",
  "openclaw-source",
  "openclaw-bun",
  "openclaw-docker",
  "openclaw-podman",
  "openclaw-ansible",
  "openclaw-nix",
  "openclaw-all"
] as const;

interface RuntimeProbe {
  commandExists: (command: string) => boolean | Promise<boolean>;
  listWslDistros: () => string[] | Promise<string[]>;
}

const OPENCLAW_EXPECTED_PLATFORMS: Record<(typeof OPENCLAW_PROFILES)[number], string[]> = {
  openclaw: ["windows", "macos", "ubuntu"],
  "openclaw-git": ["windows", "macos", "ubuntu"],
  "openclaw-cli-script": ["macos", "ubuntu"],
  "openclaw-npm": ["windows", "macos", "ubuntu"],
  "openclaw-pnpm": ["windows", "macos", "ubuntu"],
  "openclaw-source": ["windows", "macos", "ubuntu"],
  "openclaw-bun": ["macos", "ubuntu"],
  "openclaw-docker": ["windows", "macos", "ubuntu"],
  "openclaw-podman": ["macos", "ubuntu"],
  "openclaw-ansible": ["macos", "ubuntu"],
  "openclaw-nix": ["macos", "ubuntu"],
  "openclaw-all": ["windows", "macos", "ubuntu"]
};

const OPENCLAW_SCRIPT_MARKERS: Record<(typeof OPENCLAW_PROFILES)[number], string[]> = {
  openclaw: [
    "https://openclaw.ai/install.sh",
    "--version \"{{openclaw_channel}}\"",
    "--no-prompt",
    "--dry-run",
    "--verbose",
    "https://openclaw.ai/install.ps1",
    "DryRun = $true"
  ],
  "openclaw-git": [
    "--install-method git",
    "--version \"{{openclaw_channel}}\"",
    "--no-git-update",
    "--no-prompt",
    "--dry-run",
    "--verbose",
    "InstallMethod = \"git\"",
    "DryRun = $true"
  ],
  "openclaw-cli-script": [
    "https://openclaw.ai/install-cli.sh",
    "--prefix",
    "--node-version",
    "--json",
    "--set-npm-prefix"
  ],
  "openclaw-npm": ["npm install -g openclaw", "openclaw onboard --install-daemon"],
  "openclaw-pnpm": ["pnpm add -g openclaw", "pnpm approve-builds -g"],
  "openclaw-source": ["pnpm ui:build", "pnpm build", "pnpm link --global"],
  "openclaw-bun": ["bun install", "bun run build"],
  "openclaw-docker": [
    "./docker-setup.sh",
    "OPENCLAW_IMAGE",
    "OPENCLAW_EXTRA_MOUNTS",
    "OPENCLAW_HOME_VOLUME",
    "OPENCLAW_DOCKER_APT_PACKAGES"
  ],
  "openclaw-podman": ["./setup-podman.sh"],
  "openclaw-ansible": ["openclaw-ansible", "install.sh"],
  "openclaw-nix": ["nix run", "openclaw_nix_flake"],
  "openclaw-all": [
    "method=\"{{openclaw_install_method}}\"",
    "installer-script-git)",
    "--no-prompt",
    "--dry-run",
    "--verbose",
    "--set-npm-prefix"
  ]
};

const NODEJS_EXPECTED_PLATFORMS = ["windows", "macos", "ubuntu"];
const NODEJS_SCRIPT_MARKERS = [
  "case \"$method\" in",
  "os-package)",
  "fnm)",
  "nvm)",
  "winget install --id OpenJS.NodeJS.LTS",
  "choco install nodejs-lts -y",
  "https://deb.nodesource.com/setup_${major}.x",
  "https://fnm.vercel.app/install",
  "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh"
];

const PYTHON_EXPECTED_PLATFORMS = ["windows", "macos", "ubuntu"];
const PYTHON_SCRIPT_MARKERS = [
  "case \"$method\" in",
  "os-package)",
  "pyenv)",
  "uv)",
  "winget install --id \"{{python_windows_package_id}}\"",
  "choco install python -y",
  "https://github.com/pyenv/pyenv.git",
  "https://astral.sh/uv/install.sh",
  "https://astral.sh/uv/install.ps1"
];

function collectCommandScripts(manifest: HubInstallManifest): string {
  return manifest.artifacts
    .filter((artifact) => artifact.type === "command")
    .flatMap((artifact) => artifact.commands.map((command) => command.run))
    .join("\n");
}

function normalizeList(values: string[] | undefined): string[] {
  return [...(values ?? [])].sort((left, right) => left.localeCompare(right));
}

function assertListEquals(actual: string[] | undefined, expected: string[], message: string): void {
  const normalizedActual = normalizeList(actual);
  const normalizedExpected = normalizeList(expected);
  if (normalizedActual.length !== normalizedExpected.length) {
    throw new Error(`${message}: expected [${normalizedExpected.join(", ")}], got [${normalizedActual.join(", ")}].`);
  }
  for (let index = 0; index < normalizedExpected.length; index += 1) {
    if (normalizedActual[index] !== normalizedExpected[index]) {
      throw new Error(`${message}: expected [${normalizedExpected.join(", ")}], got [${normalizedActual.join(", ")}].`);
    }
  }
}

function assertContainsAll(target: string, fragments: string[], message: string): void {
  for (const fragment of fragments) {
    if (!target.includes(fragment)) {
      throw new Error(`${message}: missing "${fragment}".`);
    }
  }
}

function getCommandRecommendation(platform: SupportedPlatform, command: string): string {
  if (platform === "windows") {
    switch (command) {
      case "wsl.exe":
        return "Enable WSL2 and install Ubuntu first: `wsl --install -d Ubuntu`.";
      case "winget":
        return "Install App Installer (winget) from Microsoft Store, or use choco instead.";
      case "choco":
        return "Install Chocolatey first: `Set-ExecutionPolicy Bypass -Scope Process -Force; iwr https://community.chocolatey.org/install.ps1 -UseBasicParsing | iex`.";
      default:
        return `Install "${command}" on Windows and ensure it is available in PATH.`;
    }
  }

  if (platform === "macos") {
    if (command === "brew") {
      return "Install Homebrew first: `https://brew.sh/`.";
    }
    return `Install "${command}" on macOS and ensure it is available in PATH.`;
  }

  if (platform === "ubuntu") {
    if (command === "apt-get") {
      return "Use Ubuntu/Debian runtime with apt available, or switch method to uv/fnm where applicable.";
    }
    return `Install "${command}" with apt (for example \`sudo apt-get install -y ${command}\`) and ensure it is in PATH.`;
  }

  return `Install "${command}" and ensure it is available in PATH.`;
}

function createDefaultRuntimeProbe(): RuntimeProbe {
  return {
    commandExists: (command: string) => {
      if (process.platform === "win32") {
        const result = spawnSync("where.exe", [command], {
          encoding: "utf8",
          shell: false
        });
        return result.status === 0;
      }

      const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
        encoding: "utf8",
        shell: false
      });
      return result.status === 0;
    },
    listWslDistros: () => {
      const result = spawnSync("wsl.exe", ["-l", "-q"], {
        encoding: "utf8",
        shell: false
      });
      if (result.status !== 0) {
        return [];
      }
      const output = `${result.stdout ?? ""}`.trim();
      if (!output) {
        return [];
      }
      return output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    }
  };
}

async function runCheck(
  checks: RegistryDoctorCheck[],
  input: {
    id: string;
    target: Exclude<DoctorTarget, "all">;
    message: string;
    recommendation?: string;
    execute: () => Promise<void> | void;
  }
): Promise<void> {
  try {
    await input.execute();
    checks.push({
      id: input.id,
      target: input.target,
      success: true,
      message: input.message
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push({
      id: input.id,
      target: input.target,
      success: false,
      message: input.message,
      detail,
      ...(input.recommendation ? { recommendation: input.recommendation } : {})
    });
  }
}

async function loadEntryManifest(
  loadedRegistry: LoadedSoftwareRegistry,
  softwareName: string,
  options: LoadManifestOptions
): Promise<HubInstallManifest> {
  const resolved = resolveSoftwareEntry(loadedRegistry, softwareName, "ubuntu");
  const loadedManifest = await loadManifestFromSource(resolved.manifestSource, options);
  return loadedManifest.manifest;
}

async function runOpenclawChecks(
  loadedRegistry: LoadedSoftwareRegistry,
  checks: RegistryDoctorCheck[],
  manifestOptions: LoadManifestOptions
): Promise<void> {
  await runCheck(checks, {
    id: "openclaw-registry-profiles",
    target: "openclaw",
    message: "OpenClaw profile entries are present in registry.",
    execute: () => {
      const names = new Set(loadedRegistry.registry.entries.map((entry) => entry.name));
      for (const profile of OPENCLAW_PROFILES) {
        if (!names.has(profile)) {
          throw new Error(`Missing registry entry "${profile}".`);
        }
      }
    }
  });

  const manifests = new Map<(typeof OPENCLAW_PROFILES)[number], HubInstallManifest>();
  for (const profile of OPENCLAW_PROFILES) {
    await runCheck(checks, {
      id: `openclaw-manifest-load-${profile}`,
      target: "openclaw",
      message: `OpenClaw profile "${profile}" manifest loads successfully.`,
      execute: async () => {
        const manifest = await loadEntryManifest(loadedRegistry, profile, manifestOptions);
        manifests.set(profile, manifest);
      }
    });
  }

  for (const profile of OPENCLAW_PROFILES) {
    await runCheck(checks, {
      id: `openclaw-platform-matrix-${profile}`,
      target: "openclaw",
      message: `OpenClaw profile "${profile}" platforms match expected matrix.`,
      execute: () => {
        const manifest = manifests.get(profile);
        if (!manifest) {
          throw new Error(`Manifest not available for "${profile}".`);
        }
        assertListEquals(
          manifest.platforms,
          OPENCLAW_EXPECTED_PLATFORMS[profile],
          `platform mismatch for ${profile}`
        );
      }
    });
  }

  for (const profile of OPENCLAW_PROFILES) {
    await runCheck(checks, {
      id: `openclaw-script-markers-${profile}`,
      target: "openclaw",
      message: `OpenClaw profile "${profile}" contains required installer markers.`,
      execute: () => {
        const manifest = manifests.get(profile);
        if (!manifest) {
          throw new Error(`Manifest not available for "${profile}".`);
        }
        assertContainsAll(
          collectCommandScripts(manifest),
          OPENCLAW_SCRIPT_MARKERS[profile],
          `script markers mismatch for ${profile}`
        );
      }
    });
  }

  await runCheck(checks, {
    id: "openclaw-default-minimal-profile",
    target: "openclaw",
    message: "OpenClaw default profile stays dedicated to installer-script mode.",
    execute: () => {
      const manifest = manifests.get("openclaw");
      if (!manifest) {
        throw new Error("openclaw manifest not available.");
      }
      if (manifest.variables?.openclaw_install_method !== undefined) {
        throw new Error("openclaw default profile should not declare openclaw_install_method.");
      }
      const requiredVariables = [
        "openclaw_installer_no_prompt",
        "openclaw_installer_dry_run",
        "openclaw_installer_verbose"
      ];
      for (const key of requiredVariables) {
        if (!(key in (manifest.variables ?? {}))) {
          throw new Error(`Missing expected variable "${key}" on openclaw default profile.`);
        }
      }
    }
  });
}

async function runCodexChecks(
  loadedRegistry: LoadedSoftwareRegistry,
  checks: RegistryDoctorCheck[],
  manifestOptions: LoadManifestOptions
): Promise<void> {
  let codexManifest: HubInstallManifest | undefined;

  await runCheck(checks, {
    id: "codex-registry-entry",
    target: "codex",
    message: "Codex entry exists in registry.",
    execute: () => {
      const hasCodex = loadedRegistry.registry.entries.some((entry) => entry.name === "codex");
      if (!hasCodex) {
        throw new Error("Missing registry entry \"codex\".");
      }
    }
  });

  await runCheck(checks, {
    id: "codex-manifest-load",
    target: "codex",
    message: "Codex manifest loads successfully.",
    execute: async () => {
      codexManifest = await loadEntryManifest(loadedRegistry, "codex", manifestOptions);
    }
  });

  await runCheck(checks, {
    id: "codex-platforms",
    target: "codex",
    message: "Codex manifest supports documented platforms.",
    execute: () => {
      if (!codexManifest) {
        throw new Error("codex manifest not available.");
      }
      assertListEquals(codexManifest.platforms, ["windows", "macos", "ubuntu"], "codex platforms mismatch");
    }
  });

  await runCheck(checks, {
    id: "codex-install-methods",
    target: "codex",
    message: "Codex manifest declares source-build and dotslash-release methods.",
    execute: () => {
      if (!codexManifest) {
        throw new Error("codex manifest not available.");
      }
      if (codexManifest.variables?.codex_install_method !== "source-build") {
        throw new Error("codex_install_method default must be source-build.");
      }
      if (codexManifest.variables?.codex_release_tag !== "latest") {
        throw new Error("codex_release_tag default must be latest.");
      }
      assertContainsAll(
        collectCommandScripts(codexManifest),
        [
          "source-build",
          "dotslash-release",
          "cargo build",
          "https://github.com/openai/codex/releases/latest/download/codex",
          "https://github.com/openai/codex/releases/download/${release_tag}/codex"
        ],
        "codex install method markers mismatch"
      );
    }
  });

  await runCheck(checks, {
    id: "codex-windows-wsl-check",
    target: "codex",
    message: "Codex Windows flow enforces documented WSL2 prerequisite.",
    execute: () => {
      if (!codexManifest) {
        throw new Error("codex manifest not available.");
      }
      const wslCheckScript =
        codexManifest.lifecycle?.preflight?.find(
          (command) => command.id === "validate-codex-windows-wsl"
        )?.run ?? "";
      assertContainsAll(
        wslCheckScript,
        ["wsl.exe -l -q", "requires WSL2"],
        "codex WSL check markers mismatch"
      );
    }
  });
}

async function runNodejsChecks(
  loadedRegistry: LoadedSoftwareRegistry,
  checks: RegistryDoctorCheck[],
  manifestOptions: LoadManifestOptions
): Promise<void> {
  let nodejsManifest: HubInstallManifest | undefined;

  await runCheck(checks, {
    id: "nodejs-registry-entry",
    target: "nodejs",
    message: "Node.js entry exists in registry.",
    execute: () => {
      const hasNodejs = loadedRegistry.registry.entries.some((entry) => entry.name === "nodejs");
      if (!hasNodejs) {
        throw new Error("Missing registry entry \"nodejs\".");
      }
    }
  });

  await runCheck(checks, {
    id: "nodejs-manifest-load",
    target: "nodejs",
    message: "Node.js manifest loads successfully.",
    execute: async () => {
      nodejsManifest = await loadEntryManifest(loadedRegistry, "nodejs", manifestOptions);
    }
  });

  await runCheck(checks, {
    id: "nodejs-platforms",
    target: "nodejs",
    message: "Node.js manifest supports documented platforms.",
    execute: () => {
      if (!nodejsManifest) {
        throw new Error("nodejs manifest not available.");
      }
      assertListEquals(nodejsManifest.platforms, NODEJS_EXPECTED_PLATFORMS, "nodejs platforms mismatch");
    }
  });

  await runCheck(checks, {
    id: "nodejs-install-methods",
    target: "nodejs",
    message: "Node.js manifest declares os-package, fnm, and nvm install methods.",
    execute: () => {
      if (!nodejsManifest) {
        throw new Error("nodejs manifest not available.");
      }
      if (nodejsManifest.variables?.nodejs_install_method !== "os-package") {
        throw new Error("nodejs_install_method default must be os-package.");
      }
      if (nodejsManifest.variables?.nodejs_version_major !== "24") {
        throw new Error("nodejs_version_major default must be 24.");
      }
      assertContainsAll(
        collectCommandScripts(nodejsManifest),
        NODEJS_SCRIPT_MARKERS,
        "nodejs install method markers mismatch"
      );
    }
  });
}

async function runPythonChecks(
  loadedRegistry: LoadedSoftwareRegistry,
  checks: RegistryDoctorCheck[],
  manifestOptions: LoadManifestOptions
): Promise<void> {
  let pythonManifest: HubInstallManifest | undefined;

  await runCheck(checks, {
    id: "python-registry-entry",
    target: "python",
    message: "Python entry exists in registry.",
    execute: () => {
      const hasPython = loadedRegistry.registry.entries.some((entry) => entry.name === "python");
      if (!hasPython) {
        throw new Error("Missing registry entry \"python\".");
      }
    }
  });

  await runCheck(checks, {
    id: "python-manifest-load",
    target: "python",
    message: "Python manifest loads successfully.",
    execute: async () => {
      pythonManifest = await loadEntryManifest(loadedRegistry, "python", manifestOptions);
    }
  });

  await runCheck(checks, {
    id: "python-platforms",
    target: "python",
    message: "Python manifest supports documented platforms.",
    execute: () => {
      if (!pythonManifest) {
        throw new Error("python manifest not available.");
      }
      assertListEquals(pythonManifest.platforms, PYTHON_EXPECTED_PLATFORMS, "python platforms mismatch");
    }
  });

  await runCheck(checks, {
    id: "python-install-methods",
    target: "python",
    message: "Python manifest declares os-package, pyenv, and uv install methods.",
    execute: () => {
      if (!pythonManifest) {
        throw new Error("python manifest not available.");
      }
      if (pythonManifest.variables?.python_install_method !== "os-package") {
        throw new Error("python_install_method default must be os-package.");
      }
      if (pythonManifest.variables?.python_version !== "3.13") {
        throw new Error("python_version default must be 3.13.");
      }
      if (pythonManifest.variables?.python_windows_package_id !== "Python.Python.{{python_version}}") {
        throw new Error("python_windows_package_id default must track python_version.");
      }
      assertContainsAll(
        collectCommandScripts(pythonManifest),
        PYTHON_SCRIPT_MARKERS,
        "python install method markers mismatch"
      );
    }
  });
}

async function requireAnyRuntimeCommand(
  checks: RegistryDoctorCheck[],
  input: {
    id: string;
    target: Exclude<DoctorTarget, "all">;
    message: string;
    commands: string[];
    probe: RuntimeProbe;
    recommendation?: string;
  }
): Promise<void> {
  await runCheck(checks, {
    id: input.id,
    target: input.target,
    message: input.message,
    ...(input.recommendation ? { recommendation: input.recommendation } : {}),
    execute: async () => {
      for (const command of input.commands) {
        if (await input.probe.commandExists(command)) {
          return;
        }
      }
      throw new Error(`None of [${input.commands.join(", ")}] found in PATH.`);
    }
  });
}

async function runRuntimeChecks(
  target: DoctorTarget,
  checks: RegistryDoctorCheck[],
  platform: SupportedPlatform,
  probe: RuntimeProbe
): Promise<void> {
  const includesOpenclaw = target === "all" || target === "openclaw";
  const includesCodex = target === "all" || target === "codex";
  const includesNodejs = target === "all" || target === "nodejs";
  const includesPython = target === "all" || target === "python";

  if (includesOpenclaw) {
    const required =
      platform === "windows"
        ? ["powershell"]
        : platform === "macos" || platform === "ubuntu"
          ? ["bash", "curl"]
          : [];
    for (const command of required) {
      await runCheck(checks, {
        id: `openclaw-runtime-command-${command}`,
        target: "openclaw",
        message: `Runtime command "${command}" is available for OpenClaw install flow.`,
        recommendation: getCommandRecommendation(platform, command),
        execute: async () => {
          if (!(await probe.commandExists(command))) {
            throw new Error(`Command "${command}" not found in PATH.`);
          }
        }
      });
    }
  }

  if (includesCodex) {
    if (platform === "windows") {
      await runCheck(checks, {
        id: "codex-runtime-command-wsl",
        target: "codex",
        message: "Runtime command \"wsl.exe\" is available for Codex on Windows.",
        recommendation: getCommandRecommendation(platform, "wsl.exe"),
        execute: async () => {
          if (!(await probe.commandExists("wsl.exe"))) {
            throw new Error("wsl.exe not found in PATH.");
          }
        }
      });

      await runCheck(checks, {
        id: "codex-runtime-wsl-distros",
        target: "codex",
        message: "WSL has at least one installed Linux distribution.",
        recommendation: "Install a Linux distro in WSL2 first (recommended: `wsl --install -d Ubuntu`).",
        execute: async () => {
          const distros = await probe.listWslDistros();
          if (distros.length === 0) {
            throw new Error("No WSL distribution found. Install Ubuntu (or another distro) in WSL2 first.");
          }
        }
      });
    } else if (platform === "macos" || platform === "ubuntu") {
      for (const command of ["git", "curl"]) {
        await runCheck(checks, {
          id: `codex-runtime-command-${command}`,
          target: "codex",
          message: `Runtime command "${command}" is available for Codex install flow.`,
          recommendation: getCommandRecommendation(platform, command),
          execute: async () => {
            if (!(await probe.commandExists(command))) {
              throw new Error(`Command "${command}" not found in PATH.`);
            }
          }
        });
      }
    }
  }

  if (includesNodejs) {
    if (platform === "windows") {
      await requireAnyRuntimeCommand(checks, {
        id: "nodejs-runtime-package-manager-windows",
        target: "nodejs",
        message: "Runtime has at least one Node.js Windows package manager (winget/choco).",
        commands: ["winget", "choco"],
        probe,
        recommendation: "Install winget (recommended) or choco before using nodejs os-package mode on Windows."
      });
    } else if (platform === "macos") {
      await runCheck(checks, {
        id: "nodejs-runtime-command-brew",
        target: "nodejs",
        message: "Runtime command \"brew\" is available for Node.js macOS os-package flow.",
        recommendation: getCommandRecommendation(platform, "brew"),
        execute: async () => {
          if (!(await probe.commandExists("brew"))) {
            throw new Error("brew not found in PATH.");
          }
        }
      });
    } else if (platform === "ubuntu") {
      for (const command of ["curl", "apt-get"]) {
        await runCheck(checks, {
          id: `nodejs-runtime-command-${command}`,
          target: "nodejs",
          message: `Runtime command "${command}" is available for Node.js Ubuntu os-package flow.`,
          recommendation: getCommandRecommendation(platform, command),
          execute: async () => {
            if (!(await probe.commandExists(command))) {
              throw new Error(`Command "${command}" not found in PATH.`);
            }
          }
        });
      }
    }
  }

  if (includesPython) {
    if (platform === "windows") {
      await requireAnyRuntimeCommand(checks, {
        id: "python-runtime-installer-windows",
        target: "python",
        message: "Runtime has at least one Python Windows installer path (winget/choco/uv).",
        commands: ["winget", "choco", "uv"],
        probe,
        recommendation: "Install winget/choco or uv first, or switch Python method accordingly."
      });
    } else if (platform === "macos") {
      await requireAnyRuntimeCommand(checks, {
        id: "python-runtime-installer-macos",
        target: "python",
        message: "Runtime has a Python install path on macOS (brew or uv).",
        commands: ["brew", "uv"],
        probe,
        recommendation: "Install Homebrew or uv before using Python install methods on macOS."
      });
    } else if (platform === "ubuntu") {
      await requireAnyRuntimeCommand(checks, {
        id: "python-runtime-installer-ubuntu",
        target: "python",
        message: "Runtime has a Python install path on Ubuntu (apt-get or uv).",
        commands: ["apt-get", "uv"],
        probe,
        recommendation: "Ensure apt-get or uv is available; for uv method install uv first."
      });
    }
  }
}

export async function runRegistryDoctor(
  target: DoctorTarget = "all",
  options: RegistryDoctorOptions = {}
): Promise<RegistryDoctorReport> {
  const loadedRegistry = await loadRegistry(
    options.registrySource,
    pickDefined({
      cacheDir: options.registryCacheDir,
      fetchTimeoutMs: options.registryFetchTimeoutMs
    })
  );
  const checks: RegistryDoctorCheck[] = [];
  const manifestOptions: LoadManifestOptions = pickDefined({
    cacheDir: options.manifestCacheDir,
    fetchTimeoutMs: options.manifestFetchTimeoutMs
  });
  const runtimeEnabled = options.runtime ?? false;
  const runtimePlatform = runtimeEnabled
    ? options.runtimePlatform ?? detectHostPlatform()
    : undefined;
  const runtimeProbe = options.runtimeProbe ?? createDefaultRuntimeProbe();

  if (target === "all" || target === "openclaw") {
    await runOpenclawChecks(loadedRegistry, checks, manifestOptions);
  }
  if (target === "all" || target === "codex") {
    await runCodexChecks(loadedRegistry, checks, manifestOptions);
  }
  if (target === "all" || target === "nodejs") {
    await runNodejsChecks(loadedRegistry, checks, manifestOptions);
  }
  if (target === "all" || target === "python") {
    await runPythonChecks(loadedRegistry, checks, manifestOptions);
  }
  if (runtimeEnabled && runtimePlatform) {
    await runRuntimeChecks(target, checks, runtimePlatform, runtimeProbe);
  }

  return {
    target,
    success: checks.every((check) => check.success),
    runtime: {
      enabled: runtimeEnabled,
      ...pickDefined({
        platform: runtimePlatform
      })
    },
    registry: {
      sourceInput: loadedRegistry.sourceInput,
      resolvedPath: loadedRegistry.absolutePath,
      name: loadedRegistry.registry.metadata.name,
      ...pickDefined({
        version: loadedRegistry.registry.metadata.version
      })
    },
    checks
  };
}
