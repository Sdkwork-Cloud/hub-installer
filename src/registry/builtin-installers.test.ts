import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifestFromSource } from "../manifest";
import { loadSoftwareRegistryFromSource, resolveSoftwareEntry } from "./index";

const registryPath = path.resolve(process.cwd(), "registry", "software-registry.yaml");
const openclawManifestPath = path.resolve(
  process.cwd(),
  "registry",
  "manifests",
  "openclaw.hub.yaml"
);
const openclawProfileManifestMap: Record<string, string> = {
  "openclaw-git": path.resolve(
    process.cwd(),
    "registry",
    "manifests",
    "openclaw-installer-script-git.hub.yaml"
  ),
  "openclaw-cli-script": path.resolve(
    process.cwd(),
    "registry",
    "manifests",
    "openclaw-installer-cli-script.hub.yaml"
  ),
  "openclaw-wsl": path.resolve(
    process.cwd(),
    "registry",
    "manifests",
    "openclaw-wsl.hub.yaml"
  ),
  "openclaw-npm": path.resolve(process.cwd(), "registry", "manifests", "openclaw-npm.hub.yaml"),
  "openclaw-pnpm": path.resolve(process.cwd(), "registry", "manifests", "openclaw-pnpm.hub.yaml"),
  "openclaw-source": path.resolve(
    process.cwd(),
    "registry",
    "manifests",
    "openclaw-source.hub.yaml"
  ),
  "openclaw-bun": path.resolve(process.cwd(), "registry", "manifests", "openclaw-bun.hub.yaml"),
  "openclaw-docker": path.resolve(
    process.cwd(),
    "registry",
    "manifests",
    "openclaw-docker.hub.yaml"
  ),
  "openclaw-podman": path.resolve(
    process.cwd(),
    "registry",
    "manifests",
    "openclaw-podman.hub.yaml"
  ),
  "openclaw-ansible": path.resolve(
    process.cwd(),
    "registry",
    "manifests",
    "openclaw-ansible.hub.yaml"
  ),
  "openclaw-nix": path.resolve(process.cwd(), "registry", "manifests", "openclaw-nix.hub.yaml"),
  "openclaw-all": path.resolve(process.cwd(), "registry", "manifests", "openclaw-all.hub.yaml")
};
const codexManifestPath = path.resolve(
  process.cwd(),
  "registry",
  "manifests",
  "codex.hub.yaml"
);
const zeroclawManifestPath = path.resolve(
  process.cwd(),
  "registry",
  "manifests",
  "zeroclaw-source.hub.yaml"
);
const ironclawManifestPath = path.resolve(
  process.cwd(),
  "registry",
  "manifests",
  "ironclaw-source.hub.yaml"
);
const nodejsManifestPath = path.resolve(
  process.cwd(),
  "registry",
  "manifests",
  "nodejs.hub.yaml"
);
const pythonManifestPath = path.resolve(
  process.cwd(),
  "registry",
  "manifests",
  "python.hub.yaml"
);
const codexExampleManifestPath = path.resolve(
  process.cwd(),
  "examples",
  "codex.hub.yaml"
);
const openclawExampleManifestPath = path.resolve(
  process.cwd(),
  "examples",
  "openclaw.hub.yaml"
);
const openclawNpmExampleManifestPath = path.resolve(
  process.cwd(),
  "examples",
  "openclaw-npm.hub.yaml"
);
const openclawDockerExampleManifestPath = path.resolve(
  process.cwd(),
  "examples",
  "openclaw-docker.hub.yaml"
);

function expectFragments(value: string, expectedFragments: string[]): void {
  for (const fragment of expectedFragments) {
    expect(value).toContain(fragment);
  }
}

function collectCommandScripts(manifest: Awaited<ReturnType<typeof loadManifestFromSource>>["manifest"]): string {
  return manifest.artifacts
    .filter((artifact) => artifact.type === "command")
    .flatMap((artifact) => artifact.commands.map((command) => command.run))
    .join("\n");
}

