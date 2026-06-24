> Migrated from `docs/manifest-spec.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Hub Installer Manifest Spec v1.0

This document defines the configuration standard for `hub-installer apply`.

## 1. Goal

A single manifest file should fully describe:

- environment checks before install
- dependency checks and optional auto-remediation
- installation units (package installer, git source code, huggingface model, generic commands)
- pre/post install hooks
- post-install configuration and health checks

## 2. File format

- Supported: `.json`, `.yaml`, `.yml`
- `schemaVersion` is required and currently must be `"1.0"`
- `$schema` is optional but recommended for editor/schema tooling
- official schema file:
  - `schemas/hub-installer.manifest.schema.json`

Manifest source accepted by CLI:

- local manifest file path
- local directory (auto-discover default manifest file names such as `hub-installer.yaml`)
- remote URL (`http://` / `https://`) with local cache download

## 3. Top-level fields

| Field | Required | Type | Description |
|---|---|---|---|
| `schemaVersion` | yes | string | Must be `"1.0"` |
| `metadata` | yes | object | Basic manifest metadata |
| `platforms` | no | string[] | Optional supported target platforms |
| `variables` | no | map | String template variables |
| `defaults` | no | object | Shared execution defaults (sudo, timeout, cwd, env...) |
| `dependencies` | no | array | Dependency checks + optional install commands |
| `lifecycle` | no | object | Global lifecycle hook commands |
| `installation` | no | object | Structured description of the automated method, documented alternatives, and install directories |
| `dataLayout` | no | object | Structured description of product data, config, logs, secrets, and databases |
| `migration` | no | object | Structured description of migration strategies, commands, and warnings |
| `artifacts` | yes | array | Installable units |

## 4. Variables and templates

Template syntax:

```text
{{variable_name}}
```

Built-in runtime variables:

- `platform`
- `manifestDir`
- `cwd`
- `home`
- `temp`
- `user`
- `pathSeparator`
- `hub_install_scope`
- `hub_install_root`
- `hub_work_root`
- `hub_bin_dir`
- `hub_data_root`
- `hub_install_control_level`
- `hub_effective_runtime_platform`
- `hub_backup_root`
- `hub_backup_session_dir`
- `hub_backup_data_dir`
- `hub_backup_install_dir`
- `hub_backup_work_dir`
- `hub_install_record_file`
- `hub_install_status`

Variable override from CLI:

```bash
hub-installer apply ./manifest.yaml --var key=value --var another=123
```

## 5. Lifecycle model

Execution order:

1. `lifecycle.preflight`
2. `dependencies` (check -> optional install -> recheck)
3. `lifecycle.preInstall`
4. `lifecycle.install`
5. `artifacts[*]`
6. `lifecycle.postInstall`
7. `lifecycle.configure`
8. `lifecycle.healthcheck`

Additional lifecycle stages used by lifecycle management:

9. `lifecycle.backup`
10. `lifecycle.uninstall`

Each artifact also supports local hooks:

- `preInstall`
- `postInstall`
- `configure`

`backup` and `uninstall` are global lifecycle hooks only. They are intended for software-specific stop/export/cleanup logic that wraps the generic engine backup or filesystem removal behavior.

## 6. Artifact types

### 6.1 `package`

Install via existing hub-installer package engine.

Supports:

- local installer files (`.exe`, `.msi`, `.pkg`, `.deb`, `.apk`, etc.)
- remote installer URL sources (`http://` / `https://`) with local cache download before install
- optional `sourceChecksum` (SHA-256) for remote package integrity verification
- manager URI format:
  - `winget://...`
  - `choco://...`
  - `brew://...`
  - `apt://...`
  - `snap://...`

Install target can be:

- a single install request
- `byPlatform` map with optional fallback

### 6.2 `git`

Git repository deployment with lifecycle options:

- clone or update (`strategy`)
- fixed revision checkout (`ref`)
- submodule update
- git-lfs pull
- build commands

### 6.3 `huggingface`

Model/artifact acquisition:

