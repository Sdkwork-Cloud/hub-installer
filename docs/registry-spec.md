# Hub Installer Registry Spec v1.0

This document defines the software registry standard used by:

- `hub-installer install <software>`
- `hub-installer doctor [software]`
- `hub-installer registry validate`
- `hub-installer registry list`
- `hub-installer registry show <software>`
- `hub-installer registry install <software>`

## 1. Goal

A registry maps a software name (and aliases) to install manifest sources, so users can install by name instead of manually selecting manifest files.

## 2. File format

- Supported: `.json`, `.yaml`, `.yml`
- `schemaVersion` must be `"1.0"`
- `$schema` is optional but recommended
- official schema file:
  - `schemas/hub-installer.registry.schema.json`

## 3. Top-level fields

| Field | Required | Type | Description |
|---|---|---|---|
| `schemaVersion` | yes | string | Must be `"1.0"` |
| `metadata` | yes | object | Registry metadata |
| `entries` | yes | array | Software entries |

## 4. Entry fields

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | yes | string | Primary software key |
| `aliases` | no | string[] | Alternative names |
| `description` | no | string | Human-readable summary |
| `homepage` | no | string | Optional homepage URL |
| `tags` | no | string[] | Classification tags |
| `manifest` | yes | string/object | Manifest source or by-platform map |
| `variables` | no | object | Default variable overrides for manifest |

`manifest` supports:

1. single source:

```yaml
manifest: "./manifests/nodejs.hub.yaml"
```

2. by-platform source:

```yaml
manifest:
  byPlatform:
    windows: "./manifests/nodejs.win.hub.yaml"
    macos: "./manifests/nodejs.macos.hub.yaml"
  fallback: "./manifests/nodejs.generic.hub.yaml"
```

## 5. Source resolution

Manifest source resolution follows registry source type:

- registry from local file/dir: relative `manifest` paths are resolved relative to registry file directory
- registry from remote URL: relative `manifest` paths are resolved against that URL

Remote registry and manifest sources support cache directories and fetch timeout controls through CLI options.

## 5.1 Runtime policy variables

Registry variables can participate in install policy resolution. The bundled registry now uses these reserved keys:

| Variable | Meaning |
|---|---|
| `hub_software_name` | Canonical software name used for install/work-root resolution |
| `hub_install_control_level` | `managed`, `partial`, or `opaque` |
| `hub_install_root` | Resolved final install root |
| `hub_work_root` | Resolved source/work directory |
| `hub_bin_dir` | Resolved binary directory |
| `hub_data_root` | Resolved data directory |

These variables are injected by `hub-installer` at apply time. Registry entries may also set `hub_software_name` or `hub_install_control_level` explicitly to keep profile families consistent.

Example:

```yaml
variables:
  hub_software_name: "openclaw"
  hub_install_control_level: "managed"
  openclaw_source_dir: "{{hub_work_root}}"
```

## 6. Default registry

Default registry location candidates:

1. `./registry/software-registry.yaml`
2. `./registry/software-registry.yml`
3. `./registry/software-registry.json`
4. `./software-registry.yaml`
5. `./software-registry.yml`
6. `./software-registry.json`

If none exist, use `--registry` to provide explicit source.

## 7. CLI examples

```bash
# Shortcut: install by software name directly
hub-installer openclaw
hub-installer install openclaw
hub-installer openclaw beta
hub-installer openclaw docker
hub-installer openclaw --software-version beta
hub-installer codex dotslash-release
hub-installer codex main
hub-installer codex dotslash-release --software-version v0.2.0
hub-installer nodejs 22
hub-installer nodejs fnm --software-version 22
hub-installer python 3.12
hub-installer python uv --software-version 3.12

hub-installer list
hub-installer info openclaw
hub-installer doctor
hub-installer doctor openclaw
hub-installer doctor codex --json
hub-installer doctor nodejs
hub-installer doctor python --runtime
hub-installer doctor openclaw --runtime
hub-installer registry validate
hub-installer registry list
hub-installer registry show openclaw
hub-installer registry install openclaw
hub-installer registry show codex
hub-installer registry install codex
hub-installer registry install node --dry-run
hub-installer registry install ffmpeg --registry ./registry/software-registry.yaml
hub-installer registry install git --registry https://example.com/software-registry.yaml --registry-cache-dir ./.cache/registry --cache-dir ./.cache/manifests
hub-installer registry install openclaw-cli-script --install-scope system --install-root /opt/openclaw --bin-dir /usr/local/bin
hub-installer registry install codex --platform windows --effective-runtime-platform wsl
```

