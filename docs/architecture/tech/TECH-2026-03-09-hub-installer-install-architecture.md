> Migrated from `docs/plans/2026-03-09-hub-installer-install-architecture.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Hub Installer Install Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize `hub-installer` internal state under `~/.sdkwork/hub-installer`, add platform-aware install policy resolution, and make built-in install flows report truthful default targets and control levels across Windows, macOS, Ubuntu, and WSL-backed Codex installs.

**Architecture:** Add a core path-policy layer that resolves installer home, config, cache, state, install scope, install roots, work roots, and bin directories before manifest rendering or built-in registry execution. Feed those resolved values into template variables, doctor checks, and CLI/dry-run output, then migrate built-in OpenClaw/Codex/Node.js/Python manifests away from hard-coded home-directory defaults.

**Tech Stack:** TypeScript, Commander, Vitest, YAML manifests, Node.js filesystem/path APIs

---

### Task 1: Create a Clean Worktree and Capture a Baseline

**Files:**
- Create: `docs/plans/2026-03-09-hub-installer-install-architecture.md`
- Modify: none
- Test: none

**Step 1: Create a dedicated worktree**

```bash
git worktree add ..\hub-installer-install-architecture -b feat/hub-installer-install-architecture
```

**Step 2: Enter the worktree and inspect status**

Run: `git -C ..\hub-installer-install-architecture status --short`
Expected: clean working tree in the new worktree

**Step 3: Reinstall dependencies if needed**

Run: `pnpm.cmd install`
Expected: dependencies linked without missing package errors

**Step 4: Capture baseline verification**

Run: `pnpm.cmd typecheck`
Expected: pass, or record the exact failure before code changes

**Step 5: Commit the plan artifacts if you are isolating planning work**

```bash
git -C ..\hub-installer-install-architecture add docs/plans
git -C ..\hub-installer-install-architecture commit -m "docs: add install architecture design and plan"
```

### Task 2: Add Installer Home and Config Resolution

**Files:**
- Create: `src/core/installer-home.ts`
- Create: `src/core/installer-home.test.ts`
- Create: `src/core/hub-config.ts`
- Create: `src/core/hub-config.test.ts`
- Modify: `src/manifest/template.ts`
- Modify: `src/types.ts`
- Test: `src/core/installer-home.test.ts`
- Test: `src/core/hub-config.test.ts`

**Step 1: Write the failing installer-home tests**

```ts
it("defaults installer home to ~/.sdkwork/hub-installer on unix", () => {
  expect(resolveInstallerHome({ platform: "ubuntu", homeDir: "/home/tester" })).toBe(
    "/home/tester/.sdkwork/hub-installer"
  );
});
```

**Step 2: Run the test to verify it fails**

Run: `pnpm.cmd test -- src/core/installer-home.test.ts`
Expected: FAIL because `resolveInstallerHome` does not exist yet

**Step 3: Write the failing config-precedence tests**

```ts
it("prefers CLI values over env and config file", () => {
  const resolved = resolveHubConfig({
    cli: { installScope: "user" },
    env: { HUB_INSTALLER_INSTALL_SCOPE: "system" },
    file: { installScope: "system" }
  });

  expect(resolved.installScope).toBe("user");
});
```

**Step 4: Implement the minimal resolver code**

```ts
export function resolveInstallerHome(input: { platform: SupportedPlatform; homeDir: string }): string {
  return path.join(input.homeDir, ".sdkwork", "hub-installer");
}
```

**Step 5: Run the new tests and commit**

Run: `pnpm.cmd test -- src/core/installer-home.test.ts src/core/hub-config.test.ts`
Expected: PASS

```bash
git add src/core/installer-home.ts src/core/installer-home.test.ts src/core/hub-config.ts src/core/hub-config.test.ts src/manifest/template.ts src/types.ts
git commit -m "feat: add hub installer home and config resolution"
```

### Task 3: Add Install Policy Resolution and Template Variables

**Files:**
- Create: `src/core/install-policy.ts`
- Create: `src/core/install-policy.test.ts`
- Modify: `src/manifest/template.ts`
- Modify: `src/manifest/types.ts`
- Modify: `src/registry/types.ts`
- Test: `src/core/install-policy.test.ts`

**Step 1: Write the failing policy-resolution tests**

```ts
it("resolves ubuntu system installs to /opt and /usr/local/bin", () => {
  const policy = resolveInstallPolicy({
    platform: "ubuntu",
    softwareName: "codex",
    installScope: "system",
    installerHome: "/home/tester/.sdkwork/hub-installer"
  });

  expect(policy.installRoot).toBe("/opt/codex");
  expect(policy.binDir).toBe("/usr/local/bin");
  expect(policy.workRoot).toBe("/home/tester/.sdkwork/hub-installer/state/sources/codex");
});
```

**Step 2: Run the policy test to verify it fails**

Run: `pnpm.cmd test -- src/core/install-policy.test.ts`
Expected: FAIL because `resolveInstallPolicy` does not exist yet

**Step 3: Implement the policy model**

```ts
export interface ResolvedInstallPolicy {
  installScope: "system" | "user";
  installRoot: string;
  workRoot: string;
  binDir: string;
  dataRoot: string;
  installControlLevel: "managed" | "partial" | "opaque";
  effectiveRuntimePlatform: SupportedPlatform | "wsl";
}
```

**Step 4: Expose policy values to manifest rendering**

```ts
const output: Record<string, string> = {
  installerHome: policy.installerHome,
  hub_install_scope: policy.installScope,
  hub_install_root: policy.installRoot,
  hub_work_root: policy.workRoot,
  hub_bin_dir: policy.binDir
};
```

**Step 5: Run tests and commit**

Run: `pnpm.cmd test -- src/core/install-policy.test.ts`
Expected: PASS

```bash
git add src/core/install-policy.ts src/core/install-policy.test.ts src/manifest/template.ts src/manifest/types.ts src/registry/types.ts
git commit -m "feat: add install policy resolution"
```

### Task 4: Move Default Caches and State Paths Under Installer Home

**Files:**
- Modify: `src/core/download.ts`
- Modify: `src/manifest/loader.ts`
- Modify: `src/registry/loader.ts`
- Modify: `src/registry/service.ts`
- Modify: `src/manifest/executor.ts`
- Create: `src/core/installer-home-cache.test.ts`
- Test: `src/core/installer-home-cache.test.ts`

**Step 1: Write the failing cache-path tests**

```ts
it("uses installer-home package cache when no download cache is provided", async () => {
  const cacheDir = getDefaultPackageCacheDir({
    installerHome: "/home/tester/.sdkwork/hub-installer"
  });

  expect(cacheDir).toBe("/home/tester/.sdkwork/hub-installer/cache/packages");
});
```

**Step 2: Run the cache-path test to verify it fails**

Run: `pnpm.cmd test -- src/core/installer-home-cache.test.ts`
Expected: FAIL because the loaders still default to temp directories

**Step 3: Implement minimal default-cache helpers**

```ts
function getDefaultPackageCacheDir(installerHome: string): string {
  return path.join(installerHome, "cache", "packages");
}
```

**Step 4: Rewire manifest, registry, and package loaders to use the helper**

```ts
const cacheDir = path.resolve(options.cacheDir ?? getDefaultManifestCacheDir(installerHome));
```

**Step 5: Run tests and commit**

Run: `pnpm.cmd test -- src/core/installer-home-cache.test.ts src/registry/doctor.test.ts`
Expected: PASS

```bash
git add src/core/download.ts src/manifest/loader.ts src/registry/loader.ts src/registry/service.ts src/manifest/executor.ts src/core/installer-home-cache.test.ts
git commit -m "feat: move default caches under installer home"
```

### Task 5: Add CLI and Output Support for Resolved Policy Metadata

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/types.ts`
- Modify: `src/manifest/types.ts`
- Modify: `src/registry/service.ts`
- Create: `src/cli-policy-output.test.ts`
- Test: `src/cli-policy-output.test.ts`