- method: `git-lfs` or `huggingface-cli`
- supports `revision`
- supports include/exclude filters on `huggingface-cli`
- optional `tokenEnv` for auth token environment variable

### 6.4 `command`

Execute arbitrary command steps as install artifact.

## 7. Conditions

`when` block can be used at command and artifact level:

- `platforms`
- `env`
- `commandExists`
- `fileExists`

Only matching entries are executed.

## 8. Dependency checks

Dependency checks are structured and explicit:

- `command`
- `file`
- `env`
- `platform`

Failed required dependency without valid remediation will fail the whole run.

## 9. Execution controls

Defaults and CLI options combine to control execution:

- `dryRun`
- `verbose`
- `sudo`
- `timeoutMs`
- `cwd`

CLI options override manifest defaults.

Platform resolution rule:

- if CLI `--platform` is provided, use that value
- otherwise auto-detect current runtime platform

## 10. Recommended best practices

- keep one artifact per install concern
- prefer structured `package/git/huggingface` artifacts over large shell scripts
- use `dependencies` for deterministic tool availability checks
- always add `healthcheck` commands
- keep uninstall safe by default and purge data only when the caller opts in
- use `lifecycle.uninstall` for opaque installers such as Docker, vendor scripts, or service managers
- avoid storing secrets in manifest; use `tokenEnv` and environment injection

## 11. Product descriptors

`hub-installer` manifests can carry product truth beyond executable install steps. This is especially useful for installer UIs that need to explain what will happen before an install, uninstall, or migration starts.

### 11.1 `installation`

Use `installation` to describe:

- the automated method implemented by the current manifest
- documented alternatives that exist upstream but are not automated by this profile
- which directories are used, and whether they are customizable

Example:

```yaml
installation:
  method:
    id: "source-build"
    label: "Rust source build"
    type: "source"
    summary: "Clone the repository and install with Cargo."
    supported: true
  alternatives:
    - id: "shell-script"
      label: "Shell installer"
      type: "script"
      summary: "Documented upstream flow handled outside this profile."
      supported: false
  directories:
    installRoot:
      path: "{{hub_install_root}}"
      customizable: true
      purpose: "Managed installation root."
    workRoot:
      path: "{{hub_work_root}}"
      customizable: true
      purpose: "Repository checkout directory."
```

### 11.2 `dataLayout`

Use `dataLayout` to describe product-owned files, directories, logs, secrets, or databases.

Key fields:

- `kind`: `file`, `directory`, `database`, `secret`, or `log`
- `backupByDefault`: whether backup UI should preselect the item
- `uninstallByDefault`: `preserve`, `remove`, or `manual`

Example:

```yaml
dataLayout:
  items:
    - id: "zeroclaw-home"
      title: "ZeroClaw home directory"
      kind: "directory"
      path: "~/.zeroclaw"
      includes: ["auth-profiles.json", ".secret_key", "workspace/skills"]
      sensitive: true
      backupByDefault: true
      uninstallByDefault: "preserve"
```

### 11.3 `migration`

Use `migration` to declare supported or manual migration strategies, including preview/apply commands when available.

Example:

```yaml
migration:
  strategies:
    - id: "openclaw-memory-import"
      source: "openclaw"
      title: "Import OpenClaw memory"
      mode: "command"
      summary: "Preview and import OpenClaw memory through the product CLI."
      supported: true
      previewCommands:
        - run: "zeroclaw migrate openclaw --dry-run"
      applyCommands:
        - run: "zeroclaw migrate openclaw"
      dataItemIds: ["zeroclaw-home"]
      warnings:
        - "Only supported memory formats are migrated automatically."
```

### 11.4 Descriptor design guidance

- Keep `dependencies` as the source of truth for executable prerequisite checks and remediation.
- Use `installation`, `dataLayout`, and `migration` for truthful product explanation, not for hiding logic that belongs in lifecycle commands.
- Prefer accurate manual warnings over pretending a migration or uninstall path is fully automated.
- If a product uses external state such as PostgreSQL or Docker volumes, declare that state explicitly in `dataLayout`.

