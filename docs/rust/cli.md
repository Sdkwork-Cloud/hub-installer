# Rust CLI Usage

The Rust CLI is intentionally smaller than the Node.js CLI. It is optimized for embeddable engine behavior and progress streaming rather than operator-focused registry tooling.

## Build And Run

From the repository root:

```bash
cargo run --manifest-path rust/Cargo.toml -- --help
```

The binary exposes four primary commands:

- `apply`
- `backup`
- `install`
- `uninstall`

## Apply A Manifest

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  apply ./examples/openclaw-docker.hub.yaml \
  --platform ubuntu \
  --progress
```

This prints:

- structured final JSON to `stdout`,
- progress and streamed logs to `stderr`.

That split lets shell users watch execution while programs still capture the final result cleanly.

## Install From The Registry

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  install openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --platform windows \
  --container-runtime host \
  --progress
```

Use `--registry` explicitly unless the current working directory contains the default registry discovery paths.

## Back Up Or Uninstall A Manifest

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  backup ./examples/openclaw-docker.hub.yaml \
  --target data \
  --target work \
  --progress

cargo run --manifest-path rust/Cargo.toml -- \
  uninstall ./examples/openclaw-docker.hub.yaml \
  --backup-before-uninstall \
  --backup-target all \
  --progress
```

Registry-targeted lifecycle is also supported:

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  backup openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --target all \
  --progress

cargo run --manifest-path rust/Cargo.toml -- \
  uninstall openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --backup-before-uninstall \
  --backup-target all \
  --progress
```

Default Rust uninstall safety matches the Node engine:

- remove install root
- remove work root
- preserve data root unless `--purge-data` is set

## Important Flags

### Shared install flags

- `--platform`
- `--dry-run`
- `--progress`
- `--verbose`
- `--sudo`
- `--install-scope`
- `--install-root`
- `--work-root`
- `--bin-dir`
- `--data-root`
- `--installer-home`
- `--install-control-level`
- `--var key=value`

### Runtime-specific flags

- `--effective-runtime-platform <windows|macos|ubuntu|android|ios|wsl>`
- `--container-runtime <auto|host|wsl>`
- `--wsl-distribution <name>`
- `--docker-context <name>`
- `--docker-host <value>`

These flags are the key reason to pick the Rust CLI over the Node.js CLI for Docker-heavy native integrations.

## Recommended Execution Patterns

### Host Docker on Windows

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  install openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --platform windows \
  --container-runtime host \
  --progress
```

### WSL-targeted execution

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  install openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --platform windows \
  --effective-runtime-platform wsl \
  --container-runtime wsl \
  --wsl-distribution Ubuntu-22.04 \
  --progress
```

### WSL execution with host Docker

Use this when commands should run inside WSL but Docker must remain on the Windows host or another explicitly host-selected daemon.

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  install openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --platform windows \
  --effective-runtime-platform wsl \
  --container-runtime host \
  --wsl-distribution Ubuntu-22.04 \
  --progress
```

## Output Contract

The Rust CLI deliberately preserves a stable machine-readable result:

- final JSON on `stdout`,
- event and log stream on `stderr`.

This means:

- terminal operators see progress without waiting for completion,
- parent processes can parse JSON without stripping log lines,
- the same event model can also power a Tauri frontend.

For WSL-backed installs on Windows, final JSON keeps logical runtime paths for the installed software while backup/install-record locations are emitted as host-accessible paths so the Windows parent process can open them directly.
