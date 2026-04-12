# Execution Log Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add executor-level real-time command/log streaming so every install step can emit command input, live stdout/stderr, and terminal status events to CLI and library listeners.

**Architecture:** Extend the shared `ProgressEvent` model with execution-stream events, rework `executor.rs` to read child pipes incrementally, and wire CLI rendering to the observer path so terminal output and Tauri listeners consume the same structured event stream.

**Tech Stack:** Rust, std::process, std::sync::mpsc, threads, serde, clap

---

### Task 1: Extend progress event contracts

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\progress.rs`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\tests\progress_contract.rs`

**Step 1: Write the failing test**

Add a contract test asserting progress events can carry:
- a resolved command event,
- live stdout/stderr chunk events,
- a terminal `StepCompleted` event with `exit_code`.

**Step 2: Run test to verify it fails**

Run: `cargo test progress_contract`

Expected: FAIL because the new event variants and fields do not exist yet.

**Step 3: Write minimal implementation**

Add:
- `ProgressStream`
- `StepCommandStarted`
- `StepLogChunk`
- richer `StepCompleted { exit_code }`

**Step 4: Run test to verify it passes**

Run: `cargo test progress_contract`

Expected: PASS

### Task 2: Stream process output from executor

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\executor.rs`
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\tests\executor_contract.rs`

**Step 1: Write the failing test**

Add executor tests covering:
- step command events are emitted before logs,
- stdout/stderr chunks are emitted while the child runs,
- failed steps still emit terminal events,
- timeout emits terminal failure event.

**Step 2: Run test to verify it fails**

Run: `cargo test executor_contract`

Expected: FAIL because `wait_with_output()` buffers all output and no streaming events are emitted.

**Step 3: Write minimal implementation**

Implement:
- per-stream reader threads,
- merged chunk channel,
- live observer emission,
- aggregated stdout/stderr buffers,
- terminal event emission on success, failure, and timeout.

**Step 4: Run test to verify it passes**

Run: `cargo test executor_contract`

Expected: PASS

### Task 3: Wire CLI to real-time progress rendering

**Files:**
- Modify: `D:\javasource\spring-ai-plus\spring-ai-plus-business\apps\hub-installer\rust\src\cli.rs`

**Step 1: Write the failing test**

Add or extend CLI tests so `--progress` is parsed and observer-backed execution paths are used.

**Step 2: Run test to verify it fails**

Run: `cargo test cli::tests`

Expected: FAIL because CLI does not expose progress-driven rendering.

**Step 3: Write minimal implementation**

Add:
- `--progress`,
- stderr event rendering for command/log events,
- observer-backed install/apply execution when verbose or progress is enabled.

**Step 4: Run test to verify it passes**

Run: `cargo test cli::tests`

Expected: PASS

### Task 4: End-to-end verification

**Files:**
- Modify as needed: existing tests only

**Step 1: Run focused regression tests**

Run: `cargo test progress_contract executor_contract`

Expected: PASS

**Step 2: Run full test suite**

Run: `cargo test`

Expected: PASS

**Step 3: Run build verification**

Run: `cargo build`

Expected: PASS

**Step 4: Run lint verification**

Run: `cargo clippy --all-targets --all-features -- -D warnings`

Expected: PASS
