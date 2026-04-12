# Rust Library Usage

The Rust crate is designed so application code can own install orchestration directly.

## Add The Crate

```toml
[dependencies]
hub-installer-rs = { path = "../hub-installer/rust" }
```

## Main Engine APIs

The high-level API lives on `InstallEngine`.

```rust
pub struct InstallEngine;

impl InstallEngine {
    pub fn apply_manifest(
        source: &str,
        options: ApplyManifestOptions,
    ) -> Result<ApplyManifestResult>;

    pub fn backup_manifest(
        source: &str,
        options: BackupManifestOptions,
    ) -> Result<BackupManifestResult>;

    pub fn uninstall_manifest(
        source: &str,
        options: UninstallManifestOptions,
    ) -> Result<UninstallManifestResult>;

    pub fn apply_manifest_with_observer<F>(
        source: &str,
        options: ApplyManifestOptions,
        observer: &F,
    ) -> Result<ApplyManifestResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync;

    pub fn install_from_registry(
        software_name: &str,
        options: RegistryInstallOptions,
    ) -> Result<RegistryInstallResult>;

    pub fn backup_from_registry(
        software_name: &str,
        options: RegistryBackupOptions,
    ) -> Result<RegistryBackupResult>;

    pub fn uninstall_from_registry(
        software_name: &str,
        options: RegistryUninstallOptions,
    ) -> Result<RegistryUninstallResult>;

    pub fn install_from_registry_with_observer<F>(
        software_name: &str,
        options: RegistryInstallOptions,
        observer: &F,
    ) -> Result<RegistryInstallResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync;
}
```

## Applying A Manifest

```rust
use hub_installer_rs::{ApplyManifestOptions, InstallEngine};

let result = InstallEngine::apply_manifest(
    "./examples/openclaw-docker.hub.yaml",
    ApplyManifestOptions {
        platform: Some(hub_installer_rs::types::SupportedPlatform::Ubuntu),
        dry_run: true,
        installer_home: Some("~/.sdkwork/hub-installer".to_owned()),
        install_scope: Some(hub_installer_rs::types::InstallScope::User),
        ..Default::default()
    },
)?;

println!("{}", result.success);
println!("{}", result.resolved_install_root);
```

`ApplyManifestOptions` lets the caller control:

- target platform,
- effective runtime platform,
- container runtime preference,
- WSL distribution,
- Docker context and Docker host,
- dry-run and verbose/progress behavior,
- install roots and installer home,
- install control level,
- variable overrides.

## Backing Up Or Uninstalling Managed State

```rust
use hub_installer_rs::{
    ApplyManifestOptions, BackupManifestOptions, BackupTarget, InstallEngine,
    UninstallManifestOptions,
};

let backup = InstallEngine::backup_manifest(
    "./examples/openclaw-docker.hub.yaml",
    BackupManifestOptions {
        apply: ApplyManifestOptions {
            installer_home: Some("~/.sdkwork/hub-installer".to_owned()),
            ..Default::default()
        },
        targets: vec![BackupTarget::Data, BackupTarget::Work],
        session_id: Some("2026-03-18T10:20:30.123Z".to_owned()),
    },
)?;

let uninstall = InstallEngine::uninstall_manifest(
    "./examples/openclaw-docker.hub.yaml",
    UninstallManifestOptions {
        apply: ApplyManifestOptions {
            installer_home: Some("~/.sdkwork/hub-installer".to_owned()),
            ..Default::default()
        },
        backup_before_uninstall: true,
        backup_targets: vec![BackupTarget::Data],
        ..Default::default()
    },
)?;

println!("{}", backup.backup_session_dir);
println!("{}", uninstall.success);
```

Successful non-dry-run installs persist an install record under:

- `<installerHome>/state/install-records/<software>.json`

## Installing From The Registry

```rust
use hub_installer_rs::{ApplyManifestOptions, InstallEngine, RegistryInstallOptions};

let result = InstallEngine::install_from_registry(
    "nodejs",
    RegistryInstallOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        apply: ApplyManifestOptions {
            dry_run: true,
            variables: [
                ("nodejs_install_method".to_owned(), "fnm".to_owned()),
                ("nodejs_version".to_owned(), "22".to_owned()),
            ]
            .into_iter()
            .collect(),
            ..Default::default()
        },
    },
)?;

println!("{}", result.software_name);
```

