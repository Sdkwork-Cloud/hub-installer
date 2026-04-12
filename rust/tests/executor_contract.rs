use std::collections::BTreeMap;
#[cfg(windows)]
use std::path::Path;
use std::sync::{Arc, Mutex};

use hub_installer_rs::{
    executor::should_wrap_with_sudo_for_test,
    executor::{ExecuteOptions, execute_plan, execute_plan_with_observer},
    executor::{command_invocation_for_test, resolve_shell_program_for_test},
    progress::{ProgressEvent, ProgressStream},
    runtime::ExecutionContext,
    types::{
        ContainerRuntime, EffectiveRuntimePlatform, InstallPlan, InstallRequestSummary,
        InstallStep, PackageFormat, ShellKind, SupportedPlatform,
    },
};

#[test]
fn respects_explicit_powershell_shell_kind() {
    let result = execute_plan(
        InstallPlan {
            request: InstallRequestSummary {
                source: "unit-test".to_owned(),
                platform: SupportedPlatform::Windows,
                format: PackageFormat::Manager,
            },
            steps: vec![InstallStep {
                id: "powershell-step".to_owned(),
                description: "powershell".to_owned(),
                command: "Write-Output 'shell-kind-ok'".to_owned(),
                args: Vec::new(),
                shell: true,
                shell_kind: Some(ShellKind::Powershell),
                requires_elevation: false,
                working_directory: None,
                env: BTreeMap::new(),
                continue_on_error: false,
                timeout_ms: None,
            }],
            notes: Vec::new(),
            guidance: Vec::new(),
        },
        SupportedPlatform::Windows,
        &ExecuteOptions::default(),
    )
    .expect("execution should succeed");

    assert!(result.success);
    assert!(result.steps[0].stdout.contains("shell-kind-ok"));
}

#[test]
fn fails_when_step_times_out() {
    let error = execute_plan(
        InstallPlan {
            request: InstallRequestSummary {
                source: "unit-test".to_owned(),
                platform: SupportedPlatform::Windows,
                format: PackageFormat::Manager,
            },
            steps: vec![InstallStep {
                id: "timeout-step".to_owned(),
                description: "timeout".to_owned(),
                command: "Start-Sleep -Milliseconds 300".to_owned(),
                args: Vec::new(),
                shell: true,
                shell_kind: Some(ShellKind::Powershell),
                requires_elevation: false,
                working_directory: None,
                env: BTreeMap::new(),
                continue_on_error: false,
                timeout_ms: Some(50),
            }],
            notes: Vec::new(),
            guidance: Vec::new(),
        },
        SupportedPlatform::Windows,
        &ExecuteOptions::default(),
    )
    .expect_err("execution should time out");

    let message = error.to_string();
    assert!(message.contains("STEP_TIMEOUT"));
    assert!(message.contains("timeout-step"));
}

#[test]
fn resolves_bash_to_explicit_override_on_windows() {
    let previous = std::env::var("HUB_INSTALLER_BASH").ok();
    unsafe {
        std::env::set_var("HUB_INSTALLER_BASH", "C:\\custom\\bash.exe");
    }

    let program = resolve_shell_program_for_test(ShellKind::Bash, SupportedPlatform::Windows);

    if let Some(previous) = previous {
        unsafe {
            std::env::set_var("HUB_INSTALLER_BASH", previous);
        }
    } else {
        unsafe {
            std::env::remove_var("HUB_INSTALLER_BASH");
        }
    }

    assert_eq!(program, "C:\\custom\\bash.exe");
}

#[test]
fn windows_host_does_not_wrap_unix_target_commands_with_sudo() {
    assert!(!should_wrap_with_sudo_for_test(true, true));
}

