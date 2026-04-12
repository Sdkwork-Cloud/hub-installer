import { HubInstallerError } from "../errors";
import type { SupportedPlatform } from "../types";
import { androidAdapter } from "./android";
import { iosAdapter } from "./ios";
import { macosAdapter } from "./macos";
import type { PlatformAdapter } from "./types";
import { ubuntuAdapter } from "./ubuntu";
import { windowsAdapter } from "./windows";

const ADAPTERS: Record<SupportedPlatform, PlatformAdapter> = {
  windows: windowsAdapter,
  macos: macosAdapter,
  ubuntu: ubuntuAdapter,
  android: androidAdapter,
  ios: iosAdapter
};

export function getPlatformAdapter(platform: SupportedPlatform): PlatformAdapter {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    throw new HubInstallerError(
      "UNSUPPORTED_PLATFORM",
      `No installer adapter registered for platform "${platform}".`
    );
  }
  return adapter;
}

