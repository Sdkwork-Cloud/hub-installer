> Migrated from `docs/plans/2026-03-18-docker-runtime-implementation-plan.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Docker Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add runtime-aware Docker/WSL execution to the Rust installer so Windows/Linux/WSL container installs can be auto-detected or explicitly selected.

**Architecture:** Add a new runtime resolution layer, thread the resolved execution context through policy and executor, inject runtime metadata into manifest variables, and update Docker profiles to use the new behavior. The implementation keeps registry target resolution intact while making execution/runtime decisions explicit and testable.

**Tech Stack:** Rust, clap, serde, std::process::Command, existing manifest/policy/executor modules.

---

### Task 1: Add runtime model types

**Files:**
- Modify: `rust/src/types.rs`
- Modify: `rust/src/lib.rs`
- Test: `rust/tests/runtime_contract.rs`

**Step 1: Write the failing test**

Add tests that expect:

- `EffectiveRuntimePlatform` accepts `wsl`.
- `ContainerRuntimePreference` accepts `auto`, `host`, and `wsl`.

**Step 2: Run test to verify it fails**

Run: `cargo test runtime_contract --test runtime_contract`

Expected: FAIL because runtime types do not exist.

**Step 3: Write minimal implementation**

Add typed enums and export them from the crate.

**Step 4: Run test to verify it passes**

Run: `cargo test runtime_contract --test runtime_contract`

Expected: PASS

### Task 2: Add runtime resolution

**Files:**
- Create: `rust/src/runtime.rs`
- Modify: `rust/src/lib.rs`
- Test: `rust/tests/runtime_contract.rs`

**Step 1: Write the failing test**

Add tests for:

- Windows host + auto container runtime + WSL docker available => `effective_runtime_platform = wsl`.
- Windows host + explicit host container runtime => native Windows runtime.
- Explicit WSL distro override is preserved.

**Step 2: Run test to verify it fails**

Run: `cargo test runtime_contract --test runtime_contract`

Expected: FAIL because runtime resolver does not exist.

**Step 3: Write minimal implementation**

Implement probe-based runtime resolution plus system probe.

**Step 4: Run test to verify it passes**

Run: `cargo test runtime_contract --test runtime_contract`

Expected: PASS

### Task 3: Make policy runtime-aware

**Files:**
- Modify: `rust/src/policy.rs`
- Modify: `rust/tests/policy_defaults.rs`

**Step 1: Write the failing test**

Add tests for:

- WSL runtime resolves to Linux home-based paths.
- Windows override paths are translated for WSL runtime.

**Step 2: Run test to verify it fails**

Run: `cargo test --test policy_defaults`

Expected: FAIL because policy ignores runtime.

**Step 3: Write minimal implementation**

Thread `effective_runtime_platform` into policy resolution and normalize overrides.

**Step 4: Run test to verify it passes**

Run: `cargo test --test policy_defaults`

Expected: PASS

### Task 4: Make executor runtime-aware

**Files:**
- Modify: `rust/src/executor.rs`
- Modify: `rust/tests/executor_contract.rs`

**Step 1: Write the failing test**

Add tests for:

- WSL runtime builds a `wsl.exe ... bash -lc` launcher.
- WSL runtime allows sudo wrapping.
- Windows host native docker path still uses Git Bash for Bash steps.

**Step 2: Run test to verify it fails**

Run: `cargo test --test executor_contract`

Expected: FAIL because executor cannot launch inside WSL.

**Step 3: Write minimal implementation**

Thread `ExecutionContext` through `ExecuteOptions`, build WSL wrappers, and keep host behavior intact.

**Step 4: Run test to verify it passes**

Run: `cargo test --test executor_contract`

Expected: PASS

### Task 5: Add CLI/API/runtime metadata plumbing

**Files:**
- Modify: `rust/src/cli.rs`
- Modify: `rust/src/engine.rs`
- Modify: `rust/src/manifest.rs`
- Modify: `rust/src/types.rs`
- Test: `rust/tests/runtime_contract.rs`

**Step 1: Write the failing test**

Add tests that expect:

- CLI parses `--effective-runtime-platform`, `--container-runtime`, `--wsl-distribution`, `--docker-context`, `--docker-host`.
- Apply result reports effective runtime metadata.

**Step 2: Run test to verify it fails**

Run: `cargo test`

Expected: FAIL because options and result fields do not exist.

**Step 3: Write minimal implementation**

Parse new flags, resolve runtime in engine, inject runtime variables, and return runtime details in results.

**Step 4: Run test to verify it passes**

Run: `cargo test`

Expected: PASS

### Task 6: Update OpenClaw Docker manifest and verify locally

**Files:**
- Modify: `registry/manifests/openclaw-docker.hub.yaml`
- Modify: `rust/tests/openclaw_dry_run_matrix.rs`
- Modify: `rust/tests/openclaw_registry_contract.rs`

**Step 1: Write the failing test**

Add coverage that the Docker profile exposes runtime metadata and supports Windows host resolution.

**Step 2: Run test to verify it fails**

Run: `cargo test openclaw -- --nocapture`

Expected: FAIL because manifest/runtime expectations are missing.

**Step 3: Write minimal implementation**

Update the manifest to use runtime variables, enable Windows host support, and improve preflight messages.

**Step 4: Run test to verify it passes**

Run: `cargo test openclaw -- --nocapture`

Expected: PASS

### Task 7: Verify end to end

**Files:**
- No code changes required

**Step 1: Run full verification**

Run:

```bash
cargo test
cargo build
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: all commands succeed.

**Step 2: Run real Docker scenario**

Run the OpenClaw Docker install at least twice on Windows:

- auto runtime
- explicit `wsl`

Expected:

- repo clone succeeds
- Docker build/setup succeeds
- healthcheck succeeds
- runtime selection is visible in output/result payload

