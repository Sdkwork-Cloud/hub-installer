import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HubInstallerError } from "../errors";
import type { SupportedPlatform } from "../types";
import type {
  LoadedSoftwareRegistry,
  RegistryManifestSource,
  ResolveSoftwareEntryResult,
  SoftwareRegistryEntry
} from "./types";

const DEFAULT_REGISTRY_FILE_NAMES = [
  "software-registry.yaml",
  "software-registry.yml",
  "software-registry.json"
] as const;

function getCandidateBaseDirectories(input: { cwd: string; moduleUrl: string }): string[] {
  const moduleDirectory = path.dirname(fileURLToPath(input.moduleUrl));

  // Support both source layout (`src/registry`) and bundled layout (`dist`).
  const sourceRoot = path.resolve(moduleDirectory, "..", "..");
  const bundleRoot = path.resolve(moduleDirectory, "..");

  return [input.cwd, sourceRoot, bundleRoot];
}

function buildRegistryCandidatesForDirectory(baseDirectory: string): string[] {
  const candidates: string[] = [];

  for (const fileName of DEFAULT_REGISTRY_FILE_NAMES) {
    candidates.push(path.resolve(baseDirectory, "registry", fileName));
  }

  for (const fileName of DEFAULT_REGISTRY_FILE_NAMES) {
    candidates.push(path.resolve(baseDirectory, fileName));
  }

  return candidates;
}

function renderCandidateList(candidates: string[]): string {
  const limit = 8;
  const shown = candidates.slice(0, limit);
  const suffix =
    candidates.length > limit
      ? ` ... (+${candidates.length - limit} more)`
      : "";
  return `${shown.join(", ")}${suffix}`;
}

export function getDefaultRegistryCandidates(input?: {
  cwd?: string;
  moduleUrl?: string;
}): string[] {
  const cwd = input?.cwd ?? process.cwd();
  const moduleUrl = input?.moduleUrl ?? import.meta.url;
  const baseDirectories = getCandidateBaseDirectories({ cwd, moduleUrl });
  const deduped = new Set<string>();

  for (const baseDirectory of baseDirectories) {
    for (const candidate of buildRegistryCandidatesForDirectory(baseDirectory)) {
      deduped.add(candidate);
    }
  }

  return [...deduped];
}

export const DEFAULT_REGISTRY_CANDIDATES = getDefaultRegistryCandidates();

function isLikelyUrl(value: string): boolean {
  return /^(https?|file):\/\//i.test(value);
}

function normalizeSoftwareName(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSoftware(entry: SoftwareRegistryEntry, search: string): boolean {
  if (normalizeSoftwareName(entry.name) === search) {
    return true;
  }

  for (const alias of entry.aliases ?? []) {
    if (normalizeSoftwareName(alias) === search) {
      return true;
    }
  }

  return false;
}

function resolveManifestSourceByPlatform(
  manifestSource: RegistryManifestSource,
  platform: SupportedPlatform,
  softwareName: string
): string {
  if (typeof manifestSource === "string") {
    return manifestSource;
  }

  const selected = manifestSource.byPlatform[platform] ?? manifestSource.fallback;
  if (!selected) {
    throw new HubInstallerError(
      "REGISTRY_MANIFEST_MISSING",
      `Software "${softwareName}" has no manifest for platform "${platform}".`
    );
  }

  return selected;
}

function resolveManifestLocation(
  rawSource: string,
  loadedRegistry: LoadedSoftwareRegistry
): string {
  if (isLikelyUrl(rawSource) || path.isAbsolute(rawSource)) {
    return rawSource;
  }

  if (loadedRegistry.sourceKind === "url") {
    const base = loadedRegistry.resolvedFrom ?? loadedRegistry.sourceInput;
    return new URL(rawSource, base).toString();
  }

  return path.resolve(loadedRegistry.baseDirectory, rawSource);
}

export function resolveSoftwareEntry(
  loadedRegistry: LoadedSoftwareRegistry,
  softwareName: string,
  platform: SupportedPlatform
): ResolveSoftwareEntryResult {
  const key = normalizeSoftwareName(softwareName);
  const entry = loadedRegistry.registry.entries.find((candidate) =>
    matchesSoftware(candidate, key)
  );

  if (!entry) {
    throw new HubInstallerError(
      "REGISTRY_ENTRY_NOT_FOUND",
      `Software "${softwareName}" not found in registry "${loadedRegistry.absolutePath}".`
    );
  }

  const manifestSourceRaw = resolveManifestSourceByPlatform(
    entry.manifest,
    platform,
    entry.name
  );

  return {
    entry,
    manifestSource: resolveManifestLocation(manifestSourceRaw, loadedRegistry)
  };
}

export function getDefaultRegistrySource(input?: {
  cwd?: string;
  moduleUrl?: string;
}): string {
  const candidates = getDefaultRegistryCandidates(input);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new HubInstallerError(
    "REGISTRY_NOT_FOUND",
    `Default software registry not found. Tried: ${renderCandidateList(candidates)}. Use --registry to specify a registry source.`
  );
}
