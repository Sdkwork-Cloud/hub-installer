# hub-installer
repository-kind: application

Cross-platform installer engine built with Node.js + TypeScript + Vite.

`hub-installer` works in two modes:

- CLI tool: `hub-installer ...`
- library API: import and orchestrate installs in your own system

CLI binary name:

- `hub-installer`

## Core capabilities

- Platforms: `windows`, `macos`, `ubuntu`, `android`, `ios`
- Package forms:
  - windows: `exe`, `msi`, `msix`, `zip`, `tar`, `manager`
  - macos: `pkg`, `dmg`, `zip`, `tar`, `manager`
  - ubuntu: `deb`, `rpm`, `appimage`, `zip`, `tar`, `manager`
  - android: `apk`, `zip`, `tar`
  - ios: `ipa`, `zip`, `tar`
- Package manager URI sources:
  - `winget://...`
  - `choco://...`
  - `brew://...`
  - `apt://...`
  - `snap://...`
- Remote installer URL sources (`http://` / `https://`) with local package cache download
- Unified manifest-driven lifecycle:
  - preflight checks
  - dependency validation/remediation
  - install artifacts (`package`, `git`, `huggingface`, `command`)
  - post install config and healthcheck
  - optional backup and uninstall hooks
- Structured product descriptors:
  - installation method + documented alternatives
  - install/work/bin/data directory semantics
  - data/config/log/database inventory
  - migration strategies, commands, and warnings
- Software registry center:
  - install by software name
  - local/remote registry sources
  - default bundled registry + common software manifests
- `dry-run`, timeout, verbose logging, optional sudo elevation
- Stable installer state and policy model:
  - installer home defaults to `~/.sdkwork/hub-installer` (`%USERPROFILE%\.sdkwork\hub-installer` on Windows)
  - config/cache/logs/state stay under installer home
  - install records persist under `state/install-records/`
  - backups persist under `state/backups/<software>/<session>/`
  - final software install roots are resolved separately from installer home
  - built-in profiles report `managed`, `partial`, or `opaque` install control levels

Install policy reference:

- `docs/install-policy.md`

Manifest descriptor reference:

- `docs/manifest-spec.md`

## Setup (pnpm)

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Verification (local + CI)

Run the full local verification pipeline:

```bash
pnpm verify
```

`pnpm verify` executes:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm test:e2e-dry-run`

The `test:e2e-dry-run` suite validates built-in installation routes for OpenClaw, Codex, Node.js, and Python using `--dry-run --json` and strict output checks.

CI runs the same gates on both `ubuntu-latest` and `windows-latest` via:

- `.github/workflows/ci.yml`

## Local build and global CLI usage

Use this when you want to run `hub-installer` as a global command from your local source checkout.

### Option A: pnpm global link (recommended for local development)

```bash
# 1) install deps + build
pnpm install
pnpm build

# 2) expose local package globally
pnpm link --global

# 3) verify
hub-installer --version
hub-installer --help
```

Remove global link:

```bash
pnpm unlink --global hub-installer
```

### Option B: npm global install from local source

```bash
# 1) install deps + build
pnpm install
pnpm build

# 2) install this local project globally
npm install -g .

# 3) verify
hub-installer --version
```

Uninstall:

```bash
npm uninstall -g hub-installer
```

### Option C: run built artifact directly (no global install)

```bash
pnpm build
node dist/cli.mjs --help
node dist/cli.mjs doctor
```

## CLI

### Detect platform and format

```bash
hub-installer detect ./downloads/tool.msi
```

### Create install plan

```bash
hub-installer plan ./downloads/tool.msi --platform windows --json
```

### Install directly

```bash
# Install built-in software directly by registry name (shortcut)
hub-installer openclaw
hub-installer install openclaw
hub-installer openclaw docker
hub-installer install openclaw --method docker

# Install a manifest directly (auto-routes to `apply`)
hub-installer install ./examples/openclaw.hub.yaml

