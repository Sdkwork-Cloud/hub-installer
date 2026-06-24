> Migrated from `docs/index.md` on 2026-06-24.
> Owner: SDKWork maintainers

---
layout: home

hero:
  name: hub-installer
  text: Cross-Platform Install Engine For Node.js And Rust
  tagline: Manifest and registry driven software installation with Docker, WSL, and Tauri-ready progress streaming.
  actions:
    - theme: brand
      text: Start Here
      link: /guide/getting-started
    - theme: alt
      text: Node.js Docs
      link: /nodejs/overview
    - theme: alt
      text: Rust Docs
      link: /rust/overview

features:
  - title: Shared Install Model
    details: One manifest and registry design across package installs, git/source flows, command artifacts, and software catalogs.
  - title: Node.js Tooling Surface
    details: Use the TypeScript package for planning, CLI workflows, registry-based installs, and manifest-driven orchestration.
  - title: Rust Embedding Surface
    details: Use the Rust crate when you need native integration, structured progress events, or Tauri-friendly install orchestration.
  - title: Runtime-Aware Docker Support
    details: Distinguish host platform, effective runtime platform, and container runtime so Windows, Linux, host Docker, and WSL Docker remain predictable.
  - title: Real-Time Install Telemetry
    details: Stream stage, artifact, step, command, stdout, and stderr events from the Rust engine while keeping final JSON results stable.
  - title: Registry-Centered Productization
    details: Ship install profiles for OpenClaw, Codex, Node.js, Python, and your own software with consistent policies and shortcuts.
---

## What This Site Covers

This documentation is split into two parallel surfaces:

- **Node.js / TypeScript** for CLI-heavy workflows, package installs, registry operations, and manifest orchestration.
- **Rust** for native embedding, runtime-aware execution, real-time progress streaming, and Tauri integration.

Both surfaces share the same core product model:

1. resolve an install target,
2. build or load a manifest,
3. resolve platform and runtime policy,
4. execute lifecycle stages and artifacts,
5. emit results and diagnostics.

## Choose The Right Surface

| Need | Best fit |
| --- | --- |
| Ship a CLI and scriptable automation quickly | [Node.js / TypeScript](/nodejs/overview) |
| Embed installs inside a native desktop app | [Rust](/rust/overview) |
| Stream structured logs into a frontend | [Rust progress streaming](/rust/progress-streaming) |
| Install software by registry name and manifest | Both |
| Build a Tauri command that installs software | [Rust + Tauri](/rust/tauri) |

## Start With These Pages

- [Getting Started](/guide/getting-started)
- [Architecture](/guide/architecture)
- [Runtime And Docker](/guide/runtime-and-docker)
- [Node.js Library Usage](/nodejs/library)
- [Rust Library Usage](/rust/library)
- [Reference Overview](/reference/)

