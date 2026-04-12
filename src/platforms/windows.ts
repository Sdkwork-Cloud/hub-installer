import { HubInstallerError } from "../errors";
import type {
  InstallPlan,
  InstallStep,
  PackageFormat,
  ResolvedInstallRequest
} from "../types";
import {
  buildWindowsArchiveSteps,
  ensureFileSource,
  ensureManagerSource,
  quotePowerShell
} from "./helpers";
import type { PlatformAdapter } from "./types";

const SUPPORTED_FORMATS = ["exe", "msi", "msix", "zip", "tar", "manager"] as const;

function createSteps(request: ResolvedInstallRequest): InstallStep[] {
  const installerArgs = request.installerArgs ?? [];
  const managerArgs = request.managerArgs ?? [];

  switch (request.format) {
    case "manager": {
      const managerSource = ensureManagerSource(request, ["winget", "choco"]);
      if (managerSource.manager === "winget") {
        return [
          {
            id: "install-winget",
            description: `Install package ${managerSource.packageName} via winget`,
            command: "winget",
            args: [
              "install",
              "--id",
              managerSource.packageName,
              "--accept-package-agreements",
              "--accept-source-agreements",
              ...managerArgs
            ],
            requiresElevation: true
          }
        ];
      }

      if (managerSource.manager === "choco") {
        return [
          {
            id: "install-choco",
            description: `Install package ${managerSource.packageName} via Chocolatey`,
            command: "choco",
            args: ["install", managerSource.packageName, "-y", ...managerArgs],
            requiresElevation: true
          }
        ];
      }

      throw new HubInstallerError(
        "UNSUPPORTED_MANAGER",
        `Manager "${managerSource.manager}" is not supported on Windows.`
      );
    }

    case "exe": {
      const sourcePath = ensureFileSource(request);
      return [
        {
          id: "install-exe",
          description: "Install EXE package",
          command: sourcePath,
          args: installerArgs.length > 0 ? installerArgs : ["/quiet", "/norestart"],
          requiresElevation: true
        }
      ];
    }

    case "msi": {
      const sourcePath = ensureFileSource(request);
      return [
        {
          id: "install-msi",
          description: "Install MSI package",
          command: "msiexec",
          args: ["/i", sourcePath, "/qn", "/norestart", ...installerArgs],
          requiresElevation: true
        }
      ];
    }

    case "msix": {
      const sourcePath = ensureFileSource(request);
      const script = `Add-AppxPackage -Path ${quotePowerShell(sourcePath)}`;
      return [
        {
          id: "install-msix",
          description: "Install MSIX package",
          command: "powershell",
          args: ["-NoProfile", "-Command", script],
          requiresElevation: true
        }
      ];
    }

    case "zip":
    case "tar": {
      const sourcePath = ensureFileSource(request);
      return buildWindowsArchiveSteps(request, sourcePath);
    }

    default:
      throw new HubInstallerError(
        "UNSUPPORTED_FORMAT",
        `Format "${request.format}" is not supported on Windows.`
      );
  }
}

export const windowsAdapter: PlatformAdapter = {
  platform: "windows",
  supportedFormats: SUPPORTED_FORMATS as readonly PackageFormat[],
  createPlan(request: ResolvedInstallRequest): InstallPlan {
    const notes: string[] = [
      "Windows privileged operations require running terminal as Administrator."
    ];

    return {
      request,
      steps: createSteps(request),
      notes
    };
  }
};

