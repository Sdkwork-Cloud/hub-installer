use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use hub_installer_rs::{
    ApplyManifestOptions, DependencyInstallOptions, InstallEngine,
    progress::ProgressEvent,
    types::SupportedPlatform,
};

fn current_platform() -> SupportedPlatform {
    if cfg!(windows) {
        SupportedPlatform::Windows
    } else if cfg!(target_os = "macos") {
        SupportedPlatform::Macos
    } else {
        SupportedPlatform::Ubuntu
    }
}

#[test]
fn installs_selected_dependencies_independently_and_rechecks_status() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path: PathBuf = temp_dir.path().join("dependency-install.hub.yaml");
    let data_root = temp_dir.path().join("managed").join("data");
    let deps_root = data_root.join("deps");
    let marker_file = deps_root.join("runtime-ready.txt");

    fs::write(
        &manifest_path,
        format!(
            r#"
schemaVersion: "1.0"
metadata:
  name: dependency-install-demo
platforms: [windows, macos, ubuntu]
dependencies:
  - id: runtime-ready
    description: Runtime marker file
    check:
      type: file
      path: '{marker}'
    install:
      - id: runtime-ready-unix
        shell: bash
        when:
          platforms: [macos, ubuntu]
        run: |
          set -euo pipefail
          mkdir -p "{deps_root}"
          printf "ok" > "{marker}"
      - id: runtime-ready-win
        shell: powershell
        when:
          platforms: [windows]
        run: |
          New-Item -ItemType Directory -Force "{deps_root}" | Out-Null
          Set-Content -Path "{marker}" -Value "ok"
  - id: skipped-already-there
    description: Existing marker file
    check:
      type: file
      path: '{existing}'
    install:
      - shell: bash
        when:
          platforms: [macos, ubuntu]
        run: |
          set -euo pipefail
          mkdir -p "{deps_root}"
          printf "skip" > "{existing}"
      - shell: powershell
        when:
          platforms: [windows]
        run: |
          New-Item -ItemType Directory -Force "{deps_root}" | Out-Null
          Set-Content -Path "{existing}" -Value "skip"
artifacts:
  - id: noop
    type: command
    enabled: false
    commands:
      - run: echo noop
"#,
            marker = marker_file.display(),
            deps_root = deps_root.display(),
            existing = deps_root.join("already-there.txt").display(),
        ),
    )
    .expect("write manifest");

    fs::create_dir_all(&deps_root).expect("deps dir");
    fs::write(deps_root.join("already-there.txt"), "skip").expect("existing marker");

    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    let result = InstallEngine::install_dependencies_with_observer(
        &manifest_path.display().to_string(),
        DependencyInstallOptions {
            apply: ApplyManifestOptions {
                platform: Some(current_platform()),
                data_root: Some(data_root.display().to_string()),
                ..ApplyManifestOptions::default()
            },
            dependency_ids: vec!["runtime-ready".to_owned()],
            continue_on_error: false,
        },
        &move |event| {
            sink.lock().expect("lock").push(event.clone());
        },
    )
    .expect("dependency install should succeed");

    assert!(result.success);
    assert_eq!(result.dependency_reports.len(), 1);
    assert_eq!(result.dependency_reports[0].dependency_id, "runtime-ready");
    assert_eq!(result.dependency_reports[0].status_before, "remediable");
    assert_eq!(result.dependency_reports[0].status_after, "available");
    assert!(result.dependency_reports[0].attempted_auto_remediation);
    assert!(marker_file.exists());

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::DependencyStarted { dependency_id, .. }
            if dependency_id == "runtime-ready"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::DependencyCompleted {
            dependency_id,
            success,
            ..
        } if dependency_id == "runtime-ready" && *success
    )));
}
