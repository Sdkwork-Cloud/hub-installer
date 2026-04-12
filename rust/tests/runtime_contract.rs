use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use hub_installer_rs::{ApplyManifestOptions, InstallEngine};
use hub_installer_rs::{
    runtime::{
        RuntimeOptions, RuntimeProbe, resolve_execution_context_with_probe,
        resolve_host_path_for_runtime,
    },
    state::{resolve_backup_session_dir, resolve_install_record_file},
    types::{
        ContainerRuntime, ContainerRuntimePreference, EffectiveRuntimePlatform, SupportedPlatform,
    },
};

#[derive(Default)]
struct FakeRuntimeProbe {
    host_commands: Vec<String>,
    host_docker_available: bool,
    wsl_distros: Vec<String>,
    wsl_commands: Vec<(Option<String>, String)>,
    wsl_docker_available: Vec<Option<String>>,
    wsl_home: Option<String>,
}

impl RuntimeProbe for FakeRuntimeProbe {
    fn command_exists(&self, command: &str) -> bool {
        self.host_commands.iter().any(|item| item == command)
    }

    fn list_wsl_distros(&self) -> Vec<String> {
        self.wsl_distros.clone()
    }

    fn wsl_command_exists(&self, distro: Option<&str>, command: &str) -> bool {
        self.wsl_commands
            .iter()
            .any(|(candidate_distro, candidate_command)| {
                candidate_distro.as_deref() == distro && candidate_command == command
            })
    }

    fn wsl_read_env(&self, _distro: Option<&str>, _name: &str) -> Option<String> {
        None
    }

    fn docker_available_on_host(&self) -> bool {
        self.host_docker_available
    }

    fn wsl_docker_available(&self, distro: Option<&str>) -> bool {
        self.wsl_docker_available
            .iter()
            .any(|candidate_distro| candidate_distro.as_deref() == distro)
    }

    fn wsl_home_dir(&self, _distro: Option<&str>) -> Option<String> {
        self.wsl_home.clone()
    }
}

