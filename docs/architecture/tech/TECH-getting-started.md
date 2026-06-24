> Migrated from `docs/guide/getting-started.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Getting Started

`hub-installer` is one product with two implementation surfaces:

- a **Node.js / TypeScript** package and CLI for general-purpose automation,
- a **Rust** crate and CLI for native integration and structured progress streaming.

## Prerequisites

For the full workspace:

- Node.js `>= 20`
- `pnpm@10`
- a current Rust toolchain with `cargo`

Useful host tools depending on what you install:

- Docker
- WSL on Windows
- package managers such as `winget`, `brew`, `apt`, or `snap`

## Repository Setup

Install Node.js dependencies:

```bash
pnpm install
```

Build the TypeScript package:

```bash
pnpm build
```

Build the Rust crate:

```bash
cargo build --manifest-path rust/Cargo.toml
```

Run the current verification suites:

```bash
pnpm test
cargo test --manifest-path rust/Cargo.toml
```

Start the docs site locally:

```bash
pnpm docs:dev
```

## Quick Start Paths

### Node.js package install planning

```ts
import { createInstallPlan } from "hub-installer";

const plan = await createInstallPlan({
  source: "winget://Git.Git",
  platform: "windows"
});

console.log(plan.steps);
```

### Node.js manifest application

```ts
import { applyManifestFile } from "hub-installer";

const result = await applyManifestFile("./examples/full-stack.hub.yaml", {
  platform: "ubuntu",
  dryRun: true
});

console.log(result.success);
```

### Rust registry install with progress

```rust
use hub_installer_rs::{
    ApplyManifestOptions, InstallEngine, ProgressEvent, RegistryInstallOptions,
};

let result = InstallEngine::install_from_registry_with_observer(
    "openclaw-docker",
    RegistryInstallOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        apply: ApplyManifestOptions {
            platform: Some(hub_installer_rs::types::SupportedPlatform::Windows),
            progress: true,
            ..Default::default()
        },
    },
    &|event: &ProgressEvent| {
        println!("{event:?}");
    },
)?;

println!("{}", result.apply_result.success);
```

## Which Surface Should You Use?

| Scenario | Recommended surface |
| --- | --- |
| CLI-first usage, scripting, JSON/text outputs | Node.js |
| Library embedding in a server or tool | Node.js |
| Native desktop backend integration | Rust |
| Tauri backend commands and event streaming | Rust |
| Structured per-step command/log events | Rust |

## Core Concepts

No matter which surface you choose, the mental model stays the same:

- **Install request**: a direct package source such as `winget://Git.Git`, `apt://curl`, or an installer file/URL.
- **Manifest**: a full lifecycle document describing dependencies, lifecycle hooks, and artifacts.
- **Registry**: a catalog that maps a software name such as `openclaw` or `nodejs` to a manifest source.
- **Install policy**: resolved directories for installer state, install root, work root, bin directory, and data directory.
- **Runtime context**: the combination of host platform, effective runtime platform, and Docker/WSL behavior.

## Recommended Reading Order

1. [Architecture](/guide/architecture)
2. [Runtime And Docker](/guide/runtime-and-docker)
3. [Node.js Overview](/nodejs/overview) or [Rust Overview](/rust/overview)
4. [Reference Overview](/reference/)

