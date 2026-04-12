import { spawn, type ChildProcess } from "node:child_process";
import { HubInstallerError } from "../errors";
import type {
  InstallExecutionResult,
  InstallPlan,
  InstallStep,
  ShellKind,
  StepExecutionResult,
  SupportedPlatform
} from "../types";
import type { ExecutionContext } from "./runtime";
import { normalizePathForRuntime } from "./runtime";

function renderSpawnFailureMessage(
  commandLine: string,
  error: unknown
): string {
  const errnoError = error as NodeJS.ErrnoException | undefined;
  const code = errnoError?.code ?? "UNKNOWN";
  const parts = [
    `Failed to start command: ${commandLine}`,
    `spawn error: ${code}`
  ];

  if (code === "ENOENT") {
    parts.push(
      "command not found in PATH. Install the required runtime/tool and retry."
    );
  } else if (code === "EPERM") {
    parts.push(
      "permission denied by host policy or sandbox. Try elevated shell and check PowerShell execution policy / endpoint security restrictions."
    );
  } else if (code === "EACCES") {
    parts.push(
      "access denied. Ensure the command file is executable and current user has permission."
    );
  }

  return parts.join(" ");
}

function quoteArg(value: string): string {
  if (/^[a-zA-Z0-9._/\-=:]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function renderNonShellCommand(step: InstallStep): string {
  return [step.command, ...(step.args ?? [])].map(quoteArg).join(" ");
}

function shouldWrapWithSudo(
  executionContext: ExecutionContext | undefined,
  sudo: boolean,
  requiresElevation: boolean | undefined
): boolean {
  if (!sudo || !requiresElevation) {
    return false;
  }

  if (executionContext?.effectiveRuntimePlatform === "windows") {
    return false;
  }

  if (!executionContext) {
    return process.platform !== "win32";
  }

  return true;
}

function defaultShellKind(
  platform: SupportedPlatform,
  executionContext: ExecutionContext | undefined
): ShellKind {
  if (executionContext?.effectiveRuntimePlatform === "windows") {
    return "powershell";
  }

  if (executionContext?.effectiveRuntimePlatform) {
    return "bash";
  }

  return platform === "windows" ? "powershell" : "bash";
}

function renderShellDisplayCommand(
  program: string,
  args: string[]
): string {
  return [program, ...args.map(quoteArg)].join(" ");
}

function collectCommandEnv(
  step: InstallStep,
  executionContext: ExecutionContext | undefined
): Record<string, string> {
  return {
    ...(step.env ?? {}),
    ...(executionContext?.dockerContext
      ? { DOCKER_CONTEXT: executionContext.dockerContext }
      : {}),
    ...(executionContext?.dockerHost
      ? { DOCKER_HOST: executionContext.dockerHost }
      : {})
  };
}

function quoteBash(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shouldUseWslWrapper(
  step: InstallStep,
  executionContext: ExecutionContext | undefined
): boolean {
  return (
    executionContext?.effectiveRuntimePlatform === "wsl" &&
    step.shellKind !== "powershell" &&
    step.shellKind !== "cmd"
  );
}

function buildWslScript(
  step: InstallStep,
  executionContext: ExecutionContext,
  sudo: boolean
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(collectCommandEnv(step, executionContext))) {
    lines.push(`export ${key}=${quoteBash(value)}`);
  }

  if (step.workingDirectory) {
    lines.push(
      `cd ${quoteBash(
        normalizePathForRuntime(
          step.workingDirectory,
          executionContext.effectiveRuntimePlatform
        )
      )}`
    );
  }

  const command = step.shell ? step.command : renderNonShellCommand(step);
  lines.push(
    shouldWrapWithSudo(executionContext, sudo, step.requiresElevation)
      ? `sudo ${command}`
      : command
  );
  return lines.join("\n");
}

interface CommandInvocation {
  program: string;
  args: string[];
  displayCommand: string;
  handlesEnv: boolean;
  handlesWorkingDirectory: boolean;
}

function buildWslInvocation(
  step: InstallStep,
  executionContext: ExecutionContext | undefined,
  sudo: boolean
): CommandInvocation {
  const distribution = executionContext?.wslDistribution;
  if (!distribution) {
    throw new HubInstallerError(
      "WSL_RUNTIME_UNAVAILABLE",
      "WSL command invocation requires a WSL distribution."
    );
  }

  const script = buildWslScript(step, executionContext, sudo);
  return {
    program: "wsl.exe",
    args: ["-d", distribution, "--", "bash", "-lc", script],
    displayCommand: renderShellDisplayCommand("wsl.exe", [
      "-d",
      distribution,
      "--",
      "bash",
      "-lc",
      script
    ]),
    handlesEnv: true,
    handlesWorkingDirectory: true
  };
}

function resolveShellProgram(shellKind: ShellKind): string {
  if (shellKind === "powershell") {
    return "powershell";
  }

  if (shellKind === "cmd") {
    return "cmd";
  }

  return "bash";
}

function buildCommandInvocation(
  step: InstallStep,
  platform: SupportedPlatform,
  options: {
    sudo?: boolean;
    executionContext?: ExecutionContext;
  }
): CommandInvocation {
  const executionContext = options.executionContext;

  if (
    step.requiresElevation &&
    !options.sudo &&
    executionContext?.effectiveRuntimePlatform !== "windows" &&
    (executionContext || platform !== "windows")
  ) {
    throw new HubInstallerError(
      "ELEVATION_REQUIRED",
      `Step "${step.description}" requires root privileges. Re-run with sudo enabled.`
    );
  }

  if (shouldUseWslWrapper(step, executionContext)) {
    return buildWslInvocation(step, executionContext, options.sudo ?? false);
  }

  if (step.shell) {
    const shellKind = step.shellKind ?? defaultShellKind(platform, executionContext);
    const program = resolveShellProgram(shellKind);

    if (shellKind === "powershell") {
      return {
        program,
        args: ["-NoProfile", "-Command", step.command],
        displayCommand: renderShellDisplayCommand(program, [
          "-NoProfile",
          "-Command",
          step.command
        ]),
        handlesEnv: false,
        handlesWorkingDirectory: false
      };
    }

    if (shellKind === "cmd") {
      return {
        program,
        args: ["/d", "/s", "/c", step.command],
        displayCommand: renderShellDisplayCommand(program, [
          "/d",
          "/s",
          "/c",
          step.command
        ]),
        handlesEnv: false,
        handlesWorkingDirectory: false
      };
    }

    if (shouldWrapWithSudo(executionContext, options.sudo ?? false, step.requiresElevation)) {
      return {
        program: "sudo",
        args: [program, "-lc", step.command],
        displayCommand: renderShellDisplayCommand("sudo", [program, "-lc", step.command]),
        handlesEnv: false,
        handlesWorkingDirectory: false
      };
    }

    return {
      program,
      args: ["-lc", step.command],
      displayCommand: renderShellDisplayCommand(program, ["-lc", step.command]),
      handlesEnv: false,
      handlesWorkingDirectory: false
    };
  }

  if (shouldWrapWithSudo(executionContext, options.sudo ?? false, step.requiresElevation)) {
    return {
      program: "sudo",
      args: [step.command, ...(step.args ?? [])],
      displayCommand: renderShellDisplayCommand("sudo", [renderNonShellCommand(step)]),
      handlesEnv: false,
      handlesWorkingDirectory: false
    };
  }

  return {
    program: step.command,
    args: step.args ?? [],
    displayCommand: renderNonShellCommand(step),
    handlesEnv: false,
    handlesWorkingDirectory: false
  };
}

function runStep(
  originalStep: InstallStep,
  plan: InstallPlan,
  timeoutMs: number | undefined,
  dryRun: boolean,
  verbose: boolean,
  useSudo: boolean,
  executionContext: ExecutionContext | undefined
): Promise<StepExecutionResult> {
  const step = originalStep;
  const effectiveTimeoutMs = step.timeoutMs ?? timeoutMs;
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const invocation = buildCommandInvocation(step, plan.request.platform, {
    sudo: useSudo,
    ...(executionContext ? { executionContext } : {})
  });
  const commandLine = invocation.displayCommand;

  if (dryRun) {
    const endedAt = new Date().toISOString();
    return Promise.resolve({
      step,
      commandLine,
      startedAt,
      endedAt,
      durationMs: Date.now() - started,
      exitCode: 0,
      success: true,
      skipped: true
    });
  }

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const resolveOnce = (value: StepExecutionResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: HubInstallerError): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    let child: ChildProcess;
    try {
      child = spawn(invocation.program, invocation.args, {
        cwd: invocation.handlesWorkingDirectory
          ? undefined
          : step.workingDirectory ?? plan.request.cwd,
        shell: false,
        env: invocation.handlesEnv
          ? process.env
          : { ...process.env, ...collectCommandEnv(step, executionContext) },
        windowsHide: true
      });
    } catch (error) {
      rejectOnce(
        new HubInstallerError(
          "COMMAND_SPAWN_FAILED",
          renderSpawnFailureMessage(commandLine, error),
          error
        )
      );
      return;
    }

    child.on("error", (error) => {
      rejectOnce(
        new HubInstallerError(
          "COMMAND_SPAWN_FAILED",
          renderSpawnFailureMessage(commandLine, error),
          error
        )
      );
    });

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        if (verbose) {
          process.stdout.write(chunk);
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        if (verbose) {
          process.stderr.write(chunk);
        }
      });
    }

    const timeoutHandle =
      typeof effectiveTimeoutMs === "number" && effectiveTimeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, effectiveTimeoutMs)
        : null;

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      const ended = Date.now();
      const endedAt = new Date(ended).toISOString();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const stderrWithTimeout = timedOut
        ? [stderr.trim(), `Command timed out after ${effectiveTimeoutMs}ms.`].filter(Boolean).join(" ")
        : stderr.trim();

      resolveOnce({
        step,
        commandLine,
        startedAt,
        endedAt,
        durationMs: ended - started,
        exitCode,
        success: exitCode === 0 && !timedOut,
        ...(verbose ? {} : { stdout: stdout.trim(), stderr: stderrWithTimeout })
      });
    });
  });
}

