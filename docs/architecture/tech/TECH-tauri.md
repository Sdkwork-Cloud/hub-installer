> Migrated from `docs/rust/tauri.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Tauri Integration

Rust is the right `hub-installer` surface for Tauri because the library already exposes structured progress events and final result objects.

## Recommended Backend Pattern

1. expose a Tauri command,
2. call `InstallEngine::*_with_observer`,
3. forward each `ProgressEvent` to the frontend,
4. return the final result object once the install completes.

## Backend Example

```rust
use hub_installer_rs::{
    ApplyManifestOptions,
    InstallEngine,
    ProgressEvent,
    RegistryInstallOptions,
};
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn install_openclaw(app: AppHandle) -> Result<hub_installer_rs::RegistryInstallResult, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_owned())?;

    InstallEngine::install_from_registry_with_observer(
        "openclaw-docker",
        RegistryInstallOptions {
            registry_source: Some("./registry/software-registry.yaml".to_owned()),
            apply: ApplyManifestOptions {
                progress: true,
                ..Default::default()
            },
        },
        &move |event: &ProgressEvent| {
            let _ = window.emit("hub-installer:progress", event);
        },
    )
    .map_err(|error| error.to_string())
}
```

## Frontend Example

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type ProgressEvent =
  | { type: "stageStarted"; stage: string; totalSteps: number }
  | { type: "stageCompleted"; stage: string; success: boolean; totalSteps: number; failedSteps: number }
  | { type: "artifactStarted"; artifactId: string; artifactType: string }
  | { type: "artifactCompleted"; artifactId: string; artifactType: string; success: boolean }
  | { type: "stepStarted"; stepId: string; description: string }
  | { type: "stepCommandStarted"; stepId: string; commandLine: string; workingDirectory?: string }
  | { type: "stepLogChunk"; stepId: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "stepCompleted"; stepId: string; success: boolean; skipped: boolean; durationMs: number; exitCode?: number | null };

const unlisten = await listen<ProgressEvent>("hub-installer:progress", (event) => {
  const payload = event.payload;
  console.log(payload);
});

const result = await invoke("install_openclaw");
console.log(result);

await unlisten();
```

## Product Design Guidance

Treat progress events and final results as two different UI channels.

### Good UI split

- event stream powers live activity,
- final result powers summary state, next actions, and durable records.

### Bad UI split

- using terminal text as the UI contract,
- waiting for the final result before showing anything,
- mixing transient log chunks into the final state model.

## Recommended Event UX

In a polished Tauri product, the frontend usually renders:

- stage-level status,
- current step,
- live log console,
- per-step failure details,
- resolved install locations from the final result.

That gives users both confidence during execution and a reliable summary afterwards.