describe("built-in installer manifests", () => {
  it("registers openclaw profile entries and core runtimes in the bundled registry", async () => {
    const loadedRegistry = await loadSoftwareRegistryFromSource(registryPath);

    const openclaw = resolveSoftwareEntry(loadedRegistry, "openclaw", "ubuntu");
    expect(openclaw.manifestSource).toBe(openclawManifestPath);

    for (const [softwareName, manifestPath] of Object.entries(openclawProfileManifestMap)) {
      const resolved = resolveSoftwareEntry(loadedRegistry, softwareName, "ubuntu");
      expect(resolved.manifestSource).toBe(manifestPath);
    }

    const codex = resolveSoftwareEntry(loadedRegistry, "codex", "ubuntu");
    expect(codex.manifestSource).toBe(codexManifestPath);

    const zeroclaw = resolveSoftwareEntry(loadedRegistry, "zeroclaw", "ubuntu");
    expect(zeroclaw.manifestSource).toBe(zeroclawManifestPath);

    const ironclaw = resolveSoftwareEntry(loadedRegistry, "ironclaw", "ubuntu");
    expect(ironclaw.manifestSource).toBe(ironclawManifestPath);

    const nodejs = resolveSoftwareEntry(loadedRegistry, "nodejs", "ubuntu");
    expect(nodejs.manifestSource).toBe(nodejsManifestPath);

    const python = resolveSoftwareEntry(loadedRegistry, "python", "ubuntu");
    expect(python.manifestSource).toBe(pythonManifestPath);
  });

  it("keeps openclaw default profile minimal and focused on installer-script", async () => {
    const loadedManifest = await loadManifestFromSource(openclawManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.variables?.openclaw_channel).toBe("latest");
    expect(manifest.variables?.openclaw_onboard).toBe("true");
    expect(manifest.variables?.openclaw_install_method).toBeUndefined();

    const scripts = collectCommandScripts(manifest);
    expectFragments(scripts, [
      "https://openclaw.ai/install.sh",
      "--version \"{{openclaw_channel}}\"",
      "--no-prompt",
      "--dry-run",
      "--verbose",
      "https://openclaw.ai/install.ps1",
      "DryRun = $true"
    ]);
  });

  it("provides complete openclaw profile manifest coverage", async () => {
    const checks: Array<{
      manifestPath: string;
      expectedFragments: string[];
    }> = [
      {
        manifestPath: openclawProfileManifestMap["openclaw-git"]!,
        expectedFragments: [
          "--install-method git",
          "--no-git-update",
          "--dry-run",
          "--verbose",
          "InstallMethod = \"git\"",
          "DryRun = $true",
          "openclaw_source_dir"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-cli-script"]!,
        expectedFragments: [
          "install-cli.sh",
          "--prefix",
          "--node-version",
          "--set-npm-prefix",
          "--json"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-wsl"]!,
        expectedFragments: [
          "systemd=true",
          "wsl.exe --shutdown",
          "openclaw onboard --non-interactive --install-daemon",
          "--accept-risk",
          "--skip-channels",
          "--skip-skills",
          "--skip-ui",
          "openclaw gateway status --require-rpc --json"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-npm"]!,
        expectedFragments: ["npm install -g openclaw", "openclaw onboard --install-daemon"]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-pnpm"]!,
        expectedFragments: ["pnpm add -g openclaw", "pnpm approve-builds -g"]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-source"]!,
        expectedFragments: ["pnpm ui:build", "pnpm build", "pnpm link --global"]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-bun"]!,
        expectedFragments: ["bun install", "bun run build"]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-docker"]!,
        expectedFragments: [
          "./docker-setup.sh",
          "OPENCLAW_IMAGE",
          "OPENCLAW_EXTRA_MOUNTS",
          "OPENCLAW_HOME_VOLUME",
          "OPENCLAW_DOCKER_APT_PACKAGES"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-podman"]!,
        expectedFragments: [
          "OPENCLAW_PODMAN_QUADLET",
          "--quadlet",
          "--container",
          "OPENCLAW_DOCKER_APT_PACKAGES",
          "OPENCLAW_EXTENSIONS",
          "./scripts/run-openclaw-podman.sh",
          "\"$launch_script\" launch"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-ansible"]!,
        expectedFragments: ["openclaw-ansible", "install.sh"]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-nix"]!,
        expectedFragments: ["nix run", "openclaw_nix_flake"]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-all"]!,
        expectedFragments: [
          "method=\"{{openclaw_install_method}}\"",
          "installer-script)",
          "installer-script-git)",
          "--set-npm-prefix",
          "--no-prompt",
          "--dry-run",
          "--verbose"
        ]
      }
    ];

    for (const check of checks) {
      const loadedManifest = await loadManifestFromSource(check.manifestPath);
      const scripts = collectCommandScripts(loadedManifest.manifest);
      expectFragments(scripts, check.expectedFragments);
    }
  });

  it("uses named-parameter splatting for OpenClaw Windows installer invocations", async () => {
    const windowsInstallerTargets: Array<{
      manifestPath: string;
      expectedFragments: string[];
    }> = [
      {
        manifestPath: openclawManifestPath,
        expectedFragments: [
          "$installerArgs = @{",
          "Tag = \"{{openclaw_channel}}\"",
          "& $installer @installerArgs"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-git"]!,
        expectedFragments: [
          "$installerArgs = @{",
          "InstallMethod = \"git\"",
          "Tag = \"{{openclaw_channel}}\"",
          "GitDir = \"{{openclaw_source_dir}}\"",
          "& $installer @installerArgs"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-all"]!,
        expectedFragments: [
          "$installerArgs = @{",
          "$installerGitArgs = @{",
          "& $installer @installerArgs",
          "& $installer @installerGitArgs"
        ]
      }
    ];

    for (const target of windowsInstallerTargets) {
      const loadedManifest = await loadManifestFromSource(target.manifestPath);
      const scripts = collectCommandScripts(loadedManifest.manifest);
      expectFragments(scripts, target.expectedFragments);
      expect(scripts).not.toContain("& $installer @args");
    }
  });

  it("guides Windows OpenClaw users toward WSL2 and a supported Node.js runtime", async () => {
    const windowsInstallerTargets: Array<{
      manifestPath: string;
      expectedFragments: string[];
    }> = [
      {
        manifestPath: openclawManifestPath,
        expectedFragments: [
          "Get-NodeMajorVersion",
          "Ensure-SupportedNodeForOpenClawInstaller",
          "winget install --id OpenJS.NodeJS.LTS",
          "choco install nodejs-lts -y",
          "scoop install nodejs-lts",
          "Node.js 24 LTS is recommended for OpenClaw on Windows",
          "Node.js 22.16+ remains supported",
          "--effective-runtime-platform wsl",
          "WSL2 is strongly recommended"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-git"]!,
        expectedFragments: [
          "Get-NodeMajorVersion",
          "Ensure-SupportedNodeForOpenClawInstaller",
          "winget install --id OpenJS.NodeJS.LTS",
          "choco install nodejs-lts -y",
          "scoop install nodejs-lts",
          "Node.js 24 LTS is recommended for OpenClaw on Windows",
          "Node.js 22.16+ remains supported",
          "--effective-runtime-platform wsl",
          "WSL2 is strongly recommended"
        ]
      },
      {
        manifestPath: openclawProfileManifestMap["openclaw-all"]!,
        expectedFragments: [
          "function Get-NodeMajorVersion",
          "function Ensure-SupportedNodeForOpenClawInstaller",
          "winget install --id OpenJS.NodeJS.LTS",
          "choco install nodejs-lts -y",
          "scoop install nodejs-lts",
          "Ensure-SupportedNodeForOpenClawInstaller",
          "Node.js 24 LTS is recommended for OpenClaw on Windows",
          "Node.js 22.16+ remains supported",
          "--effective-runtime-platform wsl",
          "WSL2 is strongly recommended"
        ]
      }
    ];

    for (const target of windowsInstallerTargets) {
      const loadedManifest = await loadManifestFromSource(target.manifestPath);
      const scripts = collectCommandScripts(loadedManifest.manifest);
      expectFragments(scripts, target.expectedFragments);
    }
  });

  it("matches documented openclaw profile platform matrix", async () => {
    const expectedPlatforms: Record<string, string[]> = {
      openclaw: ["windows", "macos", "ubuntu"],
      "openclaw-git": ["windows", "macos", "ubuntu"],
      "openclaw-cli-script": ["macos", "ubuntu"],
      "openclaw-wsl": ["windows"],
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

    const manifests: Record<string, string> = {
      openclaw: openclawManifestPath,
      ...openclawProfileManifestMap
    };

    for (const [profile, expected] of Object.entries(expectedPlatforms)) {
      const loadedManifest = await loadManifestFromSource(manifests[profile]!);
      expect(loadedManifest.manifest.platforms).toEqual(expected);
    }
  });

  it("defines documented Codex installation methods", async () => {
    const loadedManifest = await loadManifestFromSource(codexManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.variables?.codex_install_method).toBe("source-build");
    expect(manifest.variables?.codex_release_tag).toBe("latest");

    const unixArtifact = manifest.artifacts.find(
      (artifact) => artifact.id === "codex-install-unix" && artifact.type === "command"
    );
    expect(unixArtifact).toBeDefined();
    expect(unixArtifact?.type).toBe("command");
    if (!unixArtifact || unixArtifact.type !== "command") {
      return;
    }

    const unixScript = unixArtifact.commands[0]?.run ?? "";
    expectFragments(unixScript, [
      "source-build",
      "dotslash-release",
      "cargo build",
      "https://github.com/openai/codex/releases/latest/download/codex",
      "https://github.com/openai/codex/releases/download/${release_tag}/codex"
    ]);

    const windowsWslCheck =
      manifest.lifecycle?.preflight?.find(
        (command) => command.id === "validate-codex-windows-wsl"
      )?.run ?? "";
    expectFragments(windowsWslCheck, ["wsl.exe -l -q", "requires WSL2"]);
  });

  it("documents installation directories, data layout, and migration strategies for product manifests", async () => {
    const checks: Array<{
      manifestPath: string;
      expectedMethodId: string;
      expectedDataItemId: string;
      expectedMigrationSource: string;
    }> = [
      {
        manifestPath: openclawManifestPath,
        expectedMethodId: "installer-script",
        expectedDataItemId: "openclaw-home",
        expectedMigrationSource: "openclaw"
      },
      {
        manifestPath: codexManifestPath,
        expectedMethodId: "source-build",
        expectedDataItemId: "codex-config",
        expectedMigrationSource: "codex"
      },
      {
        manifestPath: zeroclawManifestPath,
        expectedMethodId: "source-build",
        expectedDataItemId: "zeroclaw-home",
        expectedMigrationSource: "openclaw"
      },
      {
        manifestPath: ironclawManifestPath,
        expectedMethodId: "source-build",
        expectedDataItemId: "ironclaw-postgres",
        expectedMigrationSource: "openclaw"
      }
    ];

    for (const check of checks) {
      const manifest = (await loadManifestFromSource(check.manifestPath)).manifest;
      expect(manifest.installation?.method.id).toBe(check.expectedMethodId);
      expect(manifest.installation?.directories?.installRoot?.path).toBe("{{hub_install_root}}");
      expect(
        manifest.dataLayout?.items.some((item) => item.id === check.expectedDataItemId)
      ).toBe(true);
      expect(
        manifest.migration?.strategies.some((strategy) => strategy.source === check.expectedMigrationSource)
      ).toBe(true);
    }
  });

  it("uses installer runtime variables for Codex and path-managed OpenClaw profiles", async () => {
    const codexManifest = (await loadManifestFromSource(codexManifestPath)).manifest;
    expect(codexManifest.variables).toMatchObject({
      hub_software_name: "codex",
      hub_install_control_level: "managed",
      codex_source_dir: "{{hub_work_root}}",
      codex_binary_link: "{{hub_bin_dir}}/codex",
      codex_dotslash_target: "{{hub_bin_dir}}/codex",
      codex_wsl_source_dir: "{{hub_work_root}}",
      codex_wsl_binary_link: "{{hub_bin_dir}}/codex",
      codex_wsl_dotslash_target: "{{hub_bin_dir}}/codex"
    });

    const openclawCliScriptManifest = (
      await loadManifestFromSource(openclawProfileManifestMap["openclaw-cli-script"]!)
    ).manifest;
    expect(openclawCliScriptManifest.variables).toMatchObject({
      hub_software_name: "openclaw",
      hub_install_control_level: "managed",
      openclaw_install_prefix: "{{hub_install_root}}"
    });

    const openclawSourceManifest = (
      await loadManifestFromSource(openclawProfileManifestMap["openclaw-source"]!)
    ).manifest;
    expect(openclawSourceManifest.variables).toMatchObject({
      hub_software_name: "openclaw",
      hub_install_control_level: "managed",
      openclaw_source_dir: "{{hub_work_root}}"
    });
  });

  it("declares truthful install control levels in registry variables", async () => {
    const loadedRegistry = await loadSoftwareRegistryFromSource(registryPath);
    const expectedControls: Record<string, string> = {
      openclaw: "opaque",
      "openclaw-cli-script": "managed",
      "openclaw-source": "managed",
      codex: "managed",
      nodejs: "partial",
      python: "partial"
    };

    for (const [softwareName, expectedControl] of Object.entries(expectedControls)) {
      const resolved = resolveSoftwareEntry(loadedRegistry, softwareName, "ubuntu");
      expect(resolved.entry.variables?.hub_software_name).toBe(softwareName.split("-")[0]);
      expect(resolved.entry.variables?.hub_install_control_level).toBe(expectedControl);
    }
  });

  it("defines multiple Node.js installation methods", async () => {
    const loadedManifest = await loadManifestFromSource(nodejsManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.variables?.nodejs_install_method).toBe("os-package");
    expect(manifest.variables?.nodejs_version_major).toBe("24");
    expect(manifest.variables?.nodejs_version).toBe("24");

    const unixArtifact = manifest.artifacts.find(
      (artifact) => artifact.id === "nodejs-install-unix" && artifact.type === "command"
    );
    expect(unixArtifact).toBeDefined();
    expect(unixArtifact?.type).toBe("command");
    if (!unixArtifact || unixArtifact.type !== "command") {
      return;
    }

    const unixScript = unixArtifact.commands[0]?.run ?? "";
    expectFragments(unixScript, [
      "os-package",
      "fnm",
      "nvm",
      "https://deb.nodesource.com/setup_${major}.x",
      "$HOME/.local/share/fnm",
      "$HOME/.fnm"
    ]);

    const unixHealthcheckScript =
      manifest.lifecycle?.healthcheck?.find(
        (command) => command.id === "node-healthcheck-unix"
      )?.run ?? "";
    expectFragments(unixHealthcheckScript, [
      "case \"$method\" in",
      "fnm use \"$version\"",
      "nvm ls \"$version\""
    ]);
  });

  it("defines multiple Python installation methods", async () => {
    const loadedManifest = await loadManifestFromSource(pythonManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.variables?.python_install_method).toBe("os-package");
    expect(manifest.variables?.python_version).toBe("3.13");
    expect(manifest.variables?.python_windows_package_id).toBe(
      "Python.Python.{{python_version}}"
    );

    const unixArtifact = manifest.artifacts.find(
      (artifact) => artifact.id === "python-install-unix" && artifact.type === "command"
    );
    expect(unixArtifact).toBeDefined();
    expect(unixArtifact?.type).toBe("command");
    if (!unixArtifact || unixArtifact.type !== "command") {
      return;
    }

    const unixScript = unixArtifact.commands[0]?.run ?? "";
    expectFragments(unixScript, [
      "os-package",
      "pyenv",
      "uv",
      "https://astral.sh/uv/install.sh"
    ]);
  });

  it("provides a runnable codex example manifest", async () => {
    const loadedManifest = await loadManifestFromSource(codexExampleManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.metadata.name).toContain("Codex");
    expect(manifest.variables?.codex_install_method).toBe("source-build");
    expect(
      manifest.artifacts.some(
        (artifact) => artifact.id === "codex-install-unix" && artifact.type === "command"
      )
    ).toBe(true);
  });

  it("provides a runnable openclaw recommended profile example manifest", async () => {
    const loadedManifest = await loadManifestFromSource(openclawExampleManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.metadata.name).toContain("OpenClaw");
    expect(manifest.variables?.openclaw_channel).toBe("latest");
    expect(manifest.variables?.openclaw_onboard).toBe("true");
    expect(
      manifest.artifacts.some(
        (artifact) => artifact.id === "openclaw-installer-script-unix" && artifact.type === "command"
      )
    ).toBe(true);
  });

  it("provides a runnable openclaw npm profile example", async () => {
    const loadedManifest = await loadManifestFromSource(openclawNpmExampleManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.metadata.name).toContain("npm Profile");
    expect(manifest.variables?.openclaw_channel).toBe("latest");
    expect(manifest.variables?.openclaw_onboard).toBe("true");
    expect(
      manifest.lifecycle?.install?.some(
        (command) =>
          command.id === "install-openclaw-npm" &&
          command.run.includes("npm install -g openclaw")
      )
    ).toBe(true);
  });

  it("provides a runnable openclaw docker profile example", async () => {
    const loadedManifest = await loadManifestFromSource(openclawDockerExampleManifestPath);
    const manifest = loadedManifest.manifest;

    expect(manifest.metadata.name).toContain("Docker");
    expect(manifest.platforms).toEqual(["windows", "macos", "ubuntu"]);
    expect(manifest.variables?.hub_container_runtime_preference).toBe("auto");
    expect(manifest.variables?.openclaw_docker_image).toBe("openclaw:local");
    expect(manifest.variables?.openclaw_docker_extra_mounts).toBe("");
    expect(manifest.variables?.openclaw_docker_home_volume).toBe("");
    expect(manifest.variables?.openclaw_docker_apt_packages).toBe("");
    expect(
      manifest.artifacts.some(
        (artifact) => artifact.id === "openclaw-docker-install-unix" && artifact.type === "command"
      )
    ).toBe(true);
  });
});
