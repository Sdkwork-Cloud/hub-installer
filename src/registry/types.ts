import type {
  ApplyManifestOptions,
  ApplyManifestResult,
  BackupManifestOptions,
  BackupManifestResult,
  UninstallManifestOptions,
  UninstallManifestResult
} from "../manifest/types";
import type { SupportedPlatform } from "../types";

export const SOFTWARE_REGISTRY_SCHEMA_VERSION = "1.0" as const;
export type SoftwareRegistrySchemaVersion = typeof SOFTWARE_REGISTRY_SCHEMA_VERSION;

export interface RegistryManifestByPlatform {
  byPlatform: Partial<Record<SupportedPlatform, string>>;
  fallback?: string;
}

export type RegistryManifestSource = string | RegistryManifestByPlatform;

export interface SoftwareRegistryEntry {
  name: string;
  aliases?: string[];
  description?: string;
  homepage?: string;
  tags?: string[];
  manifest: RegistryManifestSource;
  variables?: Record<string, string>;
}

export interface SoftwareRegistryMetadata {
  name: string;
  version?: string;
  updatedAt?: string;
}

export interface SoftwareRegistry {
  schemaVersion: SoftwareRegistrySchemaVersion;
  metadata: SoftwareRegistryMetadata;
  entries: SoftwareRegistryEntry[];
}

export interface LoadedSoftwareRegistry {
  registry: SoftwareRegistry;
  absolutePath: string;
  baseDirectory: string;
  sourceInput: string;
  sourceKind: "file" | "directory" | "url";
  resolvedFrom?: string;
}

export interface ResolveSoftwareEntryResult {
  entry: SoftwareRegistryEntry;
  manifestSource: string;
}

export interface RegistryInstallOptions extends ApplyManifestOptions {
  registrySource?: string;
  registryCacheDir?: string;
  registryFetchTimeoutMs?: number;
}

export interface RegistryBackupOptions extends BackupManifestOptions {
  registrySource?: string;
  registryCacheDir?: string;
  registryFetchTimeoutMs?: number;
}

export interface RegistryUninstallOptions extends UninstallManifestOptions {
  registrySource?: string;
  registryCacheDir?: string;
  registryFetchTimeoutMs?: number;
}

export interface RegistryInstallResult {
  registry: {
    sourceInput: string;
    resolvedPath: string;
    name: string;
    version?: string;
  };
  software: {
    name: string;
    aliases: string[];
    manifestSource: string;
  };
  applyResult: ApplyManifestResult;
}

export interface RegistryBackupResult {
  registry: {
    sourceInput: string;
    resolvedPath: string;
    name: string;
    version?: string;
  };
  software: {
    name: string;
    aliases: string[];
    manifestSource: string;
  };
  backupResult: BackupManifestResult;
}

export interface RegistryUninstallResult {
  registry: {
    sourceInput: string;
    resolvedPath: string;
    name: string;
    version?: string;
  };
  software: {
    name: string;
    aliases: string[];
    manifestSource: string;
  };
  uninstallResult: UninstallManifestResult;
}
