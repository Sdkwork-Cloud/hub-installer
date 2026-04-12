# Troubleshooting

This page focuses on the most common integration and install failures that appear when manifests, registries, runtime selection, and Docker meet real machines.

## Rust CLI Cannot Find The Registry

Symptom:

```text
REGISTRY_NOT_FOUND
```

Why it happens:

- the Rust CLI defaults `registry_source` to the current working directory,
- if you run the Rust CLI from `rust/`, the default registry in the repo root is not automatically discovered there.

Recommended fix:

```bash
cargo run --manifest-path rust/Cargo.toml -- \
  install openclaw \
  --registry ./registry/software-registry.yaml
```

## Docker Install Fails Before Execution Starts

Symptoms usually look like:

- `HOST_DOCKER_UNAVAILABLE`
- `WSL_DOCKER_UNAVAILABLE`
- `WSL_RUNTIME_UNAVAILABLE`

Why it happens:

- Rust validates runtime prerequisites before running a containerized manifest,
- this is intentional so failures happen early and clearly.

Recommended fix:

- read [Runtime And Docker](/guide/runtime-and-docker),
- choose an explicit runtime model instead of assuming Docker will be inferred correctly,
- verify `docker info` in the exact environment you want the manifest to use.

## Windows Paths Look Wrong Inside WSL

Why it happens:

- WSL execution normalizes Windows paths to `/mnt/<drive>/...`,
- installer home, work root, and related paths are rendered for the effective runtime platform.

Recommended fix:

- use `--effective-runtime-platform wsl` only when the actual execution environment should be WSL,
- inspect the resolved install policy in the final JSON result,
- avoid mixing Windows-native paths with WSL-native commands in one manifest unless you are doing so intentionally.

## Manifest Fails On The Wrong Platform

Symptoms:

- a manifest validates but later fails with platform-specific commands,
- or the engine reports that the manifest does not support the selected platform.

Recommended fix:

- check the manifest `platforms` field,
- verify `--platform`,
- verify runtime-specific variables in the registry entry,
- prefer by-platform manifest branches when install behavior truly differs by platform.

## Package Format Cannot Be Detected

Symptom:

```text
UNKNOWN_FORMAT
```

Why it happens:

- direct package installs depend on file extension or explicit format selection.

Recommended fix:

- provide an install source with a clear extension,
- or set the format explicitly where the API supports it,
- or switch to a manifest when the install flow is more complex than a single package file.

## Progress Logs Seem Mixed With Final Results

Current behavior:

- Rust streams progress and command logs to `stderr`,
- final JSON stays on `stdout`.

This is deliberate because it allows:

- terminal users to watch live execution,
- programs to capture the final result separately.

Recommended integration rule:

- never parse human-readable terminal lines when the structured result or `ProgressEvent` stream is available.

## OpenClaw Docker Looks Interactive

Current expectation:

- the hardened `openclaw-docker` manifest patches onboarding into a non-interactive flow suitable for unattended installs.
- on Windows, the most reliable route is still `--effective-runtime-platform wsl` so Docker and shell behavior match the official OpenClaw guidance more closely.
- the Docker profile now exposes `openclaw_docker_extra_mounts`, `openclaw_docker_home_volume`, and `openclaw_docker_apt_packages` when you need the advanced options documented by OpenClaw.

If you still observe interactive behavior:

1. make sure the registry manifest is the current one in this repo,
2. confirm you are installing `openclaw-docker` and not an older local copy,
3. inspect the streamed command output to confirm the patched script path is being used from the cloned repo root.

## When To Use `dry-run`

Use `dry-run` when you want to validate:

- manifest resolution,
- plan generation,
- path policy,
- registry variable expansion,

without mutating the machine.

Do not treat `dry-run` as proof that:

- Docker is fully functional,
- every upstream installer is reachable,
- runtime-specific side effects will succeed.

For final validation, run at least one real install regression in the target environment.