**Step 1: Write the failing output-shape tests**

```ts
it("includes resolved policy metadata in registry install json output", async () => {
  const result = await formatRegistryInstallPayload(fakeInstallResult);
  expect(result.resolvedInstallScope).toBe("system");
  expect(result.installControlLevel).toBe("managed");
});
```

**Step 2: Run the output test to verify it fails**

Run: `pnpm.cmd test -- src/cli-policy-output.test.ts`
Expected: FAIL because the payload does not include policy metadata yet

**Step 3: Implement minimal payload wiring**

```ts
const payload = {
  ...existing,
  installerHome: result.applyResult.installerHome,
  resolvedInstallScope: result.applyResult.resolvedInstallScope,
  installControlLevel: result.applyResult.installControlLevel
};
```

**Step 4: Add CLI options and env/config hooks**

```ts
.option("--install-scope <scope>", "install scope (system or user)")
.option("--install-root <path>", "override final install root")
```

**Step 5: Run tests and commit**

Run: `pnpm.cmd test -- src/cli-policy-output.test.ts src/cli-registry-shortcuts.test.ts`
Expected: PASS

```bash
git add src/cli.ts src/types.ts src/manifest/types.ts src/registry/service.ts src/cli-policy-output.test.ts
git commit -m "feat: expose install policy metadata in cli output"
```

