import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { InstallControlLevel, InstallScope, SupportedPlatform } from "../types";

export const INSTALL_RECORD_SCHEMA_VERSION = "1.0" as const;
export type InstallRecordSchemaVersion = typeof INSTALL_RECORD_SCHEMA_VERSION;
export type InstallRecordStatus = "installed" | "uninstalled";

export interface InstallRecordRegistryMetadata {
  sourceInput: string;
  resolvedPath: string;
  name: string;
  version?: string;
  softwareName: string;
  manifestSource: string;
}

export interface InstallRecord {
  schemaVersion: InstallRecordSchemaVersion;
  softwareName: string;
  manifestName: string;
  manifestPath: string;
  manifestSourceInput: string;
  manifestSourceKind: "file" | "directory" | "url";
  platform: SupportedPlatform;
  effectiveRuntimePlatform: SupportedPlatform | "wsl";
  installerHome: string;
  installScope: InstallScope;
  installRoot: string;
  workRoot: string;
  binDir: string;
  dataRoot: string;
  installControlLevel: InstallControlLevel;
  status: InstallRecordStatus;
  installedAt?: string;
  updatedAt: string;
  registry?: InstallRecordRegistryMetadata;
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function joinPathFromBase(base: string, ...segments: string[]): string {
  if (isWindowsAbsolutePath(base)) {
    return path.win32.join(base, ...segments);
  }

  if (base.startsWith("/")) {
    return path.posix.join(base, ...segments);
  }

  return path.join(base, ...segments);
}

function toSoftwareSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "software"
  );
}

function toBackupSessionSegment(value: string): string {
  return value.replace(/:/g, "-").replace(/[<>"/\\|?*]+/g, "_");
}

export function resolveInstallRecordFile(installerHome: string, softwareName: string): string {
  return joinPathFromBase(
    installerHome,
    "state",
    "install-records",
    `${toSoftwareSlug(softwareName)}.json`
  );
}

export function resolveBackupRootDirectory(installerHome: string, softwareName: string): string {
  return joinPathFromBase(installerHome, "state", "backups", toSoftwareSlug(softwareName));
}

export function resolveBackupSessionDirectory(
  installerHome: string,
  softwareName: string,
  sessionId: string
): string {
  return joinPathFromBase(
    resolveBackupRootDirectory(installerHome, softwareName),
    toBackupSessionSegment(sessionId)
  );
}

export async function readInstallRecord(
  installerHome: string,
  softwareName: string
): Promise<InstallRecord | undefined> {
  const filePath = resolveInstallRecordFile(installerHome, softwareName);

  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as InstallRecord;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function writeInstallRecord(
  installerHome: string,
  softwareName: string,
  record: InstallRecord
): Promise<string> {
  const filePath = resolveInstallRecordFile(installerHome, softwareName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return filePath;
}
