import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRegistryDoctor } from "./doctor";

const registryPath = path.resolve(process.cwd(), "registry", "software-registry.yaml");

describe("runRegistryDoctor", () => {
  it("passes openclaw profile consistency checks", async () => {
    const report = await runRegistryDoctor("openclaw", {
      registrySource: registryPath
    });

    expect(report.target).toBe("openclaw");
    expect(report.success).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.every((check) => check.target === "openclaw")).toBe(true);
  });

  it("passes codex installer consistency checks", async () => {
    const report = await runRegistryDoctor("codex", {
      registrySource: registryPath
    });

    expect(report.target).toBe("codex");
    expect(report.success).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.every((check) => check.target === "codex")).toBe(true);
  });

  it("passes nodejs installer consistency checks", async () => {
    const report = await runRegistryDoctor("nodejs", {
      registrySource: registryPath
    });

    expect(report.target).toBe("nodejs");
    expect(report.success).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.every((check) => check.target === "nodejs")).toBe(true);
  });

  it("passes python installer consistency checks", async () => {
    const report = await runRegistryDoctor("python", {
      registrySource: registryPath
    });

    expect(report.target).toBe("python");
    expect(report.success).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.every((check) => check.target === "python")).toBe(true);
  });

  it("passes combined checks in all mode", async () => {
    const report = await runRegistryDoctor("all", {
      registrySource: registryPath
    });

    expect(report.target).toBe("all");
    expect(report.success).toBe(true);
    expect(report.checks.some((check) => check.target === "openclaw")).toBe(true);
    expect(report.checks.some((check) => check.target === "codex")).toBe(true);
    expect(report.checks.some((check) => check.target === "nodejs")).toBe(true);
    expect(report.checks.some((check) => check.target === "python")).toBe(true);
  });

  it("supports runtime checks with an injected probe", async () => {
    const report = await runRegistryDoctor("all", {
      registrySource: registryPath,
      runtime: true,
      runtimePlatform: "ubuntu",
      runtimeProbe: {
        commandExists: (command) => ["bash", "curl", "git", "apt-get"].includes(command),
        listWslDistros: () => []
      }
    });

    expect(report.runtime.enabled).toBe(true);
    expect(report.runtime.platform).toBe("ubuntu");
    expect(report.success).toBe(true);
    expect(
      report.checks.some((check) => check.id === "openclaw-runtime-command-bash" && check.success)
    ).toBe(true);
    expect(
      report.checks.some((check) => check.id === "codex-runtime-command-git" && check.success)
    ).toBe(true);
    expect(
      report.checks.some((check) => check.id === "nodejs-runtime-command-apt-get" && check.success)
    ).toBe(true);
    expect(
      report.checks.some((check) => check.id === "python-runtime-installer-ubuntu" && check.success)
    ).toBe(true);
  });

  it("fails codex runtime checks on windows when wsl distro is missing", async () => {
    const report = await runRegistryDoctor("codex", {
      registrySource: registryPath,
      runtime: true,
      runtimePlatform: "windows",
      runtimeProbe: {
        commandExists: (command) => command === "wsl.exe",
        listWslDistros: () => []
      }
    });

    expect(report.success).toBe(false);
    const failedWslDistrosCheck = report.checks.find(
      (check) => check.id === "codex-runtime-wsl-distros"
    );
    expect(failedWslDistrosCheck?.success).toBe(false);
    expect(failedWslDistrosCheck?.recommendation).toContain("wsl --install -d Ubuntu");
  });

  it("fails nodejs runtime checks on windows when package managers are missing", async () => {
    const report = await runRegistryDoctor("nodejs", {
      registrySource: registryPath,
      runtime: true,
      runtimePlatform: "windows",
      runtimeProbe: {
        commandExists: () => false,
        listWslDistros: () => []
      }
    });

    expect(report.success).toBe(false);
    const failedManagerCheck = report.checks.find(
      (check) => check.id === "nodejs-runtime-package-manager-windows"
    );
    expect(failedManagerCheck?.success).toBe(false);
    expect(failedManagerCheck?.recommendation).toContain("winget");
  });
});
