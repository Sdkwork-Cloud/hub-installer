import path from "node:path";

const PACKAGE_FILE_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".msix",
  ".pkg",
  ".dmg",
  ".deb",
  ".rpm",
  ".appimage",
  ".apk",
  ".ipa",
  ".zip",
  ".tar",
  ".tgz",
  ".gz",
  ".xz",
  ".7z"
]);

const MANIFEST_FILE_NAMES = new Set([
  "hub-installer.yaml",
  "hub-installer.yml",
  "hub-installer.json",
  "hub.yaml",
  "hub.yml",
  "hub.json",
  "manifest.yaml",
  "manifest.yml",
  "manifest.json"
]);

export type InstallMode = "registry" | "manifest" | "package";

function isUriSource(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

function isPathLike(value: string): boolean {
  if (!value) {
    return false;
  }

  if (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.startsWith("~")
  ) {
    return true;
  }

  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return true;
  }

  return value.includes("/") || value.includes("\\");
}

function hasPackageLikeExtension(value: string): boolean {
  const extension = path.extname(value).toLowerCase();
  return extension ? PACKAGE_FILE_EXTENSIONS.has(extension) : false;
}

function extractUriPathName(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

export function shouldUseRegistryInstall(
  source: string
): boolean {
  const value = source.trim();
  if (!value) {
    return false;
  }

  const baseName = path.basename(value).toLowerCase();
  if (MANIFEST_FILE_NAMES.has(baseName) || baseName.includes(".hub.")) {
    return false;
  }

  if (isUriSource(value)) {
    return false;
  }

  if (isPathLike(value)) {
    return false;
  }

  if (hasPackageLikeExtension(value)) {
    return false;
  }

  return true;
}

export function shouldUseManifestInstall(source: string): boolean {
  const value = source.trim();
  if (!value) {
    return false;
  }

  if (shouldUseRegistryInstall(value)) {
    return false;
  }

  const normalizedPath = isUriSource(value) ? extractUriPathName(value) : value;
  const baseName = path.basename(normalizedPath).toLowerCase();
  if (MANIFEST_FILE_NAMES.has(baseName)) {
    return true;
  }

  if (baseName.includes(".hub.")) {
    return true;
  }

  return false;
}

export function detectInstallMode(source: string): InstallMode {
  if (shouldUseRegistryInstall(source)) {
    return "registry";
  }

  if (shouldUseManifestInstall(source)) {
    return "manifest";
  }

  return "package";
}
