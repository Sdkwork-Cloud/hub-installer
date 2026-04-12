import { HubInstallerError } from "../errors";
import { getPlatformAdapter } from "../platforms";
import type {
  InstallExecutionResult,
  InstallPlan,
  InstallRequest,
  PackageFormat,
  ResolvedInstallRequest,
  SourceReference,
  SupportedPlatform
} from "../types";
import { downloadRemoteFile, isRemoteHttpFile } from "./download";
import { detectHostPlatform } from "./platform";
import { pickDefined } from "./pick-defined";
import { executePlan } from "./runner";
import { detectPackageFormat, resolveSourceReference } from "./source";

async function resolveRequest(request: InstallRequest): Promise<ResolvedInstallRequest> {
  if (!request.source || !request.source.trim()) {
    throw new HubInstallerError("INVALID_SOURCE", "Request source is required.");
  }

  const sourceRef: SourceReference = resolveSourceReference(request.source);
  const platform: SupportedPlatform = request.platform ?? detectHostPlatform();
  const format: PackageFormat = detectPackageFormat(request.source, sourceRef, request.format);
  let resolvedSourceRef: SourceReference = sourceRef;

  // Remote package files are downloaded to local cache before installation.
  if (
    sourceRef.kind === "file" &&
    isRemoteHttpFile(sourceRef.path) &&
    !request.dryRun &&
    format !== "manager"
  ) {
    const downloadedPath = await downloadRemoteFile(
      sourceRef.path,
      pickDefined({
        cacheDir: request.downloadCacheDir,
        timeoutMs: request.downloadTimeoutMs,
        expectedChecksum: request.sourceChecksum
      })
    );
    resolvedSourceRef = {
      kind: "file",
      path: downloadedPath
    };
  }

  return {
    ...request,
    source: request.source,
    platform,
    format,
    sourceRef: resolvedSourceRef
  };
}

export class InstallerEngine {
  public async createPlan(request: InstallRequest): Promise<InstallPlan> {
    const resolved = await resolveRequest(request);
    const adapter = getPlatformAdapter(resolved.platform);

    if (!adapter.supportedFormats.includes(resolved.format)) {
      throw new HubInstallerError(
        "UNSUPPORTED_FORMAT",
        `Format "${resolved.format}" is not supported on "${resolved.platform}".`
      );
    }

    return adapter.createPlan(resolved);
  }

  public async install(request: InstallRequest): Promise<InstallExecutionResult> {
    const plan = await this.createPlan(request);
    return executePlan(
      plan,
      pickDefined({
        dryRun: request.dryRun,
        verbose: request.verbose,
        progress: request.progress,
        timeoutMs: request.timeoutMs,
        sudo: request.sudo
      })
    );
  }
}
