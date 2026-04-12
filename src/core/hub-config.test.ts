import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadHubConfigFile, resolveHubConfig } from "./hub-config";

describe("resolveHubConfig", () => {
  it("uses cli values before env and file values", () => {
    const resolved = resolveHubConfig({
      cli: {
        installScope: "user",
        installRoot: "/custom/install"
      },
      env: {
        HUB_INSTALLER_INSTALL_SCOPE: "system",
        HUB_INSTALLER_INSTALL_ROOT: "/env/install"
      },
      file: {
        installScope: "system",
        installRoot: "/file/install"
      }
    });

    expect(resolved.installScope).toBe("user");
    expect(resolved.installRoot).toBe("/custom/install");
  });

  it("falls back to env values before file values", () => {
    const resolved = resolveHubConfig({
      env: {
        HUB_INSTALLER_HOME: "/env/home",
        HUB_INSTALLER_INSTALL_SCOPE: "user"
      },
      file: {
        installerHome: "/file/home",
        installScope: "system"
      }
    });

    expect(resolved.installerHome).toBe("/env/home");
    expect(resolved.installScope).toBe("user");
  });

  it("rejects invalid install scopes", () => {
    expect(() =>
      resolveHubConfig({
        env: {
          HUB_INSTALLER_INSTALL_SCOPE: "machine"
        }
      })
    ).toThrowError(/install scope/i);
  });

  it("rejects invalid cli and file install scopes", () => {
    expect(() =>
      resolveHubConfig({
        cli: {
          installScope: "machine" as "system"
        }
      })
    ).toThrowError(/install scope/i);

    expect(() =>
      resolveHubConfig({
        file: {
          installScope: "machine" as "system"
        }
      })
    ).toThrowError(/install scope/i);
  });
});

describe("loadHubConfigFile", () => {
  it("loads config from the default installer-home config file", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "hub-installer-config-"));
    const installerHome = path.join(workspace, "hub-home");
    const configDir = path.join(installerHome, "config");
    const configPath = path.join(configDir, "config.json");

    try {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        configPath,
        JSON.stringify({
          installScope: "user",
          installRoot: "/srv/openclaw",
          binDir: "/srv/bin"
        }),
        "utf8"
      );

      expect(
        loadHubConfigFile({
          installerHome,
          env: {}
        })
      ).toMatchObject({
        installScope: "user",
        installRoot: "/srv/openclaw",
        binDir: "/srv/bin"
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("returns an empty object when the config file is absent", () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "hub-installer-config-missing-"));

    try {
      expect(
        loadHubConfigFile({
          installerHome: path.join(workspace, "hub-home"),
          env: {}
        })
      ).toEqual({});
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