hub-installer install ./downloads/tool.msi --platform windows --sudo
hub-installer install winget://Git.Git --platform windows
hub-installer install brew://wget --platform macos
hub-installer install apt://curl --platform ubuntu --sudo
hub-installer install https://example.com/releases/tool.msi --download-cache-dir ./.cache/packages
hub-installer install https://example.com/releases/tool.msi --checksum sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

If `--platform` is omitted, `hub-installer` auto-detects the current runtime platform and installs for that platform.

Progress feedback is enabled by default in terminal mode. You will see stage/artifact/step updates such as:

```text
[STAGE] lifecycle:preflight (1 step)
[RUN] [1/1] show-installer-script-profile-win [0%]
[OK] [1/1] show-installer-script-profile-win [100%] (12ms)
[STAGE:OK] lifecycle:preflight (1 steps, 0 failed, 13ms)
[ARTIFACT] openclaw-installer-script-win (command)
```

Use `--json` for machine-readable output (progress logs are disabled in JSON mode).

When an install/apply fails, the final CLI summary now includes a single failure hint line (first failed step or stage), and step IDs are printed in execution summaries for faster manifest/script lookup.

### Apply full manifest lifecycle

```bash
hub-installer apply ./examples/full-stack.hub.yaml --platform ubuntu --var workspace=~/hub-workbench
hub-installer apply ./examples/full-stack.hub.yaml --dry-run --json
hub-installer apply ./examples/default-dir --dry-run
hub-installer apply https://example.com/manifests/prod.hub.yaml --cache-dir ./.cache/manifests --fetch-timeout 60000
```

If `--platform` is omitted for `apply`, current runtime platform is used by default.

### Back up installed state

```bash
hub-installer backup ./examples/openclaw-docker.hub.yaml --target data --target work
hub-installer backup ./examples/openclaw-docker.hub.yaml --session-id 2026-03-18T10:20:30.123Z --json
hub-installer registry backup openclaw --target all
```

Default backup target:

- `data`

Available targets:

- `data`
- `install`
- `work`
- `all`

Backups are written under:

- `<installerHome>/state/backups/<software>/<session>/`

### Uninstall with safe defaults

```bash
hub-installer uninstall ./examples/openclaw-docker.hub.yaml
hub-installer uninstall ./examples/openclaw-docker.hub.yaml --backup-before-uninstall --backup-target all
hub-installer uninstall ./examples/openclaw-docker.hub.yaml --purge-data
hub-installer registry uninstall openclaw --backup-before-uninstall --backup-target all
```

For native embedding, the Rust crate now exposes the same lifecycle closure at the registry level through `InstallEngine::backup_from_registry` and `InstallEngine::uninstall_from_registry`.

Default uninstall behavior:

- remove `installRoot`
- remove `workRoot`
- preserve `dataRoot`

Use `--purge-data` only when you want a full data wipe.

### Installer home and install roots

`hub-installer` keeps its own state under the installer home and resolves software install roots separately.

Default installer home:

- Windows: `%USERPROFILE%\.sdkwork\hub-installer`
- macOS / Ubuntu: `~/.sdkwork/hub-installer`

Default config file:

- `<installerHome>/config/config.json`
- `<installerHome>/state/install-records/<software>.json`
- `<installerHome>/state/backups/<software>/<session>/`

Manifest and registry installs accept:

- `--config <path>`
- `--installer-home <path>`
- `--install-scope <system|user>`
- `--install-root <path>`
- `--work-root <path>`
- `--bin-dir <path>`
- `--data-root <path>`
- `--effective-runtime-platform <windows|macos|ubuntu|android|ios|wsl>`
- `--container-runtime <auto|host|wsl>`
- `--wsl-distribution <name>`
- `--docker-context <name>`
- `--docker-host <value>`

Examples:

