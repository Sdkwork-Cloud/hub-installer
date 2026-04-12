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
import { readInstallRecord, resolveBackupSessionDirectory } from "../core/install-records";
import { detectHostPlatform } from "../core/platform";
import { applyManifest } from "./executor";
import type { ApplyManifestOptions, LoadedManifest } from "./types";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "hub-installer-manifest-lifecycle-"));
  workspaces.push(workspace);
  return workspace;
}

function createLoadedManifest(workspace: string): LoadedManifest {
  const manifestPath = path.join(workspace, "openclaw-docker.hub.yaml");

  return {
    absolutePath: manifestPath,
    baseDirectory: workspace,
    sourceInput: manifestPath,
    sourceKind: "file",
    manifest: {
      schemaVersion: "1.0",
      metadata: {
        name: "OpenClaw Docker"
      },
      artifacts: [
        {
          id: "noop",
          type: "command",
          enabled: false,
          commands: [
            {
              run: "echo noop"
            }
          ]
        }
      ]
    }
  };
}

function createApplyOptions(workspace: string): ApplyManifestOptions {
  const installerHome = path.join(workspace, "hub-home");

  return {
    platform: detectHostPlatform(),
    installerHome,
    installScope: "user",
    installRoot: path.join(workspace, "managed", "install"),
    workRoot: path.join(workspace, "managed", "work"),
    binDir: path.join(workspace, "managed", "bin"),
    dataRoot: path.join(workspace, "managed", "data")
  };
}

async function installFixture(workspace: string): Promise<{
  manifest: LoadedManifest;
  options: ApplyManifestOptions;
}> {
  const manifest = createLoadedManifest(workspace);
  const options = createApplyOptions(workspace);
  const result = await applyManifest(manifest, options);
  expect(result.success).toBe(true);
  return {
    manifest,
    options
  };
}

function seedManagedLayout(options: ApplyManifestOptions): void {
  mkdirSync(options.installRoot!, { recursive: true });
  mkdirSync(options.workRoot!, { recursive: true });
  mkdirSync(options.dataRoot!, { recursive: true });
  writeFileSync(path.join(options.installRoot!, "install.txt"), "install", "utf8");
  writeFileSync(path.join(options.workRoot!, "work.txt"), "work", "utf8");
  writeFileSync(path.join(options.dataRoot!, "data.txt"), "data", "utf8");
}

describe("manifest lifecycle state management", () => {
  it("persists an install record after a successful non-dry-run apply", async () => {
    const workspace = createWorkspace();
    const { options } = await installFixture(workspace);

    const record = await readInstallRecord(options.installerHome!, "OpenClaw Docker");

    expect(record).toMatchObject({
      softwareName: "OpenClaw Docker",
      installerHome: options.installerHome,
      installRoot: options.installRoot,
      workRoot: options.workRoot,
      binDir: options.binDir,
      dataRoot: options.dataRoot,
      status: "installed"
    });
  });

  it("backs up requested managed roots into a deterministic backup session", async () => {
    const workspace = createWorkspace();
    const { manifest, options } = await installFixture(workspace);
    const backupSessionId = "2026-03-18T10:20:30.123Z";
    seedManagedLayout(options);

    const backupManifest = (
      (await import("./executor")) as Record<string, unknown>
    ).backupManifest as (
      manifest: LoadedManifest,
      options: ApplyManifestOptions & {
        targets: Array<"data" | "install" | "work">;
        sessionId: string;
      }
    ) => Promise<{
      success: boolean;
      backupSessionDir: string;
      targetReports: Array<{
        target: string;
        status: string;
      }>;
    }>;

    const result = await backupManifest(manifest, {
      ...options,
      targets: ["data", "install", "work"],
      sessionId: backupSessionId
    });

    const backupSessionDir = resolveBackupSessionDirectory(
      options.installerHome!,
      "OpenClaw Docker",
      backupSessionId
    );

    expect(result.success).toBe(true);
    expect(result.backupSessionDir).toBe(backupSessionDir);
    expect(result.targetReports).toEqual([
      { target: "data", status: "copied" },
      { target: "install", status: "copied" },
      { target: "work", status: "copied" }
    ]);
    expect(readFileSync(path.join(backupSessionDir, "data", "data.txt"), "utf8")).toBe("data");
    expect(readFileSync(path.join(backupSessionDir, "install", "install.txt"), "utf8")).toBe(
      "install"
    );
    expect(readFileSync(path.join(backupSessionDir, "work", "work.txt"), "utf8")).toBe("work");
  });

  it("uninstalls install and work roots while preserving data by default", async () => {
    const workspace = createWorkspace();
    const { manifest, options } = await installFixture(workspace);
    seedManagedLayout(options);

    const uninstallManifest = (
      (await import("./executor")) as Record<string, unknown>
    ).uninstallManifest as (
      manifest: LoadedManifest,
      options: ApplyManifestOptions
    ) => Promise<{
      success: boolean;
      targetReports: Array<{
        target: string;
        status: string;
      }>;
    }>;

    const result = await uninstallManifest(manifest, options);

    expect(result.success).toBe(true);
    expect(result.targetReports).toEqual([
      { target: "install", status: "removed" },
      { target: "work", status: "removed" },
      { target: "data", status: "preserved" }
    ]);
    expect(existsSync(options.installRoot!)).toBe(false);
    expect(existsSync(options.workRoot!)).toBe(false);
    expect(existsSync(options.dataRoot!)).toBe(true);

    const record = await readInstallRecord(options.installerHome!, "OpenClaw Docker");
    expect(record?.status).toBe("uninstalled");
  });

  it("can back up before uninstall and purge data when requested", async () => {
    const workspace = createWorkspace();
    const { manifest, options } = await installFixture(workspace);
    const backupSessionId = "2026-03-18T10:20:30.123Z";
    seedManagedLayout(options);

    const uninstallManifest = (
      (await import("./executor")) as Record<string, unknown>
    ).uninstallManifest as (
      manifest: LoadedManifest,
      options: ApplyManifestOptions & {
        purgeData: boolean;
        backupBeforeUninstall: boolean;
        backupTargets: Array<"data" | "install" | "work">;
        backupSessionId: string;
      }
    ) => Promise<{
      success: boolean;
      backupResult?: {
        backupSessionDir: string;
      };
      targetReports: Array<{
        target: string;
        status: string;
      }>;
    }>;

    const result = await uninstallManifest(manifest, {
      ...options,
      purgeData: true,
      backupBeforeUninstall: true,
      backupTargets: ["data", "install", "work"],
      backupSessionId
    });

    const backupSessionDir = resolveBackupSessionDirectory(
      options.installerHome!,
      "OpenClaw Docker",
      backupSessionId
    );

    expect(result.success).toBe(true);
    expect(result.backupResult?.backupSessionDir).toBe(backupSessionDir);
    expect(result.targetReports).toEqual([
      { target: "install", status: "removed" },
      { target: "work", status: "removed" },
      { target: "data", status: "removed" }
    ]);
    expect(existsSync(path.join(backupSessionDir, "data", "data.txt"))).toBe(true);
    expect(existsSync(options.installRoot!)).toBe(false);
    expect(existsSync(options.workRoot!)).toBe(false);
    expect(existsSync(options.dataRoot!)).toBe(false);
  });
});
