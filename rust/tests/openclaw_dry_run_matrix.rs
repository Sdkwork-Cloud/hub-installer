use std::path::PathBuf;

use hub_installer_rs::{
    ApplyManifestOptions, InstallEngine, RegistryInstallOptions,
    types::{InstallControlLevel, SupportedPlatform},
};

fn registry_source() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("registry")
        .join("software-registry.yaml")
        .display()
        .to_string()
}

#[test]
fn dry_run_openclaw_profiles_cover_multiple_install_methods() {
    let cases = [
        (
            "openclaw",
            SupportedPlatform::Windows,
            Vec::<(&str, &str)>::new(),
            InstallControlLevel::Opaque,
        ),
        (
            "openclaw-wsl",
            SupportedPlatform::Windows,
            Vec::<(&str, &str)>::new(),
            InstallControlLevel::Partial,
        ),
        (
            "openclaw-source",
            SupportedPlatform::Windows,
            Vec::<(&str, &str)>::new(),
            InstallControlLevel::Managed,
        ),
        (
            "openclaw-cli-script",
            SupportedPlatform::Ubuntu,
            Vec::<(&str, &str)>::new(),
            InstallControlLevel::Managed,
        ),
        (
            "openclaw-docker",
            SupportedPlatform::Ubuntu,
            Vec::<(&str, &str)>::new(),
            InstallControlLevel::Opaque,
        ),
        (
            "openclaw-docker",
            SupportedPlatform::Windows,
            Vec::<(&str, &str)>::new(),
            InstallControlLevel::Opaque,
        ),
        (
            "openclaw-all",
            SupportedPlatform::Windows,
            vec![("openclaw_install_method", "pnpm")],
            InstallControlLevel::Partial,
        ),
        (
            "openclaw-all",
            SupportedPlatform::Ubuntu,
            vec![("openclaw_install_method", "docker")],
            InstallControlLevel::Partial,
        ),
    ];

    for (software, platform, variables, expected_control_level) in cases {
        let result = InstallEngine::install_from_registry(
            software,
            RegistryInstallOptions {
                registry_source: Some(registry_source()),
                apply: ApplyManifestOptions {
                    platform: Some(platform),
                    dry_run: true,
                    variables: variables
                        .into_iter()
                        .map(|(key, value)| (key.to_owned(), value.to_owned()))
                        .collect(),
                    ..ApplyManifestOptions::default()
                },
            },
        )
        .unwrap_or_else(|error| panic!("{software} on {} failed: {error}", platform.as_str()));

        assert!(
            result.apply_result.success,
            "{software} should dry-run successfully"
        );
        assert_eq!(
            result.apply_result.install_control_level, expected_control_level,
            "{software} should preserve declared control level"
        );
        assert!(
            result
                .apply_result
                .artifact_reports
                .iter()
                .any(|report| report.success),
            "{software} should emit at least one successful artifact report"
        );
    }
}
