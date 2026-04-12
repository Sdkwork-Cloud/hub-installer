# Progress Streaming

Rust exposes a structured event stream so install progress can be rendered without parsing terminal output.

## Event Model

The event type is `ProgressEvent`.

```rust
pub enum ProgressEvent {
    StageStarted { stage: String, total_steps: usize },
    StageCompleted { stage: String, success: bool, total_steps: usize, failed_steps: usize },
    ArtifactStarted { artifact_id: String, artifact_type: String },
    ArtifactCompleted { artifact_id: String, artifact_type: String, success: bool },
    StepStarted { step_id: String, description: String },
    StepCommandStarted { step_id: String, command_line: String, working_directory: Option<String> },
    StepLogChunk { step_id: String, stream: ProgressStream, chunk: String },
    StepCompleted { step_id: String, success: bool, skipped: bool, duration_ms: u128, exit_code: Option<i32> },
}
```

`ProgressStream` is:

- `Stdout`
- `Stderr`

## Why This Design Matters

The stream separates four concerns cleanly:

1. lifecycle semantics,
2. process command invocation,
3. raw stdout/stderr bytes,
4. final step completion.

That gives you a cleaner application design than line-based log scraping.

## Example Observer

```rust
use hub_installer_rs::{InstallEngine, ProgressEvent, RegistryInstallOptions, ApplyManifestOptions};

let _result = InstallEngine::install_from_registry_with_observer(
    "openclaw-docker",
    RegistryInstallOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        apply: ApplyManifestOptions {
            progress: true,
            ..Default::default()
        },
    },
    &|event| match event {
        ProgressEvent::StageStarted { stage, total_steps } => {
            println!("stage {stage} started with {total_steps} steps");
        }
        ProgressEvent::StepCommandStarted { command_line, .. } => {
            println!("running {command_line}");
        }
        ProgressEvent::StepLogChunk { chunk, .. } => {
            print!("{chunk}");
        }
        ProgressEvent::StepCompleted { step_id, success, exit_code, .. } => {
            println!("step {step_id} success={success} exit={exit_code:?}");
        }
        _ => {}
    },
)?;
```

## CLI Behavior

When the Rust CLI uses `--progress` or `--verbose`:

- `ProgressEvent` values are rendered to `stderr`,
- `StepLogChunk` contents are forwarded in real time,
- final JSON still stays on `stdout`.

This is the same event model the library API exposes. There is no separate CLI-only progress protocol.

## Design Guidance For Products

Use the structured stream as your integration surface.

Good uses:

- progress bars,
- grouped install logs,
- activity timelines,
- error reporting with exact step IDs and exit codes,
- Tauri event forwarding.

Avoid:

- parsing terminal strings,
- treating raw stderr as the primary source of truth,
- assuming a single log line equals a complete semantic step.
