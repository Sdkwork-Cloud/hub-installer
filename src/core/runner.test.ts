import { describe, expect, it, vi } from "vitest";
import { executePlan, resolveCommandInvocationForTest } from "./runner";
import { HubInstallerError } from "../errors";
import type { InstallPlan, InstallStep } from "../types";

function createDryRunPlan(): InstallPlan {
  return {
    request: {
      source: "test://source",
      sourceRef: {
        kind: "file",
        path: "C:\\temp\\fake"
      },
      platform: "windows",
      format: "manager"
    },
    steps: [
      {
        id: "step-1",
        description: "first step",
        command: "echo hello",
        shell: true
      },
      {
        id: "step-2",
        description: "second step",
        command: "echo world",
        shell: true
      }
    ],
    notes: []
  };
}

describe("executePlan progress output", () => {
  it("prints step progress when progress output is enabled", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output: string[] = [];
    try {
      await executePlan(createDryRunPlan(), {
        dryRun: true,
        progress: true
      });
      output = logSpy.mock.calls.map((call) => String(call[0] ?? ""));
    } finally {
      logSpy.mockRestore();
    }

    expect(output.some((line) => line.includes("[RUN] [1/2] first step"))).toBe(true);
    expect(output.some((line) => line.includes("[OK] [1/2] first step"))).toBe(true);
    expect(output.some((line) => line.includes("[RUN] [2/2] second step"))).toBe(true);
    expect(output.some((line) => line.includes("[OK] [2/2] second step"))).toBe(true);
  });

  it("does not print progress when progress output is disabled", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let output: string[] = [];
    try {
      await executePlan(createDryRunPlan(), {
        dryRun: true,
        progress: false
      });
      output = logSpy.mock.calls.map((call) => String(call[0] ?? ""));
    } finally {
      logSpy.mockRestore();
    }

    expect(output.some((line) => line.includes("[RUN] [1/2] first step"))).toBe(false);
    expect(output.some((line) => line.includes("[OK] [1/2] first step"))).toBe(false);
  });

  it("returns actionable spawn diagnostics when command cannot be started", async () => {
    const plan: InstallPlan = {
      request: {
        source: "test://source",
        sourceRef: {
          kind: "file",
          path: "C:\\temp\\fake"
        },
        platform: "windows",
        format: "manager"
      },
      steps: [
        {
          id: "missing-cmd",
          description: "missing executable",
          command: "hub-installer-definitely-missing-executable"
        }
      ],
      notes: []
    };

    const error = await executePlan(plan, {
      dryRun: false,
      progress: false
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(HubInstallerError);
    const installerError = error as HubInstallerError;
    expect(installerError.code).toBe("COMMAND_SPAWN_FAILED");
    expect(installerError.message).toContain("spawn error:");
    expect(
      installerError.message.includes("command not found in PATH") ||
        installerError.message.includes("permission denied by host policy or sandbox")
    ).toBe(true);
  });

  it("wraps WSL-targeted steps with wsl.exe and injects runtime Docker context", () => {
    const step: InstallStep = {
      id: "step-1",
      description: "run in wsl",
      command: "echo hello",
      shell: true,
      workingDirectory: "C:\\work\\demo",
      env: {
        OPENCLAW_MODE: "docker"
      }
    };

    const invocation = resolveCommandInvocationForTest(step, "windows", {
      executionContext: {
        hostPlatform: "windows",
        targetPlatform: "windows",
        effectiveRuntimePlatform: "wsl",
        containerRuntime: "host",
        wslDistribution: "Ubuntu-22.04",
        dockerContext: "desktop-linux",
        dockerHost: "npipe:////./pipe/docker_engine",
        runtimeHomeDir: "/home/tester"
      }
    });

    expect(invocation.program).toBe("wsl.exe");
    expect(invocation.args.slice(0, 5)).toEqual([
      "-d",
      "Ubuntu-22.04",
      "--",
      "bash",
      "-lc"
    ]);
    expect(invocation.args[5]).toContain("export OPENCLAW_MODE='docker'");
    expect(invocation.args[5]).toContain("export DOCKER_CONTEXT='desktop-linux'");
    expect(invocation.args[5]).toContain("export DOCKER_HOST='npipe:////./pipe/docker_engine'");
    expect(invocation.args[5]).toContain("cd '/mnt/c/work/demo'");
    expect(invocation.args[5]).toContain("echo hello");
  });

  it("keeps explicit PowerShell steps on the host even when the runtime is WSL", () => {
    const step: InstallStep = {
      id: "step-1",
      description: "run on host",
      command: "Write-Host 'hello'",
      shell: true,
      shellKind: "powershell"
    };

    const invocation = resolveCommandInvocationForTest(step, "windows", {
      executionContext: {
        hostPlatform: "windows",
        targetPlatform: "windows",
        effectiveRuntimePlatform: "wsl",
        containerRuntime: "host",
        wslDistribution: "Ubuntu-22.04",
        runtimeHomeDir: "/home/tester"
      }
    });

    expect(invocation.program).toBe("powershell");
    expect(invocation.args).toEqual([
      "-NoProfile",
      "-Command",
      "Write-Host 'hello'"
    ]);
  });
});
