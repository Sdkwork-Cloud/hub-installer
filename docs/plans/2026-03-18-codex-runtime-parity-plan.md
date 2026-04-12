# Codex Windows WSL Runtime Parity Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Codex on Windows resolve to the same WSL-first runtime contract in Rust and Node, while hardening the manifest so WSL paths are absolute and runtime-derived instead of relying on `~` expansion.

**Architecture:** Keep the Codex-on-Windows WSL default at the registry/service layer, because the current manifest schema cannot express a runtime default that applies only on Windows without incorrectly forcing WSL on macOS and Ubuntu. Harden the manifest itself by replacing fragile `~`-based WSL paths with runtime-managed absolute paths, then lock the combined contract with regression tests in both Rust and Node.

**Tech Stack:** Rust, TypeScript, VitePress docs, YAML manifests, existing runtime/policy/executor modules.

---

### Task 1: Add failing regression coverage

**Files:**
- Modify: `rust/tests/openclaw_registry_contract.rs`
- Modify: `src/registry/service-policy.test.ts`
- Modify: `src/registry/builtin-installers.test.ts`

**Step 1: Write the failing test**

Add coverage that expects:

- Rust registry install for `codex` on Windows reports `effective_runtime_platform = wsl` when a WSL distribution is supplied.
- Node registry service continues to report the same contract through the existing Windows-specific Codex runtime rule.
- Codex manifest variables resolve WSL install paths from `hub_work_root` and `hub_bin_dir` instead of `~`.

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path rust/Cargo.toml codex
pnpm test -- --run src/registry/service-policy.test.ts src/registry/builtin-installers.test.ts
```

Expected: FAIL because Rust does not yet apply the Windows-specific Codex WSL default and the manifest still uses `~`-based WSL paths.

### Task 2: Harden the Codex manifest WSL paths

**Files:**
- Modify: `registry/manifests/codex.hub.yaml`
- Modify: `examples/codex.hub.yaml`

**Step 1: Write minimal implementation**

Replace WSL-specific tilde paths with runtime-derived absolute paths based on `{{hub_work_root}}` and `{{hub_bin_dir}}`.

**Step 2: Run targeted tests**

Run:

```bash
cargo test --manifest-path rust/Cargo.toml codex
pnpm test -- --run src/registry/service-policy.test.ts src/registry/builtin-installers.test.ts
```

Expected: PASS

### Task 3: Mirror the Codex Windows WSL rule in Rust registry flow

**Files:**
- Modify: `rust/src/engine.rs`

**Step 1: Write minimal implementation**

Apply the same Windows-specific Codex `effective_runtime_platform = wsl` default that the Node registry service already uses, across Rust install, backup, and uninstall registry entry flows.

**Step 2: Run targeted tests**

Run:

```bash
pnpm test -- --run src/registry/service-policy.test.ts src/registry/builtin-installers.test.ts
```

Expected: PASS

### Task 4: Verify end to end

**Files:**
- No code changes required

**Step 1: Run verification**

Run:

```bash
cargo test --manifest-path rust/Cargo.toml
cargo clippy --manifest-path rust/Cargo.toml --all-targets --all-features -- -D warnings
pnpm test
pnpm typecheck
pnpm docs:build
```

Expected: all commands succeed.

**Step 2: Run CLI smoke**

Run:

```bash
cargo run --manifest-path rust/Cargo.toml -- install codex --registry ./registry/software-registry.yaml --platform windows --dry-run --wsl-distribution Ubuntu-22.04
node dist/cli.mjs registry install codex --registry ./registry/software-registry.yaml --platform windows --dry-run --json
```

Expected:

- Rust and Node both report a WSL effective runtime for Codex on Windows.
- Codex install roots are runtime-style Linux paths rather than Windows-managed paths.
