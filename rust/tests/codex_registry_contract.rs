use std::{fs, path::PathBuf};

use hub_installer_rs::{
    ApplyManifestOptions, HubInstallManifest, InstallEngine, RegistryInstallOptions,
    types::{EffectiveRuntimePlatform, SupportedPlatform},
};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn registry_source() -> String {
    workspace_root()
        .join("registry")
        .join("software-registry.yaml")
        .display()
        .to_string()
}

fn codex_manifest_path() -> PathBuf {
    workspace_root()
        .join("registry")
        .join("manifests")
        .join("codex.hub.yaml")
}

#[test]
fn codex_manifest_uses_runtime_managed_absolute_wsl_paths() {
    let manifest_path = codex_manifest_path();
    let manifest: HubInstallManifest = serde_yaml::from_str(
        &fs::read_to_string(&manifest_path).expect("manifest should be readable"),
    )
    .expect("manifest should parse");

    assert_eq!(
        manifest.variables.get("codex_wsl_source_dir"),
        Some(&"{{hub_work_root}}".to_owned())
    );
    assert_eq!(
        manifest.variables.get("codex_wsl_binary_link"),
        Some(&"{{hub_bin_dir}}/codex".to_owned())
    );
    assert_eq!(
        manifest.variables.get("codex_wsl_dotslash_target"),
        Some(&"{{hub_bin_dir}}/codex".to_owned())
    );
}

#[test]
fn codex_registry_install_defaults_to_wsl_runtime_on_windows() {
    let result = InstallEngine::install_from_registry(
        "codex",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                wsl_distribution: Some("Ubuntu-22.04".to_owned()),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("codex registry install dry-run should succeed");

    assert_eq!(
        result.apply_result.effective_runtime_platform,
        EffectiveRuntimePlatform::Wsl
    );
    assert_eq!(
        result.apply_result.wsl_distribution.as_deref(),
        Some("Ubuntu-22.04")
    );
    assert!(
        !result.apply_result.resolved_install_root.contains('\\'),
        "codex WSL runtime should resolve Linux-style install paths"
    );
}
