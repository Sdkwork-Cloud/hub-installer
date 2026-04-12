use serde::{Deserialize, Serialize};

pub type ProgressObserver<'a> = dyn Fn(&ProgressEvent) + Send + Sync + 'a;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgressStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProgressEvent {
    StageStarted {
        stage: String,
        total_steps: usize,
    },
    StageCompleted {
        stage: String,
        success: bool,
        total_steps: usize,
        failed_steps: usize,
    },
    ArtifactStarted {
        artifact_id: String,
        artifact_type: String,
    },
    ArtifactCompleted {
        artifact_id: String,
        artifact_type: String,
        success: bool,
    },
    DependencyStarted {
        dependency_id: String,
        target: String,
        description: Option<String>,
    },
    DependencyCompleted {
        dependency_id: String,
        target: String,
        success: bool,
        skipped: bool,
        status_after: String,
    },
    StepStarted {
        step_id: String,
        description: String,
    },
    StepCommandStarted {
        step_id: String,
        command_line: String,
        working_directory: Option<String>,
    },
    StepLogChunk {
        step_id: String,
        stream: ProgressStream,
        chunk: String,
    },
    StepCompleted {
        step_id: String,
        success: bool,
        skipped: bool,
        duration_ms: u128,
        exit_code: Option<i32>,
    },
}

pub fn emit(observer: Option<&ProgressObserver<'_>>, event: ProgressEvent) {
    if let Some(observer) = observer {
        observer(&event);
    }
}
