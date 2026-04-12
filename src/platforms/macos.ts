import { HubInstallerError } from "../errors";
import type {
  InstallPlan,
  InstallStep,
  PackageFormat,
  ResolvedInstallRequest
} from "../types";
import { buildUnixArchiveSteps, ensureFileSource, ensureManagerSource, quoteSh } from "./helpers";
import type { PlatformAdapter } from "./types";

const SUPPORTED_FORMATS = ["pkg", "dmg", "zip", "tar", "manager"] as const;

function createDmgInstallCommand(sourcePath: string): string {
  return [
    "set -euo pipefail",
    `MOUNT=$(hdiutil attach ${quoteSh(sourcePath)} -nobrowse | awk 'END{print $3}')`,
    "PKG=$(find \"$MOUNT\" -maxdepth 2 -name \"*.pkg\" -print -quit)",
    "APP=$(find \"$MOUNT\" -maxdepth 2 -name \"*.app\" -print -quit)",
    "if [ -n \"$PKG\" ]; then",
    "  installer -pkg \"$PKG\" -target /",
    "elif [ -n \"$APP\" ]; then",
    "  cp -R \"$APP\" /Applications/",
    "else",
    "  echo \"No installable .pkg or .app found in DMG\" >&2",
    "  hdiutil detach \"$MOUNT\"",
    "  exit 1",
    "fi",
    "hdiutil detach \"$MOUNT\""
  ].join("; ");
}

function createSteps(request: ResolvedInstallRequest): InstallStep[] {
  const managerArgs = request.managerArgs ?? [];

  switch (request.format) {
    case "manager": {
      const managerSource = ensureManagerSource(request, ["brew"]);
      return [
        {
          id: "install-brew",
          description: `Install package ${managerSource.packageName} via Homebrew`,
          command: "brew",
          args: ["install", managerSource.packageName, ...managerArgs]
        }
      ];
    }

    case "pkg": {
      const sourcePath = ensureFileSource(request);
      return [
        {
          id: "install-pkg",
          description: "Install PKG package",
          command: "installer",
          args: ["-pkg", sourcePath, "-target", "/"],
          requiresElevation: true
        }
      ];
    }

    case "dmg": {
      const sourcePath = ensureFileSource(request);
      return [
        {
          id: "install-dmg",
          description: "Install DMG package",
          command: createDmgInstallCommand(sourcePath),
          shell: true,
          requiresElevation: true
        }
      ];
    }

    case "zip":
    case "tar": {
      const sourcePath = ensureFileSource(request);
      return buildUnixArchiveSteps(request, sourcePath);
    }

    default:
      throw new HubInstallerError(
        "UNSUPPORTED_FORMAT",
        `Format "${request.format}" is not supported on macOS.`
      );
  }
}

export const macosAdapter: PlatformAdapter = {
  platform: "macos",
  supportedFormats: SUPPORTED_FORMATS as readonly PackageFormat[],
  createPlan(request: ResolvedInstallRequest): InstallPlan {
    const notes = [
      "Many macOS installs require elevated privileges. Pass sudo: true or run as root."
    ];

    return {
      request,
      steps: createSteps(request),
      notes
    };
  }
};

