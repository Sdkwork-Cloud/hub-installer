use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use hub_installer_rs::{
    ApplyManifestOptions, InstallEngine, RegistryInstallOptions,
    progress::ProgressEvent,
    types::{
        ContainerRuntime, ContainerRuntimePreference, EffectiveRuntimePlatform,
        InstallControlLevel, SupportedPlatform,
    },
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
fn recommended_openclaw_profile_preserves_declared_control_level() {
    let result = InstallEngine::install_from_registry(
        "openclaw",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("registry install dry-run should succeed");

    assert_eq!(
        result.apply_result.install_control_level,
        InstallControlLevel::Opaque
    );
}

#[test]
fn openclaw_source_profile_uses_hub_software_name_for_policy_paths() {
    let result = InstallEngine::install_from_registry(
        "openclaw-source",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("registry install dry-run should succeed");

    assert!(
        result
            .apply_result
            .resolved_install_root
            .ends_with("\\openclaw")
    );
    assert!(
        result
            .apply_result
            .resolved_work_root
            .ends_with("\\state\\sources\\openclaw")
    );
}

#[test]
fn openclaw_wsl_profile_prepares_systemd_and_non_interactive_gateway_install() {
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    let result = InstallEngine::install_from_registry_with_observer(
        "openclaw-wsl",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                effective_runtime_platform: Some(EffectiveRuntimePlatform::Wsl),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
        &move |event| {
            sink.lock().expect("lock").push(event.clone());
        },
    )
    .expect("windows WSL dry-run should succeed");

    assert!(result.apply_result.success);
    assert_eq!(
        result.apply_result.effective_runtime_platform,
        EffectiveRuntimePlatform::Wsl
    );

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCommandStarted {
            step_id,
            command_line,
            ..
        } if step_id == "install-openclaw-wsl"
            && command_line.contains("systemd=true")
            && command_line.contains("wsl.exe --shutdown")
            && command_line.contains("openclaw onboard --non-interactive --install-daemon")
            && command_line.contains("--accept-risk")
            && command_line.contains("--skip-channels")
            && command_line.contains("--skip-skills")
            && command_line.contains("--skip-ui")
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCommandStarted {
            step_id,
            command_line,
            ..
        } if step_id == "openclaw-wsl-health"
            && command_line.contains("openclaw gateway status --require-rpc --json")
    )));
}

#[test]
fn openclaw_docker_profile_supports_windows_host_runtime_overrides() {
    let result = InstallEngine::install_from_registry(
        "openclaw-docker",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                effective_runtime_platform: Some(EffectiveRuntimePlatform::Windows),
                container_runtime: Some(ContainerRuntimePreference::Host),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
    )
    .expect("windows host docker dry-run should succeed");

    assert_eq!(result.apply_result.platform, SupportedPlatform::Windows);
    assert_eq!(
        result.apply_result.effective_runtime_platform,
        EffectiveRuntimePlatform::Windows
    );
    assert_eq!(
        result.apply_result.container_runtime,
        Some(ContainerRuntime::Host)
    );
    assert!(result.apply_result.success);
}

#[test]
fn openclaw_docker_profile_prepares_non_interactive_onboarding() {
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    let result = InstallEngine::install_from_registry_with_observer(
        "openclaw-docker",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                effective_runtime_platform: Some(EffectiveRuntimePlatform::Windows),
                container_runtime: Some(ContainerRuntimePreference::Host),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
        &move |event| {
            sink.lock().expect("lock").push(event.clone());
        },
    )
    .expect("windows host docker dry-run should succeed");

    assert!(result.apply_result.success);

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCommandStarted {
            step_id,
            command_line,
            ..
        } if step_id == "setup-openclaw-docker-unix"
            && command_line.contains("--non-interactive")
            && command_line.contains("--accept-risk")
    )));
}

#[test]
fn openclaw_docker_profile_keeps_patched_setup_script_inside_repo_root() {
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    InstallEngine::install_from_registry_with_observer(
        "openclaw-docker",
        RegistryInstallOptions {
            registry_source: Some(registry_source()),
            apply: ApplyManifestOptions {
                platform: Some(SupportedPlatform::Windows),
                effective_runtime_platform: Some(EffectiveRuntimePlatform::Windows),
                container_runtime: Some(ContainerRuntimePreference::Host),
                dry_run: true,
                ..ApplyManifestOptions::default()
            },
        },
        &move |event| {
            sink.lock().expect("lock").push(event.clone());
        },
    )
    .expect("windows host docker dry-run should succeed");

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCommandStarted {
            step_id,
            command_line,
            ..
        } if step_id == "setup-openclaw-docker-unix"
            && command_line.contains("setup_script=\"./docker-setup.hub-installer.sh\"")
            && !command_line.contains("setup_script=\"$(mktemp)\"")
    )));
}
