import { HubInstallerError } from "../errors";
import type {
  InstallPlan,
  InstallStep,
  PackageFormat,
  ResolvedInstallRequest
} from "../types";
import { buildArchiveStepsForHost, ensureFileSource } from "./helpers";
import type { PlatformAdapter } from "./types";

const SUPPORTED_FORMATS = ["ipa", "zip", "tar"] as const;

function createSteps(request: ResolvedInstallRequest): InstallStep[] {
  switch (request.format) {
    case "ipa": {
      const sourcePath = ensureFileSource(request);

      if (request.iosSimulator) {
        const target = request.iosDeviceId ?? "booted";
        return [
          {
            id: "install-ipa-simulator",
            description: `Install IPA to iOS simulator (${target})`,
            command: "xcrun",
            args: ["simctl", "install", target, sourcePath]
          }
        ];
      }

      const args: string[] = [];
      if (request.iosDeviceId) {
        args.push("-u", request.iosDeviceId);
      }
      args.push("-i", sourcePath);

      return [
        {
          id: "install-ipa-device",
          description: "Install IPA to iOS device",
          command: "ideviceinstaller",
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
        `Format "${request.format}" is not supported on iOS.`
      );
  }
}

export const iosAdapter: PlatformAdapter = {
  platform: "ios",
  supportedFormats: SUPPORTED_FORMATS as readonly PackageFormat[],
  createPlan(request: ResolvedInstallRequest): InstallPlan {
    const notes = [
      "Physical iOS installs require trusted device + development tooling (libimobiledevice or equivalent).",
      "Simulator installs require Xcode command line tools."
    ];

    return {
      request,
      steps: createSteps(request),
      notes
    };
  }
};

