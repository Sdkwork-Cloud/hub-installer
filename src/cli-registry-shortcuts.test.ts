import { describe, expect, it } from "vitest";
import {
  hasRegistryShortcutOptions,
  resolveRegistryInstallShortcuts
} from "./cli-registry-shortcuts";

describe("resolveRegistryInstallShortcuts", () => {
  it("maps openclaw method argument to a dedicated profile entry", () => {
    const resolved = resolveRegistryInstallShortcuts({
      softwareName: "openclaw",
      methodArgument: "docker"
    });

    expect(resolved.softwareName).toBe("openclaw-docker");
    expect(resolved.variables).toEqual({});
  });

  it("supports openclaw channel as positional shorthand", () => {
    const resolved = resolveRegistryInstallShortcuts({
      softwareName: "openclaw",
      methodArgument: "beta"
    });

    expect(resolved.softwareName).toBe("openclaw");
    expect(resolved.variables).toEqual({
      openclaw_channel: "beta"
    });

    const semverTag = resolveRegistryInstallShortcuts({
      softwareName: "openclaw",
      methodArgument: "2026.03.08-beta.1"
    });
    expect(semverTag.softwareName).toBe("openclaw");
    expect(semverTag.variables).toEqual({
      openclaw_channel: "2026.03.08-beta.1"
    });
  });

  it("maps openclaw method option and channel/onboard shortcuts", () => {
    const resolved = resolveRegistryInstallShortcuts({
      softwareName: "openclaw",
      methodOption: "nix",
      channelOption: "beta",
      onboardOption: "false"
    });

    expect(resolved.softwareName).toBe("openclaw-nix");
    expect(resolved.variables).toEqual({
      openclaw_channel: "beta",
      openclaw_onboard: "false"
    });
  });

  it("supports codex/nodejs/python method and version shortcuts", () => {
    const codex = resolveRegistryInstallShortcuts({
      softwareName: "codex",
      methodArgument: "release"
    });
    expect(codex.variables.codex_install_method).toBe("dotslash-release");

    const nodejs = resolveRegistryInstallShortcuts({
      softwareName: "nodejs",
      methodOption: "package",
      nodeVersionOption: "22"
    });
    expect(nodejs.variables).toEqual({
      nodejs_install_method: "os-package",
      nodejs_version: "22",
      nodejs_version_major: "22"
    });

    const nodejsFnm = resolveRegistryInstallShortcuts({
      softwareName: "nodejs",
      methodOption: "fnm",
      nodeVersionOption: "22"
    });
    expect(nodejsFnm.variables).toEqual({
      nodejs_install_method: "fnm",
      nodejs_version: "22",
      nodejs_version_major: "22"
    });

    const python = resolveRegistryInstallShortcuts({
      softwareName: "python",
      methodOption: "package",
      pythonVersionOption: "3.12"
    });
    expect(python.variables).toEqual({
      python_install_method: "os-package",
      python_version: "3.12",
      python_windows_package_id: "Python.Python.3.12"
    });

    const pythonUv = resolveRegistryInstallShortcuts({
      softwareName: "python",
      methodOption: "uv",
      pythonVersionOption: "3.12"
    });
    expect(pythonUv.variables).toEqual({
      python_install_method: "uv",
      python_version: "3.12",
      python_windows_package_id: "Python.Python.3.12"
    });
  });

  it("supports unified software-version shortcut across built-ins", () => {
    const openclaw = resolveRegistryInstallShortcuts({
      softwareName: "openclaw",
      softwareVersionOption: "beta"
    });
    expect(openclaw.variables).toEqual({
      openclaw_channel: "beta"
    });

    const nodejs = resolveRegistryInstallShortcuts({
      softwareName: "nodejs",
      softwareVersionOption: "20.11.1"
    });
    expect(nodejs.variables).toEqual({
      nodejs_version: "20.11.1",
      nodejs_version_major: "20"
    });

    const python = resolveRegistryInstallShortcuts({
      softwareName: "python",
      softwareVersionOption: "3.11.9"
    });
    expect(python.variables).toEqual({
      python_version: "3.11.9",
      python_windows_package_id: "Python.Python.3.11"
    });

    const codex = resolveRegistryInstallShortcuts({
      softwareName: "codex",
      softwareVersionOption: "v0.2.0"
    });
    expect(codex.variables).toEqual({
      codex_git_ref: "v0.2.0",
      codex_release_tag: "v0.2.0"
    });
  });

  it("supports positional version shorthand for nodejs/python/codex", () => {
    const nodejs = resolveRegistryInstallShortcuts({
      softwareName: "nodejs",
      methodArgument: "18.20.2"
    });
    expect(nodejs.variables).toEqual({
      nodejs_version: "18.20.2",
      nodejs_version_major: "18"
    });

    const python = resolveRegistryInstallShortcuts({
      softwareName: "python",
      methodArgument: "3.13.1"
    });
    expect(python.variables).toEqual({
      python_version: "3.13.1",
      python_windows_package_id: "Python.Python.3.13"
    });

    const codex = resolveRegistryInstallShortcuts({
      softwareName: "codex",
      methodArgument: "main"
    });
    expect(codex.variables).toEqual({
      codex_git_ref: "main",
      codex_release_tag: "main"
    });
  });

  it("keeps --var overrides as the highest-priority values", () => {
    const resolved = resolveRegistryInstallShortcuts({
      softwareName: "openclaw",
      methodOption: "npm",
      channelOption: "beta",
      userVariables: {
        openclaw_channel: "dev"
      }
    });

    expect(resolved.softwareName).toBe("openclaw-npm");
    expect(resolved.variables).toEqual({
      openclaw_channel: "dev"
    });
  });

  it("throws for invalid shortcut combinations", () => {
    expect(() =>
      resolveRegistryInstallShortcuts({
        softwareName: "git",
        methodOption: "os-package"
      })
    ).toThrowError(/--method/);

    expect(() =>
      resolveRegistryInstallShortcuts({
        softwareName: "codex",
        methodOption: "beta"
      })
    ).toThrowError(/Unsupported --method/);

    expect(() =>
      resolveRegistryInstallShortcuts({
        softwareName: "openclaw",
        onboardOption: "maybe"
      })
    ).toThrowError(/--onboard/);

    expect(() =>
      resolveRegistryInstallShortcuts({
        softwareName: "git",
        softwareVersionOption: "1.0.0"
      })
    ).toThrowError(/--software-version/);
  });
});

describe("hasRegistryShortcutOptions", () => {
  it("detects when shorthand options are present", () => {
    expect(hasRegistryShortcutOptions({})).toBe(false);
    expect(hasRegistryShortcutOptions({ method: "docker" })).toBe(true);
    expect(hasRegistryShortcutOptions({ channel: "beta" })).toBe(true);
    expect(hasRegistryShortcutOptions({ softwareVersion: "22" })).toBe(true);
  });
});
