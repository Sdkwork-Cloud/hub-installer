# Rust Installer Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the Rust installer crate into a correct, embeddable, cross-platform engine that aligns with the documented `hub-installer` product contract and is ready to integrate into a Tauri backend.

**Architecture:** Introduce a dedicated policy layer, harden execution semantics, remove cross-platform false assumptions from plan generation, and expose host-friendly execution signals while keeping the core library independent from any Tauri dependency.

**Tech Stack:** Rust, Clap, Serde, Reqwest, YAML/JSON manifest loading, host callback integration

---

### Task 1: Re-establish a green baseline

**Files:**
- Modify: `rust/src/types.rs`
- Modify: `rust/src/cli.rs`
- Modify: `rust/src/manifest.rs`
- Modify: `rust/src/registry.rs`
- Test: `rust/tests/cli_contract.rs`

**Steps:**
1. Write a failing CLI parsing test that exercises `--platform`, `--install-scope`, and `--install-control-level`.
2. Run `cargo test` and confirm the crate fails before the fix.
3. Add the enum parsing support and explicit parse typing required by the current toolchain.
4. Re-run `cargo test`.

### Task 2: Centralize install policy

**Files:**
- Create: `rust/src/policy.rs`
- Modify: `rust/src/lib.rs`
- Modify: `rust/src/engine.rs`
- Test: `rust/tests/policy_defaults.rs`

**Steps:**
1. Write failing tests for installer home, work root, bin dir, and data root defaults.
2. Implement a pure resolver for platform/scope-aware policy.
3. Replace ad hoc path construction in the engine with the resolver.
4. Re-run targeted tests.

### Task 3: Harden execution semantics

**Files:**
- Modify: `rust/src/types.rs`
- Modify: `rust/src/manifest.rs`
- Modify: `rust/src/engine.rs`
- Modify: `rust/src/executor.rs`
- Test: `rust/tests/executor_contract.rs`

**Steps:**
1. Write failing tests for timeout behavior, shell selection, and failure accounting.
2. Add structured shell metadata to execution steps.
3. Enforce timeouts and preserve structured failure results.
4. Re-run targeted tests.

### Task 4: Fix cross-platform artifact planning

**Files:**
- Modify: `rust/src/engine.rs`
- Test: `rust/tests/plan_generation.rs`

**Steps:**
1. Write failing plan tests for Windows git/source flows and archive extraction behavior.
2. Replace Unix-only shell snippets with platform-aware command generation.
3. Honor archive entry semantics and safer default extraction paths.
4. Re-run targeted tests.

### Task 5: Align download, checksum, and cache semantics

**Files:**
- Modify: `rust/src/engine.rs`
- Modify: `rust/src/policy.rs`
- Test: `rust/tests/download_contract.rs`

**Steps:**
1. Write failing tests for `sha256:` checksum normalization and default package cache placement.
2. Implement normalized checksum parsing and installer-home cache defaults.
3. Re-run targeted tests.

### Task 6: Add host-facing progress integration

**Files:**
- Create: `rust/src/progress.rs`
- Modify: `rust/src/lib.rs`
- Modify: `rust/src/engine.rs`
- Modify: `rust/src/executor.rs`
- Test: `rust/tests/progress_contract.rs`

**Steps:**
1. Write failing tests that assert progress callbacks receive lifecycle and step events.
2. Thread a host-agnostic observer through engine and executor flows.
3. Keep the public API serializable and suitable for Tauri event bridging.
4. Re-run targeted tests.

### Task 7: Verify the finished crate

**Files:**
- Modify: `rust/Cargo.toml` if needed for final dependency cleanup
- Test: all Rust tests

**Steps:**
1. Run targeted tests.
2. Run `cargo fmt --check`.
3. Run `cargo clippy --all-targets --all-features -- -D warnings`.
4. Run `cargo test`.
5. Run `cargo build`.

## Notes

- Prefer host-agnostic hooks over hard dependencies on `tauri`.
- Keep library-first design as the primary success metric.
- Do not ship platform claims that rely on Unix shell fragments on Windows.
