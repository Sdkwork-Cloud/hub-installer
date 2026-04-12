import { HubInstallerError } from "../errors";
import type {
  InstallPlan,
  InstallStep,
  PackageFormat,
  ResolvedInstallRequest
} from "../types";
import { buildUnixArchiveSteps, ensureFileSource, ensureManagerSource, quoteSh } from "./helpers";
import type { PlatformAdapter } from "./types";

const SUPPORTED_FORMATS = ["deb", "rpm", "appimage", "zip", "tar", "manager"] as const;

function createSteps(request: ResolvedInstallRequest): InstallStep[] {
  const installerArgs = request.installerArgs ?? [];
  const managerArgs = request.managerArgs ?? [];

  switch (request.format) {
    case "manager": {
      const managerSource = ensureManagerSource(request, ["apt", "snap"]);
      if (managerSource.manager === "apt") {
        return [
          {
            id: "install-apt",
            description: `Install package ${managerSource.packageName} via apt`,
            command: "apt-get",
            args: ["install", "-y", managerSource.packageName, ...managerArgs],
            requiresElevation: true
          }
        ];
      }

      if (managerSource.manager === "snap") {
        return [
          {
            id: "install-snap",
            description: `Install package ${managerSource.packageName} via snap`,
            command: "snap",
            args: ["install", managerSource.packageName, ...managerArgs],
            requiresElevation: true
          }
        ];
      }

      throw new HubInstallerError(
        "UNSUPPORTED_MANAGER",
        `Manager "${managerSource.manager}" is not supported on Ubuntu.`
      );
    }

    case "deb": {
      const sourcePath = ensureFileSource(request);
      return [
        {
          id: "install-deb",
          description: "Install DEB package",
          command: "dpkg",
          args: ["-i", sourcePath, ...installerArgs],
          requiresElevation: true
        },
        {
          id: "fix-dependencies",
          description: "Fix DEB dependencies",
          command: "apt-get",
          args: ["install", "-f", "-y"],
          requiresElevation: true
        }
      ];
    }

    case "rpm": {
      const sourcePath = ensureFileSource(request);
      return [
        {
          id: "install-alien",
          description: "Install alien conversion tool",
          command: "apt-get",
          args: ["update"],
          requiresElevation: true
        },
        {
          id: "install-alien-package",
          description: "Install alien package",
          command: "apt-get",
          args: ["install", "-y", "alien"],
          requiresElevation: true
        },
        {
          id: "install-rpm-with-alien",
          description: "Convert and install RPM package through alien",
          command: "alien",
          args: ["-i", sourcePath, ...installerArgs],
          requiresElevation: true
        }
      ];
    }

    case "appimage": {
      const sourcePath = ensureFileSource(request);
      const args = installerArgs.map(quoteSh).join(" ");
      return [
        {
          id: "run-appimage",
          description: "Run AppImage installer",
          command: `set -e; chmod +x ${quoteSh(sourcePath)}; ${quoteSh(sourcePath)}${args ? ` ${args}` : ""}`,
          shell: true
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
        `Format "${request.format}" is not supported on Ubuntu.`
      );
  }
}

export const ubuntuAdapter: PlatformAdapter = {
  platform: "ubuntu",
  supportedFormats: SUPPORTED_FORMATS as readonly PackageFormat[],
  createPlan(request: ResolvedInstallRequest): InstallPlan {
    const notes = [
      "Most package installations on Ubuntu require root privileges."
    ];

    return {
      request,
      steps: createSteps(request),
      notes
    };
  }
};

