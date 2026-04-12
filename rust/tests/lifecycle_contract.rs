use std::{
    fs,
    path::{Path, PathBuf},
};

use hub_installer_rs::{
    ApplyManifestOptions, BackupManifestOptions, BackupTarget, InstallEngine,
    RegistryBackupOptions, RegistryInstallOptions, RegistryUninstallOptions,
    UninstallManifestOptions,
    state::{InstallRecordStatus, read_install_record, resolve_backup_session_dir},
    types::{InstallScope, SupportedPlatform},
};

fn host_platform() -> SupportedPlatform {
    if cfg!(windows) {
        SupportedPlatform::Windows
    } else if cfg!(target_os = "macos") {
        SupportedPlatform::Macos
    } else {
        SupportedPlatform::Ubuntu
    }
}

fn write_manifest(manifest_path: &Path) {
    fs::write(
        manifest_path,
        r#"
schemaVersion: "1.0"
metadata:
  name: openclaw
artifacts:
  - id: noop
    type: command
    enabled: false
    commands:
      - run: echo noop
"#,
    )
    .expect("write manifest");
}

fn write_registry_fixture(root: &Path) -> PathBuf {
    let manifests_dir = root.join("registry-manifests");
    fs::create_dir_all(&manifests_dir).expect("create manifests dir");
    let manifest_path = manifests_dir.join("openclaw.hub.yaml");
    write_manifest(&manifest_path);

    let registry_path = root.join("software-registry.yaml");
    fs::write(
        &registry_path,
        format!(
            r#"
schemaVersion: "1.0"
metadata:
  name: test registry
entries:
  - name: openclaw
    manifest: "{}"
"#,
            manifest_path.display().to_string().replace('\\', "/")
        ),
    )
    .expect("write registry");
    registry_path
}

fn create_apply_options(root: &Path) -> ApplyManifestOptions {
    ApplyManifestOptions {
        platform: Some(host_platform()),
        installer_home: Some(root.join("hub-home").display().to_string()),
        install_scope: Some(InstallScope::User),
        install_root: Some(root.join("managed").join("install").display().to_string()),
        work_root: Some(root.join("managed").join("work").display().to_string()),
        bin_dir: Some(root.join("managed").join("bin").display().to_string()),
        data_root: Some(root.join("managed").join("data").display().to_string()),
        ..ApplyManifestOptions::default()
    }
}

fn seed_managed_layout(options: &ApplyManifestOptions) {
    let install_root = PathBuf::from(options.install_root.as_ref().expect("install root"));
    let work_root = PathBuf::from(options.work_root.as_ref().expect("work root"));
    let data_root = PathBuf::from(options.data_root.as_ref().expect("data root"));

    fs::create_dir_all(&install_root).expect("install root");
    fs::create_dir_all(&work_root).expect("work root");
    fs::create_dir_all(&data_root).expect("data root");
    fs::write(install_root.join("install.txt"), "install").expect("install file");
    fs::write(work_root.join("work.txt"), "work").expect("work file");
    fs::write(data_root.join("data.txt"), "data").expect("data file");
}

#[test]
fn apply_manifest_persists_install_record() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path = temp_dir.path().join("openclaw.hub.yaml");
    write_manifest(&manifest_path);
    let options = create_apply_options(temp_dir.path());

    let result =
        InstallEngine::apply_manifest(&manifest_path.display().to_string(), options.clone())
            .expect("apply should succeed");

    assert!(result.success);
    let record = read_install_record(
        options.installer_home.as_ref().expect("installer home"),
        "openclaw",
    )
    .expect("read record")
    .expect("record should exist");

    assert_eq!(record.status, InstallRecordStatus::Installed);
    assert_eq!(
        record.install_root,
        options.install_root.expect("install root should exist")
    );
}

