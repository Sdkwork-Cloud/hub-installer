import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSoftwareFromRegistry } from "./service";
import type { RuntimeProbe } from "../core/runtime";

const registryPath = path.resolve(process.cwd(), "registry", "software-registry.yaml");

describe("installSoftwareFromRegistry install policy", () => {
  it("propagates install policy overrides and software identity into apply results", async () => {
    const result = await installSoftwareFromRegistry("codex", {
      registrySource: registryPath,
      platform: "ubuntu",
      dryRun: true,
      installerHome: "/home/tester/.sdkwork/hub-installer",
      installScope: "system"
    });

    expect(result.applyResult).toMatchObject({
      installerHome: "/home/tester/.sdkwork/hub-installer",
      resolvedInstallScope: "system",
      resolvedInstallRoot: "/opt/codex",
      resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
      resolvedBinDir: "/usr/local/bin",
      resolvedDataRoot: "/var/lib/codex",
      effectiveRuntimePlatform: "ubuntu"
    });
  });

  it("reports Codex on Windows as a WSL-targeted runtime", async () => {
    const runtimeProbe: RuntimeProbe = {
      commandExists: () => true,
      listWslDistros: () => ["Ubuntu-22.04"],
      wslCommandExists: (distribution, command) =>
        distribution === "Ubuntu-22.04" && command === "bash",
      dockerAvailableOnHost: () => false,
      wslDockerAvailable: () => false,
      wslHomeDir: () => "/home/tester"
    };
    const result = await installSoftwareFromRegistry("codex", {
      registrySource: registryPath,
      platform: "windows",
      dryRun: true,
      installScope: "user",
      runtimeProbe
    });

    expect(result.applyResult).toMatchObject({
      effectiveRuntimePlatform: "wsl",
      resolvedInstallScope: "user",
      installerHome: "/home/tester/.sdkwork/hub-installer",
      resolvedInstallRoot: "/home/tester/.local/opt/codex",
      resolvedWorkRoot: "/home/tester/.sdkwork/hub-installer/state/sources/codex",
      resolvedBinDir: "/home/tester/.local/bin",
      resolvedDataRoot: "/home/tester/.local/share/codex"
    });
  });
});
