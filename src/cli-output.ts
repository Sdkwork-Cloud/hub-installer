import type {
  ApplyManifestResult,
  BackupManifestResult,
  UninstallManifestResult
} from "./manifest";

function truncateForDisplay(value: string, maxLength = 600): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export function formatApplyResult(result: ApplyManifestResult): string {
  const lines: string[] = [];
  lines.push(`Manifest: ${result.manifestName}`);
  lines.push(`Path: ${result.manifestPath}`);
  lines.push(`Source Input: ${result.manifestSourceInput}`);
  lines.push(`Source Kind: ${result.manifestSourceKind}`);
  lines.push(`Platform: ${result.platform}`);
  lines.push(`Installer Home: ${result.installerHome}`);
  lines.push(`Install Scope: ${result.resolvedInstallScope}`);
  lines.push(`Install Root: ${result.resolvedInstallRoot}`);
  lines.push(`Work Root: ${result.resolvedWorkRoot}`);
  lines.push(`Bin Dir: ${result.resolvedBinDir}`);
  lines.push(`Data Root: ${result.resolvedDataRoot}`);
  lines.push(`Install Control: ${result.installControlLevel}`);
  lines.push(`Effective Runtime: ${result.effectiveRuntimePlatform}`);
  if (result.containerRuntime) {
    lines.push(`Container Runtime: ${result.containerRuntime}`);
  }
  if (result.wslDistribution) {
    lines.push(`WSL Distribution: ${result.wslDistribution}`);
  }
  lines.push(`Success: ${result.success ? "yes" : "no"}`);
  lines.push(`Duration: ${result.durationMs}ms`);
  if (!result.success) {
    const firstFailedStage = result.stageReports.find((stage) => !stage.success);
    const firstFailedArtifact = result.artifactReports.find((artifact) => !artifact.success);
    if (firstFailedStage) {
      lines.push(
        `Failure: stage "${firstFailedStage.stage}" (${firstFailedStage.failedSteps} failed steps)`
      );
    } else if (firstFailedArtifact) {
      lines.push(`Failure: artifact "${firstFailedArtifact.artifactId}" (${firstFailedArtifact.artifactType})`);
    }
  }
  lines.push("");
  lines.push("Lifecycle:");

  for (const stage of result.stageReports) {
    const status = stage.success ? "OK" : "FAILED";
    lines.push(
      `  - [${status}] ${stage.stage} (${stage.totalSteps} steps, ${stage.failedSteps} failed, ${stage.durationMs}ms)`
    );
  }

  lines.push("");
  lines.push("Artifacts:");
  for (const artifact of result.artifactReports) {
    const status = artifact.success ? "OK" : "FAILED";
    lines.push(`  - [${status}] ${artifact.artifactId} (${artifact.artifactType}, ${artifact.durationMs}ms)`);
    if (artifact.detail) {
      lines.push(`    ${truncateForDisplay(artifact.detail)}`);
    }
  }

  return lines.join("\n");
}

export function formatBackupResult(result: BackupManifestResult): string {
  const lines: string[] = [];
  lines.push(`Manifest: ${result.manifestName}`);
  lines.push(`Path: ${result.manifestPath}`);
  lines.push(`Source Input: ${result.manifestSourceInput}`);
  lines.push(`Source Kind: ${result.manifestSourceKind}`);
  lines.push(`Platform: ${result.platform}`);
  lines.push(`Installer Home: ${result.installerHome}`);
  lines.push(`Install Scope: ${result.resolvedInstallScope}`);
  lines.push(`Install Root: ${result.resolvedInstallRoot}`);
  lines.push(`Work Root: ${result.resolvedWorkRoot}`);
  lines.push(`Bin Dir: ${result.resolvedBinDir}`);
  lines.push(`Data Root: ${result.resolvedDataRoot}`);
  lines.push(`Install Control: ${result.installControlLevel}`);
  lines.push(`Effective Runtime: ${result.effectiveRuntimePlatform}`);
  if (result.containerRuntime) {
    lines.push(`Container Runtime: ${result.containerRuntime}`);
  }
  if (result.wslDistribution) {
    lines.push(`WSL Distribution: ${result.wslDistribution}`);
  }
  lines.push(`Install Record: ${result.installRecordFile}`);
  lines.push(`Backup Session: ${result.backupSessionDir}`);
  lines.push(`Success: ${result.success ? "yes" : "no"}`);
  lines.push(`Duration: ${result.durationMs}ms`);
  lines.push("");
  lines.push("Lifecycle:");

  for (const stage of result.stageReports) {
    const status = stage.success ? "OK" : "FAILED";
    lines.push(
      `  - [${status}] ${stage.stage} (${stage.totalSteps} steps, ${stage.failedSteps} failed, ${stage.durationMs}ms)`
    );
  }

  lines.push("");
  lines.push("Targets:");
  for (const target of result.targetReports) {
    lines.push(`  - [${target.status.toUpperCase()}] ${target.target}`);
  }

  return lines.join("\n");
}

