> Migrated from `docs/plans/2026-03-18-docker-runtime-architecture-design.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Docker Runtime Architecture Design

## Goal

Make the Rust `hub-installer` runtime model first-class for Docker-oriented installs so that Windows host Docker, Linux host Docker, WSL installs, and WSL-internal Docker execution are all supported through one coherent API and CLI surface.

## Current Gaps

- `platform` currently mixes target OS, shell family, and execution host assumptions.
- Rust policy resolution does not understand WSL-native layouts.
- The executor can choose Git Bash on Windows, but it cannot intentionally execute inside WSL.
- Docker routing is implicit inside manifests, so there is no clean way to auto-detect or explicitly force host Docker versus WSL Docker.
- Rust API results do not tell callers which runtime was actually chosen.

## Design

### 1. Split runtime concerns

Introduce four distinct concepts:

- `host_platform`: the real OS running the Rust library.
- `target_platform`: the software profile being requested from registry/manifest resolution.
- `effective_runtime_platform`: where shell/file semantics should behave, including `wsl`.
- `container_runtime`: how Docker should be reached, with `host` or `wsl`.

### 2. Add runtime resolution

Create a dedicated runtime resolver that:

- honors explicit API/CLI overrides first;
- auto-detects WSL distributions on Windows;
- prefers WSL Docker when the manifest requests container runtime auto mode and WSL Docker is available;
- falls back to host Docker on Windows when WSL Docker is unavailable;
- reports the resolved runtime context back to callers.

### 3. Make policy runtime-aware

Install path policy should resolve against `effective_runtime_platform`, not just `platform`.

- Native Windows runtime keeps Windows layouts.
- Native Unix runtime keeps Unix layouts.
- WSL runtime uses WSL home paths and Unix layouts.
- Windows override paths are translated to `/mnt/<drive>/...` when running inside WSL.

### 4. Make executor runtime-aware

The executor should receive the resolved runtime context and use it to choose the launcher:

- Windows native Bash -> Git Bash or configured Bash path.
- WSL runtime -> `wsl.exe [-d <distro>] -- bash -lc ...`.
- Native PowerShell/Cmd continue to run on the host.

For WSL execution, env exports, working directory changes, and sudo handling are injected into the wrapped Bash script so command steps behave consistently.

### 5. Expose runtime metadata to manifests

Inject the following variables into manifest rendering:

- `hub_host_platform`
- `hub_effective_runtime_platform`
- `hub_container_runtime`
- `hub_wsl_distribution`
- `hub_docker_context`
- `hub_docker_host`

This lets Docker manifests display and validate the chosen route without hard-coding Windows-vs-WSL logic in every script.

### 6. Product defaults

- Docker profiles should be installable on Windows and Unix hosts.
- On Windows, Docker profiles default to container runtime `auto`.
- `auto` prefers WSL Docker when available, then host Docker.
- Advanced callers can override with explicit runtime/container selections.

## Verification

- Unit tests for runtime resolution and WSL path normalization.
- Executor contract tests for WSL launcher generation and Git Bash fallback.
- CLI parse tests for new runtime flags.
- Full `cargo test`, `cargo build`, `cargo clippy --all-targets --all-features -- -D warnings`.
- Real local Docker scenario verification for OpenClaw on Windows host, including explicit host Docker and explicit WSL Docker paths.