Unified version shortcut:

- preferred: `--software-version <version>`
- positional shorthand (minimal mode): `hub-installer codex <ref>`, `hub-installer nodejs <version>`, `hub-installer python <version>`
- compatible legacy flags: `--channel`, `--node-version`, `--python-version`

Doctor mode:

- supported targets: `all`, `openclaw`, `codex`, `nodejs`, `python`
- default `doctor` checks registry + manifest consistency against built-in installer expectations
- add `--runtime` to include host runtime prerequisite checks (for example command presence and WSL distribution checks for Codex on Windows)
- failed checks include actionable `recommendation` hints in text and JSON output

## 8. Built-in entries

The bundled registry includes install profiles for `openclaw`, plus strategy-selectable
entries for `codex`, `nodejs`, and `python`.

### 8.1 OpenClaw

OpenClaw profiles are split into dedicated manifests for high cohesion and easier extension:

Design reference: `docs/openclaw-profile-architecture.md`

- `openclaw` -> `registry/manifests/openclaw.hub.yaml` (recommended installer script default)
- `openclaw-git` -> `registry/manifests/openclaw-installer-script-git.hub.yaml`
- `openclaw-cli-script` -> `registry/manifests/openclaw-installer-cli-script.hub.yaml`
- `openclaw-npm` -> `registry/manifests/openclaw-npm.hub.yaml`
- `openclaw-pnpm` -> `registry/manifests/openclaw-pnpm.hub.yaml`
- `openclaw-source` -> `registry/manifests/openclaw-source.hub.yaml`
- `openclaw-bun` -> `registry/manifests/openclaw-bun.hub.yaml`
- `openclaw-docker` -> `registry/manifests/openclaw-docker.hub.yaml`
- `openclaw-podman` -> `registry/manifests/openclaw-podman.hub.yaml`
- `openclaw-ansible` -> `registry/manifests/openclaw-ansible.hub.yaml`
- `openclaw-nix` -> `registry/manifests/openclaw-nix.hub.yaml`
- `openclaw-all` -> `registry/manifests/openclaw-all.hub.yaml` (legacy all-in-one selector)

Common variables (profile dependent):

- `hub_software_name`
- `hub_install_control_level`
- `openclaw_channel`
- `openclaw_onboard`
- `openclaw_source_dir`
- `openclaw_git_update`
- `openclaw_install_prefix`
- `openclaw_install_cli_node_version`
- `openclaw_install_cli_json`
- `openclaw_install_cli_set_npm_prefix`
- `openclaw_docker_image`
- `openclaw_ansible_dir`
- `openclaw_nix_flake`
- `openclaw_installer_no_prompt`
- `openclaw_installer_dry_run`
- `openclaw_installer_verbose`

Example:

```bash
hub-installer install openclaw
hub-installer openclaw beta
hub-installer openclaw --software-version beta
hub-installer install openclaw-docker
hub-installer openclaw npm --channel beta --onboard false
hub-installer install openclaw --method source
hub-installer install openclaw --var openclaw_installer_no_prompt=true --var openclaw_installer_dry_run=true --var openclaw_installer_verbose=true
hub-installer install openclaw-cli-script --var openclaw_install_cli_json=true --var openclaw_install_cli_set_npm_prefix=true
hub-installer install openclaw-all --var openclaw_install_method=nix
```

OpenClaw doc-to-profile mapping (`openclaw/docs/install/*.md`):

