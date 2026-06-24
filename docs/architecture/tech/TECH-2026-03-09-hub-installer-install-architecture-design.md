> Migrated from `docs/plans/2026-03-09-hub-installer-install-architecture-design.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Hub Installer Install Architecture Design

## Summary

This design hardens `hub-installer` around three truths:

1. `hub-installer` itself needs a stable home for config, cache, state, and logs.
2. Software install targets must be modeled separately from `hub-installer`'s own files.
3. Built-in install profiles must describe their real level of install-directory control instead of implying more control than they actually have.

The design standardizes `hub-installer` state under `~/.sdkwork/hub-installer`, introduces platform-aware install policy resolution, and upgrades dry-run and doctor output so users can see exactly what will happen before an install is executed.

## Goals

- Standardize all `hub-installer` config, cache, log, and state paths.
- Define clear default install locations for Windows, macOS, and Ubuntu.
- Separate software work directories from software final install directories.
- Make built-in OpenClaw/Codex/Node.js/Python profiles report their real install control level.
- Improve `doctor` and `--dry-run --json` so path resolution, privilege requirements, and control boundaries are visible.
- Preserve existing CLI entrypoints while moving internals to a coherent path and policy model.

## Non-Goals

- Do not force third-party upstream installers to support custom install roots when they do not expose that capability.
- Do not use `~/.sdkwork/hub-installer` as the software install root.
- Do not pretend Docker/Podman/Ansible/Nix installs behave like native Program Files or `/Applications` installs.
- Do not claim that Codex on Windows installs natively into Windows program directories when the documented runtime is WSL2.

## Current Problems

### Fragmented internal paths

Remote manifest, registry, and package caches currently default into OS temp directories:

- manifest cache: temp-based
- registry cache: temp-based
- package cache: temp-based

This makes behavior harder to reason about, harder to inspect, and harder to support across machines and CI environments.

### Built-in profiles hard-code user-home paths

Several built-in manifests and registry entries currently default to paths such as:

- `{{home}}/openclaw`
- `{{home}}/.openclaw`
- `{{home}}/codex`
- `{{home}}/.local/bin/codex`

That mixes source workspaces, runtime data, and final install locations. It also prevents a consistent policy for system-scope installs.

### Install control is not modeled explicitly

Different install methods have different levels of path control:

- package managers and native installers often choose final locations themselves
- prefix-based installers expose strong directory control
- source builds can be fully managed by `hub-installer`
- upstream convenience scripts may not expose final install roots at all

Today that difference is not surfaced clearly enough in CLI output or doctor checks.

### Validation signals are incomplete

Current tests and doctor checks mostly prove that manifests load and scripts contain expected markers. They do not yet prove:

- where the install would land
- whether the target directory is user-controlled or system-controlled
- whether the profile can fully honor a standard install root
- whether Windows-hosted flows actually target Windows or WSL paths

## Design Principles

### Separate tool state from installed software

`hub-installer` state belongs in one stable location. Installed software belongs in platform-standard install directories or in platform-standard user directories when the user explicitly chooses user scope.

### Model capability honestly

Profiles must declare whether install roots are:

- fully managed by `hub-installer`
- partially guided but ultimately controlled by an upstream installer
- opaque and controlled by an external script or platform service

### Favor standard OS conventions

Defaults should follow OS norms:

- Windows system installs target `Program Files`
- macOS app installs target `/Applications`
- Ubuntu system installs target `/opt` plus `/usr/local/bin`

### Make planning visible before execution

The resolved installer home, install scope, install root, work root, bin directory, data directory, and control level should appear in dry-run and doctor output.

## Directory Model

### 1. Hub Installer Home

Default location:

- Linux/macOS: `~/.sdkwork/hub-installer`
- Windows: `%USERPROFILE%\.sdkwork\hub-installer`

Subdirectories:

- `config/`
- `cache/registry/`
- `cache/manifests/`
- `cache/packages/`
- `state/sources/`
- `state/tmp/`
- `state/install-records/`
- `logs/`

This directory is only for `hub-installer` itself.

### 2. Software Work Root

Default location:

- `<installerHome>/state/sources/<software>/`

This holds:

- source checkouts
- build workspaces
- temporary wrappers
- generated helper scripts

This is especially important for:

- `codex` source builds
- `openclaw-source`
- `openclaw-git`

### 3. Software Final Install Root

This is separate from the work root and depends on platform and install scope.

#### Windows

- system scope:
  - `%ProgramFiles%\<App>`
- user scope:
  - `%LocalAppData%\Programs\<App>`

#### macOS

- system scope:
  - app bundles: `/Applications/<App>.app`
  - CLI/source builds: `/usr/local/lib/<app>` with binaries in `/usr/local/bin`
- user scope:
  - app bundles: `~/Applications/<App>.app`
  - CLI/source builds: `~/.local/opt/<app>` with binaries in `~/.local/bin`

#### Ubuntu

- system scope:
  - `/opt/<app>` with binaries in `/usr/local/bin`
- user scope:
  - `~/.local/opt/<app>` with binaries in `~/.local/bin`

## Install Control Levels

Each built-in profile should resolve to an `installControlLevel`:

- `managed`
  - `hub-installer` fully controls work and final install targets
- `partial`
  - `hub-installer` can influence some install locations, but the final result is partly controlled by an external installer or package manager
- `opaque`
  - final locations are decided by an upstream script or service and cannot be reliably standardized

### Expected classification

- `codex` source-build: `managed`
- `codex` dotslash-release on Unix: `managed`
- `codex` on Windows via WSL: `managed`, but target runtime must be shown as WSL
- `openclaw-source`: `managed`
- `openclaw-git`: `managed` if wrapper/bin placement is under our control after build
- `openclaw-cli-script`: `managed`
- `openclaw` installer-script: `opaque` or `partial`, depending on how much path control is actually exposed
- `nodejs` via winget/choco/brew/apt/snap: `partial`
- `python` via winget/choco/brew/apt: `partial`
- Docker/Podman/Ansible/Nix profiles: environment-managed, not native-directory-managed

## Configuration and Resolution Order

`hub-installer` should load configuration from:

- CLI arguments
- environment variables
- `~/.sdkwork/hub-installer/config/config.json`
- registry entry variables
- manifest variables

### New configuration concerns

- installer home override
- install scope override (`system` / `user`)
- install root override
- work root override
- bin directory override
- data directory override

### Example environment variables

- `HUB_INSTALLER_HOME`
- `HUB_INSTALLER_CONFIG`
- `HUB_INSTALLER_INSTALL_SCOPE`
- `HUB_INSTALLER_INSTALL_ROOT`
- `HUB_INSTALLER_WORK_ROOT`
- `HUB_INSTALLER_BIN_DIR`

## Template Variable Model

Built-in manifests should stop hard-coding `{{home}}/...` for install policy. Instead they should consume resolved variables such as:

- `installerHome`
- `installerConfigDir`
- `installerCacheDir`
- `installerStateDir`
- `installerLogDir`
- `hub_install_scope`
- `hub_install_root`
- `hub_work_root`
- `hub_bin_dir`
- `hub_data_root`

That keeps manifests declarative while making default behavior consistent.

## Built-In Profile Design

### OpenClaw

- `openclaw` installer-script remains the recommended user shortcut, but must be described honestly as upstream-script-driven.
- `openclaw-cli-script` becomes the primary path-controlled OpenClaw profile.
- `openclaw-source` and `openclaw-git` move source checkouts into installer-managed work roots.
- container or infrastructure profiles report their own environment behavior rather than native program-directory semantics.

### Codex

- source builds should clone into installer-managed work roots and install binaries into standard CLI locations.
- DotSlash downloads should target resolved install roots rather than hard-coded `~/.local/bin`.
- Windows runs must explicitly state that the effective runtime and install target are inside WSL2, not native Windows directories.

### Node.js and Python

- package-manager methods should report standard target roots as recommendations while marking final placement as package-manager-controlled.
- version-manager and tool-managed methods should expose more precise install roots when possible.

## CLI, Dry-Run, and Doctor Output

### Dry-run JSON additions

Each built-in install result should include:

- `installerHome`
- `resolvedInstallScope`
- `resolvedInstallRoot`
- `resolvedWorkRoot`
- `resolvedBinDir`
- `resolvedDataRoot`
- `installControlLevel`
- `effectiveRuntimePlatform`

### Doctor additions

Doctor should validate:

- installer home writability
- resolved path model for the chosen profile
- whether the profile supports strict install-root control
- whether elevation is required for the resolved scope and platform
- whether Windows-hosted WSL flows are being reported correctly

## Error Handling

Errors should include path and policy context whenever possible:

- failed path
- operation attempted
- resolved install scope
- whether elevation is required
- recommended remediation

Examples:

- system-scope install without elevation should fail during preflight, not mid-install
- opaque upstream-script flows should warn about path control limits before execution
- successful upstream install with failing healthcheck should return a failed overall result with an explicit "verification failed after install" reason

## Migration Plan

### Phase 1: Introduce policy and path model

- add installer home and install policy resolution
- wire caches to installer home defaults
- expose resolved path metadata in dry-run and doctor

### Phase 2: Migrate controllable built-in profiles

- migrate Codex and OpenClaw source/prefix flows to unified variables
- move work roots under installer home state
- standardize final bin placement per platform

### Phase 3: Upgrade docs and diagnostics

- refresh README, profile tables, and registry documentation
- document install control levels and default target roots
- extend e2e dry-run assertions and doctor coverage

## Risks

- Overstating control for upstream installers would create misleading UX. This design avoids that by formalizing `installControlLevel`.
- Windows + WSL path reporting can easily become confusing. The design requires host-platform and effective-runtime-path reporting to stay distinct.
- Existing examples and manifests may drift unless they all move to the same resolved variable model.

## Acceptance Criteria

This design is complete when all of the following are true:

- `hub-installer` internal files default to `~/.sdkwork/hub-installer`
- built-in installs resolve standard target roots by platform and scope
- controllable and non-controllable profile types are clearly distinguished
- `doctor` and `--dry-run --json` expose resolved path and control metadata
- OpenClaw and Codex documentation mappings reflect real behavior
- the user can tell, before execution, where tool state lives, where software workspaces live, where final installs target, and which parts are or are not controlled by `hub-installer`

