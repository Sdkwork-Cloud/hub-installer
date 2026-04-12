import { describe, expect, it } from "vitest";
import {
  resolveExecutionContextWithProbe,
  resolveHostPathForRuntime,
  type RuntimeProbe
} from "./runtime";

function createProbe(
  overrides: Partial<RuntimeProbe> = {}
): RuntimeProbe {
  return {
    commandExists: () => false,
    listWslDistros: () => [],
    wslCommandExists: () => false,
    dockerAvailableOnHost: () => false,
    wslDockerAvailable: () => false,
    wslHomeDir: () => undefined,
    ...overrides
  };
}

describe("resolveExecutionContextWithProbe", () => {
  it("prefers WSL execution when auto container runtime can use WSL Docker", () => {
    const context = resolveExecutionContextWithProbe(
      "windows",
      "windows",
      {
        containerRuntime: "auto"
      },
      createProbe({
        dockerAvailableOnHost: () => true,
        listWslDistros: () => ["Ubuntu-22.04"],
        wslCommandExists: (distribution, command) =>
          distribution === "Ubuntu-22.04" && command === "bash",
        wslDockerAvailable: (distribution) => distribution === "Ubuntu-22.04",
        wslHomeDir: () => "/home/tester"
      })
    );

    expect(context).toMatchObject({
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "wsl",
      wslDistribution: "Ubuntu-22.04",
      runtimeHomeDir: "/home/tester"
    });
  });

  it("allows WSL execution to target host Docker explicitly", () => {
    const context = resolveExecutionContextWithProbe(
      "windows",
      "windows",
      {
        effectiveRuntimePlatform: "wsl",
        containerRuntime: "host",
        wslDistribution: "Ubuntu-22.04"
      },
      createProbe({
        dockerAvailableOnHost: () => true,
        listWslDistros: () => ["Ubuntu-22.04"],
        wslCommandExists: (distribution, command) =>
          distribution === "Ubuntu-22.04" && command === "bash",
        wslHomeDir: () => "/home/tester"
      })
    );

    expect(context).toMatchObject({
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "host",
      wslDistribution: "Ubuntu-22.04"
    });
  });

  it("maps WSL runtime paths back to Windows host-accessible paths", () => {
    const hostPath = resolveHostPathForRuntime("/mnt/d/sdkwork/openclaw", {
      hostPlatform: "windows",
      targetPlatform: "windows",
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "wsl",
      wslDistribution: "Ubuntu-22.04",
      runtimeHomeDir: "/home/tester"
    });

    const uncPath = resolveHostPathForRuntime("/home/tester/.sdkwork/hub-installer", {
      hostPlatform: "windows",
      targetPlatform: "windows",
      effectiveRuntimePlatform: "wsl",
      containerRuntime: "wsl",
      wslDistribution: "Ubuntu-22.04",
      runtimeHomeDir: "/home/tester"
    });

    expect(hostPath).toBe("D:\\sdkwork\\openclaw");
    expect(uncPath).toBe("\\\\wsl$\\Ubuntu-22.04\\home\\tester\\.sdkwork\\hub-installer");
  });
});