```bash
hub-installer registry install openclaw-cli-script \
  --install-scope system \
  --install-root /opt/openclaw \
  --bin-dir /usr/local/bin

hub-installer apply ./examples/codex.hub.yaml \
  --installer-home ~/.sdkwork/hub-installer \
  --install-scope user \
  --install-root ~/.local/opt/codex \
  --bin-dir ~/.local/bin

hub-installer registry install codex \
  --platform windows
```

On Windows, the built-in `codex` registry entry resolves to a WSL runtime by default. If you bypass the registry and apply the raw Codex manifest directly, pass `--effective-runtime-platform wsl` explicitly.

### Validate manifest before apply

```bash
hub-installer validate ./examples/full-stack.hub.yaml
hub-installer validate ./examples/full-stack.hub.yaml --json
hub-installer validate ./examples/production.hub.yaml
hub-installer validate ./examples/openclaw.hub.yaml
hub-installer validate ./examples/openclaw-npm.hub.yaml
hub-installer validate ./examples/openclaw-docker.hub.yaml
hub-installer validate ./examples/codex.hub.yaml
hub-installer validate https://example.com/manifests/prod.hub.yaml --cache-dir ./.cache/manifests
```

Quick profile manifests:

```bash
# OpenClaw npm global install profile
hub-installer apply ./examples/openclaw-npm.hub.yaml

# OpenClaw dockerized gateway profile
hub-installer apply ./examples/openclaw-docker.hub.yaml

# Windows hosts should prefer WSL-backed execution for the closest official path
hub-installer apply ./examples/openclaw-docker.hub.yaml --platform windows --effective-runtime-platform wsl

# Optional Docker profile tuning from official OpenClaw docs
hub-installer install openclaw-docker --var openclaw_docker_extra_mounts="/data:/data" --var openclaw_docker_home_volume="openclaw-home" --var openclaw_docker_apt_packages="git htop"
```

### Registry center usage

```bash
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
hub-installer registry show nodejs
hub-installer registry install nodejs
hub-installer registry show python
hub-installer registry install python
hub-installer registry install node --dry-run
hub-installer registry install ffmpeg --registry ./registry/software-registry.yaml
hub-installer registry install git --registry https://example.com/software-registry.yaml --registry-cache-dir ./.cache/registry --cache-dir ./.cache/manifests
hub-installer registry install github-project --var repo_url=https://github.com/your-org/your-app.git --var destination={{home}}/workspace/your-app
```

#### Built-in install profiles

OpenClaw is now split into method-focused install profiles. Use software names directly or use shortcut method/profile arguments:

```bash
# OpenClaw recommended default profile
hub-installer install openclaw

# OpenClaw foolproof shortcuts (no --var needed)
hub-installer openclaw docker
hub-installer openclaw beta
hub-installer openclaw --software-version beta
hub-installer openclaw npm --channel beta --onboard false
hub-installer install openclaw --profile source
hub-installer install openclaw --method podman

# OpenClaw profile family
hub-installer install openclaw-git
hub-installer install openclaw-cli-script
hub-installer install openclaw-wsl --effective-runtime-platform wsl
hub-installer install openclaw-npm
hub-installer install openclaw-pnpm
hub-installer install openclaw-source
hub-installer install openclaw-bun
hub-installer install openclaw-docker
hub-installer install openclaw-podman
hub-installer install openclaw-ansible
hub-installer install openclaw-nix

# OpenClaw legacy all-in-one selector (for backward compatibility)
hub-installer install openclaw-all --var openclaw_install_method=docker

# Optional channel variables where applicable
hub-installer install openclaw --channel beta --onboard false
hub-installer install openclaw-npm --channel dev

# Installer automation flags aligned with OpenClaw installer docs
hub-installer install openclaw --var openclaw_installer_no_prompt=true --var openclaw_installer_dry_run=true --var openclaw_installer_verbose=true
hub-installer install openclaw-cli-script --var openclaw_install_cli_json=true --var openclaw_install_cli_set_npm_prefix=true

# Codex: source build (default) or DotSlash release bootstrap
hub-installer codex source-build
hub-installer codex dotslash-release
hub-installer codex main
hub-installer codex dotslash-release --software-version v0.2.0
hub-installer install codex --method dotslash-release

# Node.js: os package manager (default), fnm, nvm
hub-installer nodejs os-package
hub-installer nodejs 24
hub-installer nodejs --software-version 20.11.1
hub-installer nodejs fnm --node-version 24
hub-installer install nodejs --method nvm --software-version 24

# Python: os package manager (default), pyenv, uv
hub-installer python os-package
hub-installer python 3.13
hub-installer python --software-version 3.11.9
hub-installer python pyenv --python-version 3.13
hub-installer install python --method uv --software-version 3.13
```

