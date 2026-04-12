# Node.js CLI Usage

The Node.js CLI is the most operator-friendly surface in the repository today.

## Build Or Install The CLI

From this repo:

```bash
pnpm install
pnpm build
node dist/cli.mjs --help
```

Or link it globally for local development:

```bash
pnpm link --global
hub-installer --help
```

## Core Commands

### Detect

```bash
hub-installer detect ./downloads/tool.msi
hub-installer detect winget://Git.Git --json
```

Use this when you only want to know:

- detected platform,
- detected format,
- source kind.

### Plan

```bash
hub-installer plan ./downloads/tool.msi --platform windows --json
hub-installer plan apt://curl --platform ubuntu
```

Use `plan` when you want the step list without executing it.

### Install

```bash
hub-installer install winget://Git.Git --platform windows
hub-installer install apt://curl --platform ubuntu --sudo
hub-installer install ./examples/openclaw.hub.yaml
hub-installer install https://example.com/releases/tool.msi --download-cache-dir ./.cache/packages
```

`install` is the flexible command:

- direct package source,
- software name resolved from registry,
- manifest source that auto-routes to `apply`.

### Apply

```bash
hub-installer apply ./examples/full-stack.hub.yaml --platform ubuntu
hub-installer apply ./examples/default-dir --dry-run
hub-installer apply ./examples/openclaw-docker.hub.yaml --json
```

Use `apply` when you explicitly want full manifest lifecycle execution.

### Backup

```bash
hub-installer backup ./examples/openclaw-docker.hub.yaml --target data --target work
hub-installer registry backup openclaw --target all --session-id 2026-03-18T10:20:30.123Z
```

Backup defaults to the `data` target and writes under:

- `<installerHome>/state/backups/<software>/<session>/`

### Uninstall

```bash
hub-installer uninstall ./examples/openclaw-docker.hub.yaml
hub-installer uninstall ./examples/openclaw-docker.hub.yaml --backup-before-uninstall --backup-target all
hub-installer registry uninstall openclaw --purge-data
```

Default uninstall behavior:

- remove install root
- remove work root
- preserve data root

### Validate

```bash
hub-installer validate ./examples/full-stack.hub.yaml
hub-installer validate ./examples/openclaw-docker.hub.yaml --json
```

## Registry-Centered Commands

### Shortcut commands

```bash
hub-installer list
hub-installer info openclaw
hub-installer doctor
hub-installer doctor openclaw --runtime
```

### Registry namespace

```bash
hub-installer registry validate
hub-installer registry list
hub-installer registry show nodejs
hub-installer registry install python
hub-installer registry backup openclaw
hub-installer registry uninstall openclaw
```

Use the shortcut commands when you want the best default UX. Use the `registry` namespace when you want explicit subcommand structure.

## Built-In Software Shortcuts

The bundled registry includes OpenClaw, Codex, Node.js, Python, and other profiles.

Examples:

```bash
hub-installer openclaw
hub-installer openclaw docker
hub-installer openclaw --software-version beta
hub-installer codex dotslash-release
hub-installer nodejs 22
hub-installer python uv --software-version 3.12
```

This is powered by the registry layer, not a hard-coded one-off path per software.

On Windows, the built-in `codex` shortcut inherits the registry default and resolves to a WSL runtime automatically. If you call `apply` on the raw Codex manifest instead of using the registry or shortcut entrypoint, pass `--effective-runtime-platform wsl` yourself.

## Machine Output Vs Terminal Output

When you pass `--json`:

- final output becomes machine-readable JSON,
- progress-style terminal rendering is suppressed.

When you do not pass `--json`:

- the CLI prints human-readable progress and summary output.

This split is important if you are automating the CLI from another process.

## Install Policy Flags

Manifest and registry installs support policy controls such as:

- `--config`
- `--installer-home`
- `--install-scope`
- `--install-root`
- `--work-root`
- `--bin-dir`
- `--data-root`
- `--effective-runtime-platform`

Example:

```bash
hub-installer registry install openclaw-cli-script \
  --install-scope system \
  --install-root /opt/openclaw \
  --bin-dir /usr/local/bin
```

## When To Prefer The Rust CLI

Switch to the Rust CLI when you need:

- native embedding,
- structured progress events,
- richer Docker and WSL runtime controls such as `--container-runtime` and `--wsl-distribution`.