export function formatUninstallResult(result: UninstallManifestResult): string {
  const lines: string[] = [];
  lines.push(`Manifest: ${result.manifestName}`);
  lines.push(`Path: ${result.manifestPath}`);
  lines.push(`Source Input: ${result.manifestSourceInput}`);
  lines.push(`Source Kind: ${result.manifestSourceKind}`);
  lines.push(`Platform: ${result.platform}`);
  lines.push(`Installer Home: ${result.installerHome}`);
  lines.push(`Install Scope: ${result.resolvedInstallScope}`);
  lines.push(`Install Root: ${result.resolvedInstallRoot}`);
  lines.push(`Work Root: ${result.resolvedWorkRoot}`);
  lines.push(`Bin Dir: ${result.resolvedBinDir}`);
  lines.push(`Data Root: ${result.resolvedDataRoot}`);
  lines.push(`Install Control: ${result.installControlLevel}`);
  lines.push(`Effective Runtime: ${result.effectiveRuntimePlatform}`);
  if (result.containerRuntime) {
    lines.push(`Container Runtime: ${result.containerRuntime}`);
  }
  if (result.wslDistribution) {
    lines.push(`WSL Distribution: ${result.wslDistribution}`);
  }
  lines.push(`Install Record: ${result.installRecordFile}`);
  lines.push(`Purge Data: ${result.purgeData ? "yes" : "no"}`);
  lines.push(`Success: ${result.success ? "yes" : "no"}`);
  lines.push(`Duration: ${result.durationMs}ms`);
  if (result.backupResult) {
    lines.push(`Backup Session: ${result.backupResult.backupSessionDir}`);
  }
  lines.push("");
  lines.push("Lifecycle:");

  for (const stage of result.stageReports) {
    const status = stage.success ? "OK" : "FAILED";
    lines.push(
      `  - [${status}] ${stage.stage} (${stage.totalSteps} steps, ${stage.failedSteps} failed, ${stage.durationMs}ms)`
    );
  }

  lines.push("");
  lines.push("Targets:");
  for (const target of result.targetReports) {
    lines.push(`  - [${target.status.toUpperCase()}] ${target.target}`);
  }

  return lines.join("\n");
}

export function formatRegistryInstallResult(payload: {
  registrySourceInput: string;
  registryResolvedPath: string;
  registryName: string;
  registryVersion?: string;
  softwareName: string;
  manifestSource: string;
  applyResult: ApplyManifestResult;
}): string {
  const lines: string[] = [];
  lines.push(`Registry: ${payload.registryName}`);
  lines.push(`Registry Source Input: ${payload.registrySourceInput}`);
  lines.push(`Registry Resolved Path: ${payload.registryResolvedPath}`);
  lines.push(`Registry Version: ${payload.registryVersion ?? "n/a"}`);
  lines.push(`Software: ${payload.softwareName}`);
  lines.push(`Manifest Source: ${payload.manifestSource}`);
  lines.push("");
  lines.push(formatApplyResult(payload.applyResult));
  return lines.join("\n");
}

export function formatRegistryBackupResult(payload: {
  registrySourceInput: string;
  registryResolvedPath: string;
  registryName: string;
  registryVersion?: string;
  softwareName: string;
  manifestSource: string;
  backupResult: BackupManifestResult;
}): string {
  const lines: string[] = [];
  lines.push(`Registry: ${payload.registryName}`);
  lines.push(`Registry Source Input: ${payload.registrySourceInput}`);
  lines.push(`Registry Resolved Path: ${payload.registryResolvedPath}`);
  lines.push(`Registry Version: ${payload.registryVersion ?? "n/a"}`);
  lines.push(`Software: ${payload.softwareName}`);
  lines.push(`Manifest Source: ${payload.manifestSource}`);
  lines.push("");
  lines.push(formatBackupResult(payload.backupResult));
  return lines.join("\n");
}

export function formatRegistryUninstallResult(payload: {
  registrySourceInput: string;
  registryResolvedPath: string;
  registryName: string;
  registryVersion?: string;
  softwareName: string;
  manifestSource: string;
  uninstallResult: UninstallManifestResult;
}): string {
  const lines: string[] = [];
  lines.push(`Registry: ${payload.registryName}`);
  lines.push(`Registry Source Input: ${payload.registrySourceInput}`);
  lines.push(`Registry Resolved Path: ${payload.registryResolvedPath}`);
  lines.push(`Registry Version: ${payload.registryVersion ?? "n/a"}`);
  lines.push(`Software: ${payload.softwareName}`);
  lines.push(`Manifest Source: ${payload.manifestSource}`);
  lines.push("");
  lines.push(formatUninstallResult(payload.uninstallResult));
  return lines.join("\n");
}
