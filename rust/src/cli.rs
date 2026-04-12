use std::{
    collections::BTreeMap,
    ffi::OsString,
    io::{self, Write},
};

use clap::{Args, Parser, Subcommand};

use crate::{
    engine::{
        ApplyManifestOptions, BackupManifestOptions, BackupTarget, InstallEngine,
        RegistryBackupOptions, RegistryInstallOptions, RegistryUninstallOptions,
        UninstallManifestOptions,
    },
    error::Result,
    progress::ProgressEvent,
    types::{
        ContainerRuntimePreference, EffectiveRuntimePlatform, InstallControlLevel, InstallScope,
        SupportedPlatform,
    },
};

#[derive(Debug, Parser)]
#[command(
    name = "hub-installer-rs",
    version,
    about = "Rust implementation of hub-installer"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Apply(ApplyCommand),
    Backup(BackupCommand),
    Install(InstallCommand),
    Uninstall(UninstallCommand),
}

#[derive(Debug, Args)]
struct SharedArgs {
    #[arg(long)]
    platform: Option<SupportedPlatform>,
    #[arg(long)]
    effective_runtime_platform: Option<EffectiveRuntimePlatform>,
    #[arg(long)]
    container_runtime: Option<ContainerRuntimePreference>,
    #[arg(long)]
    wsl_distribution: Option<String>,
    #[arg(long)]
    docker_context: Option<String>,
    #[arg(long)]
    docker_host: Option<String>,
    #[arg(long)]
    dry_run: bool,
    #[arg(long)]
    progress: bool,
    #[arg(long)]
    verbose: bool,
    #[arg(long)]
    sudo: bool,
    #[arg(long)]
    install_scope: Option<InstallScope>,
    #[arg(long)]
    install_root: Option<String>,
    #[arg(long)]
    work_root: Option<String>,
    #[arg(long)]
    bin_dir: Option<String>,
    #[arg(long)]
    data_root: Option<String>,
    #[arg(long)]
    installer_home: Option<String>,
    #[arg(long)]
    install_control_level: Option<InstallControlLevel>,
    #[arg(long = "var", value_parser = parse_variable)]
    variables: Vec<(String, String)>,
}

#[derive(Debug, Args)]
struct ApplyCommand {
    source: String,
    #[command(flatten)]
    shared: SharedArgs,
}

#[derive(Debug, Args)]
struct InstallCommand {
    software: String,
    #[arg(long)]
    registry: Option<String>,
    #[command(flatten)]
    shared: SharedArgs,
}

#[derive(Debug, Args)]
struct BackupCommand {
    source: String,
    #[arg(long)]
    registry: Option<String>,
    #[arg(long)]
    target: Vec<BackupTargetArg>,
    #[arg(long)]
    session_id: Option<String>,
    #[command(flatten)]
    shared: SharedArgs,
}

