use std::{
    collections::BTreeMap,
    env,
    io::Read,
    process::{Command, Stdio},
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use wait_timeout::ChildExt;

use crate::{
    error::{HubError, Result},
    progress::{ProgressEvent, ProgressObserver, ProgressStream, emit},
    runtime::ExecutionContext,
    types::{
        EffectiveRuntimePlatform, InstallExecutionResult, InstallPlan, InstallStep, ShellKind,
        StepExecutionResult, SupportedPlatform,
    },
};

#[derive(Debug, Clone, Default)]
pub struct ExecuteOptions {
    pub dry_run: bool,
    pub sudo: bool,
    pub verbose: bool,
    pub execution_context: Option<ExecutionContext>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandInvocation {
    pub program: String,
    pub args: Vec<String>,
    pub display_command: String,
    pub handles_env: bool,
    pub handles_working_directory: bool,
}

pub fn execute_plan(
    plan: InstallPlan,
    platform: SupportedPlatform,
    options: &ExecuteOptions,
) -> Result<InstallExecutionResult> {
    execute_plan_with_observer(plan, platform, options, None)
}

pub fn execute_plan_with_observer(
    plan: InstallPlan,
    platform: SupportedPlatform,
    options: &ExecuteOptions,
    observer: Option<&ProgressObserver<'_>>,
) -> Result<InstallExecutionResult> {
    let started = now_string();
    let timer = Instant::now();
    let mut step_results = Vec::with_capacity(plan.steps.len());
    let mut overall_success = true;

    for step in &plan.steps {
        emit(
            observer,
            ProgressEvent::StepStarted {
                step_id: step.id.clone(),
                description: step.description.clone(),
            },
        );
        let result = execute_step(step.clone(), platform, options, observer)?;
        if !result.success {
            overall_success = false;
            if !step.continue_on_error {
                step_results.push(result);
                break;
            }
        }
        step_results.push(result);
    }

    Ok(InstallExecutionResult {
        plan,
        success: overall_success && step_results.iter().all(|step| step.success || step.skipped),
        steps: step_results,
        started_at: started,
        ended_at: now_string(),
        duration_ms: timer.elapsed().as_millis(),
    })
}

fn execute_step(
    step: InstallStep,
    platform: SupportedPlatform,
    options: &ExecuteOptions,
    observer: Option<&ProgressObserver<'_>>,
) -> Result<StepExecutionResult> {
    let started_at = now_string();
    let timer = Instant::now();
    let invocation = build_command_invocation(&step, platform, options)?;
    let command_line = invocation.display_command.clone();

    emit(
        observer,
        ProgressEvent::StepCommandStarted {
            step_id: step.id.clone(),
            command_line: command_line.clone(),
            working_directory: step.working_directory.clone(),
        },
    );

    if options.dry_run {
        let result = StepExecutionResult {
            step,
            command_line,
            started_at,
            ended_at: now_string(),
            duration_ms: timer.elapsed().as_millis(),
            exit_code: Some(0),
            success: true,
            stdout: String::new(),
            stderr: String::new(),
            skipped: true,
        };
        emit_step_completed(observer, &result);
        return Ok(result);
    }

    let mut command = Command::new(&invocation.program);
    command.args(&invocation.args);
    if !invocation.handles_working_directory
        && let Some(directory) = &step.working_directory
    {
        command.current_dir(directory);
    }
    if !invocation.handles_env {
        for (key, value) in collect_command_env(&step, options.execution_context.as_ref()) {
            command.env(key, value);
        }
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn()?;
    let output = collect_process_output(&mut child, &step, observer)?;
    let success = !output.timed_out && output.exit_code == Some(0);
    let result = StepExecutionResult {
        step,
        command_line,
        started_at,
        ended_at: now_string(),
        duration_ms: timer.elapsed().as_millis(),
        exit_code: output.exit_code,
        success,
        stdout: output.stdout,
        stderr: output.stderr,
        skipped: false,
    };

    emit_step_completed(observer, &result);

    if output.timed_out {
        return Err(HubError::message(
            "STEP_TIMEOUT",
            format!(
                "step {} exceeded timeout of {}ms: {}",
                result.step.id,
                result.step.timeout_ms.unwrap_or_default(),
                result.command_line
            ),
        ));
    }

    if !success && !result.step.continue_on_error {
        return Err(HubError::message(
            "STEP_FAILED",
            format!(
                "step {} failed with exit code {:?}: {}",
                result.step.id, result.exit_code, result.command_line
            ),
        ));
    }

    if options.verbose && observer.is_none() {
        eprintln!("{} -> {}", result.step.id, result.command_line);
    }

    Ok(result)
}

#[derive(Debug)]
struct CollectedProcessOutput {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
}

#[derive(Debug)]
struct StreamMessage {
    stream: ProgressStream,
    chunk: String,
}

fn collect_process_output(
    child: &mut std::process::Child,
    step: &InstallStep,
    observer: Option<&ProgressObserver<'_>>,
) -> Result<CollectedProcessOutput> {
    let (sender, receiver) = mpsc::channel::<StreamMessage>();
    let mut readers = Vec::new();

    if let Some(stdout) = child.stdout.take() {
        readers.push(spawn_stream_reader(
            ProgressStream::Stdout,
            stdout,
            sender.clone(),
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(spawn_stream_reader(
            ProgressStream::Stderr,
            stderr,
            sender.clone(),
        ));
    }
    drop(sender);

    let timeout = step.timeout_ms.map(Duration::from_millis);
    let poll_interval = Duration::from_millis(25);
    let start = Instant::now();
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = None;
    let mut timed_out = false;
    let mut process_exited = false;
    let mut streams_closed = false;

    while !process_exited || !streams_closed {
        if !process_exited && let Some(status) = child.try_wait()? {
            process_exited = true;
            if !timed_out {
                exit_code = status.code();
            }
        }

        if !process_exited
            && let Some(timeout) = timeout
            && start.elapsed() >= timeout
        {
            timed_out = true;
            child.kill()?;
            let _ = child.wait_timeout(Duration::from_millis(100))?;
            process_exited = true;
            exit_code = None;
        }

        match receiver.recv_timeout(poll_interval) {
            Ok(message) => {
                append_stream_chunk(step, observer, &message, &mut stdout, &mut stderr);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                streams_closed = true;
            }
        }
    }

    for reader in readers {
        let _ = reader.join();
    }

    Ok(CollectedProcessOutput {
        stdout,
        stderr,
        exit_code,
        timed_out,
    })
}

fn spawn_stream_reader<R: Read + Send + 'static>(
    stream: ProgressStream,
    mut reader: R,
    sender: mpsc::Sender<StreamMessage>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let chunk = String::from_utf8_lossy(&buffer[..read]).to_string();
                    if sender.send(StreamMessage { stream, chunk }).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    })
}

fn append_stream_chunk(
    step: &InstallStep,
    observer: Option<&ProgressObserver<'_>>,
    message: &StreamMessage,
    stdout: &mut String,
    stderr: &mut String,
) {
    match message.stream {
        ProgressStream::Stdout => stdout.push_str(&message.chunk),
        ProgressStream::Stderr => stderr.push_str(&message.chunk),
    }
    emit(
        observer,
        ProgressEvent::StepLogChunk {
            step_id: step.id.clone(),
            stream: message.stream,
            chunk: message.chunk.clone(),
        },
    );
}

fn emit_step_completed(observer: Option<&ProgressObserver<'_>>, result: &StepExecutionResult) {
    emit(
        observer,
        ProgressEvent::StepCompleted {
            step_id: result.step.id.clone(),
            success: result.success,
            skipped: result.skipped,
            duration_ms: result.duration_ms,
            exit_code: result.exit_code,
        },
    );
}

fn build_command_invocation(
    step: &InstallStep,
    platform: SupportedPlatform,
    options: &ExecuteOptions,
) -> Result<CommandInvocation> {
    let execution_context = options.execution_context.as_ref();
    if should_use_wsl_wrapper(step, execution_context) {
        return build_wsl_invocation(step, execution_context, options.sudo);
    }

    if step.shell {
        let shell_kind = step
            .shell_kind
            .unwrap_or(default_shell_kind(platform, execution_context));
        return Ok(match shell_kind {
            ShellKind::Powershell => {
                let program = resolve_shell_program(shell_kind, platform);
                CommandInvocation {
                    display_command: format!("{program} -NoProfile -Command {}", step.command),
                    program,
                    args: vec![
                        "-NoProfile".to_owned(),
                        "-Command".to_owned(),
                        step.command.clone(),
                    ],
                    handles_env: false,
                    handles_working_directory: false,
                }
            }
            ShellKind::Cmd => {
                let program = resolve_shell_program(shell_kind, platform);
                CommandInvocation {
                    display_command: format!("{program} /C {}", step.command),
                    program,
                    args: vec!["/C".to_owned(), step.command.clone()],
                    handles_env: false,
                    handles_working_directory: false,
                }
            }
            ShellKind::Bash => {
                let bash_program = resolve_shell_program(shell_kind, platform);
                if should_wrap_with_sudo(execution_context, options.sudo, step.requires_elevation) {
                    CommandInvocation {
                        program: "sudo".to_owned(),
                        args: vec![bash_program.clone(), "-lc".to_owned(), step.command.clone()],
                        display_command: format!("sudo {bash_program} -lc {}", step.command),
                        handles_env: false,
                        handles_working_directory: false,
                    }
                } else {
                    CommandInvocation {
                        program: bash_program.clone(),
                        args: vec!["-lc".to_owned(), step.command.clone()],
                        display_command: format!("{bash_program} -lc {}", step.command),
                        handles_env: false,
                        handles_working_directory: false,
                    }
                }
            }
        });
    }

    if should_wrap_with_sudo(execution_context, options.sudo, step.requires_elevation) {
        let mut args = vec![step.command.clone()];
        args.extend(step.args.iter().cloned());
        return Ok(CommandInvocation {
            program: "sudo".to_owned(),
            args,
            display_command: format!("sudo {}", render_non_shell_command(step)),
            handles_env: false,
            handles_working_directory: false,
        });
    }

    Ok(CommandInvocation {
        program: step.command.clone(),
        args: step.args.clone(),
        display_command: render_non_shell_command(step),
        handles_env: false,
        handles_working_directory: false,
    })
}

fn build_wsl_invocation(
    step: &InstallStep,
    execution_context: Option<&ExecutionContext>,
    sudo: bool,
) -> Result<CommandInvocation> {
    let context = execution_context.ok_or_else(|| {
        HubError::message(
            "WSL_RUNTIME_UNAVAILABLE",
            "WSL command invocation requires execution context",
        )
    })?;
    let distro = context.wsl_distribution.clone().ok_or_else(|| {
        HubError::message(
            "WSL_RUNTIME_UNAVAILABLE",
            "WSL execution context requires a distribution",
        )
    })?;
    let script = build_wsl_script(step, context, sudo);
    Ok(CommandInvocation {
        program: "wsl.exe".to_owned(),
        args: vec![
            "-d".to_owned(),
            distro.clone(),
            "--".to_owned(),
            "bash".to_owned(),
            "-lc".to_owned(),
            script.clone(),
        ],
        display_command: format!("wsl.exe -d {distro} -- bash -lc {}", bash_quote(&script)),
        handles_env: true,
        handles_working_directory: true,
    })
}

fn build_wsl_script(step: &InstallStep, context: &ExecutionContext, sudo: bool) -> String {
    let mut lines = Vec::new();
    for (key, value) in collect_command_env(step, Some(context)) {
        lines.push(format!("export {key}={}", bash_quote(&value)));
    }
    if let Some(directory) = &step.working_directory {
        lines.push(format!(
            "cd {}",
            bash_quote(&map_path_to_runtime(
                directory,
                context.effective_runtime_platform
            ))
        ));
    }

    let command = if step.shell {
        step.command.clone()
    } else {
        render_non_shell_command(step)
    };
    if should_wrap_with_sudo(Some(context), sudo, step.requires_elevation) {
        lines.push(format!("sudo {}", command));
    } else {
        lines.push(command);
    }
    lines.join("\n")
}

fn collect_command_env(
    step: &InstallStep,
    execution_context: Option<&ExecutionContext>,
) -> BTreeMap<String, String> {
    let mut values = step.env.clone();
    if let Some(context) = execution_context {
        if let Some(value) = &context.docker_context {
            values.insert("DOCKER_CONTEXT".to_owned(), value.clone());
        }
        if let Some(value) = &context.docker_host {
            values.insert("DOCKER_HOST".to_owned(), value.clone());
        }
    }
    values
}

fn render_non_shell_command(step: &InstallStep) -> String {
    let mut pieces = vec![bash_quote(&step.command)];
    pieces.extend(step.args.iter().map(|arg| bash_quote(arg)));
    pieces.join(" ")
}

fn default_shell_kind(
    platform: SupportedPlatform,
    execution_context: Option<&ExecutionContext>,
) -> ShellKind {
    match execution_context.map(|context| context.effective_runtime_platform) {
        Some(EffectiveRuntimePlatform::Windows) => ShellKind::Powershell,
        Some(_) => ShellKind::Bash,
        None => match platform {
            SupportedPlatform::Windows => ShellKind::Powershell,
            _ => ShellKind::Bash,
        },
    }
}

fn should_use_wsl_wrapper(
    step: &InstallStep,
    execution_context: Option<&ExecutionContext>,
) -> bool {
    matches!(
        execution_context.map(|context| context.effective_runtime_platform),
        Some(EffectiveRuntimePlatform::Wsl)
    ) && !matches!(
        step.shell_kind,
        Some(ShellKind::Powershell) | Some(ShellKind::Cmd)
    )
}

fn map_path_to_runtime(path: &str, runtime_platform: EffectiveRuntimePlatform) -> String {
    match runtime_platform {
        EffectiveRuntimePlatform::Windows => path.replace('/', "\\"),
        EffectiveRuntimePlatform::Wsl => normalize_windows_path_for_wsl(path),
        _ => path.replace('\\', "/"),
    }
}

fn normalize_windows_path_for_wsl(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.len() >= 2
        && normalized.as_bytes()[1] == b':'
        && normalized
            .chars()
            .next()
            .map(|value| value.is_ascii_alphabetic())
            .unwrap_or(false)
    {
        let drive = normalized
            .chars()
            .next()
            .unwrap_or('c')
            .to_ascii_lowercase();
        let suffix = normalized[2..].trim_start_matches('/');
        if suffix.is_empty() {
            format!("/mnt/{drive}")
        } else {
            format!("/mnt/{drive}/{suffix}")
        }
    } else {
        normalized
    }
}

fn bash_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn now_string() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}

fn resolve_shell_program(shell_kind: ShellKind, platform: SupportedPlatform) -> String {
    match shell_kind {
        ShellKind::Powershell => "powershell".to_owned(),
        ShellKind::Cmd => "cmd".to_owned(),
        ShellKind::Bash => {
            if is_windows_host() {
                if let Ok(override_path) = env::var("HUB_INSTALLER_BASH") {
                    let override_path = override_path.trim();
                    if !override_path.is_empty() {
                        return override_path.to_owned();
                    }
                }
                let git_bash = "C:\\Program Files\\Git\\bin\\bash.exe";
                if std::path::Path::new(git_bash).exists() {
                    return git_bash.to_owned();
                }
            }
            let _ = platform;
            "bash".to_owned()
        }
    }
}

#[doc(hidden)]
pub fn resolve_shell_program_for_test(
    shell_kind: ShellKind,
    platform: SupportedPlatform,
) -> String {
    resolve_shell_program(shell_kind, platform)
}

#[doc(hidden)]
pub fn should_wrap_with_sudo_for_test(sudo: bool, requires_elevation: bool) -> bool {
    should_wrap_with_sudo(None, sudo, requires_elevation)
}

#[doc(hidden)]
pub fn command_invocation_for_test(
    step: &InstallStep,
    platform: SupportedPlatform,
    options: &ExecuteOptions,
) -> Result<CommandInvocation> {
    build_command_invocation(step, platform, options)
}

fn is_windows_host() -> bool {
    cfg!(windows)
}

fn should_wrap_with_sudo(
    execution_context: Option<&ExecutionContext>,
    sudo: bool,
    requires_elevation: bool,
) -> bool {
    if !sudo || !requires_elevation {
        return false;
    }
    match execution_context.map(|context| context.effective_runtime_platform) {
        Some(EffectiveRuntimePlatform::Windows) => false,
        Some(_) => true,
        None => !is_windows_host(),
    }
}
