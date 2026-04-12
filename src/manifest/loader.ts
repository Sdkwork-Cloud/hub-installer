import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { HubInstallerError } from "../errors";
import { pickDefined } from "../core/pick-defined";
import { resolveInstallerDirectories } from "../core/installer-home";
import type { LoadedManifest } from "./types";
import { validateManifest } from "./validate";

export const DEFAULT_MANIFEST_FILE_NAMES = [
  "hub-installer.yaml",
  "hub-installer.yml",
  "hub-installer.json",
  "hub.yaml",
  "hub.yml",
  "hub.json",
  "manifest.yaml",
  "manifest.yml",
  "manifest.json"
] as const;

export interface LoadManifestOptions {
  cacheDir?: string;
  fetchTimeoutMs?: number;
  manifestFileNames?: string[];
}

function parseManifestText(referencePath: string, text: string): unknown {
  const lowerPath = referencePath.toLowerCase();

  try {
    if (lowerPath.endsWith(".json")) {
      return JSON.parse(text) as unknown;
    }

    if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) {
      return YAML.parse(text) as unknown;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return YAML.parse(text) as unknown;
    }
  } catch (error) {
    throw new HubInstallerError(
      "MANIFEST_PARSE_FAILED",
      `Failed to parse manifest from: ${referencePath}`,
      error
    );
  }
}

export function getDefaultManifestCacheDir(installerHomeOverride?: string): string {
  return resolveInstallerDirectories(
    pickDefined({
      installerHomeOverride
    })
  ).manifestCacheDir;
}

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isFileUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "file:";
  } catch {
    return false;
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildCacheFilePath(url: string, cacheDir: string): string {
  const parsed = new URL(url);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const ext = path.extname(parsed.pathname) || ".yaml";
  const host = sanitizeFileName(parsed.host || "remote");
  const baseName = sanitizeFileName(path.basename(parsed.pathname, ext) || "manifest");
  const fileName = `${host}-${baseName}-${hash}${ext}`;
  return path.join(cacheDir, fileName);
}

async function resolveDirectoryManifestPath(
  directory: string,
  fileNames: string[]
): Promise<string> {
  for (const name of fileNames) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const files = await readdir(directory);
  const manifestCandidates = files.filter((file) =>
    /(^|[-_.])(hub|manifest).*\.((ya?ml)|json)$/i.test(file)
  );

  if (manifestCandidates.length === 1) {
    const onlyCandidate = manifestCandidates[0];
    if (onlyCandidate !== undefined) {
      return path.join(directory, onlyCandidate);
    }
  }

  throw new HubInstallerError(
    "MANIFEST_NOT_FOUND",
    `No manifest found in directory "${directory}". Tried: ${fileNames.join(", ")}`
  );
}

async function readAndValidateManifest(input: {
  absolutePath: string;
  sourceInput: string;
  sourceKind: LoadedManifest["sourceKind"];
  resolvedFrom?: string;
}): Promise<LoadedManifest> {
  let text: string;
  try {
    text = await readFile(input.absolutePath, "utf8");
  } catch (error) {
    throw new HubInstallerError(
      "MANIFEST_READ_FAILED",
      `Failed to read manifest file: ${input.absolutePath}`,
      error
    );
  }

  const parsed = parseManifestText(input.absolutePath, text);
  const manifest = validateManifest(parsed);

  return {
    manifest,
    absolutePath: input.absolutePath,
    baseDirectory: path.dirname(input.absolutePath),
    sourceInput: input.sourceInput,
    sourceKind: input.sourceKind,
    ...pickDefined({
      resolvedFrom: input.resolvedFrom
    })
  };
}

async function downloadRemoteManifest(
  url: string,
  options: LoadManifestOptions
): Promise<LoadedManifest> {
  const timeoutMs = options.fetchTimeoutMs ?? 30000;
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
      "MANIFEST_FETCH_FAILED",
      `Failed to download remote manifest: ${url}`,
      error
    );
  }

  clearTimeout(timeoutHandle);

  if (!response.ok) {
    throw new HubInstallerError(
      "MANIFEST_FETCH_FAILED",
      `Failed to download remote manifest: ${url} (HTTP ${response.status})`
    );
  }

  const text = await response.text();
  const cacheDir = path.resolve(
    options.cacheDir ?? getDefaultManifestCacheDir(process.env.HUB_INSTALLER_HOME)
  );
  await mkdir(cacheDir, { recursive: true });
  const cachedPath = buildCacheFilePath(url, cacheDir);
  await writeFile(cachedPath, text, "utf8");

  return readAndValidateManifest({
    absolutePath: cachedPath,
    sourceInput: url,
    sourceKind: "url",
    resolvedFrom: url
  });
}

export async function loadManifestFromFile(filePath: string): Promise<LoadedManifest> {
  const absolutePath = path.resolve(filePath);
  const stats = await stat(absolutePath).catch(() => null);

  if (!stats || !stats.isFile()) {
    throw new HubInstallerError(
      "MANIFEST_NOT_FOUND",
      `Manifest file does not exist: ${absolutePath}`
    );
  }

  return readAndValidateManifest({
    absolutePath,
    sourceInput: filePath,
    sourceKind: "file"
  });
}

export async function loadManifestFromSource(
  source: string,
  options: LoadManifestOptions = {}
): Promise<LoadedManifest> {
  const value = source.trim();
  if (!value) {
    throw new HubInstallerError("INVALID_SOURCE", "Manifest source is required.");
  }

  if (isHttpUrl(value)) {
    return downloadRemoteManifest(value, options);
  }

  if (isFileUrl(value)) {
    const filePath = fileURLToPath(value);
    return loadManifestFromSource(filePath, options);
  }

  const absolutePath = path.resolve(value);
  const stats = await stat(absolutePath).catch(() => null);

  if (!stats) {
    throw new HubInstallerError(
      "MANIFEST_NOT_FOUND",
      `Manifest source not found: ${absolutePath}`
    );
  }

  if (stats.isDirectory()) {
    const fileNames = options.manifestFileNames ?? [...DEFAULT_MANIFEST_FILE_NAMES];
    const manifestPath = await resolveDirectoryManifestPath(absolutePath, fileNames);
    const loaded = await readAndValidateManifest({
      absolutePath: manifestPath,
      sourceInput: value,
      sourceKind: "directory",
      resolvedFrom: manifestPath
    });
    return loaded;
  }

  return readAndValidateManifest({
    absolutePath,
    sourceInput: value,
    sourceKind: "file"
  });
}
