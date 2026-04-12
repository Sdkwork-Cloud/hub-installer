import { HubInstallerError } from "../errors";
import { SUPPORTED_PLATFORMS } from "../types";
import {
  SOFTWARE_REGISTRY_SCHEMA_VERSION,
  type RegistryManifestByPlatform,
  type RegistryManifestSource,
  type SoftwareRegistry,
  type SoftwareRegistryEntry,
  type SoftwareRegistryMetadata
} from "./types";

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new HubInstallerError("INVALID_REGISTRY", message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, fieldPath: string): UnknownRecord {
  if (!isRecord(value)) {
    fail(`${fieldPath} must be an object.`);
  }
  return value;
}

function expectString(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${fieldPath} must be a non-empty string.`);
  }
  return value;
}

function expectStringAllowEmpty(value: unknown, fieldPath: string): string {
  if (typeof value !== "string") {
    fail(`${fieldPath} must be a string.`);
  }
  return value;
}

function expectStringArray(value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${fieldPath} must be an array of strings.`);
  }
  return value.map((entry, index) => expectString(entry, `${fieldPath}[${index}]`));
}

function expectStringMap(value: unknown, fieldPath: string): Record<string, string> {
  const raw = expectRecord(value, fieldPath);
  const output: Record<string, string> = {};
  for (const [key, valueEntry] of Object.entries(raw)) {
    output[key] = expectStringAllowEmpty(valueEntry, `${fieldPath}.${key}`);
  }
  return output;
}

function parseRegistryMetadata(value: unknown): SoftwareRegistryMetadata {
  const raw = expectRecord(value, "metadata");
  const metadata: SoftwareRegistryMetadata = {
    name: expectString(raw.name, "metadata.name")
  };

  if (raw.version !== undefined) {
    metadata.version = expectString(raw.version, "metadata.version");
  }

  if (raw.updatedAt !== undefined) {
    metadata.updatedAt = expectString(raw.updatedAt, "metadata.updatedAt");
  }

  return metadata;
}

function parseManifestSource(value: unknown, fieldPath: string): RegistryManifestSource {
  if (typeof value === "string") {
    return expectString(value, fieldPath);
  }

  const raw = expectRecord(value, fieldPath);
  const byPlatformRaw = expectRecord(raw.byPlatform, `${fieldPath}.byPlatform`);
  const byPlatform: RegistryManifestByPlatform["byPlatform"] = {};

  for (const [platform, source] of Object.entries(byPlatformRaw)) {
    if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
      fail(`${fieldPath}.byPlatform contains unsupported platform "${platform}".`);
    }
    byPlatform[platform as (typeof SUPPORTED_PLATFORMS)[number]] = expectString(
      source,
      `${fieldPath}.byPlatform.${platform}`
    );
  }

  const output: RegistryManifestByPlatform = {
    byPlatform
  };

  if (raw.fallback !== undefined) {
    output.fallback = expectString(raw.fallback, `${fieldPath}.fallback`);
  }

  return output;
}

function parseEntry(value: unknown, fieldPath: string): SoftwareRegistryEntry {
  const raw = expectRecord(value, fieldPath);

  const entry: SoftwareRegistryEntry = {
    name: expectString(raw.name, `${fieldPath}.name`),
    manifest: parseManifestSource(raw.manifest, `${fieldPath}.manifest`)
  };

  if (raw.aliases !== undefined) {
    entry.aliases = expectStringArray(raw.aliases, `${fieldPath}.aliases`);
  }

  if (raw.description !== undefined) {
    entry.description = expectString(raw.description, `${fieldPath}.description`);
  }

  if (raw.homepage !== undefined) {
    entry.homepage = expectString(raw.homepage, `${fieldPath}.homepage`);
  }

  if (raw.tags !== undefined) {
    entry.tags = expectStringArray(raw.tags, `${fieldPath}.tags`);
  }

  if (raw.variables !== undefined) {
    entry.variables = expectStringMap(raw.variables, `${fieldPath}.variables`);
  }

  return entry;
}

export function validateSoftwareRegistry(input: unknown): SoftwareRegistry {
  const raw = expectRecord(input, "registry");
  const schemaVersion = expectString(raw.schemaVersion, "schemaVersion");
  if (schemaVersion !== SOFTWARE_REGISTRY_SCHEMA_VERSION) {
    fail(
      `schemaVersion "${schemaVersion}" is unsupported. Expected "${SOFTWARE_REGISTRY_SCHEMA_VERSION}".`
    );
  }

  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    fail("entries must be a non-empty array.");
  }

  const registry: SoftwareRegistry = {
    schemaVersion: SOFTWARE_REGISTRY_SCHEMA_VERSION,
    metadata: parseRegistryMetadata(raw.metadata),
    entries: raw.entries.map((entry, index) => parseEntry(entry, `entries[${index}]`))
  };

  const seen = new Set<string>();
  for (const entry of registry.entries) {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) {
      fail(`Duplicate entry name "${entry.name}".`);
    }
    seen.add(key);
  }

  return registry;
}