| OpenClaw docs path | Hub Installer profile | windows | macos | ubuntu |
|---|---|---:|---:|---:|
| `install/index.md` installer script | `openclaw` | yes | yes | yes |
| `install/installer.md` (`install.sh --install-method git` / `install.ps1 -InstallMethod git`) | `openclaw-git` | yes | yes | yes |
| `install/installer.md` (`install-cli.sh`) | `openclaw-cli-script` | no | yes | yes |
| `install/index.md` npm tab | `openclaw-npm` | yes | yes | yes |
| `install/index.md` pnpm tab | `openclaw-pnpm` | yes | yes | yes |
| `install/index.md` from source | `openclaw-source` | yes | yes | yes |
| `install/bun.md` | `openclaw-bun` | no | yes | yes |
| `install/docker.md` | `openclaw-docker` | yes | yes | yes |
| `install/podman.md` | `openclaw-podman` | no | yes | yes |
| `install/ansible.md` | `openclaw-ansible` | no | yes | yes |
| `install/nix.md` | `openclaw-nix` | no | yes | yes |

OpenClaw control levels:

| Profile | Control level |
|---|---|
| `openclaw` | `opaque` |
| `openclaw-git` | `partial` |
| `openclaw-cli-script` | `managed` |
| `openclaw-source` | `managed` |
| `openclaw-npm` / `openclaw-pnpm` | `partial` |
| `openclaw-docker` / `openclaw-podman` / `openclaw-ansible` / `openclaw-nix` | `opaque` |

OpenClaw runtime prerequisite mapping:

| OpenClaw docs path | Hub Installer builtin | Supported methods |
|---|---|---|
| `install/node.md` | `nodejs` | `os-package`, `fnm`, `nvm` |

OpenClaw deployment/operations docs (for example `exe-dev.md`, `fly.md`, `gcp.md`,
`hetzner.md`, `northflank.mdx`, `railway.mdx`, `render.mdx`, `updating.md`,
`migrating.md`, `uninstall.md`) are intentionally treated as operational guides,
not one-command registry install profiles.

OpenClaw channel mapping (`openclaw/docs/install/development-channels.md`) for profiles that support channel override:

| OpenClaw channel | Variable override |
|---|---|
| stable | `--channel latest` |
| beta | `--channel beta` |
| dev | `--channel dev` |

Equivalent unified shortcut: `hub-installer openclaw --software-version <latest|beta|dev|semver>`

### 8.2 Codex

Manifest: `registry/manifests/codex.hub.yaml`

Main variable:

- `codex_install_method`

Supported values:

- `source-build`
- `dotslash-release`

Additional common variables:

- `hub_software_name`
- `hub_install_control_level`
- `codex_git_ref`
- `codex_release_tag`
- `codex_install_just`
- `codex_install_nextest`
- `codex_source_dir`

Windows note:

- bundled Codex installs report `effectiveRuntimePlatform: wsl` on Windows
- WSL work roots default to `~/.sdkwork/hub-installer/state/sources/codex`
- WSL binary targets default to `~/.local/bin/codex`

Example:

```bash
hub-installer codex source-build
hub-installer codex dotslash-release
hub-installer codex main
hub-installer codex dotslash-release --software-version v0.2.0
hub-installer install codex --method dotslash-release
```

### 8.3 Node.js

Manifest: `registry/manifests/nodejs.hub.yaml`

Main variable:

- `nodejs_install_method`

Supported values:

- `os-package`
- `fnm`
- `nvm` (macOS/Linux)

Additional common variables:

- `nodejs_version` (for `fnm` / `nvm`; also accepted by `os-package`)
- `nodejs_version_major` (for Ubuntu NodeSource setup; auto-derived from version shortcut when possible)
- `nodejs_windows_package_manager` (`winget` / `choco`)

Example:

```bash
hub-installer nodejs os-package
hub-installer nodejs 22
hub-installer nodejs --software-version 20.11.1
hub-installer nodejs fnm --node-version 22
hub-installer install nodejs --method nvm --software-version 22
```

### 8.4 Python

Manifest: `registry/manifests/python.hub.yaml`

Main variable:

- `python_install_method`

Supported values:

- `os-package`
- `pyenv` (macOS/Linux)
- `uv`

Additional common variables:

- `python_version`
- `python_windows_package_manager` (`winget` / `choco`)
- `python_windows_package_id` (winget package id; auto-derived from version shortcut when possible)
- `python_install_pipx` (`true` / `false`)

Example:

```bash
hub-installer python os-package
hub-installer python 3.12
hub-installer python --software-version 3.11.9
hub-installer python pyenv --python-version 3.12
hub-installer install python --method uv --software-version 3.12
```