#[test]
#[cfg(windows)]
fn windows_host_executes_bash_steps_for_ubuntu_target_with_git_bash() {
    let git_bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    if !Path::new(git_bash).exists() {
        eprintln!("skipping: Git Bash is not installed on this host");
        return;
    }

    let result = execute_plan(
        InstallPlan {
            request: InstallRequestSummary {
                source: "unit-test".to_owned(),
                platform: SupportedPlatform::Ubuntu,
                format: PackageFormat::Manager,
            },
            steps: vec![InstallStep {
                id: "bash-step".to_owned(),
                description: "bash".to_owned(),
                command: "echo shell-kind-ok".to_owned(),
                args: Vec::new(),
                shell: true,
                shell_kind: Some(ShellKind::Bash),
                requires_elevation: false,
                working_directory: None,
                env: BTreeMap::new(),
                continue_on_error: false,
                timeout_ms: None,
            }],
            notes: Vec::new(),
            guidance: Vec::new(),
        },
        SupportedPlatform::Ubuntu,
        &ExecuteOptions::default(),
    )
    .expect("execution should succeed on Windows host via Git Bash");

    assert!(result.success);
    assert!(result.steps[0].stdout.contains("shell-kind-ok"));
}

#[test]
fn wsl_runtime_wraps_bash_steps_with_wsl_launcher() {
    let step = InstallStep {
        id: "bash-step".to_owned(),
        description: "bash".to_owned(),
        command: "echo shell-kind-ok".to_owned(),
        args: Vec::new(),
        shell: true,
        shell_kind: Some(ShellKind::Bash),
        requires_elevation: false,
        working_directory: Some("D:\\workspace\\openclaw".to_owned()),
        env: BTreeMap::from([("DOCKER_CONTEXT".to_owned(), "desktop-linux".to_owned())]),
        continue_on_error: false,
        timeout_ms: None,
    };

    let invocation = command_invocation_for_test(
        &step,
        SupportedPlatform::Windows,
        &ExecuteOptions {
            execution_context: Some(ExecutionContext {
                host_platform: SupportedPlatform::Windows,
                target_platform: SupportedPlatform::Windows,
                effective_runtime_platform: EffectiveRuntimePlatform::Wsl,
                container_runtime: Some(ContainerRuntime::Wsl),
                wsl_distribution: Some("Ubuntu-22.04".to_owned()),
                docker_context: Some("desktop-linux".to_owned()),
                docker_host: None,
                runtime_home_dir: Some("/home/tester".to_owned()),
            }),
            ..ExecuteOptions::default()
        },
    )
    .expect("invocation should resolve");

    assert_eq!(invocation.program, "wsl.exe");
    assert_eq!(invocation.args[..4], ["-d", "Ubuntu-22.04", "--", "bash"]);
    assert!(invocation.args[5].contains("cd '/mnt/d/workspace/openclaw'"));
    assert!(invocation.args[5].contains("export DOCKER_CONTEXT='desktop-linux'"));
    assert!(invocation.handles_env);
    assert!(invocation.handles_working_directory);
}