This is the recommended product API when your application should expose software names instead of raw manifest paths.

Registry lifecycle operations are first-class too:

```rust
use hub_installer_rs::{
    ApplyManifestOptions, BackupManifestOptions, BackupTarget, InstallEngine,
    RegistryBackupOptions, RegistryUninstallOptions, UninstallManifestOptions,
};

let backup = InstallEngine::backup_from_registry(
    "openclaw-docker",
    RegistryBackupOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        backup: BackupManifestOptions {
            apply: ApplyManifestOptions {
                installer_home: Some("D:/hub-installer-smoke/home".to_owned()),
                ..Default::default()
            },
            targets: vec![BackupTarget::Data, BackupTarget::Work],
            session_id: Some("2026-03-18T10:20:30.123Z".to_owned()),
        },
    },
)?;

let uninstall = InstallEngine::uninstall_from_registry(
    "openclaw-docker",
    RegistryUninstallOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        uninstall: UninstallManifestOptions {
            apply: ApplyManifestOptions {
                installer_home: Some("D:/hub-installer-smoke/home".to_owned()),
                ..Default::default()
            },
            backup_before_uninstall: true,
            backup_targets: vec![BackupTarget::Data],
            ..Default::default()
        },
    },
)?;

println!("{}", backup.backup_result.backup_session_dir);
println!("{}", uninstall.uninstall_result.success);
```

## Observing Progress

```rust
use hub_installer_rs::{ApplyManifestOptions, InstallEngine, ProgressEvent, RegistryInstallOptions};

let result = InstallEngine::install_from_registry_with_observer(
    "openclaw-docker",
    RegistryInstallOptions {
        registry_source: Some("./registry/software-registry.yaml".to_owned()),
        apply: ApplyManifestOptions {
            progress: true,
            ..Default::default()
        },
    },
    &|event: &ProgressEvent| {
        match event {
            ProgressEvent::StepCommandStarted { command_line, .. } => {
                println!("running: {command_line}");
            }
            ProgressEvent::StepLogChunk { chunk, .. } => {
                print!("{chunk}");
            }
            _ => {}
        }
    },
)?;

println!("{}", result.apply_result.success);
```

Rust library consumers should prefer the observer path whenever UI or logging needs live updates.

## WSL State And Host File Access

When the Rust engine runs on Windows with `effective_runtime_platform = wsl`:

- manifest commands still receive WSL-native runtime paths such as `/home/tester/...` or `/mnt/d/...`,
- install records, backup directories, and uninstall file operations are mapped to host-accessible Windows paths such as `D:\...` or `\\wsl$\Ubuntu-22.04\...`.

That split is intentional. It lets a Tauri or native Windows host keep lifecycle state reliable while the actual install commands execute inside WSL.

## Runtime Resolution As A Library Concern

You can resolve runtime independently if your application wants to decide policy before running an install.

```rust
use hub_installer_rs::{
    RuntimeOptions,
    resolve_execution_context,
    types::{ContainerRuntimePreference, EffectiveRuntimePlatform, SupportedPlatform},
};

let context = resolve_execution_context(
    SupportedPlatform::Windows,
    &RuntimeOptions {
        effective_runtime_platform: Some(EffectiveRuntimePlatform::Wsl),
        container_runtime: Some(ContainerRuntimePreference::Wsl),
        wsl_distribution: Some("Ubuntu-22.04".to_owned()),
        docker_context: None,
        docker_host: None,
    },
)?;

println!("{}", context.effective_runtime_platform.as_str());
```

This is especially useful when:

- a settings page lets users pick runtime behavior,
- you need to validate Docker or WSL before showing an install action,
- you want to persist runtime policy separately from manifest content.

## Lower-Level Building Blocks

Advanced consumers can also use lower-level modules directly:

- `hub_installer_rs::manifest` for loading and validating manifests,
- `hub_installer_rs::registry` for loading registries,
- `hub_installer_rs::executor` for plan execution internals,
- `hub_installer_rs::policy` for install path resolution.

The recommended default remains `InstallEngine` unless you truly need custom orchestration.
