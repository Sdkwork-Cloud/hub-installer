import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { HubInstallerError } from "../errors";
import { pickDefined } from "../core/pick-defined";
import { resolveInstallerDirectories } from "../core/installer-home";
import type { LoadedSoftwareRegistry } from "./types";
import { validateSoftwareRegistry } from "./validate";

export const DEFAULT_REGISTRY_FILE_NAMES = [
  "software-registry.yaml",
  "software-registry.yml",
  "software-registry.json",
  "hub-software-registry.yaml",
  "hub-software-registry.yml",
  "hub-software-registry.json",
  "registry.yaml",
  "registry.yml",
  "registry.json"
] as const;

export interface LoadRegistryOptions {
  cacheDir?: string;
  fetchTimeoutMs?: number;
  registryFileNames?: string[];
}

function parseRegistryText(referencePath: string, text: string): unknown {
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
      "REGISTRY_PARSE_FAILED",
      `Failed to parse registry from: ${referencePath}`,
      error
    );
  }
}

export function getDefaultRegistryCacheDir(installerHomeOverride?: string): string {
  return resolveInstallerDirectories(
    pickDefined({
      installerHomeOverride
    })
  ).registryCacheDir;
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
  const baseName = sanitizeFileName(path.basename(parsed.pathname, ext) || "registry");
  return path.join(cacheDir, `${host}-${baseName}-${hash}${ext}`);
}

async function resolveDirectoryRegistryPath(
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
  const candidates = files.filter((file) =>
    /(^|[-_.])(registry).*\.((ya?ml)|json)$/i.test(file)
  );

  if (candidates.length === 1) {
    const onlyCandidate = candidates[0];
    if (onlyCandidate !== undefined) {
      return path.join(directory, onlyCandidate);
    }
  }

  throw new HubInstallerError(
    "REGISTRY_NOT_FOUND",
    `No registry file found in "${directory}". Tried: ${fileNames.join(", ")}`
  );
}

async function readAndValidateRegistry(input: {
  absolutePath: string;
  sourceInput: string;
  sourceKind: LoadedSoftwareRegistry["sourceKind"];
  resolvedFrom?: string;
}): Promise<LoadedSoftwareRegistry> {
  let text: string;
  try {
    text = await readFile(input.absolutePath, "utf8");
  } catch (error) {
    throw new HubInstallerError(
      "REGISTRY_READ_FAILED",
      `Failed to read registry file: ${input.absolutePath}`,
      error
    );
  }

  const parsed = parseRegistryText(input.absolutePath, text);
  const registry = validateSoftwareRegistry(parsed);

  return {
    registry,
    absolutePath: input.absolutePath,
    baseDirectory: path.dirname(input.absolutePath),
    sourceInput: input.sourceInput,
    sourceKind: input.sourceKind,
    ...pickDefined({
      resolvedFrom: input.resolvedFrom
    })
  };
}

async function downloadRemoteRegistry(
  url: string,
  options: LoadRegistryOptions
): Promise<LoadedSoftwareRegistry> {
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
      "REGISTRY_FETCH_FAILED",
      `Failed to download registry: ${url}`,
      error
    );
  }

  clearTimeout(timeoutHandle);

  if (!response.ok) {
    throw new HubInstallerError(
      "REGISTRY_FETCH_FAILED",
      `Failed to download registry: ${url} (HTTP ${response.status})`
    );
  }

  const text = await response.text();
  const cacheDir = path.resolve(
    options.cacheDir ?? getDefaultRegistryCacheDir(process.env.HUB_INSTALLER_HOME)
  );
  await mkdir(cacheDir, { recursive: true });
  const cachedPath = buildCacheFilePath(url, cacheDir);
  await writeFile(cachedPath, text, "utf8");

  return readAndValidateRegistry({
    absolutePath: cachedPath,
    sourceInput: url,
    sourceKind: "url",
    resolvedFrom: url
  });
}

export async function loadSoftwareRegistryFromFile(
  filePath: string
): Promise<LoadedSoftwareRegistry> {
  const absolutePath = path.resolve(filePath);
  const stats = await stat(absolutePath).catch(() => null);

  if (!stats || !stats.isFile()) {
    throw new HubInstallerError(
      "REGISTRY_NOT_FOUND",
      `Registry file does not exist: ${absolutePath}`
    );
  }

  return readAndValidateRegistry({
    absolutePath,
    sourceInput: filePath,
    sourceKind: "file"
  });
}

export async function loadSoftwareRegistryFromSource(
  source: string,
  options: LoadRegistryOptions = {}
): Promise<LoadedSoftwareRegistry> {
  const value = source.trim();
  if (!value) {
    throw new HubInstallerError("INVALID_SOURCE", "Registry source is required.");
  }

  if (isHttpUrl(value)) {
    return downloadRemoteRegistry(value, options);
  }

  if (isFileUrl(value)) {
    const filePath = fileURLToPath(value);
    return loadSoftwareRegistryFromSource(filePath, options);
  }

  const absolutePath = path.resolve(value);
  const stats = await stat(absolutePath).catch(() => null);
  if (!stats) {
    throw new HubInstallerError(
      "REGISTRY_NOT_FOUND",
      `Registry source not found: ${absolutePath}`
    );
  }

  if (stats.isDirectory()) {
    const fileNames = options.registryFileNames ?? [...DEFAULT_REGISTRY_FILE_NAMES];
    const registryPath = await resolveDirectoryRegistryPath(absolutePath, fileNames);
    return readAndValidateRegistry({
      absolutePath: registryPath,
      sourceInput: value,
      sourceKind: "directory",
      resolvedFrom: registryPath
    });
  }

  return readAndValidateRegistry({
    absolutePath,
    sourceInput: value,
    sourceKind: "file"
  });
}
