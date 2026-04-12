import { detectHostPlatform } from "../core/platform";
import { pickDefined } from "../core/pick-defined";
import {
  applyManifestFile,
  backupManifestFile,
  uninstallManifestFile
} from "../manifest/executor";
import type {
  ApplyManifestOptions,
  BackupManifestOptions,
  UninstallManifestOptions
} from "../manifest/types";
import type { ContainerRuntimePreference } from "../core/runtime";
import type { SupportedPlatform } from "../types";
import { loadSoftwareRegistryFromSource } from "./loader";
import { getDefaultRegistrySource, resolveSoftwareEntry } from "./resolver";
import type {
  LoadedSoftwareRegistry,
  RegistryBackupOptions,
  RegistryBackupResult,
  RegistryInstallOptions,
  RegistryInstallResult,
  RegistryUninstallOptions,
  RegistryUninstallResult,
  SoftwareRegistryEntry
} from "./types";

function mergeVariables(
  entry: SoftwareRegistryEntry,
  options: {
    variables?: Record<string, string>;
  }
): Record<string, string> | undefined {
  if (!entry.variables && !options.variables) {
    return undefined;
  }

  return {
    ...(entry.variables ?? {}),
    ...(options.variables ?? {})
  };
}

function resolveEffectiveRuntimePlatform(
  entry: SoftwareRegistryEntry,
  platform: SupportedPlatform
): ApplyManifestOptions["effectiveRuntimePlatform"] | undefined {
  if (entry.name === "codex" && platform === "windows") {
    return "wsl";
  }

  return undefined;
}

function resolveContainerRuntimePreference(
  value: string | undefined
): ContainerRuntimePreference | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "auto" || value === "host" || value === "wsl") {
    return value;
  }

  return undefined;
}

function buildRegistryMetadata(lookup: {
  loadedRegistry: LoadedSoftwareRegistry;
  entry: SoftwareRegistryEntry;
  manifestSource: string;
}) {
  return {
    registry: {
      sourceInput: lookup.loadedRegistry.sourceInput,
      resolvedPath: lookup.loadedRegistry.absolutePath,
      name: lookup.loadedRegistry.registry.metadata.name,
      ...pickDefined({
        version: lookup.loadedRegistry.registry.metadata.version
      })
    },
    software: {
      name: lookup.entry.name,
      aliases: lookup.entry.aliases ?? [],
      manifestSource: lookup.manifestSource
    }
  };
}

function buildApplyOptions(
  lookup: {
    entry: SoftwareRegistryEntry;
    manifestSource: string;
    platform: SupportedPlatform;
  },
  options: RegistryInstallOptions
): ApplyManifestOptions {
  const mergedVariables = mergeVariables(lookup.entry, options);

  return {
    platform: lookup.platform,
    ...pickDefined({
      dryRun: options.dryRun,
      verbose: options.verbose,
      progress: options.progress,
      sudo: options.sudo,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      softwareName: options.softwareName ?? mergedVariables?.hub_software_name ?? lookup.entry.name,
      installerHome: options.installerHome,
      installScope: options.installScope,
      installRoot: options.installRoot,
      workRoot: options.workRoot,
      binDir: options.binDir,
      dataRoot: options.dataRoot,
      installControlLevel: options.installControlLevel,
      effectiveRuntimePlatform:
        options.effectiveRuntimePlatform ??
        resolveEffectiveRuntimePlatform(lookup.entry, lookup.platform),
      containerRuntime:
        options.containerRuntime ??
        resolveContainerRuntimePreference(mergedVariables?.hub_container_runtime_preference),
      wslDistribution:
        options.wslDistribution ?? mergedVariables?.hub_wsl_distribution,
      dockerContext:
        options.dockerContext ?? mergedVariables?.hub_docker_context,
      dockerHost:
        options.dockerHost ?? mergedVariables?.hub_docker_host,
      variables: mergedVariables,
      manifestCacheDir: options.manifestCacheDir,
      manifestFetchTimeoutMs: options.manifestFetchTimeoutMs,
      runtimeProbe: options.runtimeProbe
    })
  };
}

function buildBackupOptions(
  lookup: {
    entry: SoftwareRegistryEntry;
    platform: SupportedPlatform;
  },
  options: RegistryBackupOptions
): BackupManifestOptions {
  const mergedVariables = mergeVariables(lookup.entry, options);

  return {
    platform: lookup.platform,
    ...pickDefined({
      dryRun: options.dryRun,
      verbose: options.verbose,
      progress: options.progress,
      sudo: options.sudo,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      softwareName: options.softwareName ?? mergedVariables?.hub_software_name ?? lookup.entry.name,
      installerHome: options.installerHome,
      installScope: options.installScope,
      installRoot: options.installRoot,
      workRoot: options.workRoot,
      binDir: options.binDir,
      dataRoot: options.dataRoot,
      installControlLevel: options.installControlLevel,
      effectiveRuntimePlatform:
        options.effectiveRuntimePlatform ??
        resolveEffectiveRuntimePlatform(lookup.entry, lookup.platform),
      containerRuntime:
        options.containerRuntime ??
        resolveContainerRuntimePreference(mergedVariables?.hub_container_runtime_preference),
      wslDistribution:
        options.wslDistribution ?? mergedVariables?.hub_wsl_distribution,
      dockerContext:
        options.dockerContext ?? mergedVariables?.hub_docker_context,
      dockerHost:
        options.dockerHost ?? mergedVariables?.hub_docker_host,
      variables: mergedVariables,
      manifestCacheDir: options.manifestCacheDir,
      manifestFetchTimeoutMs: options.manifestFetchTimeoutMs,
      targets: options.targets,
      sessionId: options.sessionId,
      runtimeProbe: options.runtimeProbe
    })
  };
}

