use std::path::PathBuf;

use hub_installer_rs::engine::InstallEngine;
use hub_installer_rs::state::{InstallRecord, InstallRecordStatus, write_install_record};
use hub_installer_rs::types::{EffectiveRuntimePlatform, SupportedPlatform};
use hub_installer_rs::{ApplyManifestOptions, RegistryInstallOptions};
use tempfile::tempdir;

fn registry_source() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("registry")
        .join("software-registry.yaml")
        .display()
        .to_string()
}

#[test]
fn inspection_reports_dependency_guidance_for_rust_native_profiles() {
    let result = InstallEngine::inspect_from_registry(
        "zeroclaw-source",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("registry inspection should succeed");

    assert_eq!(
        result.assessment_result.manifest_name,
        "ZeroClaw Install (Source)"
    );
    assert_eq!(
        result.assessment_result.platform,
        SupportedPlatform::Windows
    );
    assert!(result.assessment_result.ready || !result.assessment_result.issues.is_empty());

    let cargo_dependency = result
        .assessment_result
        .dependencies
        .iter()
        .find(|dependency| dependency.id == "cargo")
        .expect("cargo dependency should be included");

    assert_eq!(cargo_dependency.check_type, "command");
    assert_eq!(cargo_dependency.target, "cargo");
    assert!(!cargo_dependency.remediation_commands.is_empty());
    assert!(
        result
            .assessment_result
            .runtime
            .command_availability
            .contains_key("cargo")
    );
    assert_eq!(result.assessment_result.install_status, None);
}

#[test]
fn inspection_surfaces_existing_install_record_status() {
    let installer_home = tempdir().expect("temp installer home");
    write_install_record(
        installer_home.path().to_str().expect("installer home path"),
        "zeroclaw",
        &InstallRecord {
            schema_version: "1.0".to_owned(),
            software_name: "zeroclaw".to_owned(),
            manifest_name: "ZeroClaw Install (Source)".to_owned(),
            manifest_path: "registry/manifests/zeroclaw-source.hub.yaml".to_owned(),
            manifest_source_input: "registry/manifests/zeroclaw-source.hub.yaml".to_owned(),
            manifest_source_kind: "registry-entry".to_owned(),
            platform: SupportedPlatform::Windows,
            effective_runtime_platform: hub_installer_rs::types::EffectiveRuntimePlatform::Windows,
            installer_home: installer_home.path().display().to_string(),
            install_scope: hub_installer_rs::types::InstallScope::User,
            install_root: "C:/Users/admin/.sdkwork/install/zeroclaw".to_owned(),
            work_root: "C:/Users/admin/.sdkwork/work/zeroclaw".to_owned(),
            bin_dir: "C:/Users/admin/.sdkwork/bin".to_owned(),
            data_root: "C:/Users/admin/.sdkwork/data/zeroclaw".to_owned(),
            install_control_level: hub_installer_rs::types::InstallControlLevel::Managed,
            status: InstallRecordStatus::Installed,
            installed_at: Some("2026-03-20T00:00:00Z".to_owned()),
            updated_at: "2026-03-20T00:00:00Z".to_owned(),
        },
    )
    .expect("install record should be written");

    let result = InstallEngine::inspect_from_registry(
        "zeroclaw-source",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                effective_runtime_platform: Some(EffectiveRuntimePlatform::Windows),
                installer_home: Some(installer_home.path().display().to_string()),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("registry inspection should succeed");

    assert_eq!(
        result.assessment_result.install_status,
        Some(InstallRecordStatus::Installed)
    );
}
