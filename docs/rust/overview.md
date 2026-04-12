# Rust Overview

The Rust surface exists to make `hub-installer` embeddable inside native applications.

Use it when you want:

- a library-first installer engine,
- structured progress events instead of terminal scraping,
- precise runtime control across Windows, Linux, Docker, and WSL,
- direct integration into a Tauri backend.

## Package Identity

- crate package: `hub-installer-rs`
- library crate: `hub_installer_rs`
- CLI binary: `hub-installer-rs`

## The Main Product Promise

Rust keeps two outputs separate:

1. **real-time progress events** for UI/log consumers,
2. **final structured result objects** for application logic.

That design is what makes Rust the right surface for desktop products.

## Primary Public Exports

```rust
use hub_installer_rs::{
    ApplyManifestOptions,
    ApplyManifestResult,
    ExecutionContext,
    InstallEngine,
    ProgressEvent,
    ProgressObserver,
    ProgressStream,
    RegistryInstallOptions,
    RegistryInstallResult,
    RuntimeOptions,
    SystemRuntimeProbe,
    resolve_execution_context,
    resolve_install_policy,
};
```

## Main Use Cases

### Apply a manifest directly

```rust
let result = InstallEngine::apply_manifest(
    "./examples/openclaw-docker.hub.yaml",
    hub_installer_rs::ApplyManifestOptions::default(),
)?;
```

### Install software from the registry

```rust
let result = InstallEngine::install_from_registry(
    "openclaw",
    hub_installer_rs::RegistryInstallOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        apply: hub_installer_rs::ApplyManifestOptions::default(),
    },
)?;
```

### Stream progress while installing

```rust
let result = InstallEngine::install_from_registry_with_observer(
    "openclaw-docker",
    hub_installer_rs::RegistryInstallOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        apply: hub_installer_rs::ApplyManifestOptions {
            progress: true,
            ..Default::default()
        },
    },
    &|event| {
        println!("{event:?}");
    },
)?;
```

## What Rust Adds Beyond Node.js

| Capability | Rust advantage |
| --- | --- |
| Native desktop embedding | No shell-out wrapper required |
| Tauri integration | Observer events map naturally to frontend event buses |
| Real-time logs | Step command, stdout, and stderr chunks are structured |
| Runtime resolution | WSL and Docker controls are explicit |

## Where To Go Next

- [Rust Library Usage](/rust/library)
- [Rust CLI Usage](/rust/cli)
- [Progress Streaming](/rust/progress-streaming)
- [Tauri Integration](/rust/tauri)
