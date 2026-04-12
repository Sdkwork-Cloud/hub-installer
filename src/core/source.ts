import { fileURLToPath } from "node:url";
import { HubInstallerError } from "../errors";
import type {
  PackageFormat,
  PackageManager,
  SourceReference
} from "../types";

const MANAGER_SCHEME_REGEX = /^(winget|choco|brew|apt|snap):\/\/(.+)$/i;

function parseManagerSource(source: string): SourceReference | null {
  const match = source.match(MANAGER_SCHEME_REGEX);
  if (!match) {
    return null;
  }

  const managerToken = match[1];
  const packageToken = match[2];
  if (!managerToken || !packageToken) {
    return null;
  }

  const manager = managerToken.toLowerCase() as PackageManager;
  const packageName = packageToken.trim();

  if (!packageName) {
    throw new HubInstallerError(
      "INVALID_SOURCE",
      `Manager package name is empty in source: ${source}`
    );
  }

  return {
    kind: "manager",
    manager,
    packageName
  };
}

function getDetectTarget(source: string): string {
  try {
    const parsed = new URL(source);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "file:") {
      return decodeURIComponent(parsed.pathname).toLowerCase();
    }
  } catch {
    // Ignore URL parse errors and treat as local path-like source.
  }

  return source.toLowerCase();
}

function mapExtensionToFormat(source: string): PackageFormat {
  const value = getDetectTarget(source);

  if (
    value.endsWith(".tar.gz") ||
    value.endsWith(".tgz") ||
    value.endsWith(".tar.xz") ||
    value.endsWith(".txz") ||
    value.endsWith(".tar.bz2")
  ) {
    return "tar";
  }

  if (value.endsWith(".exe")) {
    return "exe";
  }

  if (value.endsWith(".msi")) {
    return "msi";
  }

  if (value.endsWith(".msix")) {
    return "msix";
  }

  if (value.endsWith(".pkg")) {
    return "pkg";
  }

  if (value.endsWith(".dmg")) {
    return "dmg";
  }

  if (value.endsWith(".deb")) {
    return "deb";
  }

  if (value.endsWith(".rpm")) {
    return "rpm";
  }

  if (value.endsWith(".appimage")) {
    return "appimage";
  }

  if (value.endsWith(".apk")) {
    return "apk";
  }

  if (value.endsWith(".ipa")) {
    return "ipa";
  }

  if (value.endsWith(".zip")) {
    return "zip";
  }

  if (value.endsWith(".tar")) {
    return "tar";
  }

  throw new HubInstallerError(
    "UNKNOWN_FORMAT",
    `Cannot detect package format from source: ${source}. Provide --format explicitly.`
  );
}

export function resolveSourceReference(source: string): SourceReference {
  const raw = source.trim();
  if (!raw) {
    throw new HubInstallerError("INVALID_SOURCE", "Source is required.");
  }

  const managerRef = parseManagerSource(raw);
  if (managerRef) {
    return managerRef;
  }

  if (raw.startsWith("file://")) {
    return {
      kind: "file",
      path: fileURLToPath(raw)
    };
  }

  return {
    kind: "file",
    path: raw
  };
}

export function detectPackageFormat(
  source: string,
  sourceRef: SourceReference,
  explicitFormat?: PackageFormat
): PackageFormat {
  if (explicitFormat) {
    return explicitFormat;
  }

  if (sourceRef.kind === "manager") {
    return "manager";
  }

  return mapExtensionToFormat(source);
}
