import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyManifest, backupManifest } from "./executor";
import type { LoadedManifest } from "./types";
import type { RuntimeProbe } from "../core/runtime";

describe("applyManifest install policy metadata", () => {
  it("includes resolved installer and install policy details in the apply result", async () => {
    const installerHome = "/home/tester/.sdkwork/hub-installer";
    const loadedManifest: LoadedManifest = {
      absolutePath: path.resolve("examples", "codex.hub.yaml"),
      baseDirectory: path.resolve("examples"),
      sourceInput: "./examples/codex.hub.yaml",
      sourceKind: "file",
      manifest: {
        schemaVersion: "1.0",
        metadata: {
          name: "Codex CLI Bootstrap"
        },
        variables: {
          hub_software_name: "codex",
          hub_install_control_level: "managed"
        },
        artifacts: []
      }
    };

    const result = await applyManifest(loadedManifest, {
      platform: "ubuntu",
      dryRun: true,
      installerHome,
      installScope: "system"
    });

    expect(result).toMatchObject({
      installerHome,
      resolvedInstallScope: "system",
      resolvedInstallRoot: "/opt/codex",
      resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
      resolvedBinDir: "/usr/local/bin",
      resolvedDataRoot: "/var/lib/codex",
      installControlLevel: "managed",
      effectiveRuntimePlatform: "ubuntu"
    });
  });

  it("loads install policy defaults from installer config", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "hub-installer-executor-config-"));
    const installerHome = path.join(workspace, "hub-home");
    const configDir = path.join(installerHome, "config");
    const previousEnv = {
      HUB_INSTALLER_INSTALL_SCOPE: process.env.HUB_INSTALLER_INSTALL_SCOPE,
      HUB_INSTALLER_INSTALL_ROOT: process.env.HUB_INSTALLER_INSTALL_ROOT,
      HUB_INSTALLER_WORK_ROOT: process.env.HUB_INSTALLER_WORK_ROOT,
      HUB_INSTALLER_BIN_DIR: process.env.HUB_INSTALLER_BIN_DIR,
      HUB_INSTALLER_DATA_ROOT: process.env.HUB_INSTALLER_DATA_ROOT
    };
    const loadedManifest: LoadedManifest = {
      absolutePath: path.resolve("examples", "codex.hub.yaml"),
      baseDirectory: path.resolve("examples"),
      sourceInput: "./examples/codex.hub.yaml",
      sourceKind: "file",
      manifest: {
        schemaVersion: "1.0",
        metadata: {
          name: "Codex CLI Bootstrap"
        },
        variables: {
          hub_software_name: "codex",
          hub_install_control_level: "managed"
        },
        artifacts: []
      }
    };

    try {
      delete process.env.HUB_INSTALLER_INSTALL_SCOPE;
      delete process.env.HUB_INSTALLER_INSTALL_ROOT;
      delete process.env.HUB_INSTALLER_WORK_ROOT;
      delete process.env.HUB_INSTALLER_BIN_DIR;
      delete process.env.HUB_INSTALLER_DATA_ROOT;
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({
          installScope: "user",
          installRoot: "/srv/codex",
          binDir: "/srv/bin",
          dataRoot: "/srv/share/codex"
        }),
        "utf8"
      );

      const result = await applyManifest(loadedManifest, {
        platform: "ubuntu",
        dryRun: true,
        installerHome
      });

      expect(result).toMatchObject({
        installerHome: installerHome.replace(/\\/g, "/"),
        resolvedInstallScope: "user",
        resolvedInstallRoot: "/srv/codex",
        resolvedWorkRoot: `${installerHome.replace(/\\/g, "/")}/state/sources/codex`,
        resolvedBinDir: "/srv/bin",
        resolvedDataRoot: "/srv/share/codex"
      });
    } finally {
      if (previousEnv.HUB_INSTALLER_INSTALL_SCOPE === undefined) {
        delete process.env.HUB_INSTALLER_INSTALL_SCOPE;
      } else {
        process.env.HUB_INSTALLER_INSTALL_SCOPE = previousEnv.HUB_INSTALLER_INSTALL_SCOPE;
      }
      if (previousEnv.HUB_INSTALLER_INSTALL_ROOT === undefined) {
        delete process.env.HUB_INSTALLER_INSTALL_ROOT;
      } else {
        process.env.HUB_INSTALLER_INSTALL_ROOT = previousEnv.HUB_INSTALLER_INSTALL_ROOT;
      }
      if (previousEnv.HUB_INSTALLER_WORK_ROOT === undefined) {
        delete process.env.HUB_INSTALLER_WORK_ROOT;
      } else {
        process.env.HUB_INSTALLER_WORK_ROOT = previousEnv.HUB_INSTALLER_WORK_ROOT;
      }
      if (previousEnv.HUB_INSTALLER_BIN_DIR === undefined) {
        delete process.env.HUB_INSTALLER_BIN_DIR;
      } else {
        process.env.HUB_INSTALLER_BIN_DIR = previousEnv.HUB_INSTALLER_BIN_DIR;
      }
      if (previousEnv.HUB_INSTALLER_DATA_ROOT === undefined) {
        delete process.env.HUB_INSTALLER_DATA_ROOT;
      } else {
        process.env.HUB_INSTALLER_DATA_ROOT = previousEnv.HUB_INSTALLER_DATA_ROOT;
      }
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("resolves WSL runtime metadata separately from host-managed lifecycle paths", async () => {
    const runtimeProbe: RuntimeProbe = {
      commandExists: () => true,
      listWslDistros: () => ["Ubuntu-22.04"],
      wslCommandExists: (distribution, command) =>
        distribution === "Ubuntu-22.04" && command === "bash",
      dockerAvailableOnHost: () => true,
      wslDockerAvailable: () => false,
      wslHomeDir: () => "/home/tester"
    };
    const loadedManifest: LoadedManifest = {
      absolutePath: path.resolve("examples", "codex.hub.yaml"),
      baseDirectory: path.resolve("examples"),
      sourceInput: "./examples/codex.hub.yaml",
      sourceKind: "file",
      manifest: {
        schemaVersion: "1.0",
        metadata: {
          name: "Codex CLI Bootstrap"
        },
        variables: {
          hub_software_name: "codex"
        },
        artifacts: []
      }
    };

    const applyResult = await applyManifest(loadedManifest, {
      platform: "windows",
      dryRun: true,
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "host",
      wslDistribution: "Ubuntu-22.04",
      runtimeProbe
    });

    expect(applyResult).toMatchObject({
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "host",
      wslDistribution: "Ubuntu-22.04",
      installerHome: "/home/tester/.sdkwork/hub-installer",
      resolvedInstallRoot: "/home/tester/.local/opt/codex",
      resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
      resolvedBinDir: "/home/tester/.local/bin",
      resolvedDataRoot: "/home/tester/.local/share/codex"
    });

    const backupResult = await backupManifest(loadedManifest, {
      platform: "windows",
      dryRun: true,
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "host",
      wslDistribution: "Ubuntu-22.04",
      sessionId: "2026-03-18T10:20:30.123Z",
      runtimeProbe
    });

    expect(backupResult.installRecordFile).toBe(
      "\\\\wsl$\\Ubuntu-22.04\\home\\tester\\.sdkwork\\hub-installer\\state\\install-records\\codex.json"
    );
    expect(backupResult.backupSessionDir).toBe(
      "\\\\wsl$\\Ubuntu-22.04\\home\\tester\\.sdkwork\\hub-installer\\state\\backups\\codex\\2026-03-18T10-20-30.123Z"
    );
    expect(backupResult).toMatchObject({
      resolvedInstallRoot: "/home/tester/.local/opt/codex",
      resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
      resolvedDataRoot: "/home/tester/.local/share/codex",
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "host",
      wslDistribution: "Ubuntu-22.04"
    });
  });
});
