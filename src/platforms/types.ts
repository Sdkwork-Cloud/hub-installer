import type {
  InstallPlan,
  PackageFormat,
  ResolvedInstallRequest,
  SupportedPlatform
} from "../types";

export interface PlatformAdapter {
  readonly platform: SupportedPlatform;
  readonly supportedFormats: readonly PackageFormat[];
  createPlan(request: ResolvedInstallRequest): InstallPlan;
}

