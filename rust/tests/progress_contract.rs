use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use hub_installer_rs::{
    ApplyManifestOptions, BackupManifestOptions, BackupTarget, InstallEngine,
    progress::{ProgressEvent, ProgressStream},
};

#[test]
fn emits_stage_artifact_and_step_progress_events() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path: PathBuf = temp_dir.path().join("progress.hub.yaml");
    fs::write(
        &manifest_path,
        r#"
schemaVersion: "1.0"
metadata:
  name: progress-demo
platforms: [windows]
lifecycle:
  preflight:
    - id: preflight-check
      run: "Write-Output 'preflight'"
artifacts:
  - id: setup
    type: command
    commands:
      - id: artifact-step
        run: "Write-Output 'artifact'"
"#,
    )
    .expect("write manifest");

    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    InstallEngine::apply_manifest_with_observer(
        &manifest_path.display().to_string(),
        ApplyManifestOptions {
            platform: Some(hub_installer_rs::types::SupportedPlatform::Windows),
            dry_run: true,
            ..ApplyManifestOptions::default()
        },
        &move |event| {
            sink.lock().expect("lock").push(event.clone());
        },
    )
    .expect("manifest should execute");

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StageStarted { stage, .. } if stage == "preflight"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::ArtifactStarted { artifact_id, .. } if artifact_id == "setup"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCommandStarted {
            step_id,
            command_line,
            ..
        } if step_id == "artifact-step" && command_line.contains("Write-Output")
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCompleted {
            step_id,
            exit_code,
            ..
        } if step_id == "artifact-step" && *exit_code == Some(0)
    )));
    assert!(!events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepLogChunk {
            stream: ProgressStream::Stdout,
            ..
        }
    )));
}

#[test]
fn emits_internal_backup_step_progress_events() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path: PathBuf = temp_dir.path().join("backup-progress.hub.yaml");
    let installer_home = temp_dir.path().join("hub-home");
    let install_root = temp_dir.path().join("managed").join("install");
    let work_root = temp_dir.path().join("managed").join("work");
    let data_root = temp_dir.path().join("managed").join("data");

    fs::write(
        &manifest_path,
        r#"
schemaVersion: "1.0"
metadata:
  name: progress-backup-demo
artifacts:
  - id: noop
    type: command
    enabled: false
    commands:
      - run: echo noop
"#,
    )
    .expect("write manifest");

    InstallEngine::apply_manifest(
        &manifest_path.display().to_string(),
        ApplyManifestOptions {
            platform: Some(hub_installer_rs::types::SupportedPlatform::Windows),
            installer_home: Some(installer_home.display().to_string()),
            install_root: Some(install_root.display().to_string()),
            work_root: Some(work_root.display().to_string()),
            bin_dir: Some(
                temp_dir
                    .path()
                    .join("managed")
                    .join("bin")
                    .display()
                    .to_string(),
            ),
            data_root: Some(data_root.display().to_string()),
            ..ApplyManifestOptions::default()
        },
    )
    .expect("apply should succeed");

    fs::create_dir_all(&data_root).expect("data dir");
    fs::write(data_root.join("data.txt"), "data").expect("data file");

    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    InstallEngine::backup_manifest_with_observer(
        &manifest_path.display().to_string(),
        BackupManifestOptions {
            apply: ApplyManifestOptions {
                platform: Some(hub_installer_rs::types::SupportedPlatform::Windows),
                installer_home: Some(installer_home.display().to_string()),
                install_root: Some(install_root.display().to_string()),
                work_root: Some(work_root.display().to_string()),
                bin_dir: Some(
                    temp_dir
                        .path()
                        .join("managed")
                        .join("bin")
                        .display()
                        .to_string(),
                ),
                data_root: Some(data_root.display().to_string()),
                ..ApplyManifestOptions::default()
            },
            targets: vec![BackupTarget::Data],
            session_id: Some("2026-03-18T10:20:30.123Z".to_owned()),
        },
        &move |event| {
            sink.lock().expect("lock").push(event.clone());
        },
    )
    .expect("backup should succeed");

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCommandStarted { step_id, command_line, .. }
            if step_id == "backup-data" && command_line.contains("copy")
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCompleted { step_id, success, .. }
            if step_id == "backup-data" && *success
    )));
}
