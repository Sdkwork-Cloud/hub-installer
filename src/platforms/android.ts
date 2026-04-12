import { HubInstallerError } from "../errors";
import type {
  InstallPlan,
  InstallStep,
  PackageFormat,
  ResolvedInstallRequest
} from "../types";
import { buildArchiveStepsForHost, ensureFileSource } from "./helpers";
import type { PlatformAdapter } from "./types";

const SUPPORTED_FORMATS = ["apk", "zip", "tar"] as const;

function createSteps(request: ResolvedInstallRequest): InstallStep[] {
  const installerArgs = request.installerArgs ?? [];

  switch (request.format) {
    case "apk": {
      const sourcePath = ensureFileSource(request);
      const args: string[] = [];

      if (request.androidDeviceId) {
        args.push("-s", request.androidDeviceId);
      }

      args.push("install", "-r", ...installerArgs, sourcePath);

      return [
        {
          id: "install-apk",
          description: "Install APK on Android device",
          command: "adb",
          args
        }
      ];
    }

    case "zip":
    case "tar": {
      const sourcePath = ensureFileSource(request);
      return buildArchiveStepsForHost(request, sourcePath);
    }

    default:
      throw new HubInstallerError(
        "UNSUPPORTED_FORMAT",
        `Format "${request.format}" is not supported on Android.`
      );
  }
}

export const androidAdapter: PlatformAdapter = {
  platform: "android",
  supportedFormats: SUPPORTED_FORMATS as readonly PackageFormat[],
  createPlan(request: ResolvedInstallRequest): InstallPlan {
    const notes = [
      "Requires Android SDK platform-tools (adb) and connected device or emulator."
    ];

    return {
      request,
      steps: createSteps(request),
      notes
    };
  }
};