#[test]
fn streams_step_command_and_output_events() {
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    let result = execute_plan_with_observer(
        InstallPlan {
            request: InstallRequestSummary {
                source: "unit-test".to_owned(),
                platform: SupportedPlatform::Windows,
                format: PackageFormat::Manager,
            },
            steps: vec![InstallStep {
                id: "stream-step".to_owned(),
                description: "stream".to_owned(),
                command: "Write-Output 'stdout-line'; [Console]::Error.WriteLine('stderr-line')"
                    .to_owned(),
                args: Vec::new(),
                shell: true,
                shell_kind: Some(ShellKind::Powershell),
                requires_elevation: false,
                working_directory: None,
                env: BTreeMap::new(),
                continue_on_error: false,
                timeout_ms: None,
            }],
            notes: Vec::new(),
            guidance: Vec::new(),
        },
        SupportedPlatform::Windows,
        &ExecuteOptions::default(),
        Some(&move |event| {
            sink.lock().expect("lock").push(event.clone());
        }),
    )
    .expect("execution should succeed");

    assert!(result.success);

    let events = events.lock().expect("lock");
    let command_index = events
        .iter()
        .position(|event| {
            matches!(
                event,
                ProgressEvent::StepCommandStarted { step_id, .. } if step_id == "stream-step"
            )
        })
        .expect("command event");
    let stdout_index = events
        .iter()
        .position(|event| {
            matches!(
                event,
                ProgressEvent::StepLogChunk {
                    step_id,
                    stream: ProgressStream::Stdout,
                    chunk,
                } if step_id == "stream-step" && chunk.contains("stdout-line")
            )
        })
        .expect("stdout event");
    let stderr_index = events
        .iter()
        .position(|event| {
            matches!(
                event,
                ProgressEvent::StepLogChunk {
                    step_id,
                    stream: ProgressStream::Stderr,
                    chunk,
                } if step_id == "stream-step" && chunk.contains("stderr-line")
            )
        })
        .expect("stderr event");
    let completed_index = events
        .iter()
        .position(|event| {
            matches!(
                event,
                ProgressEvent::StepCompleted {
                    step_id,
                    success,
                    exit_code,
                    ..
                } if step_id == "stream-step" && *success && *exit_code == Some(0)
            )
        })
        .expect("completion event");

    assert!(command_index < stdout_index);
    assert!(command_index < stderr_index);
    assert!(stdout_index < completed_index);
    assert!(stderr_index < completed_index);
}

#[test]
fn emits_terminal_event_for_failed_step_before_returning_error() {
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    let error = execute_plan_with_observer(
        InstallPlan {
            request: InstallRequestSummary {
                source: "unit-test".to_owned(),
                platform: SupportedPlatform::Windows,
                format: PackageFormat::Manager,
            },
            steps: vec![InstallStep {
                id: "failure-step".to_owned(),
                description: "failure".to_owned(),
                command: "Write-Output 'before-fail'; exit 7".to_owned(),
                args: Vec::new(),
                shell: true,
                shell_kind: Some(ShellKind::Powershell),
                requires_elevation: false,
                working_directory: None,
                env: BTreeMap::new(),
                continue_on_error: false,
                timeout_ms: None,
            }],
            notes: Vec::new(),
            guidance: Vec::new(),
        },
        SupportedPlatform::Windows,
        &ExecuteOptions::default(),
        Some(&move |event| {
            sink.lock().expect("lock").push(event.clone());
        }),
    )
    .expect_err("execution should fail");

    assert!(error.to_string().contains("STEP_FAILED"));

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCompleted {
            step_id,
            success,
            exit_code,
            ..
        } if step_id == "failure-step" && !success && *exit_code == Some(7)
    )));
}

#[test]
fn emits_terminal_event_for_timeout_before_returning_error() {
    let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();

    let error = execute_plan_with_observer(
        InstallPlan {
            request: InstallRequestSummary {
                source: "unit-test".to_owned(),
                platform: SupportedPlatform::Windows,
                format: PackageFormat::Manager,
            },
            steps: vec![InstallStep {
                id: "timeout-stream-step".to_owned(),
                description: "timeout".to_owned(),
                command: "Write-Output 'before-timeout'; Start-Sleep -Milliseconds 300".to_owned(),
                args: Vec::new(),
                shell: true,
                shell_kind: Some(ShellKind::Powershell),
                requires_elevation: false,
                working_directory: None,
                env: BTreeMap::new(),
                continue_on_error: false,
                timeout_ms: Some(50),
            }],
            notes: Vec::new(),
            guidance: Vec::new(),
        },
        SupportedPlatform::Windows,
        &ExecuteOptions::default(),
        Some(&move |event| {
            sink.lock().expect("lock").push(event.clone());
        }),
    )
    .expect_err("execution should time out");

    assert!(error.to_string().contains("STEP_TIMEOUT"));

    let events = events.lock().expect("lock");
    assert!(events.iter().any(|event| matches!(
        event,
        ProgressEvent::StepCompleted {
            step_id,
            success,
            exit_code,
            ..
        } if step_id == "timeout-stream-step" && !success && exit_code.is_none()
    )));
}
