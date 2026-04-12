#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.mjs");

if (!existsSync(cliPath)) {
  console.error(`Missing CLI build artifact: ${cliPath}`);
  console.error("Run `pnpm build` before running this regression suite.");
  process.exit(1);
}

const CASES = [
  {
    name: "openclaw::installer-script",
    args: ["install", "openclaw", "installer-script", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw"
  },
  {
    name: "openclaw::git",
    args: ["install", "openclaw", "git", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-git"
  },
  {
    name: "openclaw::cli-script",
    args: ["install", "openclaw", "cli-script", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-cli-script"
  },
  {
    name: "openclaw::npm",
    args: ["install", "openclaw", "npm", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-npm"
  },
  {
    name: "openclaw::pnpm",
    args: ["install", "openclaw", "pnpm", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-pnpm"
  },
  {
    name: "openclaw::source",
    args: ["install", "openclaw", "source", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-source"
  },
  {
    name: "openclaw::bun",
    args: ["install", "openclaw", "bun", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-bun"
  },
  {
    name: "openclaw::docker",
    args: ["install", "openclaw", "docker", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-docker"
  },
  {
    name: "openclaw::podman",
    args: ["install", "openclaw", "podman", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-podman",
    requiredCommand: "podman"
  },
  {
    name: "openclaw::ansible",
    args: ["install", "openclaw", "ansible", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-ansible"
  },
  {
    name: "openclaw::nix",
    args: ["install", "openclaw", "nix", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-nix"
  },
  {
    name: "openclaw-all::default",
    args: ["install", "openclaw-all", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "openclaw-all"
  },
  {
    name: "codex::source-build",
    args: ["install", "codex", "source-build", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "codex"
  },
  {
    name: "codex::dotslash-release",
    args: ["install", "codex", "dotslash-release", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "codex"
  },
  {
    name: "nodejs::os-package",
    args: ["install", "nodejs", "os-package", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "nodejs"
  },
  {
    name: "nodejs::fnm",
    args: ["install", "nodejs", "fnm", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "nodejs"
  },
  {
    name: "nodejs::nvm",
    args: ["install", "nodejs", "nvm", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "nodejs"
  },
  {
    name: "python::os-package",
    args: ["install", "python", "os-package", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "python"
  },
  {
    name: "python::pyenv",
    args: ["install", "python", "pyenv", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "python"
  },
  {
    name: "python::uv",
    args: ["install", "python", "uv", "--platform", "ubuntu", "--dry-run", "--json"],
    expectedSoftware: "python"
  }
];

function hasCommand(commandName) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [commandName], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return probe.status === 0;
}

function runCase(testCase) {
  const result = spawnSync(process.execPath, [cliPath, ...testCase.args], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.error) {
    return {
      ...testCase,
      success: false,
      reason: `spawn error (${result.error.code ?? "unknown"}): ${result.error.message}`
    };
  }

  if (result.status !== 0) {
    return {
      ...testCase,
      success: false,
      reason: `exit=${result.status}\n${combinedOutput}`
    };
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    return {
      ...testCase,
      success: false,
      reason: `Invalid JSON output: ${
        error instanceof Error ? error.message : String(error)
      }\n${combinedOutput}`
    };
  }

  if (!payload?.applyResult || payload.applyResult.success !== true) {
    return {
      ...testCase,
      success: false,
      reason: `applyResult.success is not true.\n${JSON.stringify(payload, null, 2)}`
    };
  }

  if (payload.softwareName !== testCase.expectedSoftware) {
    return {
      ...testCase,
      success: false,
      reason: `software mismatch: expected "${testCase.expectedSoftware}", got "${
        payload.softwareName ?? "undefined"
      }"`
    };
  }

  return {
    ...testCase,
    success: true,
    durationMs: payload.applyResult.durationMs
  };
}

const failures = [];
let skippedCount = 0;
for (const testCase of CASES) {
  if (testCase.requiredCommand && !hasCommand(testCase.requiredCommand)) {
    skippedCount += 1;
    console.log(
      `[SKIP] ${testCase.name} (missing required host command: ${testCase.requiredCommand})`
    );
    continue;
  }
  const outcome = runCase(testCase);
  if (outcome.success) {
    console.log(`[PASS] ${testCase.name} (${outcome.durationMs}ms)`);
  } else {
    console.error(`[FAIL] ${testCase.name}`);
    console.error(outcome.reason);
    failures.push(outcome);
  }
}

if (failures.length > 0) {
  console.error(`\nE2E dry-run regression failed: ${failures.length}/${CASES.length} cases failed.`);
  process.exit(1);
}

console.log(
  `\nE2E dry-run regression passed: ${CASES.length - skippedCount}/${CASES.length} cases executed, ${skippedCount} skipped.`
);
