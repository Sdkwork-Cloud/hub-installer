import { describe, expect, it } from "vitest";
import { collectInstallPolicyOptions } from "./cli-install-policy";

describe("collectInstallPolicyOptions", () => {
  it("collects install policy cli options into apply-manifest options", () => {
    expect(
      collectInstallPolicyOptions({
        config: "/workspace/config.json",
        installerHome: "/workspace/hub-home",
        installScope: "user",
        installRoot: "/workspace/apps/openclaw",
        workRoot: "/workspace/src/openclaw",
        binDir: "/workspace/bin",
        dataRoot: "/workspace/share/openclaw",
        effectiveRuntimePlatform: "wsl",
        containerRuntime: "host",
        wslDistribution: "Ubuntu-22.04",
        dockerContext: "desktop-linux",
        dockerHost: "npipe:////./pipe/docker_engine"
      })
    ).toEqual({
      configPath: "/workspace/config.json",
      installerHome: "/workspace/hub-home",
      installScope: "user",
      installRoot: "/workspace/apps/openclaw",
      workRoot: "/workspace/src/openclaw",
      binDir: "/workspace/bin",
      dataRoot: "/workspace/share/openclaw",
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "host",
      wslDistribution: "Ubuntu-22.04",
      dockerContext: "desktop-linux",
      dockerHost: "npipe:////./pipe/docker_engine"
    });
  });

  it("rejects invalid install policy cli values", () => {
    expect(() =>
      collectInstallPolicyOptions({
        installScope: "machine"
      })
    ).toThrowError(/install scope/i);

    expect(() =>
      collectInstallPolicyOptions({
        effectiveRuntimePlatform: "linux"
      })
    ).toThrowError(/runtime platform/i);

    expect(() =>
      collectInstallPolicyOptions({
        containerRuntime: "remote"
      })
    ).toThrowError(/container runtime/i);
  });
});
