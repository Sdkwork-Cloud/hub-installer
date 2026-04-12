# OpenClaw Profile Architecture

This document defines the OpenClaw install profile design used by `hub-installer`.

## Goal

Use a small, method-focused manifest per install strategy instead of one giant
multi-method manifest.

Design outcomes:

- simple and explicit profile selection (`hub-installer openclaw docker`)
- high cohesion (one manifest = one install strategy)
- low coupling (changing one strategy does not risk others)
- strong extensibility (add new profiles without touching legacy logic)

## Profile model

Each profile is its own registry entry and manifest:

| Profile | Registry name | Manifest |
|---|---|---|
| Installer script (recommended) | `openclaw` | `registry/manifests/openclaw.hub.yaml` |
| Installer script git mode | `openclaw-git` | `registry/manifests/openclaw-installer-script-git.hub.yaml` |
| install-cli.sh local prefix | `openclaw-cli-script` | `registry/manifests/openclaw-installer-cli-script.hub.yaml` |
| Windows WSL managed flow | `openclaw-wsl` | `registry/manifests/openclaw-wsl.hub.yaml` |
| npm global install | `openclaw-npm` | `registry/manifests/openclaw-npm.hub.yaml` |
| pnpm global install | `openclaw-pnpm` | `registry/manifests/openclaw-pnpm.hub.yaml` |
| Source build | `openclaw-source` | `registry/manifests/openclaw-source.hub.yaml` |
| Bun experimental | `openclaw-bun` | `registry/manifests/openclaw-bun.hub.yaml` |
| Docker | `openclaw-docker` | `registry/manifests/openclaw-docker.hub.yaml` |
| Podman | `openclaw-podman` | `registry/manifests/openclaw-podman.hub.yaml` |
| Ansible | `openclaw-ansible` | `registry/manifests/openclaw-ansible.hub.yaml` |
| Nix | `openclaw-nix` | `registry/manifests/openclaw-nix.hub.yaml` |

Legacy compatibility profile:

- `openclaw-all` -> `registry/manifests/openclaw-all.hub.yaml`

Platform notes:

- `openclaw-docker` now supports `windows`, `macos`, and `ubuntu`
- `openclaw-wsl` keeps the Windows host orchestration on the host side while installing the gateway inside WSL with systemd-backed readiness checks
- on Windows, the profile is intended for host Docker or explicit WSL runtime selection rather than a fake "Windows equals WSL" model

## Install docs coverage

OpenClaw install docs under `openclaw/docs/install/` are split into two groups.

Profile-backed installation methods (fully mapped in registry):

| Docs file | Hub Installer profile |
|---|---|
| `index.md` installer script | `openclaw` |
| `installer.md` git mode | `openclaw-git` |
| `installer.md` install-cli.sh mode | `openclaw-cli-script` |
| `platforms/windows.md` WSL2 flow | `openclaw-wsl` |
| `index.md` npm | `openclaw-npm` |
| `index.md` pnpm | `openclaw-pnpm` |
| `index.md` from source | `openclaw-source` |
| `bun.md` | `openclaw-bun` |
| `docker.md` | `openclaw-docker` |
| `podman.md` | `openclaw-podman` |
| `ansible.md` | `openclaw-ansible` |
| `nix.md` | `openclaw-nix` |
| `development-channels.md` | `openclaw_channel` shortcut/variable |

Installer flag coverage aligned with OpenClaw installer docs:

- `openclaw_installer_no_prompt` -> `install.sh --no-prompt`
- `openclaw_installer_dry_run` -> `install.sh --dry-run` / `install.ps1 -DryRun`
- `openclaw_installer_verbose` -> `install.sh --verbose`
- `openclaw_install_cli_json` -> `install-cli.sh --json`
- `openclaw_install_cli_set_npm_prefix` -> `install-cli.sh --set-npm-prefix`

Related runtime prerequisite docs:

| Docs file | Hub Installer builtin |
|---|---|
| `node.md` | `nodejs` (os-package/fnm/nvm) |

Deployment/operations guides (not represented as one-command install profiles):

| Docs file | Scope |
|---|---|
| `exe-dev.md`, `fly.md`, `gcp.md`, `hetzner.md`, `macos-vm.md`, `northflank.mdx`, `railway.mdx`, `render.mdx` | Hosting/platform deployment playbooks |
| `updating.md`, `migrating.md`, `uninstall.md` | Post-install lifecycle operations |

## CLI UX shortcuts

The install command accepts method/profile shortcuts for built-in software:

```bash
hub-installer openclaw docker
hub-installer openclaw beta
hub-installer openclaw npm --channel beta --onboard false
hub-installer codex dotslash-release
hub-installer nodejs fnm --node-version 22
hub-installer python uv --python-version 3.12
```

Equivalent explicit form:

```bash
hub-installer install openclaw --method docker
hub-installer install codex --method dotslash-release
```

Consistency verification:

```bash
hub-installer doctor openclaw
hub-installer doctor codex
hub-installer doctor openclaw --runtime
```

## Adding a new OpenClaw profile

1. Create a new manifest under `registry/manifests/openclaw-<profile>.hub.yaml`.
2. Add one registry entry in `registry/software-registry.yaml`.
3. Add profile alias mapping in `src/cli-registry-shortcuts.ts`.
4. Add/update test coverage in:
   - `src/registry/builtin-installers.test.ts`
   - `src/cli-registry-shortcuts.test.ts`
5. Update `README.md` and `docs/registry-spec.md`.

This flow keeps changes local, discoverable, and regression-safe.
