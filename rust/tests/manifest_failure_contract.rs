use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use hub_installer_rs::{ApplyManifestOptions, InstallEngine, progress::ProgressEvent};

#[test]
fn artifact_stage_failure_marks_manifest_unsuccessful() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path: PathBuf = temp_dir.path().join("artifact-failure.hub.yaml");
    fs::write(
        &manifest_path,
        r#"
schemaVersion: "1.0"
metadata:
  name: artifact-failure
platforms: [windows]
artifacts:
  - id: failing-artifact
    type: command
    commands:
      - id: failing-step
        run: "Write-Error 'boom'; exit 1"
        continueOnError: true
"#,
    )
    .expect("write manifest");

    let result = InstallEngine::apply_manifest(
        &manifest_path.display().to_string(),
        ApplyManifestOptions {
            platform: Some(hub_installer_rs::types::SupportedPlatform::Windows),
            ..ApplyManifestOptions::default()
        },
    )
    .expect("manifest should execute");

    assert!(!result.success);
    assert_eq!(result.artifact_reports.len(), 1);
    assert!(!result.artifact_reports[0].success);
}

#[test]
fn failing_artifact_emits_failure_stage_and_artifact_events() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path: PathBuf = temp_dir.path().join("artifact-failure-events.hub.yaml");
    fs::write(
        &manifest_path,
        r#"
schemaVersion: "1.0"
metadata:
  name: artifact-failure-events
platforms: [windows]
artifacts:
  - id: failing-artifact
    type: command
    commands:
      - id: failing-step
        run: "Write-Error 'boom'; exit 5"
"#,
    )
    .expect("write manifest");

    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    let error = InstallEngine::apply_manifest_with_observer(
        &manifest_path.display().to_string(),
        ApplyManifestOptions {
            platform: Some(hub_installer_rs::types::SupportedPlatform::Windows),
            ..ApplyManifestOptions::default()
        },
        &move |event| {
            sink.lock().expect("lock").push(event.clone());
        },
    )
    .expect_err("manifest should fail");

    assert!(error.to_string().contains("STEP_FAILED"));

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StageCompleted {
            stage,
            success,
            ..
        } if stage == "artifactCommand" && !success
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::ArtifactCompleted {
            artifact_id,
            success,
            ..
        } if artifact_id == "failing-artifact" && !success
    )));
}
