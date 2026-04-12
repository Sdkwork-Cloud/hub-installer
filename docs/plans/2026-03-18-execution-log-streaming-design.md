# Execution Log Streaming Design

**Problem**

`hub-installer` currently exposes only coarse-grained progress events. `executor.rs` waits for the child process to exit and only then returns buffered `stdout` and `stderr`. This prevents real-time CLI feedback, makes Tauri integration lag behind the actual install flow, and leaves failure/timeout scenarios without a complete observable event trail.

**Goals**

- Stream each step's command input, `stdout`, and `stderr` in real time.
- Keep one event model for Rust library, CLI, and future Tauri integration.
- Preserve current structured final results (`StepExecutionResult`, `InstallExecutionResult`).
- Ensure failed and timed-out steps still emit terminal progress events.

**Non-Goals**

- Persistent log storage and replay.
- Cross-process pub/sub broker.
- Full historical session indexing.

**Recommended Approach**

Build a single executor-level event stream and make all frontends consume it.

1. Extend `ProgressEvent` with step execution events:
   - `StepCommandStarted`
   - `StepLogChunk`
   - richer `StepCompleted` metadata including `exit_code`
2. Change `executor.rs` from `wait_with_output()` to concurrent pipe readers plus a merged channel.
3. Emit all streaming events from inside the executor so success, failure, timeout, and kill paths share the same lifecycle.
4. Keep CLI final JSON on `stdout`, but print streaming logs to `stderr`.
5. Keep Tauri integration simple by reusing the observer closure already exposed by `apply_manifest_with_observer`.

**Event Model**

- `StepStarted`: semantic step lifecycle start.
- `StepCommandStarted`: the resolved command line that will actually run, plus working directory.
- `StepLogChunk`: one raw chunk from `stdout` or `stderr`.
- `StepCompleted`: terminal event with `success`, `skipped`, `duration_ms`, and `exit_code`.

This separates "what step is running" from "what process command is invoked" and from "what bytes are emitted".

**Streaming Strategy**

Use `std::process::Child` with piped `stdout` and `stderr`, take both handles, and spawn one reader thread per stream. Each reader forwards chunks into a merged channel tagged with stream type. The main executor thread drains that channel while polling `try_wait()` and timeout deadlines.

This design:

- works with existing synchronous code,
- supports both short and long-running commands,
- streams without waiting for process completion,
- avoids a Tokio dependency,
- keeps output collection for final result objects.

**Failure and Timeout Semantics**

- Non-zero exit:
  emit final `StepCompleted`, then return the existing `STEP_FAILED` error when `continue_on_error = false`.
- Timeout:
  kill the child, drain the remaining channel, emit final `StepCompleted` with `success = false` and `exit_code = None`, then return `STEP_TIMEOUT`.
- Spawn/invocation failures:
  these occur before the child exists, so they remain direct errors.

**CLI Behavior**

- When `--verbose` or `--progress` is enabled, subscribe to progress events.
- Render:
  - `StepCommandStarted` as `[step-id] $ command`
  - `StepLogChunk` raw to `stderr`
  - lifecycle summaries as compact status lines
- Keep the machine-readable final JSON result on `stdout`.

**Tauri Integration**

The Tauri side should not parse terminal text. It should subscribe to the same observer events and forward serialized `ProgressEvent` payloads to the frontend event bus. That keeps CLI rendering and GUI rendering decoupled from the executor itself.

**Acceptance Criteria**

- A multi-step install shows each step command before execution.
- `stdout` and `stderr` appear incrementally during execution.
- Timeouts and failures still emit terminal step events.
- CLI and library observer both see the same event stream.
- Existing result JSON remains available after execution completes.