#[derive(Debug, Args)]
struct UninstallCommand {
    source: String,
    #[arg(long)]
    registry: Option<String>,
    #[arg(long)]
    purge_data: bool,
    #[arg(long)]
    backup_before_uninstall: bool,
    #[arg(long)]
    backup_target: Vec<BackupTargetArg>,
    #[arg(long)]
    backup_session_id: Option<String>,
    #[command(flatten)]
    shared: SharedArgs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum BackupTargetArg {
    Data,
    Install,
    Work,
    All,
}

pub fn run(args: impl IntoIterator<Item = OsString>) -> Result<()> {
    let cli = Cli::parse_from(args);
    match cli.command {
        Commands::Apply(command) => run_apply(command)?,
        Commands::Backup(command) => run_backup(command)?,
        Commands::Install(command) => run_install(command)?,
        Commands::Uninstall(command) => run_uninstall(command)?,
    }
    Ok(())
}

fn into_apply_options(shared: SharedArgs) -> ApplyManifestOptions {
    ApplyManifestOptions {
        platform: shared.platform,
        effective_runtime_platform: shared.effective_runtime_platform,
        container_runtime: shared.container_runtime,
        wsl_distribution: shared.wsl_distribution,
        docker_context: shared.docker_context,
        docker_host: shared.docker_host,
        dry_run: shared.dry_run,
        verbose: shared.verbose,
        progress: shared.progress,
        sudo: shared.sudo,
        timeout_ms: None,
        cwd: None,
        software_name: None,
        installer_home: shared.installer_home,
        install_scope: shared.install_scope,
        install_root: shared.install_root,
        work_root: shared.work_root,
        bin_dir: shared.bin_dir,
        data_root: shared.data_root,
        install_control_level: shared.install_control_level,
        variables: shared.variables.into_iter().collect::<BTreeMap<_, _>>(),
    }
}

fn parse_variable(input: &str) -> std::result::Result<(String, String), String> {
    let (key, value) = input
        .split_once('=')
        .ok_or_else(|| "variables must be provided as key=value".to_owned())?;
    Ok((key.to_owned(), value.to_owned()))
}

fn resolve_backup_target_args(targets: &[BackupTargetArg]) -> Vec<BackupTarget> {
    let mut resolved = Vec::new();
    let mut push_unique = |target| {
        if !resolved.contains(&target) {
            resolved.push(target);
        }
    };

    for target in targets {
        match target {
            BackupTargetArg::Data => push_unique(BackupTarget::Data),
            BackupTargetArg::Install => push_unique(BackupTarget::Install),
            BackupTargetArg::Work => push_unique(BackupTarget::Work),
            BackupTargetArg::All => {
                push_unique(BackupTarget::Data);
                push_unique(BackupTarget::Install);
                push_unique(BackupTarget::Work);
            }
        }
    }

    resolved
}

fn run_apply(command: ApplyCommand) -> Result<()> {
    let stream_progress = command.shared.verbose || command.shared.progress;
    let result = if stream_progress {
        InstallEngine::apply_manifest_with_observer(
            &command.source,
            into_apply_options(command.shared),
            &render_progress_event,
        )?
    } else {
        InstallEngine::apply_manifest(&command.source, into_apply_options(command.shared))?
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn run_install(command: InstallCommand) -> Result<()> {
    let stream_progress = command.shared.verbose || command.shared.progress;
    let registry_source = command.registry.clone();
    let software = command.software.clone();
    let result = if stream_progress {
        InstallEngine::install_from_registry_with_observer(
            &software,
            RegistryInstallOptions {
                registry_source,
                apply: into_apply_options(command.shared),
            },
            &render_progress_event,
        )?
    } else {
        InstallEngine::install_from_registry(
            &software,
            RegistryInstallOptions {
                registry_source,
                apply: into_apply_options(command.shared),
            },
        )?
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn run_backup(command: BackupCommand) -> Result<()> {
    let BackupCommand {
        source,
        registry,
        target,
        session_id,
        shared,
    } = command;
    let stream_progress = shared.verbose || shared.progress;
    let apply = into_apply_options(shared);
    let targets = resolve_backup_target_args(&target);
    let result = if let Some(registry_source) = registry {
        if stream_progress {
            serde_json::to_value(InstallEngine::backup_from_registry_with_observer(
                &source,
                RegistryBackupOptions {
                    registry_source: Some(registry_source),
                    backup: BackupManifestOptions {
                        apply,
                        targets,
                        session_id,
                    },
                },
                &render_progress_event,
            )?)?
        } else {
            serde_json::to_value(InstallEngine::backup_from_registry(
                &source,
                RegistryBackupOptions {
                    registry_source: Some(registry_source),
                    backup: BackupManifestOptions {
                        apply,
                        targets,
                        session_id,
                    },
                },
            )?)?
        }
    } else if stream_progress {
        serde_json::to_value(InstallEngine::backup_manifest_with_observer(
            &source,
            BackupManifestOptions {
                apply,
                targets,
                session_id,
            },
            &render_progress_event,
        )?)?
    } else {
        serde_json::to_value(InstallEngine::backup_manifest(
            &source,
            BackupManifestOptions {
                apply,
                targets,
                session_id,
            },
        )?)?
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn run_uninstall(command: UninstallCommand) -> Result<()> {
    let UninstallCommand {
        source,
        registry,
        purge_data,
        backup_before_uninstall,
        backup_target,
        backup_session_id,
        shared,
    } = command;
    let stream_progress = shared.verbose || shared.progress;
    let apply = into_apply_options(shared);
    let backup_targets = resolve_backup_target_args(&backup_target);
    let result = if let Some(registry_source) = registry {
        if stream_progress {
            serde_json::to_value(InstallEngine::uninstall_from_registry_with_observer(
                &source,
                RegistryUninstallOptions {
                    registry_source: Some(registry_source),
                    uninstall: UninstallManifestOptions {
                        apply,
                        purge_data,
                        backup_before_uninstall,
                        backup_targets,
                        backup_session_id,
                    },
                },
                &render_progress_event,
            )?)?
        } else {
            serde_json::to_value(InstallEngine::uninstall_from_registry(
                &source,
                RegistryUninstallOptions {
                    registry_source: Some(registry_source),
                    uninstall: UninstallManifestOptions {
                        apply,
                        purge_data,
                        backup_before_uninstall,
                        backup_targets,
                        backup_session_id,
                    },
                },
            )?)?
        }
    } else if stream_progress {
        serde_json::to_value(InstallEngine::uninstall_manifest_with_observer(
            &source,
            UninstallManifestOptions {
                apply,
                purge_data,
                backup_before_uninstall,
                backup_targets,
                backup_session_id,
            },
            &render_progress_event,
        )?)?
    } else {
        serde_json::to_value(InstallEngine::uninstall_manifest(
            &source,
            UninstallManifestOptions {
                apply,
                purge_data,
                backup_before_uninstall,
                backup_targets,
                backup_session_id,
            },
        )?)?
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn render_progress_event(event: &ProgressEvent) {
    match event {
        ProgressEvent::StageStarted { stage, total_steps } => {
            eprintln!("[stage:{stage}] start ({total_steps} steps)");
        }
        ProgressEvent::StageCompleted {
            stage,
            success,
            total_steps,
            failed_steps,
        } => {
            let status = if *success { "ok" } else { "failed" };
            eprintln!("[stage:{stage}] {status} ({total_steps} steps, {failed_steps} failed)");
        }
        ProgressEvent::ArtifactStarted {
            artifact_id,
            artifact_type,
        } => {
            eprintln!("[artifact:{artifact_id}] start ({artifact_type})");
        }
        ProgressEvent::ArtifactCompleted {
            artifact_id,
            artifact_type,
            success,
        } => {
            let status = if *success { "ok" } else { "failed" };
            eprintln!("[artifact:{artifact_id}] {status} ({artifact_type})");
        }
        ProgressEvent::DependencyStarted {
            dependency_id,
            target,
            description,
        } => {
            if let Some(description) = description.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                eprintln!("[dependency:{dependency_id}] start ({target}) {description}");
            } else {
                eprintln!("[dependency:{dependency_id}] start ({target})");
            }
        }
        ProgressEvent::DependencyCompleted {
            dependency_id,
            target,
            success,
            skipped,
            status_after,
        } => {
            let status = if *skipped {
                "skipped"
            } else if *success {
                "ok"
            } else {
                "failed"
            };
            eprintln!(
                "[dependency:{dependency_id}] {status} ({target}) -> {status_after}"
            );
        }
        ProgressEvent::StepStarted {
            step_id,
            description,
        } => {
            let compact_description = description.trim();
            if compact_description.is_empty()
                || compact_description.contains('\n')
                || compact_description.len() > 96
            {
                eprintln!("[step:{step_id}] start");
            } else {
                eprintln!("[step:{step_id}] {compact_description}");
            }
        }
        ProgressEvent::StepCommandStarted {
            step_id,
            command_line,
            working_directory,
        } => {
            let rendered_command = indent_multiline(command_line);
            if let Some(directory) = working_directory {
                eprintln!("[step:{step_id}] $ {rendered_command} (cwd: {directory})");
            } else {
                eprintln!("[step:{step_id}] $ {rendered_command}");
            }
        }
        ProgressEvent::StepLogChunk { chunk, .. } => {
            let mut stderr = io::stderr();
            let _ = stderr.write_all(chunk.as_bytes());
            let _ = stderr.flush();
        }
        ProgressEvent::StepCompleted {
            step_id,
            success,
            skipped,
            duration_ms,
            exit_code,
        } => {
            let status = if *skipped {
                "skipped"
            } else if *success {
                "ok"
            } else {
                "failed"
            };
            eprintln!(
                "[step:{step_id}] {status} in {duration_ms}ms (exit: {})",
                exit_code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "none".to_owned())
            );
        }
    }
}

fn indent_multiline(value: &str) -> String {
    value.replace('\n', "\n  ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_value_enums_from_cli() {
        let cli = Cli::try_parse_from([
            "hub-installer-rs",
            "apply",
            "./examples/codex.hub.yaml",
            "--platform",
            "ubuntu",
            "--progress",
            "--install-scope",
            "user",
            "--install-control-level",
            "managed",
            "--effective-runtime-platform",
            "wsl",
            "--container-runtime",
            "host",
            "--wsl-distribution",
            "Ubuntu-22.04",
            "--var",
            "channel=beta",
        ])
        .expect("cli should parse");

        let Commands::Apply(command) = cli.command else {
            panic!("expected apply command");
        };

        assert_eq!(command.shared.platform, Some(SupportedPlatform::Ubuntu));
        assert!(command.shared.progress);
        assert_eq!(command.shared.install_scope, Some(InstallScope::User));
        assert_eq!(
            command.shared.install_control_level,
            Some(InstallControlLevel::Managed)
        );
        assert_eq!(
            command.shared.effective_runtime_platform,
            Some(EffectiveRuntimePlatform::Wsl)
        );
        assert_eq!(
            command.shared.container_runtime,
            Some(ContainerRuntimePreference::Host)
        );
        assert_eq!(
            command.shared.wsl_distribution.as_deref(),
            Some("Ubuntu-22.04")
        );
        assert_eq!(
            command.shared.variables,
            vec![("channel".to_owned(), "beta".to_owned())]
        );
    }

    #[test]
    fn parses_backup_and_uninstall_commands() {
        let backup = Cli::try_parse_from([
            "hub-installer-rs",
            "backup",
            "openclaw-docker",
            "--registry",
            "./registry/software-registry.yaml",
            "--target",
            "all",
            "--session-id",
            "2026-03-18T10:20:30.123Z",
        ])
        .expect("backup command should parse");
        let Commands::Backup(command) = backup.command else {
            panic!("expected backup command");
        };
        assert_eq!(
            command.registry.as_deref(),
            Some("./registry/software-registry.yaml")
        );
        assert_eq!(
            resolve_backup_target_args(&command.target),
            vec![
                BackupTarget::Data,
                BackupTarget::Install,
                BackupTarget::Work
            ]
        );

        let uninstall = Cli::try_parse_from([
            "hub-installer-rs",
            "uninstall",
            "openclaw-docker",
            "--registry",
            "./registry/software-registry.yaml",
            "--purge-data",
            "--backup-before-uninstall",
            "--backup-target",
            "all",
        ])
        .expect("uninstall command should parse");
        let Commands::Uninstall(command) = uninstall.command else {
            panic!("expected uninstall command");
        };
        assert_eq!(
            command.registry.as_deref(),
            Some("./registry/software-registry.yaml")
        );
        assert!(command.purge_data);
        assert!(command.backup_before_uninstall);
        assert_eq!(
            resolve_backup_target_args(&command.backup_target),
            vec![
                BackupTarget::Data,
                BackupTarget::Install,
                BackupTarget::Work
            ]
        );
    }

    #[test]
    fn resolves_backup_targets_without_duplicates() {
        assert_eq!(
            resolve_backup_target_args(&[
                BackupTargetArg::Work,
                BackupTargetArg::All,
                BackupTargetArg::Data,
            ]),
            vec![
                BackupTarget::Work,
                BackupTarget::Data,
                BackupTarget::Install
            ]
        );
    }
}