Unified version shortcut:

- preferred flag: `--software-version <version>`
- positional shorthand (minimal mode): for `codex`/`nodejs`/`python`, `hub-installer <software> <version>`
- backward compatible: `--channel`, `--node-version`, `--python-version` remain supported

OpenClaw install analysis (`openclaw/docs/install/*.md` mapped to profiles):

| OpenClaw docs path | Hub Installer profile | windows | macos | ubuntu | Best for |
|---|---|---:|---:|---:|---|
| `install/index.md` installer script | `openclaw` | yes | yes | yes | Most users |
| `install/installer.md` git mode | `openclaw-git` | yes | yes | yes | Editable local checkout |
| `install/installer.md` install-cli.sh | `openclaw-cli-script` | no | yes | yes | Local-prefix/non-root installs |
| `platforms/windows.md` WSL2 flow | `openclaw-wsl` | yes | no | no | Windows hosts that should run the gateway inside WSL2 with systemd |
| `install/index.md` npm tab | `openclaw-npm` | yes | yes | yes | Fast global npm install |
| `install/index.md` pnpm tab | `openclaw-pnpm` | yes | yes | yes | pnpm-centric environments |
| `install/index.md` from source | `openclaw-source` | yes | yes | yes | Contributors/custom patches |
| `install/bun.md` | `openclaw-bun` | no | yes | yes | Bun experimental workflow |
| `install/docker.md` | `openclaw-docker` | yes | yes | yes | Containerized gateway |
| `install/podman.md` | `openclaw-podman` | no | yes | yes | Rootless container flow |
| `install/ansible.md` | `openclaw-ansible` | no | yes | yes | Fleet automation |
| `install/nix.md` | `openclaw-nix` | no | yes | yes | Declarative reproducibility |
| Legacy all-in-one | `openclaw-all` | yes/no by method | yes | yes | Backward compatibility |

Runtime prerequisite mapping from OpenClaw docs:

| OpenClaw docs path | Hub Installer builtin | Supported methods |
|---|---|---|
| `install/node.md` | `nodejs` | `os-package`, `fnm`, `nvm` |

Advanced OpenClaw installer profile variables:

| Variable | Applies to | Purpose |
|---|---|---|
| `openclaw_installer_no_prompt` | `openclaw`, `openclaw-git`, `openclaw-all` | Add `--no-prompt` for installer-script Unix automation |
| `openclaw_installer_dry_run` | `openclaw`, `openclaw-git`, `openclaw-all` | Add `--dry-run` (`-DryRun` on PowerShell) |
| `openclaw_installer_verbose` | `openclaw`, `openclaw-git`, `openclaw-all` | Add `--verbose` for installer-script Unix debug output |
| `openclaw_install_cli_json` | `openclaw-cli-script`, `openclaw-all` | Add `--json` to `install-cli.sh` |
| `openclaw_install_cli_set_npm_prefix` | `openclaw-cli-script`, `openclaw-all` | Add `--set-npm-prefix` to `install-cli.sh` |
| `openclaw_wsl_enable_systemd` | `openclaw-wsl` | Ensure `/etc/wsl.conf` contains `systemd=true` and restart WSL once before install if needed |
| `openclaw_podman_quadlet` | `openclaw-podman` | Pass `--quadlet` / `OPENCLAW_PODMAN_QUADLET=1` for the Podman systemd user service |
| `openclaw_podman_container_only` | `openclaw-podman` | Pass `--container` to stop after container + launch script setup |
| `openclaw_docker_apt_packages` | `openclaw-docker`, `openclaw-podman` | Bake extra apt packages into the container image |
| `openclaw_extensions` | `openclaw-podman` | Pre-install extension dependencies during the Podman image build |

