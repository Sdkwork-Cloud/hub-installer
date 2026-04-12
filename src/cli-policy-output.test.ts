import { describe, expect, it } from "vitest";
import {
  formatApplyResult,
  formatBackupResult,
  formatUninstallResult,
  formatRegistryInstallResult
} from "./cli-output";
import type {
  ApplyManifestResult,
  BackupManifestResult,
  UninstallManifestResult
} from "./manifest";

const applyResult: ApplyManifestResult = {
  manifestName: "Codex CLI Bootstrap",
  manifestPath: "/workspace/examples/codex.hub.yaml",
  manifestSourceInput: "./examples/codex.hub.yaml",
  manifestSourceKind: "file",
  platform: "ubuntu",
  installerHome: "/home/tester/.sdkwork/hub-installer",
  resolvedInstallScope: "system",
  resolvedInstallRoot: "/opt/codex",
  resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
  resolvedBinDir: "/usr/local/bin",
  resolvedDataRoot: "/var/lib/codex",
  installControlLevel: "managed",
  effectiveRuntimePlatform: "ubuntu",
  success: true,
  startedAt: "2026-03-09T12:00:00.000Z",
  endedAt: "2026-03-09T12:00:02.000Z",
  durationMs: 2000,
  stageReports: [],
  artifactReports: []
};

const backupResult: BackupManifestResult = {
  manifestName: "Codex CLI Bootstrap",
  manifestPath: "/workspace/examples/codex.hub.yaml",
  manifestSourceInput: "./examples/codex.hub.yaml",
  manifestSourceKind: "file",
  platform: "ubuntu",
  installerHome: "/home/tester/.sdkwork/hub-installer",
  resolvedInstallScope: "system",
  resolvedInstallRoot: "/opt/codex",
  resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
  resolvedBinDir: "/usr/local/bin",
  resolvedDataRoot: "/var/lib/codex",
  installControlLevel: "managed",
  effectiveRuntimePlatform: "ubuntu",
  installRecordFile: "/home/tester/.sdkwork/hub-installer/state/install-records/codex.json",
  installRecordFound: true,
  backupSessionDir: "/home/tester/.sdkwork/hub-installer/state/backups/codex/2026-03-18T10-20-30.123Z",
  success: true,
  startedAt: "2026-03-09T12:00:00.000Z",
  endedAt: "2026-03-09T12:00:02.000Z",
  durationMs: 2000,
  stageReports: [],
  targetReports: [
    { target: "data", status: "copied" },
    { target: "install", status: "missing" }
  ]
};

const uninstallResult: UninstallManifestResult = {
  manifestName: "Codex CLI Bootstrap",
  manifestPath: "/workspace/examples/codex.hub.yaml",
  manifestSourceInput: "./examples/codex.hub.yaml",
  manifestSourceKind: "file",
  platform: "ubuntu",
  installerHome: "/home/tester/.sdkwork/hub-installer",
  resolvedInstallScope: "system",
  resolvedInstallRoot: "/opt/codex",
  resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
  resolvedBinDir: "/usr/local/bin",
  resolvedDataRoot: "/var/lib/codex",
  installControlLevel: "managed",
  effectiveRuntimePlatform: "ubuntu",
  installRecordFile: "/home/tester/.sdkwork/hub-installer/state/install-records/codex.json",
  installRecordFound: true,
  purgeData: false,
  success: true,
  startedAt: "2026-03-09T12:00:00.000Z",
  endedAt: "2026-03-09T12:00:02.000Z",
  durationMs: 2000,
  stageReports: [],
  targetReports: [
    { target: "install", status: "removed" },
    { target: "work", status: "removed" },
    { target: "data", status: "preserved" }
  ]
};

describe("CLI policy output", () => {
  it("includes resolved install policy metadata in apply output", () => {
    const output = formatApplyResult(applyResult);

    expect(output).toContain("Installer Home: /home/tester/.sdkwork/hub-installer");
    expect(output).toContain("Install Scope: system");
    expect(output).toContain("Install Root: /opt/codex");
    expect(output).toContain("Work Root: /home/tester/.sdkwork/hub-installer/state/sources/codex");
    expect(output).toContain("Bin Dir: /usr/local/bin");
    expect(output).toContain("Data Root: /var/lib/codex");
    expect(output).toContain("Install Control: managed");
    expect(output).toContain("Effective Runtime: ubuntu");
  });

  it("surfaces install policy metadata in registry install output", () => {
    const output = formatRegistryInstallResult({
      registrySourceInput: "./registry/software-registry.yaml",
      registryResolvedPath: "/workspace/registry/software-registry.yaml",
      registryName: "SDK Work Registry",
      softwareName: "codex",
      manifestSource: "./registry/manifests/codex.hub.yaml",
      applyResult
    });

    expect(output).toContain("Software: codex");
    expect(output).toContain("Install Root: /opt/codex");
    expect(output).toContain("Install Control: managed");
  });

  it("renders backup target status and install record metadata", () => {
    const output = formatBackupResult(backupResult);

    expect(output).toContain("Install Record: /home/tester/.sdkwork/hub-installer/state/install-records/codex.json");
    expect(output).toContain("Backup Session: /home/tester/.sdkwork/hub-installer/state/backups/codex/2026-03-18T10-20-30.123Z");
    expect(output).toContain("[COPIED] data");
    expect(output).toContain("[MISSING] install");
  });

  it("renders uninstall data-preservation status", () => {
    const output = formatBackupResult({
      ...backupResult,
      targetReports: [{ target: "work", status: "copied" }]
    });
    const uninstallOutput = formatUninstallResult(uninstallResult);

    expect(output).toContain("[COPIED] work");
    expect(uninstallOutput).toContain("Purge Data: no");
    expect(uninstallOutput).toContain("[PRESERVED] data");
  });
});
