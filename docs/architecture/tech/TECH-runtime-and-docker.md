> Migrated from `docs/guide/runtime-and-docker.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Runtime And Docker

This is the most important guide for understanding `hub-installer` installs on Windows, Linux, WSL, and Docker across both the Node.js and Rust implementations.

## The Three Axes

`hub-installer` treats runtime selection as three separate questions.

### Host Platform

The platform where the installer process itself is running.

Examples:

- Windows desktop running the Rust CLI
- Linux server running the Node.js CLI
- Tauri backend process on macOS

### Effective Runtime Platform

The environment where commands should execute.

Examples:

- `windows`
- `ubuntu`
- `wsl`

This is controlled in Node.js by `effectiveRuntimePlatform`, in Rust by `effective_runtime_platform`, and in the CLI by `--effective-runtime-platform`.

### Container Runtime

The Docker path that should be used or validated.

Node.js and Rust both support:

- `auto`
- `host`
- `wsl`

via `containerRuntime` / `container_runtime` or `--container-runtime`.

## The Crucial Product Rule

WSL is an independent execution environment.

That means:

- Windows is the **host platform** when the process starts on Windows.
- WSL is the **effective runtime platform** only when commands are intentionally executed there.
- Docker on the Windows host and Docker available inside a WSL distribution are different capabilities and must be validated separately.

## How hub-installer Resolves Runtime

The Node.js and Rust engines now share the same runtime model. Resolution combines:

- target platform,
- explicit runtime options,
- host Docker availability,
- WSL distribution availability,
- Docker availability inside the chosen WSL distribution.

### Auto Mode

On Windows:

- if `--container-runtime auto` is selected and a suitable WSL Docker environment is available, Rust can choose WSL execution,
- otherwise it can fall back to host Docker if host Docker is available,
- otherwise container runtime stays unresolved and containerized manifests should fail early instead of failing halfway through execution.

If no container runtime is requested, WSL execution does not automatically force Docker validation. This matters for tools like Codex that want Linux execution on Windows without depending on Docker at all.

The built-in `codex` registry profile uses this rule on Windows by default: registry-driven installs resolve to WSL execution even without an explicit `--effective-runtime-platform wsl` flag. Raw manifest `apply` flows still need that flag today because the manifest schema cannot yet express a Windows-only runtime default.

On non-Windows hosts:

- the effective runtime normally follows the target platform,
- `host` is the common Docker path.

## Recommended Scenarios

### 1. Windows host, Docker on the host

Use this when Docker Desktop or another host-side Docker daemon is the intended runtime.

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  install openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --platform windows \
  --container-runtime host \
  --progress
```

```bash
hub-installer registry install openclaw-docker \
  --platform windows \
  --container-runtime host
```

Use this path when:

- the main process is Windows-native,
- the install flow should stay Windows-native,
- Docker is already usable from Windows.

### 2. Windows host, commands should execute inside WSL

Use this when Linux semantics are required and the install flow should run from a specific WSL distro.

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

```bash
hub-installer registry install openclaw-docker \
  --platform windows \
  --effective-runtime-platform wsl \
  --container-runtime wsl \
  --wsl-distribution Ubuntu-22.04
```

Use this path when:

- install scripts are Linux-first,
- the final toolchain is intended to live in WSL,
- Docker is validated from inside that WSL distro.

### 2b. Windows host, commands execute in WSL, Docker stays on the host

This is the right choice when Linux shell semantics are required but Docker access should still go through the Windows host or another explicitly host-selected daemon.

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

```bash
hub-installer registry install openclaw-docker \
  --platform windows \
  --effective-runtime-platform wsl \
  --container-runtime host \
  --wsl-distribution Ubuntu-22.04
```

This matters because "run in WSL" and "use WSL Docker" are different design decisions.

### 3. Linux host, host Docker

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  install openclaw-docker \
  --registry ./registry/software-registry.yaml \
  --platform ubuntu \
  --container-runtime host \
  --progress
```

This is the cleanest case because host platform and effective runtime are both Linux-like.

## Docker Context And Docker Host

Node.js and Rust also accept:

- `--docker-context`
- `--docker-host`

Use these when the manifest or runtime environment needs an explicit Docker target instead of relying on defaults from the current shell.

This is especially useful when:

- one machine has multiple Docker contexts,
- Tauri embeds the installer inside an application with its own runtime policy,
- enterprise environments require connecting to a remote daemon.

## Common Failure Modes

### `WSL_RUNTIME_UNAVAILABLE`

Meaning:

- `wsl` execution was requested, but no usable WSL distribution was available.

Typical fix:

- install or enable WSL,
- specify `--wsl-distribution`,
- or switch back to host execution.

### `WSL_DOCKER_UNAVAILABLE`

Meaning:

- WSL execution was selected, but Docker is not usable inside the chosen distribution.

Typical fix:

- validate `docker info` inside the WSL distro,
- ensure Docker integration is enabled,
- or choose host Docker if that matches the product intent better.

### `HOST_DOCKER_UNAVAILABLE`

Meaning:

- host Docker was requested explicitly, but the host environment cannot run Docker successfully.

Typical fix:

- validate `docker info` on the host,
- start Docker Desktop or the host daemon,
- or change to a WSL-based flow.

## Design Guidance

If you are embedding `hub-installer` into a product, decide runtime with the same discipline you would use for storage or networking.

Ask:

1. Where must the resulting software actually live?
2. Where will its commands execute after install?
3. Which Docker daemon is part of the product contract?

If those answers are not explicit, runtime bugs usually show up as confusing path issues, shell issues, or Docker connectivity issues later.

## State Path Model On Windows + WSL

Node.js and Rust intentionally separate:

- runtime paths used inside manifests and shell commands,
- host-accessible paths used for install records, backups, and uninstall file operations.

Examples:

- runtime path: `/home/tester/.sdkwork/hub-installer`
- host path: `\\wsl$\Ubuntu-22.04\home\tester\.sdkwork\hub-installer`

- runtime path: `/mnt/d/openclaw`
- host path: `D:\openclaw`

That split is what lets Tauri or other native Windows shells manage lifecycle state correctly even when the actual install runs inside WSL.