### Task 6: Migrate Built-In OpenClaw and Codex Profiles to Unified Variables

**Files:**
- Modify: `registry/software-registry.yaml`
- Modify: `registry/manifests/openclaw.hub.yaml`
- Modify: `registry/manifests/openclaw-installer-script-git.hub.yaml`
- Modify: `registry/manifests/openclaw-installer-cli-script.hub.yaml`
- Modify: `registry/manifests/openclaw-source.hub.yaml`
- Modify: `registry/manifests/codex.hub.yaml`
- Modify: `examples/codex.hub.yaml`
- Modify: `examples/openclaw.hub.yaml`
- Test: `src/registry/builtin-installers.test.ts`

**Step 1: Write the failing built-in manifest expectations**

```ts
expect(manifest.variables?.hub_install_scope).toBe("system");
expect(manifest.variables?.hub_work_root).toContain(".sdkwork/hub-installer/state/sources");
expect(manifest.variables?.codex_binary_link).not.toBe("{{home}}/.local/bin/codex");
```

**Step 2: Run the built-in installer tests to verify failure**

Run: `pnpm.cmd test -- src/registry/builtin-installers.test.ts`
Expected: FAIL because manifests still use hard-coded `{{home}}` defaults

**Step 3: Apply minimal manifest rewrites**

```yaml
variables:
  hub_install_scope: "system"
  hub_work_root: "{{installerHome}}/state/sources/codex"
  hub_install_root: "/opt/codex"
  hub_bin_dir: "/usr/local/bin"
```

**Step 4: Mark control levels honestly**

```yaml
variables:
  hub_install_control_level: "opaque"
```

**Step 5: Run tests and commit**

Run: `pnpm.cmd test -- src/registry/builtin-installers.test.ts`
Expected: PASS

```bash
git add registry/software-registry.yaml registry/manifests/openclaw.hub.yaml registry/manifests/openclaw-installer-script-git.hub.yaml registry/manifests/openclaw-installer-cli-script.hub.yaml registry/manifests/openclaw-source.hub.yaml registry/manifests/codex.hub.yaml examples/codex.hub.yaml examples/openclaw.hub.yaml src/registry/builtin-installers.test.ts
git commit -m "feat: unify openclaw and codex install path variables"
```

### Task 7: Upgrade Doctor and E2E Dry-Run Coverage

**Files:**
- Modify: `src/registry/doctor.ts`
- Modify: `src/registry/doctor.test.ts`
- Modify: `scripts/e2e-dry-run.mjs`
- Modify: `src/registry/builtin-installers.test.ts`
- Test: `src/registry/doctor.test.ts`

**Step 1: Write failing doctor assertions for resolved policy metadata**

```ts
expect(report.checks.some((check) => check.id === "codex-policy-paths")).toBe(true);
expect(report.checks.some((check) => check.id === "openclaw-control-level")).toBe(true);
```

**Step 2: Run doctor tests to verify failure**

Run: `pnpm.cmd test -- src/registry/doctor.test.ts`
Expected: FAIL because doctor does not emit policy-specific checks yet