#[test]
fn backup_and_uninstall_manage_roots_and_state() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path = temp_dir.path().join("openclaw.hub.yaml");
    write_manifest(&manifest_path);
    let options = create_apply_options(temp_dir.path());

    InstallEngine::apply_manifest(&manifest_path.display().to_string(), options.clone())
        .expect("apply should succeed");
    seed_managed_layout(&options);

    let backup = InstallEngine::backup_manifest(
        &manifest_path.display().to_string(),
        hub_installer_rs::BackupManifestOptions {
            apply: options.clone(),
            targets: vec![
                hub_installer_rs::BackupTarget::Data,
                hub_installer_rs::BackupTarget::Install,
                hub_installer_rs::BackupTarget::Work,
            ],
            session_id: Some("2026-03-18T10:20:30.123Z".to_owned()),
        },
    )
    .expect("backup should succeed");

    assert!(backup.success);
    assert_eq!(backup.target_reports.len(), 3);
    let backup_session_dir = resolve_backup_session_dir(
        options.installer_home.as_ref().expect("installer home"),
        "openclaw",
        "2026-03-18T10:20:30.123Z",
    );
    assert_eq!(backup.backup_session_dir, backup_session_dir);
    assert!(
        Path::new(&backup_session_dir)
            .join("data")
            .join("data.txt")
            .exists()
    );

    let uninstall = InstallEngine::uninstall_manifest(
        &manifest_path.display().to_string(),
        hub_installer_rs::UninstallManifestOptions {
            apply: options.clone(),
            purge_data: false,
            backup_before_uninstall: false,
            backup_targets: Vec::new(),
            backup_session_id: None,
        },
    )
    .expect("uninstall should succeed");

    assert!(uninstall.success);
    assert!(!Path::new(options.install_root.as_ref().expect("install root")).exists());
    assert!(!Path::new(options.work_root.as_ref().expect("work root")).exists());
    assert!(Path::new(options.data_root.as_ref().expect("data root")).exists());

    let record = read_install_record(
        options.installer_home.as_ref().expect("installer home"),
        "openclaw",
    )
    .expect("read record")
    .expect("record should exist");
    assert_eq!(record.status, InstallRecordStatus::Uninstalled);
}

#[test]
fn registry_backup_and_uninstall_manage_roots_and_state() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let registry_path = write_registry_fixture(temp_dir.path());
    let options = create_apply_options(temp_dir.path());

    InstallEngine::install_from_registry(
        "openclaw",
        RegistryInstallOptions {
            registry_source: Some(registry_path.display().to_string()),
            apply: options.clone(),
        },
    )
    .expect("registry install should succeed");
    seed_managed_layout(&options);

    let backup = InstallEngine::backup_from_registry(
        "openclaw",
        RegistryBackupOptions {
            registry_source: Some(registry_path.display().to_string()),
            backup: BackupManifestOptions {
                apply: options.clone(),
                targets: vec![
                    BackupTarget::Data,
                    BackupTarget::Install,
                    BackupTarget::Work,
                ],
                session_id: Some("2026-03-18T10:20:30.123Z".to_owned()),
            },
        },
    )
    .expect("registry backup should succeed");

    assert!(backup.backup_result.success);
    let backup_session_dir = resolve_backup_session_dir(
        options.installer_home.as_ref().expect("installer home"),
        "openclaw",
        "2026-03-18T10:20:30.123Z",
    );
    assert_eq!(backup.backup_result.backup_session_dir, backup_session_dir);

    let uninstall = InstallEngine::uninstall_from_registry(
        "openclaw",
        RegistryUninstallOptions {
            registry_source: Some(registry_path.display().to_string()),
            uninstall: UninstallManifestOptions {
                apply: options.clone(),
                purge_data: true,
                backup_before_uninstall: false,
                backup_targets: Vec::new(),
                backup_session_id: None,
            },
        },
    )
    .expect("registry uninstall should succeed");

    assert!(uninstall.uninstall_result.success);
    assert!(!Path::new(options.install_root.as_ref().expect("install root")).exists());
    assert!(!Path::new(options.work_root.as_ref().expect("work root")).exists());
    assert!(!Path::new(options.data_root.as_ref().expect("data root")).exists());

    let record = read_install_record(
        options.installer_home.as_ref().expect("installer home"),
        "openclaw",
    )
    .expect("read record")
    .expect("record should exist");
    assert_eq!(record.status, InstallRecordStatus::Uninstalled);
}
