import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readInstallRecord } from "../core/install-records";
import { detectHostPlatform } from "../core/platform";
import { installSoftwareFromRegistry } from "./service";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "hub-installer-registry-lifecycle-"));
  workspaces.push(workspace);
  return workspace;
}

function createRegistryFixture(workspace: string): {
  registryPath: string;
} {
  const manifestsDir = path.join(workspace, "manifests");
  mkdirSync(manifestsDir, { recursive: true });
  const manifestPath = path.join(manifestsDir, "openclaw-docker.hub.yaml");
  const registryPath = path.join(workspace, "software-registry.yaml");

  writeFileSync(
    manifestPath,
    [
      'schemaVersion: "1.0"',
      "metadata:",
      "  name: OpenClaw Docker",
      "artifacts:",
      "  - id: noop",
      "    type: command",
      "    enabled: false",
      "    commands:",
      '      - run: echo "noop"'
    ].join("\n"),
    "utf8"
  );

  writeFileSync(
    registryPath,
    [
      'schemaVersion: "1.0"',
      "metadata:",
      "  name: Test Registry",
      "entries:",
      "  - name: openclaw",
      "    aliases: [claw]",
      "    manifest: ./manifests/openclaw-docker.hub.yaml"
    ].join("\n"),
    "utf8"
  );

  return {
    registryPath
  };
}

function createManagedOptions(workspace: string) {
  return {
    platform: detectHostPlatform(),
    installerHome: path.join(workspace, "hub-home"),
    installScope: "user" as const,
    installRoot: path.join(workspace, "managed", "install"),
    workRoot: path.join(workspace, "managed", "work"),
    binDir: path.join(workspace, "managed", "bin"),
    dataRoot: path.join(workspace, "managed", "data")
  };
}

function seedManagedLayout(options: ReturnType<typeof createManagedOptions>): void {
  mkdirSync(options.installRoot, { recursive: true });
  mkdirSync(options.workRoot, { recursive: true });
  mkdirSync(options.dataRoot, { recursive: true });
  writeFileSync(path.join(options.installRoot, "install.txt"), "install", "utf8");
  writeFileSync(path.join(options.workRoot, "work.txt"), "work", "utf8");
  writeFileSync(path.join(options.dataRoot, "data.txt"), "data", "utf8");
}

describe("registry lifecycle operations", () => {
  it("backs up software by registry entry name", async () => {
    const workspace = createWorkspace();
    const { registryPath } = createRegistryFixture(workspace);
    const managedOptions = createManagedOptions(workspace);
    await installSoftwareFromRegistry("openclaw", {
      registrySource: registryPath,
      ...managedOptions
    });
    seedManagedLayout(managedOptions);

    const backupSoftwareFromRegistry = (
      (await import("./service")) as Record<string, unknown>
    ).backupSoftwareFromRegistry as (
      softwareName: string,
      options: typeof managedOptions & {
        registrySource: string;
        targets: Array<"data" | "install" | "work">;
        sessionId: string;
      }
    ) => Promise<{
      software: {
        name: string;
      };
      backupResult: {
        success: boolean;
        targetReports: Array<{
          target: string;
          status: string;
        }>;
        backupSessionDir: string;
      };
    }>;

    const result = await backupSoftwareFromRegistry("openclaw", {
      registrySource: registryPath,
      ...managedOptions,
      targets: ["data", "install", "work"],
      sessionId: "2026-03-18T10:20:30.123Z"
    });

    expect(result.software.name).toBe("openclaw");
    expect(result.backupResult.success).toBe(true);
    expect(result.backupResult.targetReports).toEqual([
      { target: "data", status: "copied" },
      { target: "install", status: "copied" },
      { target: "work", status: "copied" }
    ]);
    expect(
      readFileSync(path.join(result.backupResult.backupSessionDir, "data", "data.txt"), "utf8")
    ).toBe("data");
  });

  it("uninstalls software by registry entry name and updates install state", async () => {
    const workspace = createWorkspace();
    const { registryPath } = createRegistryFixture(workspace);
    const managedOptions = createManagedOptions(workspace);
    await installSoftwareFromRegistry("openclaw", {
      registrySource: registryPath,
      ...managedOptions
    });
    seedManagedLayout(managedOptions);

    const uninstallSoftwareFromRegistry = (
      (await import("./service")) as Record<string, unknown>
    ).uninstallSoftwareFromRegistry as (
      softwareName: string,
      options: typeof managedOptions & {
        registrySource: string;
        purgeData: boolean;
        backupBeforeUninstall: boolean;
        backupTargets: Array<"data" | "install" | "work">;
        backupSessionId: string;
      }
    ) => Promise<{
      uninstallResult: {
        success: boolean;
        targetReports: Array<{
          target: string;
          status: string;
        }>;
      };
    }>;

    const result = await uninstallSoftwareFromRegistry("openclaw", {
      registrySource: registryPath,
      ...managedOptions,
      purgeData: true,
      backupBeforeUninstall: true,
      backupTargets: ["data", "install", "work"],
      backupSessionId: "2026-03-18T10:20:30.123Z"
    });

    expect(result.uninstallResult.success).toBe(true);
    expect(result.uninstallResult.targetReports).toEqual([
      { target: "install", status: "removed" },
      { target: "work", status: "removed" },
      { target: "data", status: "removed" }
    ]);
    expect(existsSync(managedOptions.installRoot)).toBe(false);
    expect(existsSync(managedOptions.workRoot)).toBe(false);
    expect(existsSync(managedOptions.dataRoot)).toBe(false);

    const record = await readInstallRecord(managedOptions.installerHome, "openclaw");
    expect(record?.status).toBe("uninstalled");
  });
});