**Step 3: Implement minimal doctor policy checks**

```ts
await runCheck(checks, {
  id: "codex-policy-paths",
  target: "codex",
  message: "Codex resolves standard install and work paths.",
  execute: () => {
    expectPolicy(policy, "codex");
  }
});
```

**Step 4: Update e2e dry-run assertions**

```js
if (payload.installControlLevel !== testCase.expectedControlLevel) {
  return fail("control level mismatch");
}
```

**Step 5: Run tests and commit**

Run: `pnpm.cmd test -- src/registry/doctor.test.ts`
Expected: PASS

Run: `pnpm.cmd test:e2e-dry-run`
Expected: PASS with policy metadata assertions

```bash
git add src/registry/doctor.ts src/registry/doctor.test.ts scripts/e2e-dry-run.mjs src/registry/builtin-installers.test.ts
git commit -m "feat: add install policy checks to doctor and dry-run"
```

### Task 8: Refresh Documentation and Examples

**Files:**
- Modify: `README.md`
- Modify: `docs/registry-spec.md`
- Modify: `docs/openclaw-profile-architecture.md`
- Modify: `examples/openclaw.hub.yaml`
- Modify: `examples/codex.hub.yaml`
- Test: none

**Step 1: Write the documentation checklist**

```md
- Document installer home under ~/.sdkwork/hub-installer
- Document system vs user install scope
- Document installControlLevel meanings
- Document Codex-on-Windows as WSL-targeted
```

**Step 2: Re-read the design doc before editing docs**

Run: `Get-Content -Raw 'docs/plans/2026-03-09-hub-installer-install-architecture-design.md'`
Expected: design sections available as source of truth

**Step 3: Update README and spec docs**

```md
| Field | Meaning |
|---|---|
| installerHome | hub-installer's own config/cache/state root |
| resolvedInstallRoot | final software target root |
| installControlLevel | managed / partial / opaque |
```

**Step 4: Update examples so they no longer imply home-root installs by default**

```yaml
variables:
  hub_install_scope: "system"
```

**Step 5: Commit**

```bash
git add README.md docs/registry-spec.md docs/openclaw-profile-architecture.md examples/openclaw.hub.yaml examples/codex.hub.yaml
git commit -m "docs: document install policy and directory standards"
```

### Task 9: Run Full Verification and Manual Smoke Checks

**Files:**
- Modify: none
- Test: `src/core/installer-home.test.ts`
- Test: `src/core/install-policy.test.ts`
- Test: `src/registry/doctor.test.ts`
- Test: `src/registry/builtin-installers.test.ts`

**Step 1: Run focused test suites first**

Run: `pnpm.cmd test -- src/core/installer-home.test.ts src/core/install-policy.test.ts src/registry/doctor.test.ts src/registry/builtin-installers.test.ts`
Expected: PASS

**Step 2: Run typecheck**

Run: `pnpm.cmd typecheck`
Expected: PASS

**Step 3: Run build and dry-run regression**

Run: `pnpm.cmd build`
Expected: PASS

Run: `pnpm.cmd test:e2e-dry-run`
Expected: PASS

**Step 4: Run manual JSON smoke checks**

Run: `node dist/cli.mjs doctor codex --json`
Expected: JSON includes resolved installer home, install control level, and WSL runtime semantics

Run: `node dist/cli.mjs install openclaw cli-script --platform ubuntu --dry-run --json`
Expected: JSON includes resolved install root, work root, bin dir, and control level

**Step 5: Commit the final implementation**

```bash
git add .
git commit -m "feat: standardize install policy and installer home"
```

## Notes for the Implementer

- Keep new path and policy logic in `src/core/` so it stays shared across CLI, manifest, registry, and doctor layers.
- Do not silently claim that opaque upstream installers honor `Program Files` or `/opt`; surface those limits explicitly.
- When handling Codex on Windows, always distinguish host platform (`windows`) from effective runtime/install target (`wsl`).
- If baseline verification fails before Task 2, capture the exact failure and fix the environment or repo setup first instead of mixing unrelated breakage into feature work.

