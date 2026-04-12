import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { HubInstallerError } from "../errors";
import { resolveInstallerDirectories } from "./installer-home";
import { pickDefined } from "./pick-defined";

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function getDefaultPackageCacheDir(installerHomeOverride?: string): string {
  return resolveInstallerDirectories(
    pickDefined({
      installerHomeOverride
    })
  ).packageCacheDir;
}

function getCacheDir(cacheDir?: string): string {
  return path.resolve(
    cacheDir ?? getDefaultPackageCacheDir(process.env.HUB_INSTALLER_HOME)
  );
}

function buildCachedFilePath(url: string, cacheDir: string): string {
  const parsed = new URL(url);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const ext = path.extname(parsed.pathname) || ".bin";
  const fileName = sanitizeFileName(path.basename(parsed.pathname, ext) || "package");
  return path.join(cacheDir, `${fileName}-${hash}${ext}`);
}

export function isRemoteHttpFile(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeSha256(value: string): string {
  const raw = value.trim().toLowerCase();
  const normalized = raw.startsWith("sha256:") ? raw.slice("sha256:".length) : raw;
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new HubInstallerError(
      "INVALID_CHECKSUM",
      `Invalid checksum "${value}". Expected SHA-256 hex, optionally prefixed with "sha256:".`
    );
  }
  return normalized;
}

export async function downloadRemoteFile(url: string, options?: {
  cacheDir?: string;
  timeoutMs?: number;
  expectedChecksum?: string;
}): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 120000;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeoutHandle);
    throw new HubInstallerError(
      "REMOTE_DOWNLOAD_FAILED",
      `Failed to download remote package: ${url}`,
      error
    );
  }

  clearTimeout(timeoutHandle);

  if (!response.ok) {
    throw new HubInstallerError(
      "REMOTE_DOWNLOAD_FAILED",
      `Failed to download remote package: ${url} (HTTP ${response.status})`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (options?.expectedChecksum) {
    const expected = normalizeSha256(options.expectedChecksum);
    const actual = createHash("sha256").update(buffer).digest("hex").toLowerCase();
    if (actual !== expected) {
      throw new HubInstallerError(
        "CHECKSUM_MISMATCH",
        `Checksum mismatch for "${url}". Expected sha256:${expected}, got sha256:${actual}.`
      );
    }
  }
  const targetDir = getCacheDir(options?.cacheDir);
  await mkdir(targetDir, { recursive: true });
  const targetPath = buildCachedFilePath(url, targetDir);
  await writeFile(targetPath, buffer);
  return targetPath;
}
