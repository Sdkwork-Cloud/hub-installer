> Migrated from `docs/plans/2026-03-17-rust-installer-architecture-design.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Rust Installer Architecture Design

## Context

`hub-installer` already has a broad TypeScript implementation, but the Rust crate under `rust/` is intended to become the embeddable engine for Tauri and other native hosts.

The current Rust code proves the direction, but it is not yet a production-grade engine:

- the crate does not compile on the current toolchain
- install policy defaults diverge from the documented product contract
- several execution paths are Unix-only even when the public API claims cross-platform support
- command execution ignores timeout semantics and shell selection metadata
- the package download path does not fully honor checksum and cache behavior documented by the TypeScript implementation
- the embeddable story is incomplete for Tauri-style progress reporting and long-running work orchestration

## Product Goal

Make the Rust engine the authoritative installer core for native embedding:

- usable as a regular Rust library
- safe to wire into Tauri command handlers
- correct across Windows, macOS, Ubuntu, Android, and iOS execution planning
- aligned with the manifest, registry, and install-policy contracts already documented in the repository

## Principles

### Correctness before breadth

The engine must compile, validate inputs, and execute plans deterministically before adding more command surface.

### Product contract must match runtime behavior

Defaults such as installer home, work roots, bin/data directories, and install-control metadata must match the README and policy documentation. A Rust port that behaves differently from the documented product is not acceptable.

### Platform abstraction must be truthful

Cross-platform support means platform-specific logic is explicit. Unix shell fragments hidden inside Windows flows are architectural bugs, not shortcuts.

### Embedding comes first

The Rust API should be designed around host integration:

- serializable result types
- stable error taxonomy
- progress hooks that can be bridged into Tauri events or channels
- non-UI-blocking execution patterns

### Capability-driven architecture

An installer engine should separate:

- policy resolution
- manifest/registry loading
- plan synthesis
- execution
- host integration

This avoids coupling product policy to CLI details.

## Gap Analysis

### 1. Build health is broken

The crate currently fails to compile because:

- CLI enums are not integrated with `clap`
- manifest and registry parsers rely on inference that no longer resolves cleanly on the current compiler

This blocks every downstream use case.

### 2. Install policy is inconsistent

The Rust engine currently defaults to:

- installer home: `~/.hub-installer`
- work root: `<installerHome>/work/<software>`
- bin/data roots: under install root

That conflicts with the documented product standard:

- installer home: `~/.sdkwork/hub-installer`
- work root: `<installerHome>/state/sources/<software>`
- user/system bin and data roots resolved by platform policy

### 3. Execution semantics are weaker than the manifest model

The manifest schema exposes:

- shell selection
- timeout
- conditional execution
- elevated execution
- continue-on-error

The executor only partially honors this:

- `shell` metadata is effectively collapsed to a boolean
- `timeout_ms` is stored but not enforced
- failure accounting is lossy for artifact stages

### 4. Cross-platform shelling is not real yet

Multiple artifact flows embed Unix shell scripts directly:

- `git` clone-or-pull
- source checkout/update
- archive extraction defaults

That makes Windows behavior unreliable even though the engine advertises Windows support.

### 5. Download and cache behavior lag product expectations

The TypeScript implementation already normalizes `sha256:` checksums and stores package downloads under the installer-home package cache. The Rust engine does neither reliably.

### 6. Tauri integration needs a first-class host layer

The engine can be called from Rust today, but it is still shaped like a CLI core. For Tauri embedding we need:

- a library-first API surface
- progress events that can be forwarded to the frontend
- execution patterns that avoid blocking the UI runtime

## Target Architecture

### Layer 1: Policy

Add a dedicated install-policy module that resolves:

- installer home
- work root
- install root
- bin dir
- data root
- install scope
- install control level

This module is pure and testable. Every execution path consumes resolved policy instead of recomputing paths ad hoc.

### Layer 2: Content Loading

Manifest and registry loading stay focused on:

- file/URL loading
- schema-version validation
- source resolution

No install-path policy should live here.

### Layer 3: Planning

Package planning converts resolved install requests into platform-specific steps. This layer must:

- honor download cache defaults
- honor archive extraction semantics
- avoid shell fragments where structured command steps are possible

### Layer 4: Execution

The executor must own:

- shell selection
- environment application
- timeout enforcement
- elevation wrapping
- step result capture

It should preserve enough structured detail for host UX and post-failure diagnosis.

### Layer 5: Host Integration

Expose an embeddable facade for Tauri and similar hosts:

- synchronous API for plain Rust callers
- callback-oriented progress API for host event bridging
- result/error types that serialize cleanly

This layer should not depend on `tauri` directly. Instead, it should provide hooks that Tauri apps can adapt into events or channels.

## Improvement Roadmap

### Phase 1: Restore trust

- fix build failures
- add regression tests for CLI parsing, policy defaults, checksum normalization, and cross-platform planning basics

### Phase 2: Harden correctness

- centralize install-policy resolution
- enforce timeout semantics
- respect shell metadata
- fix artifact success accounting

### Phase 3: Make platform handling honest

- replace Unix-only update commands with platform-aware command generation
- improve archive handling and remote download behavior

### Phase 4: Finish embedding surface

- add progress events and host-facing API hooks suitable for Tauri integration
- document recommended `spawn_blocking` or async-host integration patterns

## Algorithmic Opportunities

There is no single exotic algorithm that magically makes an installer engine elite. The highest leverage comes from choosing the right execution model:

- dependency and lifecycle execution should evolve toward a DAG instead of a fixed list once manifests gain richer dependency structure
- downloads should move toward content-addressable caching keyed by URL plus checksum
- retries should use bounded exponential backoff for transient network failures
- health checks should become condition-based verification rather than blind sequential commands where possible

For the current codebase, the most valuable improvement is not an academic algorithm. It is replacing implicit, stringly, shell-driven behavior with explicit typed planning and execution.

## Assumptions

The user explicitly delegated design and implementation decisions without interactive checkpoints. This design therefore assumes:

- library-first Rust embedding is more important than matching every TypeScript CLI command immediately
- correctness and contract alignment outrank feature count
- new API surface should remain host-agnostic so Tauri can consume it cleanly

## Acceptance Criteria

The Rust engine is in a strong production-ready state when all of the following are true:

- `cargo build`, `cargo test`, and `cargo clippy -- -D warnings` pass
- install-policy defaults match the documented product contract
- manifest and registry flows behave consistently across supported host platforms
- timeout, checksum, shell, and artifact-status semantics are enforced rather than implied
- the library surface is stable enough to integrate into a Tauri backend without blocking the UI thread or losing progress visibility

