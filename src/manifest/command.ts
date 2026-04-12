import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import type { InstallStep, SupportedPlatform } from "../types";
import { pickDefined } from "../core/pick-defined";
import type { ExecutionContext } from "../core/runtime";
import { resolveHostPathForRuntime } from "../core/runtime";
import type { ManifestCommand, ManifestCondition, ManifestDefaults } from "./types";

function resolvePath(baseDirectory: string, target: string): string {
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.resolve(baseDirectory, target);
}

export async function commandExists(
  commandName: string,
  executionContext?: ExecutionContext
): Promise<boolean> {
  if (executionContext?.effectiveRuntimePlatform === "wsl") {
    const args = executionContext.wslDistribution
      ? [
          "-d",
          executionContext.wslDistribution,
          "--",
          "bash",
          "-lc",
          `command -v ${commandName} >/dev/null 2>&1`
        ]
      : ["--", "bash", "-lc", `command -v ${commandName} >/dev/null 2>&1`];

    return new Promise((resolve) => {
      const child = spawn("wsl.exe", args, {
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      });

      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    });
  }

  return new Promise((resolve) => {
    const probeCommand =
      process.platform === "win32"
        ? `where ${commandName}`
        : `command -v ${commandName} >/dev/null 2>&1`;

    const child = spawn(probeCommand, {
      shell: true,
      windowsHide: true,
      stdio: "ignore"
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });

    child.on("error", () => {
      resolve(false);
    });
  });
}

export async function conditionMatches(
  condition: ManifestCondition | undefined,
  context: {
    platform: SupportedPlatform;
    baseDirectory: string;
    executionContext?: ExecutionContext;
  }
): Promise<boolean> {
  if (!condition) {
    return true;
  }

  if (condition.platforms && !condition.platforms.includes(context.platform)) {
    return false;
  }

  if (condition.env) {
    for (const [key, expected] of Object.entries(condition.env)) {
      if ((process.env[key] ?? "") !== expected) {
        return false;
      }
    }
  }

  if (condition.commandExists) {
    const exists = await commandExists(condition.commandExists, context.executionContext);
    if (!exists) {
      return false;
    }
  }

  if (condition.fileExists) {
    const targetPath = context.executionContext
      ? resolveHostPathForRuntime(
          resolvePath(context.baseDirectory, condition.fileExists),
          context.executionContext
        )
      : resolvePath(context.baseDirectory, condition.fileExists);
    if (!existsSync(targetPath)) {
      return false;
    }
  }

  return true;
}

export function toInstallStep(
  command: ManifestCommand,
  context: {
    index: number;
    defaultCwd: string;
    defaults?: ManifestDefaults;
    baseDirectory: string;
  }
): InstallStep {
  const shell = command.shell ?? "auto";
  const id = command.id ?? `cmd-${context.index + 1}`;
  const description = command.description ?? command.id ?? `command-${context.index + 1}`;
  const workingDirectory = command.cwd
    ? resolvePath(context.baseDirectory, command.cwd)
    : context.defaultCwd;

  const common = {
    id,
    description,
    workingDirectory,
    env: {
      ...(context.defaults?.env ?? {}),
      ...(command.env ?? {})
    },
    continueOnError:
      command.continueOnError ?? context.defaults?.continueOnError ?? false,
    requiresElevation: command.elevated ?? false,
    ...pickDefined({
      timeoutMs: command.timeoutMs
    })
  } satisfies Partial<InstallStep>;

  if (shell === "bash") {
    return {
      ...common,
      command: "bash",
      args: ["-lc", command.run],
      shellKind: "bash"
    };
  }

  if (shell === "powershell") {
    return {
      ...common,
      command: "powershell",
      args: ["-NoProfile", "-Command", command.run],
      shellKind: "powershell"
    };
  }

  if (shell === "cmd") {
    return {
      ...common,
      command: "cmd",
      args: ["/d", "/s", "/c", command.run],
      shellKind: "cmd"
    };
  }

  return {
    ...common,
    command: command.run,
    shell: true
  };
}
