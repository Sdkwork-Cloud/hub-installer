use std::path::PathBuf;

use hub_installer_rs::engine::InstallEngine;
use hub_installer_rs::types::SupportedPlatform;
use hub_installer_rs::{ApplyManifestOptions, RegistryInstallOptions};

fn registry_source() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("registry")
        .join("software-registry.yaml")
        .display()
        .to_string()
}

#[test]
fn inspection_surfaces_zeroclaw_installation_data_and_migration_descriptors() {
    let result = InstallEngine::inspect_from_registry(
        "zeroclaw-source",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Ubuntu),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("registry inspection should succeed");

    let installation = result
        .assessment_result
        .installation
        .expect("installation descriptor should exist");
    let directories = installation
        .directories
        .expect("installation directories should exist");
    assert_eq!(installation.method.id, "source-build");
    assert_eq!(
        directories
            .work_root
            .as_ref()
            .and_then(|directory| directory.customizable),
        Some(true)
    );
    assert_eq!(
        directories
            .work_root
            .as_ref()
            .map(|directory| directory.path.as_str()),
        Some("{{hub_work_root}}")
    );

    let data_item = result
        .assessment_result
        .data_items
        .iter()
        .find(|item| item.id == "zeroclaw-home")
        .expect("zeroclaw home data item should exist");
    assert_eq!(data_item.kind, "directory");
    assert!(
        data_item
            .includes
            .contains(&"auth-profiles.json".to_owned())
    );
    assert_eq!(data_item.uninstall_by_default, "preserve");

    let migration = result
        .assessment_result
        .migration_strategies
        .iter()
        .find(|strategy| strategy.source == "openclaw")
        .expect("openclaw migration strategy should exist");
    assert_eq!(migration.mode, "command");
    assert_eq!(
        migration.preview_commands[0].run,
        "zeroclaw migrate openclaw --dry-run"
    );
}

#[test]
fn inspection_surfaces_ironclaw_manual_database_migration_constraints() {
    let result = InstallEngine::inspect_from_registry(
        "ironclaw-source",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Ubuntu),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("registry inspection should succeed");

    let database_item = result
        .assessment_result
        .data_items
        .iter()
        .find(|item| item.id == "ironclaw-postgres")
        .expect("ironclaw postgres data item should exist");
    assert_eq!(database_item.kind, "database");
    assert_eq!(database_item.uninstall_by_default, "manual");

    let migration = result
        .assessment_result
        .migration_strategies
        .iter()
        .find(|strategy| strategy.source == "openclaw")
        .expect("openclaw migration strategy should exist");
    assert_eq!(migration.mode, "manual");
    assert_eq!(migration.supported, Some(false));
    assert!(
        migration
            .warnings
            .iter()
            .any(|warning| warning.contains("PostgreSQL")),
        "migration warning should mention PostgreSQL"
    );
}

#[test]
fn inspection_surfaces_developer_package_manager_descriptors() {
    let npm_result = InstallEngine::inspect_from_registry(
        "npm",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Ubuntu),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("npm registry inspection should succeed");

    let npm_installation = npm_result
        .assessment_result
        .installation
        .expect("npm installation descriptor should exist");
    assert_eq!(npm_installation.method.id, "npm-global");
    assert!(
        npm_result
            .assessment_result
            .dependencies
            .iter()
            .any(|dependency| dependency.id == "nodejs"),
        "npm should declare a nodejs dependency"
    );

    let pnpm_result = InstallEngine::inspect_from_registry(
        "pnpm",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Ubuntu),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("pnpm registry inspection should succeed");

    let pnpm_installation = pnpm_result
        .assessment_result
        .installation
        .expect("pnpm installation descriptor should exist");
    assert_eq!(pnpm_installation.method.id, "pnpm-global");
    assert!(
        pnpm_result
            .assessment_result
            .dependencies
            .iter()
            .any(|dependency| dependency.id == "nodejs"),
        "pnpm should declare a nodejs dependency"
    );

    let brew_result = InstallEngine::inspect_from_registry(
        "brew",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("brew registry inspection should succeed");

    let brew_installation = brew_result
        .assessment_result
        .installation
        .expect("brew installation descriptor should exist");
    assert_eq!(brew_installation.method.id, "homebrew");
    assert!(
        brew_installation.method.summary.contains("WSL")
            || brew_installation.method.summary.contains("Windows"),
        "brew summary should mention the Windows WSL bridge"
    );
}
