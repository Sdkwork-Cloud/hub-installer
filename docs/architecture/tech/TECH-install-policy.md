> Migrated from `docs/install-policy.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Hub Installer Install Policy

`hub-installer` separates its own state from the software it installs.

- `hub-installer` state lives under the installer home.
- software work trees live under the installer home state directory unless overridden.
- final software install roots follow platform defaults unless overridden.

## Installer Home

Default installer home:

- Windows: `%USERPROFILE%\.sdkwork\hub-installer`
- macOS / Ubuntu: `~/.sdkwork/hub-installer`

Installer home subdirectories:

- `config/config.json`
- `cache/registry/`
- `cache/manifests/`
- `cache/packages/`
- `state/sources/`
- `state/tmp/`
- `state/install-records/`
- `state/backups/`
- `logs/`

This directory is for `hub-installer` itself. It is not the final software install root.

## Configuration Sources

Configuration precedence:

1. CLI options
2. Environment variables
3. `config/config.json`
4. Registry entry variables
5. Manifest variables

Supported config keys in `config/config.json`:

```json
{
  "installerHome": "D:/sdkwork/hub-home",
  "installScope": "system",
  "installRoot": "D:/sdkwork/apps/openclaw",
  "workRoot": "D:/sdkwork/src/openclaw",
  "binDir": "D:/sdkwork/bin",
  "dataRoot": "D:/sdkwork/data/openclaw"
}
```

Environment variables:

- `HUB_INSTALLER_CONFIG`
- `HUB_INSTALLER_HOME`
- `HUB_INSTALLER_INSTALL_SCOPE`
- `HUB_INSTALLER_INSTALL_ROOT`
- `HUB_INSTALLER_WORK_ROOT`
- `HUB_INSTALLER_BIN_DIR`
- `HUB_INSTALLER_DATA_ROOT`

## CLI Overrides

Commands that apply manifests or install registry software support:

- `--config <path>`
- `--installer-home <path>`
- `--install-scope <system|user>`
- `--install-root <path>`
- `--work-root <path>`
- `--bin-dir <path>`
- `--data-root <path>`
- `--effective-runtime-platform <windows|macos|ubuntu|android|ios|wsl>`
- `--target <data|install|work|all>` for `backup`
- `--backup-before-uninstall`, `--backup-target`, `--backup-session-id`, `--purge-data` for `uninstall`

Examples:

```bash
hub-installer apply ./examples/codex.hub.yaml \
  --installer-home ~/.sdkwork/hub-installer \
  --install-scope user \
  --install-root ~/.local/opt/codex \
  --bin-dir ~/.local/bin
```

```bash
hub-installer registry install openclaw-cli-script \
  --install-scope system \
  --install-root /opt/openclaw \
  --bin-dir /usr/local/bin
```

```bash
hub-installer registry install codex \
  --platform windows \
  --effective-runtime-platform wsl
```

## Default Path Policy

### Windows

System scope:

- install root: `%ProgramFiles%\<App>`
- bin dir: `%ProgramFiles%\<App>\bin`
- data root: `%ProgramData%\<App>`

User scope:

- install root: `%LocalAppData%\Programs\<App>`
- bin dir: `%LocalAppData%\Programs\<App>\bin`
- data root: `%LocalAppData%\<App>`

### Unix-like

System scope:

- install root: `/opt/<app>`
- bin dir: `/usr/local/bin`
- data root: `/var/lib/<app>`

User scope:

- install root: `~/.local/opt/<app>`
- bin dir: `~/.local/bin`
- data root: `~/.local/share/<app>`

### WSL-targeted installs

WSL-targeted runtime metadata is surfaced separately from the host platform.

- Windows-hosted Codex installs resolve their effective runtime to `wsl`
- install root defaults to `~/.local/opt/<app>`
- work root defaults to `~/.sdkwork/hub-installer/state/sources/<app>`

## Install Records And Backups

Successful non-dry-run manifest installs now persist an install record under:

- `<installerHome>/state/install-records/<software>.json`

That record is the default source of truth for later:

- `backup`
- `uninstall`

Generic backup output is written under:

- `<installerHome>/state/backups/<software>/<session>/`

Default safety policy:

- `backup` defaults to the `data` target
- `uninstall` removes `installRoot` and `workRoot`
- `uninstall` preserves `dataRoot` unless `--purge-data` is explicitly set

## Install Control Levels

Built-in registry profiles report one of:

- `managed`: `hub-installer` controls the final install/work roots
- `partial`: `hub-installer` influences paths, but an upstream tool still controls part of the install
- `opaque`: the upstream installer decides the final layout

Examples:

- `codex`: `managed`
- `openclaw`: `opaque`
- `openclaw-cli-script`: `managed`
- `openclaw-source`: `managed`
- `nodejs`: `partial`
- `python`: `partial`