function printStepStart(index: number, total: number, step: InstallStep, dryRun: boolean): void {
  const dryRunSuffix = dryRun ? " (dry-run)" : "";
  const progress = total > 0 ? Math.floor((index / total) * 100) : 0;
  console.log(`[RUN] [${index + 1}/${total}] ${step.description}${dryRunSuffix} [${progress}%]`);
}

function printStepResult(
  index: number,
  total: number,
  result: StepExecutionResult
): void {
  const status = result.success ? "[OK]" : "[FAIL]";
  const continueSuffix = result.step.continueOnError ? " (continueOnError)" : "";
  const progress = total > 0 ? Math.floor(((index + 1) / total) * 100) : 100;
  console.log(
    `${status} [${index + 1}/${total}] ${result.step.description} [${progress}%] (${result.durationMs}ms)${continueSuffix}`
  );

  if (!result.success && result.stderr) {
    console.error(`  stderr: ${result.stderr}`);
  }
}

export async function executePlan(
  plan: InstallPlan,
  options: {
    dryRun?: boolean;
    verbose?: boolean;
    progress?: boolean;
    timeoutMs?: number;
    sudo?: boolean;
    executionContext?: ExecutionContext;
  }
): Promise<InstallExecutionResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const results: StepExecutionResult[] = [];

  const dryRun = options.dryRun ?? false;
  const verbose = options.verbose ?? false;
  const useSudo = options.sudo ?? false;
  const progress = options.progress ?? false;

  for (const [index, step] of plan.steps.entries()) {
    if (progress) {
      printStepStart(index, plan.steps.length, step, dryRun);
    }

    const result = await runStep(
      step,
      plan,
      options.timeoutMs ?? plan.request.timeoutMs,
      dryRun,
      verbose,
      useSudo,
      options.executionContext
    );
    results.push(result);
    if (progress) {
      printStepResult(index, plan.steps.length, result);
    }

    if (!result.success && !result.step.continueOnError) {
      break;
    }
  }

  const ended = Date.now();
  const endedAt = new Date(ended).toISOString();

  return {
    plan,
    success: results.every((step) => step.success || Boolean(step.step.continueOnError)),
    steps: results,
    startedAt,
    endedAt,
    durationMs: ended - started
  };
}

export function resolveCommandInvocationForTest(
  step: InstallStep,
  platform: SupportedPlatform,
  options: {
    sudo?: boolean;
    executionContext?: ExecutionContext;
  }
): {
  program: string;
  args: string[];
  displayCommand: string;
  handlesEnv: boolean;
  handlesWorkingDirectory: boolean;
} {
  return buildCommandInvocation(step, platform, options);
}