OpenClaw channel mapping (`openclaw/docs/install/development-channels.md`) for profiles supporting channel variables:

| OpenClaw channel | Variable override |
|---|---|
| stable | `--channel latest` |
| beta | `--channel beta` |
| dev | `--channel dev` |

Equivalent unified shortcut: `hub-installer openclaw --software-version <latest|beta|dev|semver>`

Method/platform matrix:

| Software | Method | windows | macos | ubuntu |
|---|---|---:|---:|---:|
| OpenClaw | `openclaw` | yes | yes | yes |
| OpenClaw | `openclaw-git` | yes | yes | yes |
| OpenClaw | `openclaw-cli-script` | no | yes | yes |
| OpenClaw | `openclaw-wsl` | WSL2 | no | no |
| OpenClaw | `openclaw-npm` / `openclaw-pnpm` / `openclaw-source` | yes | yes | yes |
| OpenClaw | `openclaw-bun` / `openclaw-podman` / `openclaw-ansible` / `openclaw-nix` | no | yes | yes |
| OpenClaw | `openclaw-docker` | yes | yes | yes |
| Codex | source-build | WSL2 | yes | yes |
| Codex | dotslash-release | WSL2 | yes | yes |
| Node.js | os-package | yes | yes | yes |
| Node.js | fnm | yes | yes | yes |
| Node.js | nvm | no | yes | yes |
| Python | os-package | yes | yes | yes |
| Python | pyenv | no | yes | yes |
| Python | uv | yes | yes | yes |

Doctor coverage:

```bash
hub-installer doctor all --runtime
hub-installer doctor openclaw --runtime
hub-installer doctor codex --runtime
hub-installer doctor nodejs --runtime
hub-installer doctor python --runtime
```

When a doctor check fails, output now includes `recommendation:` with the fastest remediation path.

## Manifest standard

- Spec doc: `docs/manifest-spec.md`
- Registry spec: `docs/registry-spec.md`
- OpenClaw profile architecture: `docs/openclaw-profile-architecture.md`
- JSON schema: `schemas/hub-installer.manifest.schema.json`
- Registry schema: `schemas/hub-installer.registry.schema.json`
- Full example: `examples/full-stack.hub.yaml`
- Production template: `examples/production.hub.yaml`
- OpenClaw template: `examples/openclaw.hub.yaml`
- OpenClaw npm profile: `examples/openclaw-npm.hub.yaml`
- OpenClaw docker profile: `examples/openclaw-docker.hub.yaml`
- Codex template: `examples/codex.hub.yaml`
- Default registry: `registry/software-registry.yaml`
- Built-in OpenClaw profile manifests:
  - `registry/manifests/openclaw.hub.yaml`
  - `registry/manifests/openclaw-installer-script-git.hub.yaml`
  - `registry/manifests/openclaw-installer-cli-script.hub.yaml`
  - `registry/manifests/openclaw-npm.hub.yaml`
  - `registry/manifests/openclaw-pnpm.hub.yaml`
  - `registry/manifests/openclaw-source.hub.yaml`
  - `registry/manifests/openclaw-bun.hub.yaml`
  - `registry/manifests/openclaw-docker.hub.yaml`
  - `registry/manifests/openclaw-podman.hub.yaml`
  - `registry/manifests/openclaw-ansible.hub.yaml`
  - `registry/manifests/openclaw-nix.hub.yaml`
  - `registry/manifests/openclaw-all.hub.yaml`
