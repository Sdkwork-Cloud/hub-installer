import { existsSync, readFileSync } from "node:fs";
import { HubInstallerError } from "../errors";
import type { SupportedPlatform } from "../types";

function readLinuxOsRelease(): string {
  const releasePath = "/etc/os-release";
  if (!existsSync(releasePath)) {
    return "";
  }

  try {
    return readFileSync(releasePath, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

function detectLinuxPlatform(): SupportedPlatform {
  const osRelease = readLinuxOsRelease();

  if (osRelease.includes("ubuntu") || osRelease.includes("debian")) {
    return "ubuntu";
  }

  return "ubuntu";
}

export function detectHostPlatform(): SupportedPlatform {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return detectLinuxPlatform();
    default:
      throw new HubInstallerError(
        "UNSUPPORTED_HOST",
        `Unsupported host platform: ${process.platform}`
      );
  }
}

