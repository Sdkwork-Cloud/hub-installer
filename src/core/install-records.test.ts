import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readInstallRecord,
  resolveBackupSessionDirectory,
  resolveInstallRecordFile,
  writeInstallRecord,
  type InstallRecord
} from "./install-records";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "hub-installer-install-records-"));
  workspaces.push(workspace);
  return workspace;
}

function createInstallRecord(installerHome: string): InstallRecord {
  return {
    schemaVersion: "1.0",
    softwareName: "OpenClaw Docker",
    manifestName: "OpenClaw Docker",
    manifestPath: "D:/workspace/manifests/openclaw-docker.hub.yaml",
    manifestSourceInput: "./openclaw-docker.hub.yaml",
    manifestSourceKind: "file",
    platform: "windows",
    effectiveRuntimePlatform: "windows",
    installerHome,
    installScope: "user",
    installRoot: "C:/Users/tester/AppData/Local/Programs/OpenClawDocker",
    workRoot: path.join(installerHome, "state", "sources", "openclaw-docker"),
    binDir: "C:/Users/tester/AppData/Local/Programs/OpenClawDocker/bin",
    dataRoot: "C:/Users/tester/AppData/Local/OpenClawDocker",
    installControlLevel: "managed",
    status: "installed",
    installedAt: "2026-03-18T05:06:07.000Z",
    updatedAt: "2026-03-18T05:06:07.000Z"
  };
}

describe("install records", () => {
  it("resolves install record files using a canonical software slug", () => {
    const installerHome = path.join("D:", "sdkwork", "hub-installer");

    expect(resolveInstallRecordFile(installerHome, "OpenClaw Docker")).toBe(
      path.join(installerHome, "state", "install-records", "openclaw-docker.json")
    );
  });

  it("writes and reads install records from installer state", async () => {
    const workspace = createWorkspace();
    const installerHome = path.join(workspace, "hub-installer");
    const record = createInstallRecord(installerHome);

    await writeInstallRecord(installerHome, record.softwareName, record);

    await expect(readInstallRecord(installerHome, record.softwareName)).resolves.toEqual(record);
  });

  it("returns undefined when an install record does not exist", async () => {
    const workspace = createWorkspace();
    const installerHome = path.join(workspace, "hub-installer");

    await expect(readInstallRecord(installerHome, "missing")).resolves.toBeUndefined();
  });

  it("resolves deterministic backup session directories for a software entry", () => {
    const installerHome = path.join("D:", "sdkwork", "hub-installer");

    expect(
      resolveBackupSessionDirectory(installerHome, "OpenClaw Docker", "2026-03-18T10:20:30.123Z")
    ).toBe(
      path.join(
        installerHome,
        "state",
        "backups",
        "openclaw-docker",
        "2026-03-18T10-20-30.123Z"
      )
    );
  });
});