- Other built-in manifests:
  - `registry/manifests/codex.hub.yaml`
  - `registry/manifests/nodejs.hub.yaml`
  - `registry/manifests/python.hub.yaml`

Lifecycle order:

1. `preflight`
2. `dependencies`
3. `preInstall`
4. `install`
5. `artifacts`
6. `postInstall`
7. `configure`
8. `healthcheck`

Lifecycle stages available for custom hooks:

- `preflight`
- `preInstall`
- `install`
- `postInstall`
- `configure`
- `healthcheck`
- `backup`
- `uninstall`

## Library usage

```ts
import {
  createInstallPlan,
  installPackage,
  resolveExecutionContext,
  applyManifestFile,
  backupManifestFile,
  uninstallManifestFile,
  installSoftwareFromRegistry
} from "hub-installer";

const plan = await createInstallPlan({
  source: "winget://Git.Git",
  platform: "windows"
});

const install = await installPackage({
  source: "./downloads/tool.msi",
  platform: "windows",
  dryRun: true
});

const applied = await applyManifestFile("./examples/full-stack.hub.yaml", {
  platform: "ubuntu",
  dryRun: true
});

const runtime = resolveExecutionContext("windows", {
  effectiveRuntimePlatform: "wsl",
  containerRuntime: "host",
  wslDistribution: "Ubuntu-22.04"
});

const backup = await backupManifestFile("./examples/openclaw-docker.hub.yaml", {
  targets: ["data", "install"],
  sessionId: "2026-03-18T10:20:30.123Z"
});

const uninstall = await uninstallManifestFile("./examples/openclaw-docker.hub.yaml", {
  backupBeforeUninstall: true,
  backupTargets: ["data", "work"]
});

const registryInstall = await installSoftwareFromRegistry("openclaw", {
  registrySource: "./registry/software-registry.yaml",
  dryRun: true
});

console.log({
  planSteps: plan.steps.length,
  installOk: install.success,
  applyOk: applied.success,
  runtimeMode: runtime.effectiveRuntimePlatform,
  backupOk: backup.success,
  uninstallOk: uninstall.success,
  registryOk: registryInstall.applyResult.success
});
```

## Notes

- Non-Windows elevated steps can auto-prefix `sudo` when enabled.
- On Windows, run terminal as Administrator for privileged operations.
- On Windows + WSL, manifest commands can execute through `wsl.exe` while install records, backups, and uninstall still use host-accessible paths.
- Archive installs (`zip`/`tar`) require `archiveEntry` or `archiveCommand`.
- For private HuggingFace artifacts, use `tokenEnv` and export token via environment variable.

## SDKWork Documentation Contract

Domain: device
Capability: hub-installer
Package type: node-package
Status: standard

### Public API

Public exports are declared in `specs/component.spec.json` under `contracts.publicExports`.

### Required SDK Surface

- None declared in `specs/component.spec.json`.

### Configuration

Configuration keys and runtime entrypoints are declared in `specs/component.spec.json`.

### SaaS/Private/Local Behavior

This module follows the canonical standards linked from `specs/component.spec.json`, including deployment and runtime configuration rules where applicable.

### Security

Do not add secrets, live tokens, manual auth headers, or app-local credential handling to this module.

### Extension Points

Extension points are limited to declared public exports, runtime entrypoints, SDK clients, events, and config keys.

### Verification

- `pnpm typecheck`

### Owner And Status

Owner and lifecycle status are tracked in `specs/component.spec.json`.

## Documentation Canon

- [docs/README.md](docs/README.md)
- [docs/product/prd/PRD.md](docs/product/prd/PRD.md)
- [docs/architecture/tech/TECH_ARCHITECTURE.md](docs/architecture/tech/TECH_ARCHITECTURE.md)
