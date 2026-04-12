import { InstallerEngine } from "./core/engine";
import { detectHostPlatform } from "./core/platform";
import { detectPackageFormat, resolveSourceReference } from "./core/source";
import type {
  InstallExecutionResult,
  InstallPlan,
  InstallRequest,
  PackageFormat,
  SourceReference,
  SupportedPlatform
} from "./types";

export * from "./types";
export * from "./manifest";
export * from "./registry";
export * from "./core/runtime";
export { HubInstallerError } from "./errors";

export function createInstaller(): InstallerEngine {
  return new InstallerEngine();
}

const defaultEngine = new InstallerEngine();

export async function createInstallPlan(request: InstallRequest): Promise<InstallPlan> {
  return defaultEngine.createPlan(request);
}

export async function installPackage(request: InstallRequest): Promise<InstallExecutionResult> {
  return defaultEngine.install(request);
}

export function detectPlatform(): SupportedPlatform {
  return detectHostPlatform();
}

export function detectFormat(
  source: string,
  sourceRef?: SourceReference,
  explicitFormat?: PackageFormat
): PackageFormat {
  const resolved = sourceRef ?? resolveSourceReference(source);
  return detectPackageFormat(source, resolved, explicitFormat);
}