function buildUninstallOptions(
  lookup: {
    entry: SoftwareRegistryEntry;
    platform: SupportedPlatform;
  },
  options: RegistryUninstallOptions
): UninstallManifestOptions {
  const mergedVariables = mergeVariables(lookup.entry, options);

  return {
    platform: lookup.platform,
    ...pickDefined({
      dryRun: options.dryRun,
      verbose: options.verbose,
      progress: options.progress,
      sudo: options.sudo,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      softwareName: options.softwareName ?? mergedVariables?.hub_software_name ?? lookup.entry.name,
      installerHome: options.installerHome,
      installScope: options.installScope,
      installRoot: options.installRoot,
      workRoot: options.workRoot,
      binDir: options.binDir,
      dataRoot: options.dataRoot,
      installControlLevel: options.installControlLevel,
      effectiveRuntimePlatform:
        options.effectiveRuntimePlatform ??
        resolveEffectiveRuntimePlatform(lookup.entry, lookup.platform),
      containerRuntime:
        options.containerRuntime ??
        resolveContainerRuntimePreference(mergedVariables?.hub_container_runtime_preference),
      wslDistribution:
        options.wslDistribution ?? mergedVariables?.hub_wsl_distribution,
      dockerContext:
        options.dockerContext ?? mergedVariables?.hub_docker_context,
      dockerHost:
        options.dockerHost ?? mergedVariables?.hub_docker_host,
      variables: mergedVariables,
      manifestCacheDir: options.manifestCacheDir,
      manifestFetchTimeoutMs: options.manifestFetchTimeoutMs,
      purgeData: options.purgeData,
      backupBeforeUninstall: options.backupBeforeUninstall,
      backupTargets: options.backupTargets,
      backupSessionId: options.backupSessionId,
      runtimeProbe: options.runtimeProbe
    })
  };
}

export async function loadRegistry(
  source?: string,
  options?: {
    cacheDir?: string;
    fetchTimeoutMs?: number;
  }
): Promise<LoadedSoftwareRegistry> {
  const resolvedSource = source ?? getDefaultRegistrySource();
  return loadSoftwareRegistryFromSource(
    resolvedSource,
    pickDefined({
      cacheDir: options?.cacheDir,
      fetchTimeoutMs: options?.fetchTimeoutMs
    })
  );
}

export async function listRegistryEntries(
  source?: string,
  options?: {
    cacheDir?: string;
    fetchTimeoutMs?: number;
  }
): Promise<{
  loadedRegistry: LoadedSoftwareRegistry;
  entries: SoftwareRegistryEntry[];
}> {
  const loadedRegistry = await loadRegistry(source, options);
  const entries = [...loadedRegistry.registry.entries].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  return {
    loadedRegistry,
    entries
  };
}

export async function getRegistryEntry(
  softwareName: string,
  input: {
    platform?: SupportedPlatform;
    source?: string;
    cacheDir?: string;
    fetchTimeoutMs?: number;
  } = {}
): Promise<{
  loadedRegistry: LoadedSoftwareRegistry;
  entry: SoftwareRegistryEntry;
  manifestSource: string;
  platform: SupportedPlatform;
}> {
  const platform = input.platform ?? detectHostPlatform();
  const loadedRegistry = await loadRegistry(
    input.source,
    pickDefined({
      cacheDir: input.cacheDir,
      fetchTimeoutMs: input.fetchTimeoutMs
    })
  );
  const resolved = resolveSoftwareEntry(loadedRegistry, softwareName, platform);

  return {
    loadedRegistry,
    entry: resolved.entry,
    manifestSource: resolved.manifestSource,
    platform
  };
}

export async function installSoftwareFromRegistry(
  softwareName: string,
  options: RegistryInstallOptions = {}
): Promise<RegistryInstallResult> {
  const lookup = await getRegistryEntry(
    softwareName,
    pickDefined({
      platform: options.platform,
      source: options.registrySource,
      cacheDir: options.registryCacheDir,
      fetchTimeoutMs: options.registryFetchTimeoutMs
    })
  );
  const applyResult = await applyManifestFile(
    lookup.manifestSource,
    buildApplyOptions(lookup, options)
  );

  return {
    ...buildRegistryMetadata(lookup),
    applyResult
  };
}

export async function backupSoftwareFromRegistry(
  softwareName: string,
  options: RegistryBackupOptions = {}
): Promise<RegistryBackupResult> {
  const lookup = await getRegistryEntry(
    softwareName,
    pickDefined({
      platform: options.platform,
      source: options.registrySource,
      cacheDir: options.registryCacheDir,
      fetchTimeoutMs: options.registryFetchTimeoutMs
    })
  );
  const backupResult = await backupManifestFile(
    lookup.manifestSource,
    buildBackupOptions(lookup, options)
  );

  return {
    ...buildRegistryMetadata(lookup),
    backupResult
  };
}

export async function uninstallSoftwareFromRegistry(
  softwareName: string,
  options: RegistryUninstallOptions = {}
): Promise<RegistryUninstallResult> {
  const lookup = await getRegistryEntry(
    softwareName,
    pickDefined({
      platform: options.platform,
      source: options.registrySource,
      cacheDir: options.registryCacheDir,
      fetchTimeoutMs: options.registryFetchTimeoutMs
    })
  );
  const uninstallResult = await uninstallManifestFile(
    lookup.manifestSource,
    buildUninstallOptions(lookup, options)
  );

  return {
    ...buildRegistryMetadata(lookup),
    uninstallResult
  };
}