#[test]
fn windows_host_prefers_wsl_container_runtime_when_auto_and_wsl_docker_is_available() {
    let probe = FakeRuntimeProbe {
        host_commands: vec!["docker".to_owned()],
        host_docker_available: true,
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_docker_available: vec![Some("Ubuntu-22.04".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
    };

    let context = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            container_runtime: Some(ContainerRuntimePreference::Auto),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect("runtime resolution should succeed");

    assert_eq!(
        context.effective_runtime_platform,
        EffectiveRuntimePlatform::Wsl
    );
    assert_eq!(context.container_runtime, Some(ContainerRuntime::Wsl));
    assert_eq!(context.wsl_distribution.as_deref(), Some("Ubuntu-22.04"));
    assert_eq!(context.runtime_home_dir.as_deref(), Some("/home/tester"));
}

#[test]
fn windows_host_honors_explicit_host_container_runtime_override() {
    let probe = FakeRuntimeProbe {
        host_commands: vec!["docker".to_owned()],
        host_docker_available: true,
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_docker_available: vec![Some("Ubuntu-22.04".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
    };

    let context = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            container_runtime: Some(ContainerRuntimePreference::Host),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect("runtime resolution should succeed");

    assert_eq!(
        context.effective_runtime_platform,
        EffectiveRuntimePlatform::Windows
    );
    assert_eq!(context.container_runtime, Some(ContainerRuntime::Host));
    assert_eq!(context.wsl_distribution, None);
}

#[test]
fn explicit_wsl_distribution_is_preserved_in_execution_context() {
    let probe = FakeRuntimeProbe {
        wsl_distros: vec!["Ubuntu-22.04".to_owned(), "docker-desktop".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_docker_available: vec![Some("Ubuntu-22.04".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
        ..FakeRuntimeProbe::default()
    };

    let context = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Ubuntu,
        &RuntimeOptions {
            effective_runtime_platform: Some(EffectiveRuntimePlatform::Wsl),
            wsl_distribution: Some("Ubuntu-22.04".to_owned()),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect("runtime resolution should succeed");

    assert_eq!(
        context.effective_runtime_platform,
        EffectiveRuntimePlatform::Wsl
    );
    assert_eq!(context.wsl_distribution.as_deref(), Some("Ubuntu-22.04"));
}

#[test]
fn auto_runtime_prefers_user_wsl_distribution_over_docker_desktop() {
    let probe = FakeRuntimeProbe {
        wsl_distros: vec!["docker-desktop".to_owned(), "Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_docker_available: vec![Some("Ubuntu-22.04".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
        ..FakeRuntimeProbe::default()
    };

    let context = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            container_runtime: Some(ContainerRuntimePreference::Auto),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect("runtime resolution should succeed");

    assert_eq!(context.wsl_distribution.as_deref(), Some("Ubuntu-22.04"));
}

#[test]
fn auto_runtime_falls_back_to_host_when_wsl_docker_is_not_usable() {
    let probe = FakeRuntimeProbe {
        host_commands: vec!["docker".to_owned()],
        host_docker_available: true,
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
        ..FakeRuntimeProbe::default()
    };

    let context = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            container_runtime: Some(ContainerRuntimePreference::Auto),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect("runtime resolution should succeed");

    assert_eq!(
        context.effective_runtime_platform,
        EffectiveRuntimePlatform::Windows
    );
    assert_eq!(context.container_runtime, Some(ContainerRuntime::Host));
}

#[test]
fn explicit_host_container_runtime_requires_host_docker() {
    let probe = FakeRuntimeProbe {
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_docker_available: vec![Some("Ubuntu-22.04".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
        ..FakeRuntimeProbe::default()
    };

    let error = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            container_runtime: Some(ContainerRuntimePreference::Host),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect_err("runtime resolution should fail when host docker is unavailable");

    assert!(error.to_string().contains("host Docker is unavailable"));
}

#[test]
fn explicit_wsl_container_runtime_requires_usable_wsl_docker() {
    let probe = FakeRuntimeProbe {
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
        ..FakeRuntimeProbe::default()
    };

    let error = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            container_runtime: Some(ContainerRuntimePreference::Wsl),
            wsl_distribution: Some("Ubuntu-22.04".to_owned()),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect_err("runtime resolution should fail when WSL docker is unusable");

    assert!(
        error
            .to_string()
            .contains("Docker is unavailable inside WSL distribution")
    );
}

#[test]
fn wsl_container_runtime_cannot_be_combined_with_windows_execution() {
    let probe = FakeRuntimeProbe {
        host_commands: vec!["docker".to_owned()],
        host_docker_available: true,
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "docker".to_owned())],
        wsl_docker_available: vec![Some("Ubuntu-22.04".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
    };

    let error = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            effective_runtime_platform: Some(EffectiveRuntimePlatform::Windows),
            container_runtime: Some(ContainerRuntimePreference::Wsl),
            wsl_distribution: Some("Ubuntu-22.04".to_owned()),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect_err("runtime resolution should reject incompatible Windows+WSL runtime pairing");

    assert!(
        error
            .to_string()
            .contains("container runtime wsl requires WSL execution")
    );
}

#[test]
fn wsl_execution_can_explicitly_target_host_docker() {
    let probe = FakeRuntimeProbe {
        host_commands: vec!["docker".to_owned()],
        host_docker_available: true,
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "bash".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
        ..FakeRuntimeProbe::default()
    };

    let context = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            effective_runtime_platform: Some(EffectiveRuntimePlatform::Wsl),
            container_runtime: Some(ContainerRuntimePreference::Host),
            wsl_distribution: Some("Ubuntu-22.04".to_owned()),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect("runtime resolution should allow WSL execution with explicit host docker");

    assert_eq!(
        context.effective_runtime_platform,
        EffectiveRuntimePlatform::Wsl
    );
    assert_eq!(context.container_runtime, Some(ContainerRuntime::Host));
    assert_eq!(context.wsl_distribution.as_deref(), Some("Ubuntu-22.04"));
}

#[test]
fn wsl_execution_without_container_runtime_does_not_require_docker() {
    let probe = FakeRuntimeProbe {
        wsl_distros: vec!["Ubuntu-22.04".to_owned()],
        wsl_commands: vec![(Some("Ubuntu-22.04".to_owned()), "bash".to_owned())],
        wsl_home: Some("/home/tester".to_owned()),
        ..FakeRuntimeProbe::default()
    };

    let context = resolve_execution_context_with_probe(
        SupportedPlatform::Windows,
        SupportedPlatform::Windows,
        &RuntimeOptions {
            effective_runtime_platform: Some(EffectiveRuntimePlatform::Wsl),
            wsl_distribution: Some("Ubuntu-22.04".to_owned()),
            ..RuntimeOptions::default()
        },
        &probe,
    )
    .expect("runtime resolution should allow WSL execution without Docker");

    assert_eq!(
        context.effective_runtime_platform,
        EffectiveRuntimePlatform::Wsl
    );
    assert_eq!(context.container_runtime, None);
    assert_eq!(context.wsl_distribution.as_deref(), Some("Ubuntu-22.04"));
}

#[test]
fn resolves_windows_host_accessible_paths_for_wsl_runtime_locations() {
    let execution_context = hub_installer_rs::ExecutionContext {
        host_platform: SupportedPlatform::Windows,
        target_platform: SupportedPlatform::Windows,
        effective_runtime_platform: EffectiveRuntimePlatform::Wsl,
        container_runtime: Some(ContainerRuntime::Wsl),
        wsl_distribution: Some("Ubuntu-22.04".to_owned()),
        docker_context: None,
        docker_host: None,
        runtime_home_dir: Some("/home/tester".to_owned()),
    };

    assert_eq!(
        resolve_host_path_for_runtime("/mnt/d/sdkwork/openclaw", &execution_context)
            .expect("path should map"),
        "D:\\sdkwork\\openclaw"
    );
    assert_eq!(
        resolve_host_path_for_runtime("/home/tester/.sdkwork/hub-installer", &execution_context)
            .expect("path should map"),
        "\\\\wsl$\\Ubuntu-22.04\\home\\tester\\.sdkwork\\hub-installer"
    );
    assert_eq!(
        resolve_install_record_file("/home/tester/.sdkwork/hub-installer", "openclaw"),
        "/home/tester/.sdkwork/hub-installer/state/install-records/openclaw.json"
    );
    assert_eq!(
        resolve_backup_session_dir(
            "/home/tester/.sdkwork/hub-installer",
            "openclaw",
            "2026-03-18T10:20:30.123Z"
        ),
        "/home/tester/.sdkwork/hub-installer/state/backups/openclaw/2026-03-18T10-20-30.123Z"
    );
}

#[test]
fn apply_manifest_reports_effective_runtime_metadata_in_dry_run() {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let manifest_path =
        std::env::temp_dir().join(format!("hub-installer-runtime-{unique}.hub.yaml"));
    fs::write(
        &manifest_path,
        r#"
schemaVersion: "1.0"
metadata:
  name: runtime-demo
variables:
  hub_software_name: "runtime-demo"
artifacts:
  - id: noop
    type: command
    commands: []
"#,
    )
    .expect("manifest should be written");

    let result = InstallEngine::apply_manifest(
        &path_to_string(&manifest_path),
        ApplyManifestOptions {
            platform: Some(SupportedPlatform::Windows),
            dry_run: true,
            effective_runtime_platform: Some(EffectiveRuntimePlatform::Windows),
            ..ApplyManifestOptions::default()
        },
    )
    .expect("apply_manifest should succeed");

    fs::remove_file(&manifest_path).ok();

    assert_eq!(
        result.effective_runtime_platform,
        EffectiveRuntimePlatform::Windows
    );
    assert_eq!(result.container_runtime, None);
    assert_eq!(result.wsl_distribution, None);
}

fn path_to_string(path: &Path) -> String {
    path.display().to_string()
}
