use std::{
    collections::{BTreeMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    time::Instant,
};

use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::{
    error::{HubError, Result},
    executor::{ExecuteOptions, execute_plan_with_observer},
    manifest::{
        ArtifactBase, DependencyCheck, GitArtifact, HubInstallManifest, HuggingFaceArtifact,
        LoadedManifest, ManifestArtifact, ManifestCommand, ManifestCondition, ManifestDataItem,
        ManifestDependency, ManifestInstallationDescriptor, ManifestMigrationStrategy,
        ManifestShell, PackageArtifact, PackageInstall, RuntimeContext, SourceArtifact,
        SourceInstallSpec, load_manifest, merge_variables,
    },
    platform::detect_host_platform,
    policy::{
        InstallPolicyInput, default_package_cache_dir as resolve_default_package_cache_dir,
        resolve_install_policy,
    },
    progress::{ProgressEvent, ProgressObserver, emit},
    registry::{load_registry, resolve_software_entry},
    runtime::{
        ExecutionContext, RuntimeOptions, RuntimeProbe, SystemRuntimeProbe,
        normalize_path_for_runtime, resolve_execution_context,
        resolve_execution_context_with_probe, resolve_host_path_for_runtime,
    },
    state::{
        InstallRecord, InstallRecordStatus, read_install_record, resolve_backup_root_dir,
        resolve_backup_session_dir, resolve_install_record_file, write_install_record,
    },
    template::{render_optional, render_template},
    types::{
        ContainerRuntime, ContainerRuntimePreference, EffectiveRuntimePlatform,
        InstallControlLevel, InstallPlan, InstallRequest, InstallRequestSummary, InstallScope,
        InstallStep, PackageFormat, PackageManager, ResolvedInstallRequest, ShellKind,
        SourceReference, SupportedPlatform,
    },
};

#[derive(Debug, Clone, Default)]
pub struct ApplyManifestOptions {
    pub platform: Option<SupportedPlatform>,
    pub effective_runtime_platform: Option<EffectiveRuntimePlatform>,
    pub container_runtime: Option<ContainerRuntimePreference>,
    pub wsl_distribution: Option<String>,
    pub docker_context: Option<String>,
    pub docker_host: Option<String>,
    pub dry_run: bool,
    pub verbose: bool,
    pub progress: bool,
    pub sudo: bool,
    pub timeout_ms: Option<u64>,
    pub cwd: Option<String>,
    pub software_name: Option<String>,
    pub installer_home: Option<String>,
    pub install_scope: Option<InstallScope>,
    pub install_root: Option<String>,
    pub work_root: Option<String>,
    pub bin_dir: Option<String>,
    pub data_root: Option<String>,
    pub install_control_level: Option<InstallControlLevel>,
    pub variables: BTreeMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StageReport {
    pub stage: String,
    pub success: bool,
    pub duration_ms: u128,
    pub total_steps: usize,
    pub failed_steps: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ArtifactReport {
    pub artifact_id: String,
    pub artifact_type: String,
    pub success: bool,
    pub duration_ms: u128,
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApplyManifestResult {
    pub manifest_name: String,
    pub manifest_path: String,
    pub manifest_source_input: String,
    pub manifest_source_kind: String,
    pub platform: SupportedPlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub container_runtime: Option<ContainerRuntime>,
    pub wsl_distribution: Option<String>,
    pub installer_home: String,
    pub resolved_install_scope: InstallScope,
    pub resolved_install_root: String,
    pub resolved_work_root: String,
    pub resolved_bin_dir: String,
    pub resolved_data_root: String,
    pub install_control_level: InstallControlLevel,
    pub success: bool,
    pub duration_ms: u128,
    pub stage_reports: Vec<StageReport>,
    pub artifact_reports: Vec<ArtifactReport>,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, clap::ValueEnum,
)]
#[serde(rename_all = "lowercase")]
pub enum BackupTarget {
    Data,
    Install,
    Work,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackupTargetStatus {
    Copied,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UninstallTargetStatus {
    Removed,
    Missing,
    Preserved,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BackupTargetReport {
    pub target: BackupTarget,
    pub status: BackupTargetStatus,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UninstallTargetReport {
    pub target: BackupTarget,
    pub status: UninstallTargetStatus,
}

#[derive(Debug, Clone, Default)]
pub struct BackupManifestOptions {
    pub apply: ApplyManifestOptions,
    pub targets: Vec<BackupTarget>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BackupManifestResult {
    pub manifest_name: String,
    pub manifest_path: String,
    pub manifest_source_input: String,
    pub manifest_source_kind: String,
    pub platform: SupportedPlatform,
    pub installer_home: String,
    pub resolved_install_scope: InstallScope,
    pub resolved_install_root: String,
    pub resolved_work_root: String,
    pub resolved_bin_dir: String,
    pub resolved_data_root: String,
    pub install_control_level: InstallControlLevel,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub install_record_file: String,
    pub install_record_found: bool,
    pub backup_session_dir: String,
    pub success: bool,
    pub duration_ms: u128,
    pub stage_reports: Vec<StageReport>,
    pub target_reports: Vec<BackupTargetReport>,
}

#[derive(Debug, Clone, Default)]
pub struct UninstallManifestOptions {
    pub apply: ApplyManifestOptions,
    pub purge_data: bool,
    pub backup_before_uninstall: bool,
    pub backup_targets: Vec<BackupTarget>,
    pub backup_session_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UninstallManifestResult {
    pub manifest_name: String,
    pub manifest_path: String,
    pub manifest_source_input: String,
    pub manifest_source_kind: String,
    pub platform: SupportedPlatform,
    pub installer_home: String,
    pub resolved_install_scope: InstallScope,
    pub resolved_install_root: String,
    pub resolved_work_root: String,
    pub resolved_bin_dir: String,
    pub resolved_data_root: String,
    pub install_control_level: InstallControlLevel,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub install_record_file: String,
    pub install_record_found: bool,
    pub purge_data: bool,
    pub success: bool,
    pub duration_ms: u128,
    pub stage_reports: Vec<StageReport>,
    pub target_reports: Vec<UninstallTargetReport>,
    pub backup_result: Option<BackupManifestResult>,
}

#[derive(Debug, Clone, Default)]
pub struct RegistryInstallOptions {
    pub registry_source: Option<String>,
    pub apply: ApplyManifestOptions,
}

#[derive(Debug, Clone, Default)]
pub struct RegistryBackupOptions {
    pub registry_source: Option<String>,
    pub backup: BackupManifestOptions,
}

#[derive(Debug, Clone, Default)]
pub struct RegistryUninstallOptions {
    pub registry_source: Option<String>,
    pub uninstall: UninstallManifestOptions,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RegistryInstallResult {
    pub registry_name: String,
    pub registry_source: String,
    pub software_name: String,
    pub manifest_source: String,
    pub apply_result: ApplyManifestResult,
}

#[derive(Debug, Clone, Default)]
pub struct DependencyInstallOptions {
    pub apply: ApplyManifestOptions,
    pub dependency_ids: Vec<String>,
    pub continue_on_error: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DependencyInstallReport {
    pub dependency_id: String,
    pub description: Option<String>,
    pub target: String,
    pub required: bool,
    pub status_before: String,
    pub status_after: String,
    pub attempted_auto_remediation: bool,
    pub success: bool,
    pub skipped: bool,
    pub duration_ms: u128,
    pub step_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DependencyInstallResult {
    pub manifest_name: String,
    pub manifest_path: String,
    pub manifest_source_input: String,
    pub manifest_source_kind: String,
    pub platform: SupportedPlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub installer_home: String,
    pub resolved_install_scope: InstallScope,
    pub resolved_install_root: String,
    pub resolved_work_root: String,
    pub resolved_bin_dir: String,
    pub resolved_data_root: String,
    pub install_control_level: InstallControlLevel,
    pub success: bool,
    pub duration_ms: u128,
    pub dependency_reports: Vec<DependencyInstallReport>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallAssessmentCommand {
    pub description: String,
    pub command_line: String,
    pub shell_kind: Option<ShellKind>,
    pub working_directory: Option<String>,
    pub requires_elevation: bool,
    pub auto_run: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallAssessmentDependency {
    pub id: String,
    pub description: Option<String>,
    pub required: bool,
    pub check_type: String,
    pub target: String,
    pub status: String,
    pub supports_auto_remediation: bool,
    pub remediation_commands: Vec<InstallAssessmentCommand>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallAssessmentIssue {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub dependency_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallAssessmentRuntime {
    pub host_platform: SupportedPlatform,
    pub requested_runtime_platform: EffectiveRuntimePlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub container_runtime_preference: Option<ContainerRuntimePreference>,
    pub resolved_container_runtime: Option<ContainerRuntime>,
    pub wsl_distribution: Option<String>,
    pub available_wsl_distributions: Vec<String>,
    pub wsl_available: bool,
    pub host_docker_available: bool,
    pub wsl_docker_available: bool,
    pub runtime_home_dir: Option<String>,
    pub command_availability: BTreeMap<String, bool>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallAssessmentResult {
    pub manifest_name: String,
    pub manifest_description: Option<String>,
    pub manifest_homepage: Option<String>,
    pub platform: SupportedPlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub resolved_install_scope: InstallScope,
    pub resolved_install_root: String,
    pub resolved_work_root: String,
    pub resolved_bin_dir: String,
    pub resolved_data_root: String,
    pub install_control_level: InstallControlLevel,
    pub install_status: Option<InstallRecordStatus>,
    pub ready: bool,
    pub requires_elevated_setup: bool,
    pub dependencies: Vec<InstallAssessmentDependency>,
    pub issues: Vec<InstallAssessmentIssue>,
    pub recommendations: Vec<String>,
    pub installation: Option<ManifestInstallationDescriptor>,
    pub data_items: Vec<ManifestDataItem>,
    pub migration_strategies: Vec<ManifestMigrationStrategy>,
    pub runtime: InstallAssessmentRuntime,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RegistryInstallAssessmentResult {
    pub registry_name: String,
    pub registry_source: String,
    pub software_name: String,
    pub manifest_source: String,
    pub assessment_result: InstallAssessmentResult,
}

#[derive(Debug, Clone, Default)]
pub struct RegistryDependencyInstallOptions {
    pub registry_source: Option<String>,
    pub dependencies: DependencyInstallOptions,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RegistryDependencyInstallResult {
    pub registry_name: String,
    pub registry_source: String,
    pub software_name: String,
    pub manifest_source: String,
    pub dependency_result: DependencyInstallResult,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RegistryBackupResult {
    pub registry_name: String,
    pub registry_source: String,
    pub software_name: String,
    pub manifest_source: String,
    pub backup_result: BackupManifestResult,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RegistryUninstallResult {
    pub registry_name: String,
    pub registry_source: String,
    pub software_name: String,
    pub manifest_source: String,
    pub uninstall_result: UninstallManifestResult,
}

#[derive(Debug, Clone)]
struct OperationState {
    install_scope: InstallScope,
    install_root: String,
    work_root: String,
    bin_dir: String,
    data_root: String,
    install_control_level: InstallControlLevel,
    effective_runtime_platform: EffectiveRuntimePlatform,
}

#[derive(Debug, Clone)]
struct HostOperationPaths {
    installer_home: String,
    install_root: String,
    work_root: String,
    data_root: String,
}

struct ResolvedOperationContext {
    platform: SupportedPlatform,
    software_name: String,
    policy: crate::policy::ResolvedInstallPolicy,
    execution_context: ExecutionContext,
    runtime: RuntimeContext,
    state: OperationState,
    host_paths: HostOperationPaths,
    host_install_record_file: String,
    install_record: Option<InstallRecord>,
}

#[derive(Debug, Clone)]
struct DependencyRuntimeEvaluation {
    target: String,
    required: bool,
    supports_auto_remediation: bool,
    step_count: usize,
    present: bool,
    status: String,
}

pub struct InstallEngine;

impl InstallEngine {
    pub fn apply_manifest(
        source: &str,
        options: ApplyManifestOptions,
    ) -> Result<ApplyManifestResult> {
        let loaded = load_manifest(source)?;
        apply_loaded_manifest(&loaded, &options, None)
    }

    pub fn apply_manifest_with_observer<F>(
        source: &str,
        options: ApplyManifestOptions,
        observer: &F,
    ) -> Result<ApplyManifestResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let loaded = load_manifest(source)?;
        apply_loaded_manifest(&loaded, &options, Some(observer))
    }

    pub fn backup_manifest(
        source: &str,
        options: BackupManifestOptions,
    ) -> Result<BackupManifestResult> {
        let loaded = load_manifest(source)?;
        backup_loaded_manifest(&loaded, &options, None)
    }

    pub fn backup_manifest_with_observer<F>(
        source: &str,
        options: BackupManifestOptions,
        observer: &F,
    ) -> Result<BackupManifestResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let loaded = load_manifest(source)?;
        backup_loaded_manifest(&loaded, &options, Some(observer))
    }

    pub fn uninstall_manifest(
        source: &str,
        options: UninstallManifestOptions,
    ) -> Result<UninstallManifestResult> {
        let loaded = load_manifest(source)?;
        uninstall_loaded_manifest(&loaded, &options, None)
    }

    pub fn uninstall_manifest_with_observer<F>(
        source: &str,
        options: UninstallManifestOptions,
        observer: &F,
    ) -> Result<UninstallManifestResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let loaded = load_manifest(source)?;
        uninstall_loaded_manifest(&loaded, &options, Some(observer))
    }

    pub fn install_from_registry(
        software_name: &str,
        options: RegistryInstallOptions,
    ) -> Result<RegistryInstallResult> {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options.apply.platform.unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut apply_options = options.apply.clone();
        apply_options.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        apply_options.effective_runtime_platform = apply_options
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            apply_options
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let apply_result = Self::apply_manifest(&resolved.manifest_source, apply_options)?;
        Ok(RegistryInstallResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            apply_result,
        })
    }

    pub fn inspect_from_registry(
        software_name: &str,
        options: RegistryInstallOptions,
    ) -> Result<RegistryInstallAssessmentResult> {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options.apply.platform.unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut inspect_options = options.apply.clone();
        inspect_options.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        inspect_options.effective_runtime_platform = inspect_options
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            inspect_options
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let loaded_manifest = load_manifest(&resolved.manifest_source)?;
        let assessment_result = inspect_loaded_manifest(&loaded_manifest, &inspect_options)?;

        Ok(RegistryInstallAssessmentResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            assessment_result,
        })
    }

    pub fn install_dependencies(
        source: &str,
        options: DependencyInstallOptions,
    ) -> Result<DependencyInstallResult> {
        let loaded = load_manifest(source)?;
        install_loaded_dependencies(&loaded, &options, None)
    }

    pub fn install_dependencies_with_observer<F>(
        source: &str,
        options: DependencyInstallOptions,
        observer: &F,
    ) -> Result<DependencyInstallResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let loaded = load_manifest(source)?;
        install_loaded_dependencies(&loaded, &options, Some(observer))
    }

    pub fn install_dependencies_from_registry(
        software_name: &str,
        options: RegistryDependencyInstallOptions,
    ) -> Result<RegistryDependencyInstallResult> {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options
            .dependencies
            .apply
            .platform
            .unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut dependency_options = options.dependencies.clone();
        dependency_options.apply.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        dependency_options.apply.effective_runtime_platform = dependency_options
            .apply
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            dependency_options
                .apply
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let dependency_result =
            Self::install_dependencies(&resolved.manifest_source, dependency_options)?;
        Ok(RegistryDependencyInstallResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            dependency_result,
        })
    }

    pub fn install_dependencies_from_registry_with_observer<F>(
        software_name: &str,
        options: RegistryDependencyInstallOptions,
        observer: &F,
    ) -> Result<RegistryDependencyInstallResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options
            .dependencies
            .apply
            .platform
            .unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut dependency_options = options.dependencies.clone();
        dependency_options.apply.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        dependency_options.apply.effective_runtime_platform = dependency_options
            .apply
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            dependency_options
                .apply
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let dependency_result = Self::install_dependencies_with_observer(
            &resolved.manifest_source,
            dependency_options,
            observer,
        )?;
        Ok(RegistryDependencyInstallResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            dependency_result,
        })
    }

    pub fn install_from_registry_with_observer<F>(
        software_name: &str,
        options: RegistryInstallOptions,
        observer: &F,
    ) -> Result<RegistryInstallResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options.apply.platform.unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut apply_options = options.apply.clone();
        apply_options.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        apply_options.effective_runtime_platform = apply_options
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            apply_options
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let apply_result =
            Self::apply_manifest_with_observer(&resolved.manifest_source, apply_options, observer)?;
        Ok(RegistryInstallResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            apply_result,
        })
    }

    pub fn backup_from_registry(
        software_name: &str,
        options: RegistryBackupOptions,
    ) -> Result<RegistryBackupResult> {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options
            .backup
            .apply
            .platform
            .unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut backup_options = options.backup.clone();
        backup_options.apply.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        backup_options.apply.effective_runtime_platform = backup_options
            .apply
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            backup_options
                .apply
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let backup_result = Self::backup_manifest(&resolved.manifest_source, backup_options)?;
        Ok(RegistryBackupResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            backup_result,
        })
    }

    pub fn backup_from_registry_with_observer<F>(
        software_name: &str,
        options: RegistryBackupOptions,
        observer: &F,
    ) -> Result<RegistryBackupResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options
            .backup
            .apply
            .platform
            .unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut backup_options = options.backup.clone();
        backup_options.apply.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        backup_options.apply.effective_runtime_platform = backup_options
            .apply
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            backup_options
                .apply
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let backup_result = Self::backup_manifest_with_observer(
            &resolved.manifest_source,
            backup_options,
            observer,
        )?;
        Ok(RegistryBackupResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            backup_result,
        })
    }

    pub fn uninstall_from_registry(
        software_name: &str,
        options: RegistryUninstallOptions,
    ) -> Result<RegistryUninstallResult> {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options
            .uninstall
            .apply
            .platform
            .unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut uninstall_options = options.uninstall.clone();
        uninstall_options.apply.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        uninstall_options.apply.effective_runtime_platform = uninstall_options
            .apply
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            uninstall_options
                .apply
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let uninstall_result =
            Self::uninstall_manifest(&resolved.manifest_source, uninstall_options)?;
        Ok(RegistryUninstallResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            uninstall_result,
        })
    }

    pub fn uninstall_from_registry_with_observer<F>(
        software_name: &str,
        options: RegistryUninstallOptions,
        observer: &F,
    ) -> Result<RegistryUninstallResult>
    where
        F: Fn(&ProgressEvent) + Send + Sync,
    {
        let registry_source = options.registry_source.unwrap_or_else(|| ".".to_owned());
        let loaded_registry = load_registry(&registry_source)?;
        let platform = options
            .uninstall
            .apply
            .platform
            .unwrap_or(detect_host_platform()?);
        let resolved = resolve_software_entry(&loaded_registry, software_name, platform)?;

        let mut uninstall_options = options.uninstall.clone();
        uninstall_options.apply.software_name = Some(
            resolved
                .entry
                .variables
                .get("hub_software_name")
                .cloned()
                .unwrap_or_else(|| resolved.entry.name.clone()),
        );
        uninstall_options.apply.effective_runtime_platform = uninstall_options
            .apply
            .effective_runtime_platform
            .or_else(|| resolve_registry_effective_runtime_platform(&resolved.entry, platform));
        for (key, value) in &resolved.entry.variables {
            uninstall_options
                .apply
                .variables
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }

        let uninstall_result = Self::uninstall_manifest_with_observer(
            &resolved.manifest_source,
            uninstall_options,
            observer,
        )?;
        Ok(RegistryUninstallResult {
            registry_name: loaded_registry.registry.metadata.name,
            registry_source: loaded_registry.absolute_path,
            software_name: resolved.entry.name,
            manifest_source: resolved.manifest_source,
            uninstall_result,
        })
    }
}

fn apply_loaded_manifest(
    loaded: &LoadedManifest,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
) -> Result<ApplyManifestResult> {
    let started = Instant::now();
    let platform = options.platform.unwrap_or(detect_host_platform()?);
    validate_manifest_platforms(&loaded.manifest, platform)?;

    let install_scope = options
        .install_scope
        .or_else(|| hinted_install_scope(loaded, options))
        .unwrap_or(InstallScope::User);
    let software_name = options
        .software_name
        .clone()
        .or_else(|| hinted_software_name(loaded, options))
        .unwrap_or_else(|| loaded.manifest.metadata.name.clone());
    let control_level = options
        .install_control_level
        .or_else(|| hinted_install_control_level(loaded, options))
        .unwrap_or(InstallControlLevel::Managed);
    let host_home_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .display()
        .to_string();
    let execution_context = resolve_execution_context(
        platform,
        &RuntimeOptions {
            effective_runtime_platform: options.effective_runtime_platform.or(
                parse_effective_runtime_platform_option(
                    hinted_manifest_variable(loaded, options, "hub_effective_runtime_platform")
                        .as_deref(),
                )?,
            ),
            container_runtime: options.container_runtime.or(parse_container_runtime_option(
                hinted_manifest_variable(loaded, options, "hub_container_runtime_preference")
                    .or_else(|| hinted_manifest_variable(loaded, options, "hub_container_runtime"))
                    .as_deref(),
            )?),
            wsl_distribution: options
                .wsl_distribution
                .clone()
                .or_else(|| hinted_manifest_variable(loaded, options, "hub_wsl_distribution")),
            docker_context: options
                .docker_context
                .clone()
                .or_else(|| hinted_manifest_variable(loaded, options, "hub_docker_context")),
            docker_host: options
                .docker_host
                .clone()
                .or_else(|| hinted_manifest_variable(loaded, options, "hub_docker_host")),
        },
    )?;
    let runtime_home_dir = execution_context
        .runtime_home_dir
        .clone()
        .unwrap_or_else(|| {
            normalize_path_for_runtime(&host_home_dir, execution_context.effective_runtime_platform)
        });
    let local_data_dir = dirs::data_local_dir().map(|path| {
        normalize_path_for_runtime(
            &path.display().to_string(),
            execution_context.effective_runtime_platform,
        )
    });
    let policy = resolve_install_policy(InstallPolicyInput {
        platform,
        effective_runtime_platform: execution_context.effective_runtime_platform,
        software_name: software_name.clone(),
        home_dir: runtime_home_dir.clone(),
        local_data_dir,
        install_scope,
        install_control_level: control_level,
        installer_home_override: options.installer_home.clone(),
        install_root_override: options.install_root.clone(),
        work_root_override: options.work_root.clone(),
        bin_dir_override: options.bin_dir.clone(),
        data_root_override: options.data_root.clone(),
    });
    let installer_home = policy.installer_home.clone();
    let install_root = policy.install_root.clone();
    let work_root = policy.work_root.clone();
    let bin_dir = policy.bin_dir.clone();
    let data_root = policy.data_root.clone();
    let host_installer_home = resolve_host_path_for_runtime(&installer_home, &execution_context)?;

    let runtime = RuntimeContext {
        platform,
        host_platform: execution_context.host_platform,
        effective_runtime_platform: execution_context.effective_runtime_platform,
        manifest_dir: normalize_path_for_runtime(
            &loaded.base_directory,
            execution_context.effective_runtime_platform,
        ),
        cwd: normalize_path_for_runtime(
            &options.cwd.clone().unwrap_or_else(current_dir_string),
            execution_context.effective_runtime_platform,
        ),
        home: runtime_home_dir,
        temp: if execution_context.effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
            "/tmp".to_owned()
        } else {
            normalize_path_for_runtime(
                &env::temp_dir().display().to_string(),
                execution_context.effective_runtime_platform,
            )
        },
        user: env::var("USER")
            .or_else(|_| env::var("USERNAME"))
            .unwrap_or_else(|_| "unknown".to_owned()),
        path_separator: if execution_context.effective_runtime_platform
            == EffectiveRuntimePlatform::Windows
        {
            "\\".to_owned()
        } else {
            "/".to_owned()
        },
        software_name: Some(software_name.clone()),
        installer_home: Some(installer_home.clone()),
        install_scope: Some(install_scope),
        install_root: Some(install_root.clone()),
        work_root: Some(work_root.clone()),
        bin_dir: Some(bin_dir.clone()),
        data_root: Some(data_root.clone()),
        install_control_level: Some(control_level),
        container_runtime: execution_context.container_runtime,
        wsl_distribution: execution_context.wsl_distribution.clone(),
        docker_context: execution_context.docker_context.clone(),
        docker_host: execution_context.docker_host.clone(),
        backup_root: None,
        backup_session_dir: None,
        backup_data_dir: None,
        backup_install_dir: None,
        backup_work_dir: None,
        install_record_file: None,
        install_status: None,
    };

    let variables = merge_variables(&loaded.manifest, &runtime, &options.variables);
    let mut stage_reports = Vec::new();
    let mut artifact_reports = Vec::new();
    let mut overall_success = true;

    stage_reports.push(run_stage(
        "preflight",
        &loaded.manifest.lifecycle.preflight,
        &variables,
        platform,
        &loaded.manifest.defaults,
        options,
        observer,
        &execution_context,
    )?);

    stage_reports.push(run_dependencies(
        &loaded.manifest.dependencies,
        &variables,
        platform,
        &loaded.manifest.defaults,
        options,
        observer,
        &execution_context,
    )?);

    for (name, commands) in [
        ("preInstall", &loaded.manifest.lifecycle.pre_install),
        ("install", &loaded.manifest.lifecycle.install),
    ] {
        stage_reports.push(run_stage(
            name,
            commands,
            &variables,
            platform,
            &loaded.manifest.defaults,
            options,
            observer,
            &execution_context,
        )?);
    }

    for artifact in &loaded.manifest.artifacts {
        let timer = Instant::now();
        let report = run_artifact(
            artifact,
            &variables,
            platform,
            &loaded.manifest.defaults,
            options,
            observer,
            &execution_context,
        )?;
        overall_success &= report.success;
        artifact_reports.push(ArtifactReport {
            duration_ms: timer.elapsed().as_millis(),
            ..report
        });
    }

    for (name, commands) in [
        ("postInstall", &loaded.manifest.lifecycle.post_install),
        ("configure", &loaded.manifest.lifecycle.configure),
        ("healthcheck", &loaded.manifest.lifecycle.healthcheck),
    ] {
        stage_reports.push(run_stage(
            name,
            commands,
            &variables,
            platform,
            &loaded.manifest.defaults,
            options,
            observer,
            &execution_context,
        )?);
    }

    overall_success &= stage_reports.iter().all(|report| report.success);

    if overall_success && !options.dry_run {
        let now = timestamp_now_string();
        let record = InstallRecord {
            schema_version: "1.0".to_owned(),
            software_name: software_name.clone(),
            manifest_name: loaded.manifest.metadata.name.clone(),
            manifest_path: loaded.absolute_path.clone(),
            manifest_source_input: loaded.source_input.clone(),
            manifest_source_kind: loaded.source_kind.clone(),
            platform,
            effective_runtime_platform: execution_context.effective_runtime_platform,
            installer_home: installer_home.clone(),
            install_scope,
            install_root: install_root.clone(),
            work_root: work_root.clone(),
            bin_dir: bin_dir.clone(),
            data_root: data_root.clone(),
            install_control_level: control_level,
            status: InstallRecordStatus::Installed,
            installed_at: Some(now.clone()),
            updated_at: now,
        };
        write_install_record(&host_installer_home, &software_name, &record)?;
    }

    Ok(ApplyManifestResult {
        manifest_name: loaded.manifest.metadata.name.clone(),
        manifest_path: loaded.absolute_path.clone(),
        manifest_source_input: loaded.source_input.clone(),
        manifest_source_kind: loaded.source_kind.clone(),
        platform,
        effective_runtime_platform: execution_context.effective_runtime_platform,
        container_runtime: execution_context.container_runtime,
        wsl_distribution: execution_context.wsl_distribution,
        installer_home,
        resolved_install_scope: install_scope,
        resolved_install_root: install_root,
        resolved_work_root: work_root,
        resolved_bin_dir: bin_dir,
        resolved_data_root: data_root,
        install_control_level: control_level,
        success: overall_success,
        duration_ms: started.elapsed().as_millis(),
        stage_reports,
        artifact_reports,
    })
}

fn install_status_string(status: &InstallRecordStatus) -> String {
    match status {
        InstallRecordStatus::Installed => "installed".to_owned(),
        InstallRecordStatus::Uninstalled => "uninstalled".to_owned(),
    }
}

fn merge_operation_state(
    policy: &crate::policy::ResolvedInstallPolicy,
    install_record: Option<&InstallRecord>,
    options: &ApplyManifestOptions,
    prefer_install_record: bool,
) -> OperationState {
    OperationState {
        install_scope: options.install_scope.unwrap_or_else(|| {
            if prefer_install_record {
                install_record
                    .as_ref()
                    .map(|record| record.install_scope)
                    .unwrap_or(policy.install_scope)
            } else {
                policy.install_scope
            }
        }),
        install_root: options.install_root.clone().unwrap_or_else(|| {
            if prefer_install_record {
                install_record
                    .as_ref()
                    .map(|record| record.install_root.clone())
                    .unwrap_or_else(|| policy.install_root.clone())
            } else {
                policy.install_root.clone()
            }
        }),
        work_root: options.work_root.clone().unwrap_or_else(|| {
            if prefer_install_record {
                install_record
                    .as_ref()
                    .map(|record| record.work_root.clone())
                    .unwrap_or_else(|| policy.work_root.clone())
            } else {
                policy.work_root.clone()
            }
        }),
        bin_dir: options.bin_dir.clone().unwrap_or_else(|| {
            if prefer_install_record {
                install_record
                    .as_ref()
                    .map(|record| record.bin_dir.clone())
                    .unwrap_or_else(|| policy.bin_dir.clone())
            } else {
                policy.bin_dir.clone()
            }
        }),
        data_root: options.data_root.clone().unwrap_or_else(|| {
            if prefer_install_record {
                install_record
                    .as_ref()
                    .map(|record| record.data_root.clone())
                    .unwrap_or_else(|| policy.data_root.clone())
            } else {
                policy.data_root.clone()
            }
        }),
        install_control_level: options.install_control_level.unwrap_or_else(|| {
            if prefer_install_record {
                install_record
                    .as_ref()
                    .map(|record| record.install_control_level)
                    .unwrap_or(policy.install_control_level)
            } else {
                policy.install_control_level
            }
        }),
        effective_runtime_platform: options.effective_runtime_platform.unwrap_or_else(|| {
            if prefer_install_record {
                install_record
                    .as_ref()
                    .map(|record| record.effective_runtime_platform)
                    .unwrap_or(policy.effective_runtime_platform)
            } else {
                policy.effective_runtime_platform
            }
        }),
    }
}

fn join_runtime_path(
    base: &str,
    child: &str,
    runtime_platform: EffectiveRuntimePlatform,
) -> String {
    let separator = if runtime_platform == EffectiveRuntimePlatform::Windows {
        '\\'
    } else {
        '/'
    };
    let mut output = base.trim_end_matches(['\\', '/']).to_owned();
    if !output.ends_with(separator) {
        output.push(separator);
    }
    output.push_str(child.trim_matches(['\\', '/']));
    output
}

fn resolve_host_operation_paths(
    installer_home: &str,
    state: &OperationState,
    execution_context: &ExecutionContext,
) -> Result<HostOperationPaths> {
    Ok(HostOperationPaths {
        installer_home: resolve_host_path_for_runtime(installer_home, execution_context)?,
        install_root: resolve_host_path_for_runtime(&state.install_root, execution_context)?,
        work_root: resolve_host_path_for_runtime(&state.work_root, execution_context)?,
        data_root: resolve_host_path_for_runtime(&state.data_root, execution_context)?,
    })
}

fn resolve_operation_context(
    loaded: &LoadedManifest,
    options: &ApplyManifestOptions,
    prefer_install_record: bool,
    backup_runtime: Option<(&str, &str)>,
) -> Result<ResolvedOperationContext> {
    let platform = options.platform.unwrap_or(detect_host_platform()?);
    validate_manifest_platforms(&loaded.manifest, platform)?;

    let install_scope = options
        .install_scope
        .or_else(|| hinted_install_scope(loaded, options))
        .unwrap_or(InstallScope::User);
    let software_name = options
        .software_name
        .clone()
        .or_else(|| hinted_software_name(loaded, options))
        .unwrap_or_else(|| loaded.manifest.metadata.name.clone());
    let control_level = options
        .install_control_level
        .or_else(|| hinted_install_control_level(loaded, options))
        .unwrap_or(InstallControlLevel::Managed);
    let host_home_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .display()
        .to_string();
    let execution_context = resolve_execution_context(
        platform,
        &RuntimeOptions {
            effective_runtime_platform: options.effective_runtime_platform.or(
                parse_effective_runtime_platform_option(
                    hinted_manifest_variable(loaded, options, "hub_effective_runtime_platform")
                        .as_deref(),
                )?,
            ),
            container_runtime: options.container_runtime.or(parse_container_runtime_option(
                hinted_manifest_variable(loaded, options, "hub_container_runtime_preference")
                    .or_else(|| hinted_manifest_variable(loaded, options, "hub_container_runtime"))
                    .as_deref(),
            )?),
            wsl_distribution: options
                .wsl_distribution
                .clone()
                .or_else(|| hinted_manifest_variable(loaded, options, "hub_wsl_distribution")),
            docker_context: options
                .docker_context
                .clone()
                .or_else(|| hinted_manifest_variable(loaded, options, "hub_docker_context")),
            docker_host: options
                .docker_host
                .clone()
                .or_else(|| hinted_manifest_variable(loaded, options, "hub_docker_host")),
        },
    )?;
    let runtime_home_dir = execution_context
        .runtime_home_dir
        .clone()
        .unwrap_or_else(|| {
            normalize_path_for_runtime(&host_home_dir, execution_context.effective_runtime_platform)
        });
    let local_data_dir = dirs::data_local_dir().map(|path| {
        normalize_path_for_runtime(
            &path.display().to_string(),
            execution_context.effective_runtime_platform,
        )
    });
    let policy = resolve_install_policy(InstallPolicyInput {
        platform,
        effective_runtime_platform: execution_context.effective_runtime_platform,
        software_name: software_name.clone(),
        home_dir: runtime_home_dir.clone(),
        local_data_dir,
        install_scope,
        install_control_level: control_level,
        installer_home_override: options.installer_home.clone(),
        install_root_override: options.install_root.clone(),
        work_root_override: options.work_root.clone(),
        bin_dir_override: options.bin_dir.clone(),
        data_root_override: options.data_root.clone(),
    });
    let host_installer_home =
        resolve_host_path_for_runtime(&policy.installer_home, &execution_context)?;
    let runtime_install_record_file =
        resolve_install_record_file(&policy.installer_home, &software_name);
    let host_install_record_file =
        resolve_install_record_file(&host_installer_home, &software_name);
    let install_record = read_install_record(&host_installer_home, &software_name)?;
    let state = merge_operation_state(
        &policy,
        install_record.as_ref(),
        options,
        prefer_install_record,
    );
    let host_paths =
        resolve_host_operation_paths(&policy.installer_home, &state, &execution_context)?;

    let runtime = RuntimeContext {
        platform,
        host_platform: execution_context.host_platform,
        effective_runtime_platform: state.effective_runtime_platform,
        manifest_dir: normalize_path_for_runtime(
            &loaded.base_directory,
            state.effective_runtime_platform,
        ),
        cwd: normalize_path_for_runtime(
            &options.cwd.clone().unwrap_or_else(current_dir_string),
            state.effective_runtime_platform,
        ),
        home: runtime_home_dir,
        temp: if state.effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
            "/tmp".to_owned()
        } else {
            normalize_path_for_runtime(
                &env::temp_dir().display().to_string(),
                state.effective_runtime_platform,
            )
        },
        user: env::var("USER")
            .or_else(|_| env::var("USERNAME"))
            .unwrap_or_else(|_| "unknown".to_owned()),
        path_separator: if state.effective_runtime_platform == EffectiveRuntimePlatform::Windows {
            "\\".to_owned()
        } else {
            "/".to_owned()
        },
        software_name: Some(software_name.clone()),
        installer_home: Some(policy.installer_home.clone()),
        install_scope: Some(state.install_scope),
        install_root: Some(state.install_root.clone()),
        work_root: Some(state.work_root.clone()),
        bin_dir: Some(state.bin_dir.clone()),
        data_root: Some(state.data_root.clone()),
        install_control_level: Some(state.install_control_level),
        container_runtime: execution_context.container_runtime,
        wsl_distribution: execution_context.wsl_distribution.clone(),
        docker_context: execution_context.docker_context.clone(),
        docker_host: execution_context.docker_host.clone(),
        backup_root: backup_runtime.map(|(root, _)| root.to_owned()),
        backup_session_dir: backup_runtime.map(|(_, session)| session.to_owned()),
        backup_data_dir: backup_runtime.map(|(_, session)| {
            join_runtime_path(session, "data", state.effective_runtime_platform)
        }),
        backup_install_dir: backup_runtime.map(|(_, session)| {
            join_runtime_path(session, "install", state.effective_runtime_platform)
        }),
        backup_work_dir: backup_runtime.map(|(_, session)| {
            join_runtime_path(session, "work", state.effective_runtime_platform)
        }),
        install_record_file: Some(runtime_install_record_file.clone()),
        install_status: install_record
            .as_ref()
            .map(|record| install_status_string(&record.status)),
    };

    Ok(ResolvedOperationContext {
        platform,
        software_name,
        policy,
        execution_context,
        runtime,
        state,
        host_paths,
        host_install_record_file,
        install_record,
    })
}

fn evaluate_dependency_runtime(
    dependency: &ManifestDependency,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    execution_context: &ExecutionContext,
    runtime_probe: &SystemRuntimeProbe,
) -> Result<DependencyRuntimeEvaluation> {
    let target = dependency_target(dependency, variables, platform);
    let step_count = render_commands(&dependency.install, variables, platform, defaults).len();
    let supports_auto_remediation = step_count > 0;
    let present = evaluate_dependency_with_probe(
        dependency,
        variables,
        platform,
        execution_context,
        runtime_probe,
    )?;

    Ok(DependencyRuntimeEvaluation {
        target,
        required: dependency.required.unwrap_or(true),
        supports_auto_remediation,
        step_count,
        present,
        status: dependency_status(
            present,
            matches!(&dependency.check, DependencyCheck::Platform { .. }),
            supports_auto_remediation,
        )
        .to_owned(),
    })
}

fn dependency_status(
    present: bool,
    platform_only_dependency: bool,
    supports_auto_remediation: bool,
) -> &'static str {
    if present {
        "available"
    } else if platform_only_dependency {
        "unsupported"
    } else if supports_auto_remediation {
        "remediable"
    } else {
        "missing"
    }
}

fn install_loaded_dependencies(
    loaded: &LoadedManifest,
    options: &DependencyInstallOptions,
    observer: Option<&ProgressObserver<'_>>,
) -> Result<DependencyInstallResult> {
    let started = Instant::now();
    let context = resolve_operation_context(loaded, &options.apply, true, None)?;
    let variables = merge_variables(&loaded.manifest, &context.runtime, &options.apply.variables);
    let runtime_probe = SystemRuntimeProbe;

    let known_ids = loaded
        .manifest
        .dependencies
        .iter()
        .map(|dependency| dependency.id.as_str())
        .collect::<HashSet<_>>();
    let unknown_ids = options
        .dependency_ids
        .iter()
        .filter(|dependency_id| !known_ids.contains(dependency_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !unknown_ids.is_empty() {
        return Err(HubError::message(
            "UNKNOWN_DEPENDENCY",
            format!(
                "dependency ids were not found in manifest: {}",
                unknown_ids.join(", ")
            ),
        ));
    }

    let selected_ids = options
        .dependency_ids
        .iter()
        .map(|dependency_id| dependency_id.as_str())
        .collect::<HashSet<_>>();

    let mut dependency_reports = Vec::new();
    let mut success = true;

    for dependency in &loaded.manifest.dependencies {
        if !selected_ids.is_empty() && !selected_ids.contains(dependency.id.as_str()) {
            continue;
        }

        let report = install_selected_dependency(
            dependency,
            &variables,
            context.platform,
            &loaded.manifest.defaults,
            &options.apply,
            observer,
            &context.execution_context,
            &runtime_probe,
        );
        success &= report.success;
        let should_stop = !report.success && !options.continue_on_error;
        dependency_reports.push(report);

        if should_stop {
            break;
        }
    }

    Ok(DependencyInstallResult {
        manifest_name: loaded.manifest.metadata.name.clone(),
        manifest_path: loaded.absolute_path.clone(),
        manifest_source_input: loaded.source_input.clone(),
        manifest_source_kind: loaded.source_kind.clone(),
        platform: context.platform,
        effective_runtime_platform: context.state.effective_runtime_platform,
        installer_home: context.policy.installer_home.clone(),
        resolved_install_scope: context.state.install_scope,
        resolved_install_root: context.state.install_root.clone(),
        resolved_work_root: context.state.work_root.clone(),
        resolved_bin_dir: context.state.bin_dir.clone(),
        resolved_data_root: context.state.data_root.clone(),
        install_control_level: context.state.install_control_level,
        success,
        duration_ms: started.elapsed().as_millis(),
        dependency_reports,
    })
}

fn install_selected_dependency(
    dependency: &ManifestDependency,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
    runtime_probe: &SystemRuntimeProbe,
) -> DependencyInstallReport {
    let timer = Instant::now();
    let before = evaluate_dependency_runtime(
        dependency,
        variables,
        platform,
        defaults,
        execution_context,
        runtime_probe,
    );

    let (target, required, status_before, step_count, supports_auto_remediation, before_error) =
        match before {
            Ok(evaluation) => (
                evaluation.target,
                evaluation.required,
                evaluation.status,
                evaluation.step_count,
                evaluation.supports_auto_remediation,
                None,
            ),
            Err(error) => (
                dependency.id.clone(),
                dependency.required.unwrap_or(true),
                "missing".to_owned(),
                0,
                false,
                Some(error.to_string()),
            ),
        };

    emit(
        observer,
        ProgressEvent::DependencyStarted {
            dependency_id: dependency.id.clone(),
            target: target.clone(),
            description: dependency.description.clone(),
        },
    );

    let mut report = DependencyInstallReport {
        dependency_id: dependency.id.clone(),
        description: dependency.description.clone(),
        target: target.clone(),
        required,
        status_before: status_before.clone(),
        status_after: status_before.clone(),
        attempted_auto_remediation: false,
        success: false,
        skipped: false,
        duration_ms: 0,
        step_count,
        error: before_error,
    };

    if report.error.is_some() {
        report.duration_ms = timer.elapsed().as_millis();
        emit(
            observer,
            ProgressEvent::DependencyCompleted {
                dependency_id: dependency.id.clone(),
                target,
                success: false,
                skipped: false,
                status_after: report.status_after.clone(),
            },
        );
        return report;
    }

    if status_before == "available" {
        report.success = true;
        report.skipped = true;
        report.duration_ms = timer.elapsed().as_millis();
        emit(
            observer,
            ProgressEvent::DependencyCompleted {
                dependency_id: dependency.id.clone(),
                target,
                success: true,
                skipped: true,
                status_after: report.status_after.clone(),
            },
        );
        return report;
    }

    if status_before == "unsupported" {
        report.error = Some(format!(
            "dependency {} does not match the current platform or runtime requirements",
            dependency.id
        ));
        report.duration_ms = timer.elapsed().as_millis();
        emit(
            observer,
            ProgressEvent::DependencyCompleted {
                dependency_id: dependency.id.clone(),
                target,
                success: false,
                skipped: false,
                status_after: report.status_after.clone(),
            },
        );
        return report;
    }

    if !supports_auto_remediation {
        report.error = Some(format!(
            "dependency {} is missing and has no remediation steps",
            dependency.id
        ));
        report.duration_ms = timer.elapsed().as_millis();
        emit(
            observer,
            ProgressEvent::DependencyCompleted {
                dependency_id: dependency.id.clone(),
                target,
                success: false,
                skipped: false,
                status_after: report.status_after.clone(),
            },
        );
        return report;
    }

    report.attempted_auto_remediation = true;
    let stage_name = format!("dependencyInstall:{}", dependency.id);
    let stage_run = run_stage(
        &stage_name,
        &dependency.install,
        variables,
        platform,
        defaults,
        options,
        observer,
        execution_context,
    );

    if let Err(error) = stage_run {
        report.error = Some(error.to_string());
        report.duration_ms = timer.elapsed().as_millis();
        emit(
            observer,
            ProgressEvent::DependencyCompleted {
                dependency_id: dependency.id.clone(),
                target,
                success: false,
                skipped: false,
                status_after: report.status_after.clone(),
            },
        );
        return report;
    }

    match evaluate_dependency_runtime(
        dependency,
        variables,
        platform,
        defaults,
        execution_context,
        runtime_probe,
    ) {
        Ok(after) => {
            report.status_after = after.status;
            report.success = after.present;
            if !after.present {
                report.error = Some(format!(
                    "dependency {} still missing after remediation",
                    dependency.id
                ));
            }
        }
        Err(error) => {
            report.error = Some(error.to_string());
        }
    }

    report.duration_ms = timer.elapsed().as_millis();
    emit(
        observer,
        ProgressEvent::DependencyCompleted {
            dependency_id: dependency.id.clone(),
            target,
            success: report.success,
            skipped: false,
            status_after: report.status_after.clone(),
        },
    );

    report
}

fn inspect_loaded_manifest(
    loaded: &LoadedManifest,
    options: &ApplyManifestOptions,
) -> Result<InstallAssessmentResult> {
    let platform = options.platform.unwrap_or(detect_host_platform()?);
    validate_manifest_platforms(&loaded.manifest, platform)?;

    let install_scope = options
        .install_scope
        .or_else(|| hinted_install_scope(loaded, options))
        .unwrap_or(InstallScope::User);
    let software_name = options
        .software_name
        .clone()
        .or_else(|| hinted_software_name(loaded, options))
        .unwrap_or_else(|| loaded.manifest.metadata.name.clone());
    let control_level = options
        .install_control_level
        .or_else(|| hinted_install_control_level(loaded, options))
        .unwrap_or(InstallControlLevel::Managed);
    let runtime_options = RuntimeOptions {
        effective_runtime_platform: options.effective_runtime_platform.or(
            parse_effective_runtime_platform_option(
                hinted_manifest_variable(loaded, options, "hub_effective_runtime_platform")
                    .as_deref(),
            )?,
        ),
        container_runtime: options.container_runtime.or(parse_container_runtime_option(
            hinted_manifest_variable(loaded, options, "hub_container_runtime_preference")
                .or_else(|| hinted_manifest_variable(loaded, options, "hub_container_runtime"))
                .as_deref(),
        )?),
        wsl_distribution: options
            .wsl_distribution
            .clone()
            .or_else(|| hinted_manifest_variable(loaded, options, "hub_wsl_distribution")),
        docker_context: options
            .docker_context
            .clone()
            .or_else(|| hinted_manifest_variable(loaded, options, "hub_docker_context")),
        docker_host: options
            .docker_host
            .clone()
            .or_else(|| hinted_manifest_variable(loaded, options, "hub_docker_host")),
    };
    let requested_runtime_platform = runtime_options
        .effective_runtime_platform
        .unwrap_or(EffectiveRuntimePlatform::from(platform));
    let host_home_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .display()
        .to_string();
    let runtime_probe = SystemRuntimeProbe;
    let available_wsl_distributions = runtime_probe
        .list_wsl_distros()
        .into_iter()
        .filter(|distro| !is_reserved_wsl_distribution(distro))
        .collect::<Vec<_>>();
    let host_docker_available = runtime_probe.docker_available_on_host();

    let resolved_execution =
        resolve_execution_context_with_probe(platform, platform, &runtime_options, &runtime_probe);
    let mut issues = Vec::new();
    if let Err(error) = &resolved_execution {
        issues.push(assessment_issue_from_error(error, "error", None));
    }

    let mut execution_context = resolved_execution.unwrap_or_else(|_| ExecutionContext {
        host_platform: platform,
        target_platform: platform,
        effective_runtime_platform: requested_runtime_platform,
        container_runtime: None,
        wsl_distribution: runtime_options.wsl_distribution.clone(),
        docker_context: runtime_options.docker_context.clone(),
        docker_host: runtime_options.docker_host.clone(),
        runtime_home_dir: None,
    });

    let runtime_home_dir = execution_context
        .runtime_home_dir
        .clone()
        .unwrap_or_else(|| {
            normalize_path_for_runtime(&host_home_dir, execution_context.effective_runtime_platform)
        });
    execution_context.runtime_home_dir = Some(runtime_home_dir.clone());

    let local_data_dir = dirs::data_local_dir().map(|path| {
        normalize_path_for_runtime(
            &path.display().to_string(),
            execution_context.effective_runtime_platform,
        )
    });
    let policy = resolve_install_policy(InstallPolicyInput {
        platform,
        effective_runtime_platform: execution_context.effective_runtime_platform,
        software_name: software_name.clone(),
        home_dir: runtime_home_dir.clone(),
        local_data_dir,
        install_scope,
        install_control_level: control_level,
        installer_home_override: options.installer_home.clone(),
        install_root_override: options.install_root.clone(),
        work_root_override: options.work_root.clone(),
        bin_dir_override: options.bin_dir.clone(),
        data_root_override: options.data_root.clone(),
    });

    let install_record = resolve_host_path_for_runtime(&policy.installer_home, &execution_context)
        .ok()
        .and_then(|host_installer_home| {
            read_install_record(&host_installer_home, &software_name).ok()
        })
        .flatten();
    let state = merge_operation_state(&policy, install_record.as_ref(), options, true);
    let runtime_install_record_file =
        resolve_install_record_file(&policy.installer_home, &software_name);

    let runtime = RuntimeContext {
        platform,
        host_platform: execution_context.host_platform,
        effective_runtime_platform: state.effective_runtime_platform,
        manifest_dir: normalize_path_for_runtime(
            &loaded.base_directory,
            state.effective_runtime_platform,
        ),
        cwd: normalize_path_for_runtime(
            &options.cwd.clone().unwrap_or_else(current_dir_string),
            state.effective_runtime_platform,
        ),
        home: runtime_home_dir.clone(),
        temp: if state.effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
            "/tmp".to_owned()
        } else {
            normalize_path_for_runtime(
                &env::temp_dir().display().to_string(),
                state.effective_runtime_platform,
            )
        },
        user: env::var("USER")
            .or_else(|_| env::var("USERNAME"))
            .unwrap_or_else(|_| "unknown".to_owned()),
        path_separator: if state.effective_runtime_platform == EffectiveRuntimePlatform::Windows {
            "\\".to_owned()
        } else {
            "/".to_owned()
        },
        software_name: Some(software_name.clone()),
        installer_home: Some(policy.installer_home.clone()),
        install_scope: Some(state.install_scope),
        install_root: Some(state.install_root.clone()),
        work_root: Some(state.work_root.clone()),
        bin_dir: Some(state.bin_dir.clone()),
        data_root: Some(state.data_root.clone()),
        install_control_level: Some(state.install_control_level),
        container_runtime: execution_context.container_runtime,
        wsl_distribution: execution_context.wsl_distribution.clone(),
        docker_context: execution_context.docker_context.clone(),
        docker_host: execution_context.docker_host.clone(),
        backup_root: None,
        backup_session_dir: None,
        backup_data_dir: None,
        backup_install_dir: None,
        backup_work_dir: None,
        install_record_file: Some(runtime_install_record_file),
        install_status: install_record
            .as_ref()
            .map(|record| install_status_string(&record.status)),
    };
    let variables = merge_variables(&loaded.manifest, &runtime, &options.variables);

    let mut dependencies = Vec::new();
    let mut command_availability = BTreeMap::new();
    let runtime_blocked = issues.iter().any(|issue| issue.severity == "error");

    for dependency in &loaded.manifest.dependencies {
        let target = dependency_target(dependency, &variables, platform);
        let auto_remediation_commands = render_commands(
            &dependency.install,
            &variables,
            platform,
            &loaded.manifest.defaults,
        )
        .into_iter()
        .map(|step| assessment_command_from_step(&step, true))
        .collect::<Vec<_>>();
        let manual_remediation_commands = if auto_remediation_commands.is_empty() {
            suggested_dependency_commands(&target, &execution_context)
        } else {
            Vec::new()
        };
        let present = evaluate_dependency_with_probe(
            dependency,
            &variables,
            platform,
            &execution_context,
            &runtime_probe,
        )?;

        if matches!(&dependency.check, DependencyCheck::Command { .. }) {
            command_availability.insert(target.clone(), present);
        }

        let required = dependency.required.unwrap_or(true);
        let supports_auto_remediation = !auto_remediation_commands.is_empty();
        let remediation_commands = if supports_auto_remediation {
            auto_remediation_commands
        } else {
            manual_remediation_commands
        };
        let status = dependency_status(
            present,
            matches!(&dependency.check, DependencyCheck::Platform { .. }),
            supports_auto_remediation,
        );

        if !present {
            let severity = dependency_issue_severity(status, required, runtime_blocked);
            if severity != "info" || required {
                issues.push(InstallAssessmentIssue {
                    severity: severity.to_owned(),
                    code: dependency_issue_code(status).to_owned(),
                    message: dependency_issue_message(
                        dependency,
                        &target,
                        status,
                        supports_auto_remediation,
                    ),
                    dependency_id: Some(dependency.id.clone()),
                });
            }
        }

        dependencies.push(InstallAssessmentDependency {
            id: dependency.id.clone(),
            description: dependency.description.clone(),
            required,
            check_type: dependency_check_type(dependency),
            target,
            status: status.to_owned(),
            supports_auto_remediation,
            remediation_commands,
        });
    }

    let requires_elevated_setup = dependencies.iter().any(|dependency| {
        dependency
            .remediation_commands
            .iter()
            .any(|command| command.requires_elevation)
    });
    let mut recommendations = build_assessment_recommendations(
        &dependencies,
        &execution_context,
        host_docker_available,
        control_level,
    );
    if loaded.manifest.dependencies.is_empty() {
        recommendations.push(
            "This install profile relies on artifact-level checks, so prerequisite guidance is partial.".to_owned(),
        );
    }

    let wsl_docker_available = execution_context
        .wsl_distribution
        .as_deref()
        .map(|distro| runtime_probe.wsl_docker_available(Some(distro)))
        .unwrap_or_else(|| {
            available_wsl_distributions
                .iter()
                .any(|distro| runtime_probe.wsl_docker_available(Some(distro.as_str())))
        });
    let ready = !issues.iter().any(|issue| issue.severity == "error");

    Ok(InstallAssessmentResult {
        manifest_name: loaded.manifest.metadata.name.clone(),
        manifest_description: loaded.manifest.metadata.description.clone(),
        manifest_homepage: loaded.manifest.metadata.homepage.clone(),
        platform,
        effective_runtime_platform: execution_context.effective_runtime_platform,
        resolved_install_scope: state.install_scope,
        resolved_install_root: state.install_root,
        resolved_work_root: state.work_root,
        resolved_bin_dir: state.bin_dir,
        resolved_data_root: state.data_root,
        install_control_level: state.install_control_level,
        install_status: install_record.as_ref().map(|record| record.status),
        ready,
        requires_elevated_setup,
        dependencies,
        issues,
        recommendations: {
            recommendations.sort();
            recommendations.dedup();
            recommendations
        },
        installation: loaded.manifest.installation.clone(),
        data_items: loaded
            .manifest
            .data_layout
            .as_ref()
            .map(|layout| layout.items.clone())
            .unwrap_or_default(),
        migration_strategies: loaded
            .manifest
            .migration
            .as_ref()
            .map(|migration| migration.strategies.clone())
            .unwrap_or_default(),
        runtime: InstallAssessmentRuntime {
            host_platform: execution_context.host_platform,
            requested_runtime_platform,
            effective_runtime_platform: execution_context.effective_runtime_platform,
            container_runtime_preference: runtime_options.container_runtime,
            resolved_container_runtime: execution_context.container_runtime,
            wsl_distribution: execution_context.wsl_distribution.clone(),
            available_wsl_distributions,
            wsl_available: !runtime_probe.list_wsl_distros().is_empty(),
            host_docker_available,
            wsl_docker_available,
            runtime_home_dir: execution_context.runtime_home_dir.clone(),
            command_availability,
        },
    })
}

fn dependency_check_type(dependency: &ManifestDependency) -> String {
    match &dependency.check {
        DependencyCheck::Command { .. } => "command",
        DependencyCheck::File { .. } => "file",
        DependencyCheck::Env { .. } => "env",
        DependencyCheck::Platform { .. } => "platform",
    }
    .to_owned()
}

fn dependency_target(
    dependency: &ManifestDependency,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
) -> String {
    match &dependency.check {
        DependencyCheck::Command { name } => render_template(name, variables),
        DependencyCheck::File { path } => render_template(path, variables),
        DependencyCheck::Env { name, .. } => render_template(name, variables),
        DependencyCheck::Platform { platforms } => {
            let rendered = platforms
                .iter()
                .map(|item| item.as_str())
                .collect::<Vec<_>>()
                .join(",");
            if rendered.is_empty() {
                platform.as_str().to_owned()
            } else {
                rendered
            }
        }
    }
}

fn suggested_dependency_commands(
    target: &str,
    execution_context: &ExecutionContext,
) -> Vec<InstallAssessmentCommand> {
    let normalized = target.trim().to_ascii_lowercase();
    match runtime_shell_for_context(execution_context) {
        ShellKind::Powershell => match normalized.as_str() {
            "git" => vec![manual_assessment_command(
                "Install Git with winget",
                "winget install --id Git.Git -e --source winget",
                ShellKind::Powershell,
                true,
            )],
            "node" | "npm" => vec![manual_assessment_command(
                "Install Node.js LTS with winget",
                "winget install --id OpenJS.NodeJS.LTS -e --source winget",
                ShellKind::Powershell,
                true,
            )],
            "pnpm" => vec![manual_assessment_command(
                "Enable pnpm through Corepack",
                "corepack enable; corepack prepare pnpm@latest --activate",
                ShellKind::Powershell,
                false,
            )],
            "cargo" | "rustc" => vec![manual_assessment_command(
                "Install Rustup with winget",
                "winget install --id Rustlang.Rustup -e --source winget",
                ShellKind::Powershell,
                true,
            )],
            "docker" => vec![manual_assessment_command(
                "Install Docker Desktop with winget",
                "winget install --id Docker.DockerDesktop -e --source winget",
                ShellKind::Powershell,
                true,
            )],
            _ => Vec::new(),
        },
        _ => match normalized.as_str() {
            "git" => vec![manual_assessment_command(
                "Install Git from the system package manager",
                "sudo apt-get update && sudo apt-get install -y git",
                ShellKind::Bash,
                true,
            )],
            "node" | "npm" => vec![manual_assessment_command(
                "Install Node.js and npm from the system package manager",
                "sudo apt-get update && sudo apt-get install -y nodejs npm",
                ShellKind::Bash,
                true,
            )],
            "pnpm" => vec![manual_assessment_command(
                "Enable pnpm through Corepack",
                "corepack enable && corepack prepare pnpm@latest --activate",
                ShellKind::Bash,
                false,
            )],
            "cargo" | "rustc" => vec![manual_assessment_command(
                "Install Rust with rustup",
                "curl https://sh.rustup.rs -sSf | sh -s -- -y",
                ShellKind::Bash,
                false,
            )],
            "docker" => vec![manual_assessment_command(
                "Install Docker from the system package manager",
                "sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin",
                ShellKind::Bash,
                true,
            )],
            _ => Vec::new(),
        },
    }
}

fn manual_assessment_command(
    description: &str,
    command_line: &str,
    shell_kind: ShellKind,
    requires_elevation: bool,
) -> InstallAssessmentCommand {
    InstallAssessmentCommand {
        description: description.to_owned(),
        command_line: command_line.to_owned(),
        shell_kind: Some(shell_kind),
        working_directory: None,
        requires_elevation,
        auto_run: false,
    }
}

fn assessment_command_from_step(step: &InstallStep, auto_run: bool) -> InstallAssessmentCommand {
    let command_line = if step.shell || step.args.is_empty() {
        step.command.clone()
    } else {
        format!("{} {}", step.command, step.args.join(" "))
    };

    InstallAssessmentCommand {
        description: step.description.clone(),
        command_line,
        shell_kind: step.shell_kind,
        working_directory: step.working_directory.clone(),
        requires_elevation: step.requires_elevation,
        auto_run,
    }
}

fn build_assessment_recommendations(
    dependencies: &[InstallAssessmentDependency],
    execution_context: &ExecutionContext,
    host_docker_available: bool,
    control_level: InstallControlLevel,
) -> Vec<String> {
    let mut recommendations = Vec::new();
    let auto_dependencies = dependencies
        .iter()
        .filter(|dependency| dependency.status == "remediable")
        .map(|dependency| dependency.id.clone())
        .collect::<Vec<_>>();
    if !auto_dependencies.is_empty() {
        recommendations.push(format!(
            "Claw Studio can attempt prerequisite setup for: {}.",
            auto_dependencies.join(", ")
        ));
    }

    let manual_dependencies = dependencies
        .iter()
        .filter(|dependency| {
            dependency.required
                && matches!(dependency.status.as_str(), "missing" | "unsupported")
                && !dependency.remediation_commands.is_empty()
        })
        .map(|dependency| dependency.id.clone())
        .collect::<Vec<_>>();
    if !manual_dependencies.is_empty() {
        recommendations.push(format!(
            "Manual prerequisite setup is recommended before install for: {}.",
            manual_dependencies.join(", ")
        ));
    }

    if execution_context.effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
        recommendations.push(format!(
            "This profile will execute inside WSL{}.",
            execution_context
                .wsl_distribution
                .as_ref()
                .map(|distro| format!(" ({distro})"))
                .unwrap_or_default()
        ));
    }

    if matches!(
        execution_context.container_runtime,
        Some(ContainerRuntime::Host)
    ) && host_docker_available
    {
        recommendations.push("Docker host runtime is available for this profile.".to_owned());
    }

    if control_level != InstallControlLevel::Managed {
        recommendations.push(format!(
            "This profile uses {} control, so some lifecycle steps remain upstream-owned.",
            install_control_level_label(control_level)
        ));
    }

    recommendations
}

fn dependency_issue_severity(status: &str, required: bool, runtime_blocked: bool) -> &'static str {
    if runtime_blocked {
        return "info";
    }

    match (status, required) {
        ("remediable", true) => "warning",
        ("missing", true) | ("unsupported", true) => "error",
        ("remediable", false) => "info",
        ("missing", false) | ("unsupported", false) => "info",
        _ => "info",
    }
}

fn dependency_issue_code(status: &str) -> &'static str {
    match status {
        "remediable" => "DEPENDENCY_REMEDIABLE",
        "unsupported" => "DEPENDENCY_UNSUPPORTED",
        _ => "DEPENDENCY_MISSING",
    }
}

fn dependency_issue_message(
    dependency: &ManifestDependency,
    target: &str,
    status: &str,
    supports_auto_remediation: bool,
) -> String {
    let label = dependency
        .description
        .clone()
        .unwrap_or_else(|| dependency.id.clone());
    match status {
        "remediable" if supports_auto_remediation => format!(
            "{label} ({target}) is missing. Claw Studio can try to install it automatically during setup."
        ),
        "unsupported" => format!(
            "{label} ({target}) does not match the current platform or runtime requirements."
        ),
        _ => format!(
            "{label} ({target}) is missing and must be installed before setup can complete."
        ),
    }
}

fn runtime_shell_for_context(execution_context: &ExecutionContext) -> ShellKind {
    if execution_context.effective_runtime_platform == EffectiveRuntimePlatform::Windows {
        ShellKind::Powershell
    } else {
        ShellKind::Bash
    }
}

fn assessment_issue_from_error(
    error: &HubError,
    severity: &str,
    dependency_id: Option<String>,
) -> InstallAssessmentIssue {
    let (code, message) = match error {
        HubError::Message { code, message } => (code.to_string(), message.clone()),
        _ => ("INSPECTION_FAILED".to_owned(), error.to_string()),
    };

    InstallAssessmentIssue {
        severity: severity.to_owned(),
        code,
        message,
        dependency_id,
    }
}

fn is_reserved_wsl_distribution(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized == "docker-desktop" || normalized == "docker-desktop-data"
}

fn install_control_level_label(level: InstallControlLevel) -> &'static str {
    match level {
        InstallControlLevel::Managed => "managed",
        InstallControlLevel::Partial => "partial",
        InstallControlLevel::Opaque => "opaque",
    }
}

fn normalized_backup_targets(targets: &[BackupTarget]) -> Vec<BackupTarget> {
    if targets.is_empty() {
        vec![BackupTarget::Data]
    } else {
        targets.to_vec()
    }
}

fn backup_target_path(host_paths: &HostOperationPaths, target: BackupTarget) -> &str {
    match target {
        BackupTarget::Data => &host_paths.data_root,
        BackupTarget::Install => &host_paths.install_root,
        BackupTarget::Work => &host_paths.work_root,
    }
}

fn normalize_comparable_path(value: &str) -> String {
    let normalized = value.replace('\\', "/").trim_end_matches('/').to_owned();
    if normalized.contains(':') {
        normalized.to_ascii_lowercase()
    } else {
        normalized
    }
}

fn is_same_or_nested_path(candidate: &str, parent: &str) -> bool {
    let candidate = normalize_comparable_path(candidate);
    let parent = normalize_comparable_path(parent);
    candidate == parent || candidate.starts_with(&format!("{parent}/"))
}

fn copy_path_recursive(source: &Path, destination: &Path) -> Result<()> {
    let metadata = fs::metadata(source)?;
    if metadata.is_dir() {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_path_recursive(&entry.path(), &destination.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, destination)?;
        Ok(())
    }
}

fn emit_internal_step(
    observer: Option<&ProgressObserver<'_>>,
    step_id: &str,
    description: &str,
    command_line: &str,
    dry_run: bool,
    action: impl FnOnce() -> Result<()>,
) -> Result<()> {
    emit(
        observer,
        ProgressEvent::StepStarted {
            step_id: step_id.to_owned(),
            description: description.to_owned(),
        },
    );
    emit(
        observer,
        ProgressEvent::StepCommandStarted {
            step_id: step_id.to_owned(),
            command_line: command_line.to_owned(),
            working_directory: None,
        },
    );
    let timer = Instant::now();
    let result = if dry_run { Ok(()) } else { action() };
    emit(
        observer,
        ProgressEvent::StepCompleted {
            step_id: step_id.to_owned(),
            success: result.is_ok(),
            skipped: dry_run,
            duration_ms: timer.elapsed().as_millis(),
            exit_code: if result.is_ok() { Some(0) } else { Some(1) },
        },
    );
    result
}

fn copy_backup_target(
    observer: Option<&ProgressObserver<'_>>,
    target: BackupTarget,
    source_path: &str,
    backup_session_dir: &str,
    dry_run: bool,
) -> Result<BackupTargetReport> {
    if !Path::new(source_path).exists() {
        return Ok(BackupTargetReport {
            target,
            status: BackupTargetStatus::Missing,
        });
    }
    let destination = PathBuf::from(backup_session_dir).join(match target {
        BackupTarget::Data => "data",
        BackupTarget::Install => "install",
        BackupTarget::Work => "work",
    });
    emit_internal_step(
        observer,
        &format!("backup-{:?}", target).to_ascii_lowercase(),
        &format!("backup {:?}", target).to_ascii_lowercase(),
        &format!("copy {} -> {}", source_path, destination.display()),
        dry_run,
        || copy_path_recursive(Path::new(source_path), &destination),
    )?;

    Ok(BackupTargetReport {
        target,
        status: BackupTargetStatus::Copied,
    })
}

fn remove_path(target_path: &Path) -> Result<()> {
    let metadata = fs::metadata(target_path)?;
    if metadata.is_dir() {
        fs::remove_dir_all(target_path)?;
    } else {
        fs::remove_file(target_path)?;
    }
    Ok(())
}

fn remove_managed_target(
    observer: Option<&ProgressObserver<'_>>,
    target: BackupTarget,
    target_path: &str,
    preserved_paths: &[String],
    dry_run: bool,
) -> Result<UninstallTargetReport> {
    if preserved_paths
        .iter()
        .any(|preserved_path| is_same_or_nested_path(preserved_path, target_path))
    {
        return Ok(UninstallTargetReport {
            target,
            status: UninstallTargetStatus::Preserved,
        });
    }

    let target_ref = Path::new(target_path);
    if !target_ref.exists() {
        return Ok(UninstallTargetReport {
            target,
            status: UninstallTargetStatus::Missing,
        });
    }

    emit_internal_step(
        observer,
        &format!("remove-{:?}", target).to_ascii_lowercase(),
        &format!("remove {:?}", target).to_ascii_lowercase(),
        &format!("remove {}", target_path),
        dry_run,
        || remove_path(target_ref),
    )?;

    Ok(UninstallTargetReport {
        target,
        status: UninstallTargetStatus::Removed,
    })
}

fn build_install_record(
    loaded: &LoadedManifest,
    context: &ResolvedOperationContext,
    status: InstallRecordStatus,
) -> InstallRecord {
    let now = timestamp_now_string();
    InstallRecord {
        schema_version: "1.0".to_owned(),
        software_name: context.software_name.clone(),
        manifest_name: loaded.manifest.metadata.name.clone(),
        manifest_path: loaded.absolute_path.clone(),
        manifest_source_input: loaded.source_input.clone(),
        manifest_source_kind: loaded.source_kind.clone(),
        platform: context.platform,
        effective_runtime_platform: context.state.effective_runtime_platform,
        installer_home: context.policy.installer_home.clone(),
        install_scope: context.state.install_scope,
        install_root: context.state.install_root.clone(),
        work_root: context.state.work_root.clone(),
        bin_dir: context.state.bin_dir.clone(),
        data_root: context.state.data_root.clone(),
        install_control_level: context.state.install_control_level,
        status,
        installed_at: match status {
            InstallRecordStatus::Installed => context
                .install_record
                .as_ref()
                .and_then(|record| record.installed_at.clone())
                .or_else(|| Some(now.clone())),
            InstallRecordStatus::Uninstalled => context
                .install_record
                .as_ref()
                .and_then(|record| record.installed_at.clone()),
        },
        updated_at: now,
    }
}

fn timestamp_now_string() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| OffsetDateTime::now_utc().unix_timestamp().to_string())
}

fn backup_loaded_manifest(
    loaded: &LoadedManifest,
    options: &BackupManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
) -> Result<BackupManifestResult> {
    let started = Instant::now();
    let base_context = resolve_operation_context(loaded, &options.apply, true, None)?;
    let session_id = options
        .session_id
        .clone()
        .unwrap_or_else(|| format!("{:?}", started));
    let runtime_backup_root = resolve_backup_root_dir(
        &base_context.policy.installer_home,
        &base_context.software_name,
    );
    let runtime_backup_session_dir = resolve_backup_session_dir(
        &base_context.policy.installer_home,
        &base_context.software_name,
        &session_id,
    );
    let host_backup_session_dir = resolve_backup_session_dir(
        &base_context.host_paths.installer_home,
        &base_context.software_name,
        &session_id,
    );
    let context = resolve_operation_context(
        loaded,
        &options.apply,
        true,
        Some((&runtime_backup_root, &runtime_backup_session_dir)),
    )?;
    let variables = merge_variables(&loaded.manifest, &context.runtime, &options.apply.variables);
    let stage_reports = vec![run_stage(
        "backup",
        &loaded.manifest.lifecycle.backup,
        &variables,
        context.platform,
        &loaded.manifest.defaults,
        &options.apply,
        observer,
        &context.execution_context,
    )?];

    if !options.apply.dry_run {
        fs::create_dir_all(&host_backup_session_dir)?;
    }

    let mut target_reports = Vec::new();
    for target in normalized_backup_targets(&options.targets) {
        target_reports.push(copy_backup_target(
            observer,
            target,
            backup_target_path(&context.host_paths, target),
            &host_backup_session_dir,
            options.apply.dry_run,
        )?);
    }

    Ok(BackupManifestResult {
        manifest_name: loaded.manifest.metadata.name.clone(),
        manifest_path: loaded.absolute_path.clone(),
        manifest_source_input: loaded.source_input.clone(),
        manifest_source_kind: loaded.source_kind.clone(),
        platform: context.platform,
        installer_home: context.policy.installer_home.clone(),
        resolved_install_scope: context.state.install_scope,
        resolved_install_root: context.state.install_root.clone(),
        resolved_work_root: context.state.work_root.clone(),
        resolved_bin_dir: context.state.bin_dir.clone(),
        resolved_data_root: context.state.data_root.clone(),
        install_control_level: context.state.install_control_level,
        effective_runtime_platform: context.state.effective_runtime_platform,
        install_record_file: context.host_install_record_file.clone(),
        install_record_found: context.install_record.is_some(),
        backup_session_dir: host_backup_session_dir,
        success: stage_reports.iter().all(|report| report.success),
        duration_ms: started.elapsed().as_millis(),
        stage_reports,
        target_reports,
    })
}

fn uninstall_loaded_manifest(
    loaded: &LoadedManifest,
    options: &UninstallManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
) -> Result<UninstallManifestResult> {
    let started = Instant::now();
    let base_context = resolve_operation_context(loaded, &options.apply, true, None)?;
    let backup_session_id = options
        .backup_session_id
        .clone()
        .unwrap_or_else(|| format!("{:?}", started));
    let backup_result = if options.backup_before_uninstall {
        Some(backup_loaded_manifest(
            loaded,
            &BackupManifestOptions {
                apply: options.apply.clone(),
                targets: options.backup_targets.clone(),
                session_id: Some(backup_session_id.clone()),
            },
            observer,
        )?)
    } else {
        None
    };
    let backup_runtime = if options.backup_before_uninstall {
        Some((
            resolve_backup_root_dir(
                &base_context.policy.installer_home,
                &base_context.software_name,
            ),
            resolve_backup_session_dir(
                &base_context.policy.installer_home,
                &base_context.software_name,
                &backup_session_id,
            ),
        ))
    } else {
        None
    };
    let context = resolve_operation_context(
        loaded,
        &options.apply,
        true,
        backup_runtime
            .as_ref()
            .map(|(root, session)| (root.as_str(), session.as_str())),
    )?;
    let variables = merge_variables(&loaded.manifest, &context.runtime, &options.apply.variables);
    let stage_reports = vec![run_stage(
        "uninstall",
        &loaded.manifest.lifecycle.uninstall,
        &variables,
        context.platform,
        &loaded.manifest.defaults,
        &options.apply,
        observer,
        &context.execution_context,
    )?];

    let data_exists = Path::new(&context.host_paths.data_root).exists();
    let preserved_paths = if !options.purge_data && data_exists {
        vec![context.host_paths.data_root.clone()]
    } else {
        Vec::new()
    };
    let target_reports = vec![
        remove_managed_target(
            observer,
            BackupTarget::Install,
            &context.host_paths.install_root,
            &preserved_paths,
            options.apply.dry_run,
        )?,
        remove_managed_target(
            observer,
            BackupTarget::Work,
            &context.host_paths.work_root,
            &preserved_paths,
            options.apply.dry_run,
        )?,
        if options.purge_data {
            remove_managed_target(
                observer,
                BackupTarget::Data,
                &context.host_paths.data_root,
                &[],
                options.apply.dry_run,
            )?
        } else {
            UninstallTargetReport {
                target: BackupTarget::Data,
                status: if data_exists {
                    UninstallTargetStatus::Preserved
                } else {
                    UninstallTargetStatus::Missing
                },
            }
        },
    ];
    let success = stage_reports.iter().all(|report| report.success);

    if success && !options.apply.dry_run {
        let record = build_install_record(loaded, &context, InstallRecordStatus::Uninstalled);
        write_install_record(
            &context.host_paths.installer_home,
            &context.software_name,
            &record,
        )?;
    }

    Ok(UninstallManifestResult {
        manifest_name: loaded.manifest.metadata.name.clone(),
        manifest_path: loaded.absolute_path.clone(),
        manifest_source_input: loaded.source_input.clone(),
        manifest_source_kind: loaded.source_kind.clone(),
        platform: context.platform,
        installer_home: context.policy.installer_home.clone(),
        resolved_install_scope: context.state.install_scope,
        resolved_install_root: context.state.install_root.clone(),
        resolved_work_root: context.state.work_root.clone(),
        resolved_bin_dir: context.state.bin_dir.clone(),
        resolved_data_root: context.state.data_root.clone(),
        install_control_level: context.state.install_control_level,
        effective_runtime_platform: context.state.effective_runtime_platform,
        install_record_file: context.host_install_record_file.clone(),
        install_record_found: context.install_record.is_some(),
        purge_data: options.purge_data,
        success,
        duration_ms: started.elapsed().as_millis(),
        stage_reports,
        target_reports,
        backup_result,
    })
}

fn validate_manifest_platforms(
    manifest: &HubInstallManifest,
    platform: SupportedPlatform,
) -> Result<()> {
    if manifest.platforms.is_empty() || manifest.platforms.contains(&platform) {
        Ok(())
    } else {
        Err(HubError::message(
            "PLATFORM_NOT_SUPPORTED",
            format!(
                "manifest {} does not support platform {}",
                manifest.metadata.name,
                platform.as_str()
            ),
        ))
    }
}

fn run_dependencies(
    dependencies: &[ManifestDependency],
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
) -> Result<StageReport> {
    let timer = Instant::now();
    let mut total_steps = 0;
    let mut failed_steps = 0;
    let runtime_probe = SystemRuntimeProbe;

    for dependency in dependencies {
        total_steps += 1;
        let report = install_selected_dependency(
            dependency,
            variables,
            platform,
            defaults,
            options,
            observer,
            execution_context,
            &runtime_probe,
        );

        if report.skipped && report.success {
            continue;
        }

        if !report.success {
            failed_steps += 1;
            if report.required {
                return Err(HubError::message(
                    "DEPENDENCY_REMEDIATION_FAILED",
                    report.error.unwrap_or_else(|| {
                        format!(
                            "dependency {} still missing after remediation",
                            dependency.id
                        )
                    }),
                ));
            }
        }
    }

    Ok(StageReport {
        stage: "dependencies".to_owned(),
        success: failed_steps == 0,
        duration_ms: timer.elapsed().as_millis(),
        total_steps,
        failed_steps,
    })
}

fn evaluate_dependency_with_probe<P: RuntimeProbe>(
    dependency: &ManifestDependency,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    execution_context: &ExecutionContext,
    runtime_probe: &P,
) -> Result<bool> {
    Ok(match &dependency.check {
        DependencyCheck::Command { name } => command_exists_for_context(
            &render_template(name, variables),
            execution_context,
            runtime_probe,
        ),
        DependencyCheck::File { path } => {
            file_exists_for_context(&render_template(path, variables), execution_context)
        }
        DependencyCheck::Env { name, equals } => {
            let variable_name = render_template(name, variables);
            let value = env_value_for_context(&variable_name, execution_context, runtime_probe);
            match (value, equals) {
                (Some(current), Some(expected)) => current == render_template(expected, variables),
                (Some(_), None) => true,
                _ => false,
            }
        }
        DependencyCheck::Platform { platforms } => platforms.contains(&platform),
    })
}

fn command_exists_for_context<P: RuntimeProbe>(
    command: &str,
    execution_context: &ExecutionContext,
    runtime_probe: &P,
) -> bool {
    if execution_context.effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
        runtime_probe.wsl_command_exists(execution_context.wsl_distribution.as_deref(), command)
    } else {
        runtime_probe.command_exists(command)
    }
}

fn file_exists_for_context(path: &str, execution_context: &ExecutionContext) -> bool {
    let host_path =
        resolve_host_path_for_runtime(path, execution_context).unwrap_or_else(|_| path.to_owned());
    Path::new(&host_path).exists()
}

fn env_value_for_context<P: RuntimeProbe>(
    name: &str,
    execution_context: &ExecutionContext,
    runtime_probe: &P,
) -> Option<String> {
    if execution_context.effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
        runtime_probe.wsl_read_env(execution_context.wsl_distribution.as_deref(), name)
    } else {
        env::var(name).ok()
    }
}

#[allow(clippy::too_many_arguments)]
fn run_stage(
    stage_name: &str,
    commands: &[ManifestCommand],
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
) -> Result<StageReport> {
    let timer = Instant::now();
    let steps = render_commands(commands, variables, platform, defaults);
    let total_steps = steps.len();
    emit(
        observer,
        ProgressEvent::StageStarted {
            stage: stage_name.to_owned(),
            total_steps,
        },
    );
    if steps.is_empty() {
        let report = StageReport {
            stage: stage_name.to_owned(),
            success: true,
            duration_ms: 0,
            total_steps: 0,
            failed_steps: 0,
        };
        emit(
            observer,
            ProgressEvent::StageCompleted {
                stage: stage_name.to_owned(),
                success: true,
                total_steps: 0,
                failed_steps: 0,
            },
        );
        return Ok(report);
    }

    let plan = InstallPlan {
        request: InstallRequestSummary {
            source: stage_name.to_owned(),
            platform,
            format: PackageFormat::Manager,
        },
        steps,
        notes: Vec::new(),
        guidance: Vec::new(),
    };

    let execution = match execute_plan_with_observer(
        plan,
        platform,
        &ExecuteOptions {
            dry_run: options.dry_run,
            sudo: options.sudo || defaults.sudo.unwrap_or(false),
            verbose: options.verbose,
            execution_context: Some(execution_context.clone()),
        },
        observer,
    ) {
        Ok(execution) => execution,
        Err(error) => {
            emit(
                observer,
                ProgressEvent::StageCompleted {
                    stage: stage_name.to_owned(),
                    success: false,
                    total_steps,
                    failed_steps: usize::from(total_steps > 0),
                },
            );
            return Err(error);
        }
    };

    let failed_steps = execution.steps.iter().filter(|step| !step.success).count();
    let report = StageReport {
        stage: stage_name.to_owned(),
        success: execution.success,
        duration_ms: timer.elapsed().as_millis(),
        total_steps: execution.steps.len(),
        failed_steps,
    };
    emit(
        observer,
        ProgressEvent::StageCompleted {
            stage: stage_name.to_owned(),
            success: report.success,
            total_steps: report.total_steps,
            failed_steps: report.failed_steps,
        },
    );
    Ok(report)
}

fn run_artifact(
    artifact: &ManifestArtifact,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
) -> Result<ArtifactReport> {
    let (base, artifact_type) = artifact_descriptor(artifact);
    if base.enabled == Some(false) {
        return Ok(ArtifactReport {
            artifact_id: base.id.clone(),
            artifact_type: artifact_type.to_owned(),
            success: true,
            duration_ms: 0,
            detail: "disabled".to_owned(),
        });
    }
    if !condition_matches(base.when.as_ref(), variables, platform) {
        return Ok(ArtifactReport {
            artifact_id: base.id.clone(),
            artifact_type: artifact_type.to_owned(),
            success: true,
            duration_ms: 0,
            detail: "skipped by condition".to_owned(),
        });
    }

    emit(
        observer,
        ProgressEvent::ArtifactStarted {
            artifact_id: base.id.clone(),
            artifact_type: artifact_type.to_owned(),
        },
    );

    let artifact_result = (|| -> Result<ArtifactReport> {
        let pre_install_report = run_stage(
            "artifactPreInstall",
            &base.pre_install,
            variables,
            platform,
            defaults,
            options,
            observer,
            execution_context,
        )?;

        let artifact_success = match artifact {
            ManifestArtifact::Package(spec) => run_package_artifact(
                spec,
                variables,
                platform,
                defaults,
                options,
                observer,
                execution_context,
            )?,
            ManifestArtifact::Git(spec) => run_git_artifact(
                spec,
                variables,
                platform,
                defaults,
                options,
                observer,
                execution_context,
            )?,
            ManifestArtifact::Huggingface(spec) => run_huggingface_artifact(
                spec,
                variables,
                platform,
                defaults,
                options,
                observer,
                execution_context,
            )?,
            ManifestArtifact::Command(spec) => {
                run_stage(
                    "artifactCommand",
                    &spec.commands,
                    variables,
                    platform,
                    defaults,
                    options,
                    observer,
                    execution_context,
                )?
                .success
            }
            ManifestArtifact::Source(spec) => run_source_artifact(
                spec,
                variables,
                platform,
                defaults,
                options,
                observer,
                execution_context,
            )?,
        };

        let configure_report = run_stage(
            "artifactConfigure",
            &base.configure,
            variables,
            platform,
            defaults,
            options,
            observer,
            execution_context,
        )?;
        let post_install_report = run_stage(
            "artifactPostInstall",
            &base.post_install,
            variables,
            platform,
            defaults,
            options,
            observer,
            execution_context,
        )?;
        let success = pre_install_report.success
            && artifact_success
            && configure_report.success
            && post_install_report.success;

        Ok(ArtifactReport {
            artifact_id: base.id.clone(),
            artifact_type: artifact_type.to_owned(),
            success,
            duration_ms: 0,
            detail: if success {
                base.title.clone().unwrap_or_else(|| "completed".to_owned())
            } else {
                format!("artifact {} reported execution failures", base.id)
            },
        })
    })();

    let report = match artifact_result {
        Ok(report) => report,
        Err(error) => {
            emit(
                observer,
                ProgressEvent::ArtifactCompleted {
                    artifact_id: base.id.clone(),
                    artifact_type: artifact_type.to_owned(),
                    success: false,
                },
            );
            return Err(error);
        }
    };
    emit(
        observer,
        ProgressEvent::ArtifactCompleted {
            artifact_id: report.artifact_id.clone(),
            artifact_type: report.artifact_type.clone(),
            success: report.success,
        },
    );
    Ok(report)
}

fn run_package_artifact(
    artifact: &PackageArtifact,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
) -> Result<bool> {
    let request = select_install_request(&artifact.install, platform)?;
    let resolved = resolve_install_request(request, variables, platform, defaults, options)?;
    let plan = create_package_plan(&resolved)?;
    let execution = execute_plan_with_observer(
        plan,
        platform,
        &ExecuteOptions {
            dry_run: resolved.dry_run,
            sudo: resolved.sudo,
            verbose: resolved.verbose,
            execution_context: Some(execution_context.clone()),
        },
        observer,
    )?;
    Ok(execution.success)
}

fn run_git_artifact(
    artifact: &GitArtifact,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
) -> Result<bool> {
    let destination = render_template(&artifact.destination, variables);
    let repository = render_template(&artifact.repository, variables);
    let reference = render_optional(&artifact.reference, variables);
    let mut commands = Vec::new();

    let strategy = artifact
        .strategy
        .clone()
        .unwrap_or(crate::manifest::GitStrategy::CloneOrPull);

    match strategy {
        crate::manifest::GitStrategy::CloneOrPull => {
            commands.push(build_git_sync_command(platform, &repository, &destination));
        }
        crate::manifest::GitStrategy::CloneOnly => {
            commands.push(simple_shell_command(
                "git-clone",
                &format!("git clone \"{repository}\" \"{destination}\""),
            ));
        }
        crate::manifest::GitStrategy::PullOnly => {
            commands.push(simple_shell_command(
                "git-pull",
                &format!("git -C \"{destination}\" pull --ff-only"),
            ));
        }
    }

    if let Some(reference) = reference {
        commands.push(simple_shell_command(
            "git-checkout",
            &format!("git -C \"{destination}\" checkout \"{reference}\""),
        ));
    }
    if artifact.submodules.unwrap_or(false) {
        commands.push(simple_shell_command(
            "git-submodules",
            &format!("git -C \"{destination}\" submodule update --init --recursive"),
        ));
    }
    if artifact.lfs.unwrap_or(false) {
        commands.push(simple_shell_command(
            "git-lfs",
            &format!("git -C \"{destination}\" lfs pull"),
        ));
    }
    commands.extend(artifact.build.clone());
    let report = run_stage(
        "gitArtifact",
        &commands,
        variables,
        platform,
        defaults,
        options,
        observer,
        execution_context,
    )?;
    Ok(report.success)
}

fn run_huggingface_artifact(
    artifact: &HuggingFaceArtifact,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
) -> Result<bool> {
    let destination = render_template(&artifact.destination, variables);
    let repo_id = render_template(&artifact.repo_id, variables);
    let revision = render_optional(&artifact.revision, variables);
    let command = match artifact
        .method
        .clone()
        .unwrap_or(crate::manifest::HuggingFaceMethod::HuggingfaceCli)
    {
        crate::manifest::HuggingFaceMethod::GitLfs => {
            let mut run = format!("git clone https://huggingface.co/{repo_id} \"{destination}\"");
            if let Some(revision) = revision {
                run.push_str(&format!(
                    " && git -C \"{destination}\" checkout \"{revision}\""
                ));
            }
            simple_shell_command("huggingface-git-lfs", &run)
        }
        crate::manifest::HuggingFaceMethod::HuggingfaceCli => {
            let mut run = format!("huggingface-cli download {repo_id}");
            if let Some(revision) = revision {
                run.push_str(&format!(" --revision \"{revision}\""));
            }
            run.push_str(&format!(" --local-dir \"{destination}\""));
            for pattern in &artifact.include {
                run.push_str(&format!(
                    " --include \"{}\"",
                    render_template(pattern, variables)
                ));
            }
            for pattern in &artifact.exclude {
                run.push_str(&format!(
                    " --exclude \"{}\"",
                    render_template(pattern, variables)
                ));
            }
            simple_shell_command("huggingface-cli", &run)
        }
    };
    let report = run_stage(
        "huggingfaceArtifact",
        &[command],
        variables,
        platform,
        defaults,
        options,
        observer,
        execution_context,
    )?;
    Ok(report.success)
}

fn run_source_artifact(
    artifact: &SourceArtifact,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
    observer: Option<&ProgressObserver<'_>>,
    execution_context: &ExecutionContext,
) -> Result<bool> {
    let SourceInstallSpec {
        repository,
        archive,
        destination,
        reference,
        fetch,
        prepare,
        build,
        install,
    } = &artifact.source;

    let destination = render_template(destination, variables);
    let mut commands = Vec::new();

    if let Some(repository) = repository {
        commands.push(build_git_sync_command(
            platform,
            &render_template(repository, variables),
            &destination,
        ));
        if let Some(reference) = reference {
            commands.push(simple_shell_command(
                "source-checkout",
                &format!(
                    "git -C \"{destination}\" checkout \"{}\"",
                    render_template(reference, variables)
                ),
            ));
        }
    }
    if let Some(archive) = archive {
        commands.push(simple_shell_command(
            "source-fetch-archive",
            &format!(
                "mkdir -p \"{destination}\" && cd \"{destination}\" && curl -L \"{}\" | tar -xz --strip-components=1",
                render_template(archive, variables)
            ),
        ));
    }

    commands.extend(fetch.clone());
    commands.extend(prepare.clone());
    commands.extend(build.clone());
    commands.extend(install.clone());

    let report = run_stage(
        "sourceArtifact",
        &commands,
        variables,
        platform,
        defaults,
        options,
        observer,
        execution_context,
    )?;
    Ok(report.success)
}

fn artifact_descriptor(artifact: &ManifestArtifact) -> (&ArtifactBase, &'static str) {
    match artifact {
        ManifestArtifact::Package(spec) => (&spec.base, "package"),
        ManifestArtifact::Git(spec) => (&spec.base, "git"),
        ManifestArtifact::Huggingface(spec) => (&spec.base, "huggingface"),
        ManifestArtifact::Command(spec) => (&spec.base, "command"),
        ManifestArtifact::Source(spec) => (&spec.base, "source"),
    }
}

fn render_commands(
    commands: &[ManifestCommand],
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
) -> Vec<InstallStep> {
    commands
        .iter()
        .filter(|command| condition_matches(command.when.as_ref(), variables, platform))
        .enumerate()
        .map(|(index, command)| InstallStep {
            id: command
                .id
                .clone()
                .unwrap_or_else(|| format!("command-{}", index + 1)),
            description: command
                .description
                .clone()
                .unwrap_or_else(|| command.run.clone()),
            command: render_template(&command.run, variables),
            args: Vec::new(),
            shell: true,
            shell_kind: match command.shell.clone().unwrap_or(ManifestShell::Auto) {
                ManifestShell::Auto => None,
                ManifestShell::Bash => Some(ShellKind::Bash),
                ManifestShell::Powershell => Some(ShellKind::Powershell),
                ManifestShell::Cmd => Some(ShellKind::Cmd),
            },
            requires_elevation: command.elevated.unwrap_or(defaults.sudo.unwrap_or(false)),
            working_directory: command
                .cwd
                .as_ref()
                .map(|value| render_template(value, variables))
                .or_else(|| defaults.cwd.clone()),
            env: merge_env(&defaults.env, &command.env, variables),
            continue_on_error: command
                .continue_on_error
                .unwrap_or(defaults.continue_on_error.unwrap_or(false)),
            timeout_ms: command.timeout_ms.or(defaults.timeout_ms),
        })
        .collect()
}

fn merge_env(
    defaults: &BTreeMap<String, String>,
    command_env: &BTreeMap<String, String>,
    variables: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    for (key, value) in defaults {
        env.insert(key.clone(), render_template(value, variables));
    }
    for (key, value) in command_env {
        env.insert(key.clone(), render_template(value, variables));
    }
    env
}

fn condition_matches(
    condition: Option<&ManifestCondition>,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
) -> bool {
    let Some(condition) = condition else {
        return true;
    };
    if !condition.platforms.is_empty() && !condition.platforms.contains(&platform) {
        return false;
    }
    for (name, expected) in &condition.env {
        let actual = env::var(render_template(name, variables)).unwrap_or_default();
        if actual != render_template(expected, variables) {
            return false;
        }
    }
    if let Some(command) = &condition.command_exists
        && which::which(render_template(command, variables)).is_err()
    {
        return false;
    }
    if let Some(path) = &condition.file_exists
        && !Path::new(&render_template(path, variables)).exists()
    {
        return false;
    }
    true
}

fn select_install_request(
    install: &PackageInstall,
    platform: SupportedPlatform,
) -> Result<&InstallRequest> {
    match install {
        PackageInstall::Single(request) => Ok(request),
        PackageInstall::ByPlatform(map) => map
            .by_platform
            .get(platform.as_str())
            .or(map.fallback.as_ref())
            .ok_or_else(|| {
                HubError::message(
                    "INSTALL_REQUEST_MISSING",
                    format!(
                        "no package install request for platform {}",
                        platform.as_str()
                    ),
                )
            }),
    }
}

fn resolve_install_request(
    request: &InstallRequest,
    variables: &BTreeMap<String, String>,
    platform: SupportedPlatform,
    defaults: &crate::manifest::ManifestDefaults,
    options: &ApplyManifestOptions,
) -> Result<ResolvedInstallRequest> {
    let source = render_template(&request.source, variables);
    let source_ref = resolve_source_reference(&source)?;
    let format = detect_package_format(&source, &source_ref, request.format)?;
    let resolved_source_ref = if matches!(&source_ref, SourceReference::File { path } if is_remote_http_file(path))
        && !request.dry_run.unwrap_or(options.dry_run)
        && format != PackageFormat::Manager
    {
        let installer_home = options
            .installer_home
            .clone()
            .or_else(|| variables.get("hub_installer_home").cloned())
            .unwrap_or_else(default_installer_home);
        SourceReference::File {
            path: download_remote_file(
                &source,
                request
                    .download_cache_dir
                    .clone()
                    .or_else(|| options.variables.get("hub_download_cache_dir").cloned())
                    .or_else(|| Some(default_package_cache_dir(&installer_home))),
                request.download_timeout_ms,
                request.source_checksum.as_deref(),
            )?,
        }
    } else {
        source_ref
    };

    Ok(ResolvedInstallRequest {
        source,
        source_checksum: request.source_checksum.clone(),
        platform: request.platform.unwrap_or(platform),
        format,
        source_ref: resolved_source_ref,
        installer_args: request
            .installer_args
            .iter()
            .map(|value| render_template(value, variables))
            .collect(),
        manager_args: request
            .manager_args
            .iter()
            .map(|value| render_template(value, variables))
            .collect(),
        archive_entry: render_optional(&request.archive_entry, variables),
        archive_command: render_optional(&request.archive_command, variables),
        dry_run: request.dry_run.unwrap_or(options.dry_run),
        verbose: request.verbose.unwrap_or(options.verbose),
        sudo: request
            .sudo
            .unwrap_or(options.sudo || defaults.sudo.unwrap_or(false)),
        cwd: request
            .cwd
            .as_ref()
            .map(|value| render_template(value, variables))
            .or_else(|| defaults.cwd.clone()),
        timeout_ms: request
            .timeout_ms
            .or(options.timeout_ms)
            .or(defaults.timeout_ms),
        download_cache_dir: request.download_cache_dir.clone(),
        download_timeout_ms: request.download_timeout_ms,
        android_device_id: request.android_device_id.clone(),
        ios_device_id: request.ios_device_id.clone(),
        ios_simulator: request.ios_simulator.unwrap_or(false),
        progress: request.progress.unwrap_or(options.progress),
    })
}

fn create_package_plan(request: &ResolvedInstallRequest) -> Result<InstallPlan> {
    let steps = match request.platform {
        SupportedPlatform::Windows => create_windows_steps(request)?,
        SupportedPlatform::Macos => create_macos_steps(request)?,
        SupportedPlatform::Ubuntu => create_ubuntu_steps(request)?,
        SupportedPlatform::Android => create_android_steps(request)?,
        SupportedPlatform::Ios => create_ios_steps(request)?,
    };
    Ok(InstallPlan {
        request: InstallRequestSummary {
            source: request.source.clone(),
            platform: request.platform,
            format: request.format,
        },
        steps,
        notes: install_notes(request.platform),
        guidance: prerequisite_guidance(request.platform, request.format),
    })
}

fn create_windows_steps(request: &ResolvedInstallRequest) -> Result<Vec<InstallStep>> {
    Ok(match request.format {
        PackageFormat::Manager => {
            let (manager, package_name) = ensure_manager_source(
                &request.source_ref,
                &[PackageManager::Winget, PackageManager::Choco],
            )?;
            let (command, args) = match manager {
                PackageManager::Winget => (
                    "winget".to_owned(),
                    [
                        vec![
                            "install".to_owned(),
                            "--id".to_owned(),
                            package_name,
                            "--accept-package-agreements".to_owned(),
                            "--accept-source-agreements".to_owned(),
                        ],
                        request.manager_args.clone(),
                    ]
                    .concat(),
                ),
                PackageManager::Choco => (
                    "choco".to_owned(),
                    [
                        vec!["install".to_owned(), package_name, "-y".to_owned()],
                        request.manager_args.clone(),
                    ]
                    .concat(),
                ),
                _ => {
                    return Err(HubError::message(
                        "UNSUPPORTED_MANAGER",
                        "unsupported Windows package manager",
                    ));
                }
            };
            vec![step(
                "install-manager",
                "Install package via manager",
                &command,
                args,
                false,
                true,
            )]
        }
        PackageFormat::Exe => vec![step(
            "install-exe",
            "Install EXE package",
            &ensure_file_source(&request.source_ref)?,
            if request.installer_args.is_empty() {
                vec!["/quiet".to_owned(), "/norestart".to_owned()]
            } else {
                request.installer_args.clone()
            },
            false,
            true,
        )],
        PackageFormat::Msi => vec![step(
            "install-msi",
            "Install MSI package",
            "msiexec",
            [
                vec![
                    "/i".to_owned(),
                    ensure_file_source(&request.source_ref)?,
                    "/qn".to_owned(),
                    "/norestart".to_owned(),
                ],
                request.installer_args.clone(),
            ]
            .concat(),
            false,
            true,
        )],
        PackageFormat::Msix => vec![step(
            "install-msix",
            "Install MSIX package",
            &format!(
                "Add-AppxPackage -Path \"{}\"",
                ensure_file_source(&request.source_ref)?
            ),
            Vec::new(),
            true,
            true,
        )],
        PackageFormat::Zip | PackageFormat::Tar => create_archive_steps(request, "windows"),
        other => {
            return Err(HubError::message(
                "UNSUPPORTED_FORMAT",
                format!("unsupported Windows format: {other:?}"),
            ));
        }
    })
}

fn create_macos_steps(request: &ResolvedInstallRequest) -> Result<Vec<InstallStep>> {
    Ok(match request.format {
        PackageFormat::Manager => {
            let (_, package_name) =
                ensure_manager_source(&request.source_ref, &[PackageManager::Brew])?;
            vec![step(
                "install-brew",
                "Install package via Homebrew",
                "brew",
                ["install".to_owned(), package_name].to_vec(),
                false,
                false,
            )]
        }
        PackageFormat::Pkg => vec![step(
            "install-pkg",
            "Install PKG package",
            "installer",
            vec![
                "-pkg".to_owned(),
                ensure_file_source(&request.source_ref)?,
                "-target".to_owned(),
                "/".to_owned(),
            ],
            false,
            true,
        )],
        PackageFormat::Dmg => vec![step(
            "install-dmg",
            "Install DMG package",
            &format!(
                "set -euo pipefail; MOUNT=$(hdiutil attach \"{}\" -nobrowse | awk 'END{{print $3}}'); PKG=$(find \"$MOUNT\" -maxdepth 2 -name \"*.pkg\" -print -quit); APP=$(find \"$MOUNT\" -maxdepth 2 -name \"*.app\" -print -quit); if [ -n \"$PKG\" ]; then installer -pkg \"$PKG\" -target /; elif [ -n \"$APP\" ]; then cp -R \"$APP\" /Applications/; else echo \"No installable package found\" >&2; exit 1; fi; hdiutil detach \"$MOUNT\"",
                ensure_file_source(&request.source_ref)?
            ),
            Vec::new(),
            true,
            true,
        )],
        PackageFormat::Zip | PackageFormat::Tar => create_archive_steps(request, "unix"),
        other => {
            return Err(HubError::message(
                "UNSUPPORTED_FORMAT",
                format!("unsupported macOS format: {other:?}"),
            ));
        }
    })
}

fn create_ubuntu_steps(request: &ResolvedInstallRequest) -> Result<Vec<InstallStep>> {
    Ok(match request.format {
        PackageFormat::Manager => {
            let (manager, package_name) = ensure_manager_source(
                &request.source_ref,
                &[PackageManager::Apt, PackageManager::Snap],
            )?;
            match manager {
                PackageManager::Apt => vec![step(
                    "install-apt",
                    "Install package via apt",
                    "apt-get",
                    ["install".to_owned(), "-y".to_owned(), package_name].to_vec(),
                    false,
                    true,
                )],
                PackageManager::Snap => vec![step(
                    "install-snap",
                    "Install package via snap",
                    "snap",
                    ["install".to_owned(), package_name].to_vec(),
                    false,
                    true,
                )],
                _ => {
                    return Err(HubError::message(
                        "UNSUPPORTED_MANAGER",
                        "unsupported Ubuntu package manager",
                    ));
                }
            }
        }
        PackageFormat::Deb => vec![
            step(
                "install-deb",
                "Install DEB package",
                "dpkg",
                vec!["-i".to_owned(), ensure_file_source(&request.source_ref)?],
                false,
                true,
            ),
            step(
                "fix-dependencies",
                "Fix package dependencies",
                "apt-get",
                vec!["install".to_owned(), "-f".to_owned(), "-y".to_owned()],
                false,
                true,
            ),
        ],
        PackageFormat::Rpm => vec![
            step(
                "apt-update",
                "Refresh package index",
                "apt-get",
                vec!["update".to_owned()],
                false,
                true,
            ),
            step(
                "install-alien",
                "Install alien",
                "apt-get",
                vec!["install".to_owned(), "-y".to_owned(), "alien".to_owned()],
                false,
                true,
            ),
            step(
                "install-rpm",
                "Convert RPM with alien",
                "alien",
                vec!["-i".to_owned(), ensure_file_source(&request.source_ref)?],
                false,
                true,
            ),
        ],
        PackageFormat::Appimage => vec![step(
            "run-appimage",
            "Run AppImage installer",
            &format!(
                "chmod +x \"{0}\" && \"{0}\" {1}",
                ensure_file_source(&request.source_ref)?,
                request.installer_args.join(" ")
            ),
            Vec::new(),
            true,
            false,
        )],
        PackageFormat::Zip | PackageFormat::Tar => create_archive_steps(request, "unix"),
        other => {
            return Err(HubError::message(
                "UNSUPPORTED_FORMAT",
                format!("unsupported Ubuntu format: {other:?}"),
            ));
        }
    })
}

fn create_android_steps(request: &ResolvedInstallRequest) -> Result<Vec<InstallStep>> {
    if request.format != PackageFormat::Apk {
        return Err(HubError::message(
            "UNSUPPORTED_FORMAT",
            "Android currently supports APK installs",
        ));
    }
    let mut args = Vec::new();
    if let Some(device_id) = &request.android_device_id {
        args.extend(["-s".to_owned(), device_id.clone()]);
    }
    args.extend([
        "install".to_owned(),
        "-r".to_owned(),
        ensure_file_source(&request.source_ref)?,
    ]);
    Ok(vec![step(
        "install-apk",
        "Install APK via adb",
        "adb",
        args,
        false,
        false,
    )])
}

fn create_ios_steps(request: &ResolvedInstallRequest) -> Result<Vec<InstallStep>> {
    if request.format != PackageFormat::Ipa {
        return Err(HubError::message(
            "UNSUPPORTED_FORMAT",
            "iOS currently supports IPA installs",
        ));
    }
    let file = ensure_file_source(&request.source_ref)?;
    let command = if request.ios_simulator {
        format!("xcrun simctl install booted \"{file}\"")
    } else if let Some(device_id) = &request.ios_device_id {
        format!("ios-deploy --id {device_id} --bundle \"{file}\"")
    } else {
        format!("ios-deploy --bundle \"{file}\"")
    };
    Ok(vec![step(
        "install-ipa",
        "Install IPA package",
        &command,
        Vec::new(),
        true,
        false,
    )])
}

fn create_archive_steps(request: &ResolvedInstallRequest, shell_family: &str) -> Vec<InstallStep> {
    let file = ensure_file_source(&request.source_ref).unwrap_or_else(|_| request.source.clone());
    let extract_dir = request.cwd.clone().unwrap_or_else(current_dir_string);
    if let Some(custom) = &request.archive_command {
        return vec![step(
            "extract-archive",
            "Extract archive package",
            custom,
            Vec::new(),
            true,
            false,
        )];
    }

    if let Some(entry) = &request.archive_entry {
        let staging_dir = join_path_like(shell_family, &extract_dir, "__hub_archive_stage");
        let extract_command = if shell_family == "windows" {
            format!(
                "$stage = \"{staging_dir}\"; New-Item -ItemType Directory -Force -Path $stage | Out-Null; Expand-Archive -Force \"{file}\" $stage"
            )
        } else {
            match request.format {
                PackageFormat::Zip => format!(
                    "mkdir -p \"{staging_dir}\" && unzip -o \"{file}\" \"{entry}\" -d \"{staging_dir}\""
                ),
                _ => format!(
                    "mkdir -p \"{staging_dir}\" && tar -xf \"{file}\" -C \"{staging_dir}\" \"{entry}\""
                ),
            }
        };
        let install_command = if shell_family == "windows" {
            format!(
                "$source = Join-Path \"{staging_dir}\" \"{entry}\"; New-Item -ItemType Directory -Force -Path \"{extract_dir}\" | Out-Null; Copy-Item -Path $source -Destination \"{extract_dir}\" -Recurse -Force"
            )
        } else {
            format!(
                "mkdir -p \"{extract_dir}\" && cp -R \"{staging_dir}/{entry}\" \"{extract_dir}\""
            )
        };
        return vec![
            step(
                "extract-archive-entry",
                "Extract requested archive entry",
                &extract_command,
                Vec::new(),
                true,
                false,
            ),
            step(
                "install-archive-entry",
                "Install extracted archive entry",
                &install_command,
                Vec::new(),
                true,
                false,
            ),
        ];
    }

    let command = if shell_family == "windows" {
        format!("Expand-Archive -Force \"{file}\" \"{extract_dir}\"")
    } else {
        match request.format {
            PackageFormat::Zip => {
                format!("mkdir -p \"{extract_dir}\" && unzip -o \"{file}\" -d \"{extract_dir}\"")
            }
            _ => format!("mkdir -p \"{extract_dir}\" && tar -xf \"{file}\" -C \"{extract_dir}\""),
        }
    };
    vec![step(
        "extract-archive",
        "Extract archive package",
        &command,
        Vec::new(),
        true,
        false,
    )]
}

fn resolve_source_reference(source: &str) -> Result<SourceReference> {
    if let Some((scheme, rest)) = source.split_once("://") {
        let manager = match scheme {
            "winget" => Some(PackageManager::Winget),
            "choco" => Some(PackageManager::Choco),
            "brew" => Some(PackageManager::Brew),
            "apt" => Some(PackageManager::Apt),
            "snap" => Some(PackageManager::Snap),
            "http" | "https" => None,
            _ => None,
        };
        if let Some(manager) = manager {
            return Ok(SourceReference::Manager {
                manager,
                package_name: rest.to_owned(),
            });
        }
    }
    Ok(SourceReference::File {
        path: source.to_owned(),
    })
}

fn detect_package_format(
    source: &str,
    source_ref: &SourceReference,
    explicit: Option<PackageFormat>,
) -> Result<PackageFormat> {
    if let Some(explicit) = explicit {
        return Ok(explicit);
    }
    if matches!(source_ref, SourceReference::Manager { .. }) {
        return Ok(PackageFormat::Manager);
    }
    let lower = source.to_lowercase();
    let format = if lower.ends_with(".exe") {
        PackageFormat::Exe
    } else if lower.ends_with(".msi") {
        PackageFormat::Msi
    } else if lower.ends_with(".msix") {
        PackageFormat::Msix
    } else if lower.ends_with(".pkg") {
        PackageFormat::Pkg
    } else if lower.ends_with(".dmg") {
        PackageFormat::Dmg
    } else if lower.ends_with(".deb") {
        PackageFormat::Deb
    } else if lower.ends_with(".rpm") {
        PackageFormat::Rpm
    } else if lower.ends_with(".appimage") {
        PackageFormat::Appimage
    } else if lower.ends_with(".apk") {
        PackageFormat::Apk
    } else if lower.ends_with(".ipa") {
        PackageFormat::Ipa
    } else if lower.ends_with(".zip") {
        PackageFormat::Zip
    } else if lower.ends_with(".tar") || lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        PackageFormat::Tar
    } else {
        return Err(HubError::message(
            "UNKNOWN_FORMAT",
            format!("could not detect package format from source {source}"),
        ));
    };
    Ok(format)
}

fn is_remote_http_file(path: &str) -> bool {
    path.starts_with("http://") || path.starts_with("https://")
}

fn download_remote_file(
    source: &str,
    cache_dir: Option<String>,
    _timeout_ms: Option<u64>,
    checksum: Option<&str>,
) -> Result<String> {
    let response = reqwest::blocking::get(source)?.error_for_status()?;
    let bytes = response.bytes()?;
    if let Some(checksum) = checksum {
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if digest != normalize_sha256_checksum(checksum)? {
            return Err(HubError::message(
                "CHECKSUM_MISMATCH",
                format!("expected sha256 {checksum}, got {digest}"),
            ));
        }
    }
    let cache_root = cache_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default_package_cache_dir(&default_installer_home())));
    fs::create_dir_all(&cache_root)?;
    let filename = build_cached_filename(source);
    let path = cache_root.join(filename);
    fs::write(&path, &bytes)?;
    Ok(path.display().to_string())
}

fn install_notes(platform: SupportedPlatform) -> Vec<String> {
    match platform {
        SupportedPlatform::Windows => {
            vec!["Windows package installs often require Administrator privileges.".to_owned()]
        }
        SupportedPlatform::Macos => {
            vec!["macOS package installs may require sudo or Full Disk Access.".to_owned()]
        }
        SupportedPlatform::Ubuntu => {
            vec!["Ubuntu package installs typically require sudo privileges.".to_owned()]
        }
        SupportedPlatform::Android => {
            vec!["Android installs require adb connectivity and developer mode enabled.".to_owned()]
        }
        SupportedPlatform::Ios => {
            vec!["iOS installs require Xcode tooling or ios-deploy on macOS.".to_owned()]
        }
    }
}

fn prerequisite_guidance(platform: SupportedPlatform, format: PackageFormat) -> Vec<String> {
    let mut guidance = Vec::new();
    match platform {
        SupportedPlatform::Windows => {
            guidance.push(
                "Recommended prerequisites: winget, PowerShell, Administrator terminal.".to_owned(),
            );
        }
        SupportedPlatform::Macos => {
            guidance.push(
                "Recommended prerequisites: Homebrew, Xcode Command Line Tools, sudo access."
                    .to_owned(),
            );
        }
        SupportedPlatform::Ubuntu => {
            guidance.push("Recommended prerequisites: apt, sudo, curl, tar/unzip.".to_owned());
        }
        SupportedPlatform::Android => guidance.push("Required prerequisite: adb.".to_owned()),
        SupportedPlatform::Ios => {
            guidance.push("Required prerequisites: Xcode tools, ios-deploy or simctl.".to_owned())
        }
    }
    if matches!(format, PackageFormat::Tar | PackageFormat::Zip) {
        guidance.push(
            "Archive installs should define archiveCommand when extraction layout is non-standard."
                .to_owned(),
        );
    }
    guidance
}

fn ensure_manager_source(
    source: &SourceReference,
    allowed: &[PackageManager],
) -> Result<(PackageManager, String)> {
    match source {
        SourceReference::Manager {
            manager,
            package_name,
        } if allowed.contains(manager) => Ok((*manager, package_name.clone())),
        SourceReference::Manager { manager, .. } => Err(HubError::message(
            "UNSUPPORTED_MANAGER",
            format!("manager {:?} is not allowed on this platform", manager),
        )),
        _ => Err(HubError::message(
            "INVALID_SOURCE",
            "expected manager source",
        )),
    }
}

fn ensure_file_source(source: &SourceReference) -> Result<String> {
    match source {
        SourceReference::File { path } => Ok(path.clone()),
        _ => Err(HubError::message("INVALID_SOURCE", "expected file source")),
    }
}

fn step(
    id: &str,
    description: &str,
    command: &str,
    args: Vec<String>,
    shell: bool,
    requires_elevation: bool,
) -> InstallStep {
    InstallStep {
        id: id.to_owned(),
        description: description.to_owned(),
        command: command.to_owned(),
        args,
        shell,
        shell_kind: None,
        requires_elevation,
        working_directory: None,
        env: BTreeMap::new(),
        continue_on_error: false,
        timeout_ms: None,
    }
}

fn simple_shell_command(id: &str, run: &str) -> ManifestCommand {
    ManifestCommand {
        id: Some(id.to_owned()),
        description: None,
        run: run.to_owned(),
        shell: None,
        cwd: None,
        env: BTreeMap::new(),
        timeout_ms: None,
        continue_on_error: Some(false),
        elevated: Some(false),
        when: None,
    }
}

fn current_dir_string() -> String {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .display()
        .to_string()
}

fn default_installer_home() -> String {
    let home = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .display()
        .to_string();
    resolve_install_policy(InstallPolicyInput {
        platform: detect_host_platform().unwrap_or(SupportedPlatform::Ubuntu),
        effective_runtime_platform: EffectiveRuntimePlatform::from(
            detect_host_platform().unwrap_or(SupportedPlatform::Ubuntu),
        ),
        software_name: "hub-installer".to_owned(),
        home_dir: home,
        local_data_dir: dirs::data_local_dir().map(|path| path.display().to_string()),
        install_scope: InstallScope::User,
        install_control_level: InstallControlLevel::Managed,
        installer_home_override: None,
        install_root_override: None,
        work_root_override: None,
        bin_dir_override: None,
        data_root_override: None,
    })
    .installer_home
}

fn default_package_cache_dir(installer_home: &str) -> String {
    resolve_default_package_cache_dir(installer_home)
}

fn normalize_sha256_checksum(value: &str) -> Result<String> {
    let normalized = value.trim().to_lowercase();
    let normalized = normalized
        .strip_prefix("sha256:")
        .unwrap_or(&normalized)
        .to_owned();
    if normalized.len() != 64 || !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(HubError::message(
            "INVALID_CHECKSUM",
            format!(
                "invalid checksum \"{value}\". expected 64 hex chars optionally prefixed with sha256:"
            ),
        ));
    }
    Ok(normalized)
}

fn build_cached_filename(source: &str) -> String {
    let hash = format!("{:x}", Sha256::digest(source.as_bytes()));
    let name = source.rsplit('/').next().unwrap_or("download.bin").replace(
        |ch: char| !ch.is_ascii_alphanumeric() && ch != '.' && ch != '_' && ch != '-',
        "_",
    );
    format!("{}-{}", hash.chars().take(16).collect::<String>(), name)
}

fn build_git_sync_command(
    platform: SupportedPlatform,
    repository: &str,
    destination: &str,
) -> ManifestCommand {
    let (run, shell) = match platform {
        SupportedPlatform::Windows => (
            format!(
                "if (Test-Path \"{destination}\\.git\") {{ git -C \"{destination}\" pull --ff-only }} else {{ git clone \"{repository}\" \"{destination}\" }}"
            ),
            Some(ManifestShell::Powershell),
        ),
        _ => (
            format!(
                "if [ -d \"{destination}/.git\" ]; then git -C \"{destination}\" pull --ff-only; else git clone \"{repository}\" \"{destination}\"; fi"
            ),
            Some(ManifestShell::Bash),
        ),
    };

    ManifestCommand {
        id: Some("git-clone-or-pull".to_owned()),
        description: Some("Clone or update repository".to_owned()),
        run,
        shell,
        cwd: None,
        env: BTreeMap::new(),
        timeout_ms: None,
        continue_on_error: Some(false),
        elevated: Some(false),
        when: None,
    }
}

fn join_path_like(shell_family: &str, base: &str, child: &str) -> String {
    let separator = if shell_family == "windows" { '\\' } else { '/' };
    format!(
        "{}{}{}",
        base.trim_end_matches(['\\', '/']),
        separator,
        child.trim_matches(['\\', '/'])
    )
}

fn hinted_software_name(loaded: &LoadedManifest, options: &ApplyManifestOptions) -> Option<String> {
    hinted_manifest_variable(loaded, options, "hub_software_name")
        .filter(|value| !value.trim().is_empty())
}

fn hinted_install_scope(
    loaded: &LoadedManifest,
    options: &ApplyManifestOptions,
) -> Option<InstallScope> {
    match hinted_manifest_variable(loaded, options, "hub_install_scope")
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("system") => Some(InstallScope::System),
        Some("user") => Some(InstallScope::User),
        _ => None,
    }
}

fn hinted_install_control_level(
    loaded: &LoadedManifest,
    options: &ApplyManifestOptions,
) -> Option<InstallControlLevel> {
    match hinted_manifest_variable(loaded, options, "hub_install_control_level")
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("managed") => Some(InstallControlLevel::Managed),
        Some("partial") => Some(InstallControlLevel::Partial),
        Some("opaque") => Some(InstallControlLevel::Opaque),
        _ => None,
    }
}

fn resolve_registry_effective_runtime_platform(
    entry: &crate::registry::SoftwareRegistryEntry,
    platform: SupportedPlatform,
) -> Option<EffectiveRuntimePlatform> {
    if entry.name.eq_ignore_ascii_case("codex") && platform == SupportedPlatform::Windows {
        Some(EffectiveRuntimePlatform::Wsl)
    } else {
        None
    }
}

fn parse_effective_runtime_platform_option(
    value: Option<&str>,
) -> Result<Option<EffectiveRuntimePlatform>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    Ok(Some(match value.to_ascii_lowercase().as_str() {
        "windows" => EffectiveRuntimePlatform::Windows,
        "macos" => EffectiveRuntimePlatform::Macos,
        "ubuntu" => EffectiveRuntimePlatform::Ubuntu,
        "android" => EffectiveRuntimePlatform::Android,
        "ios" => EffectiveRuntimePlatform::Ios,
        "wsl" => EffectiveRuntimePlatform::Wsl,
        other => {
            return Err(HubError::message(
                "INVALID_RUNTIME_PLATFORM",
                format!("unsupported effective runtime platform {other}"),
            ));
        }
    }))
}

fn parse_container_runtime_option(
    value: Option<&str>,
) -> Result<Option<ContainerRuntimePreference>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    Ok(Some(match value.to_ascii_lowercase().as_str() {
        "auto" => ContainerRuntimePreference::Auto,
        "host" => ContainerRuntimePreference::Host,
        "wsl" => ContainerRuntimePreference::Wsl,
        other => {
            return Err(HubError::message(
                "INVALID_CONTAINER_RUNTIME",
                format!("unsupported container runtime {other}"),
            ));
        }
    }))
}

fn hinted_manifest_variable(
    loaded: &LoadedManifest,
    options: &ApplyManifestOptions,
    key: &str,
) -> Option<String> {
    options
        .variables
        .get(key)
        .cloned()
        .or_else(|| loaded.manifest.variables.get(key).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_manager_source() {
        let source = resolve_source_reference("brew://wget").unwrap();
        assert!(matches!(
            source,
            SourceReference::Manager {
                manager: PackageManager::Brew,
                package_name
            } if package_name == "wget"
        ));
    }

    #[test]
    fn renders_manifest_template_variables() {
        let manifest: HubInstallManifest = serde_yaml::from_str(
            r#"
schemaVersion: "1.0"
metadata:
  name: demo
variables:
  demo_root: "{{home}}/demo"
artifacts:
  - id: echo
    type: command
    commands:
      - run: echo "{{demo_root}}"
"#,
        )
        .unwrap();
        let runtime = RuntimeContext {
            platform: SupportedPlatform::Ubuntu,
            host_platform: SupportedPlatform::Ubuntu,
            effective_runtime_platform: EffectiveRuntimePlatform::Ubuntu,
            manifest_dir: "/tmp".to_owned(),
            cwd: "/work".to_owned(),
            home: "/home/test".to_owned(),
            temp: "/tmp".to_owned(),
            user: "tester".to_owned(),
            path_separator: "/".to_owned(),
            software_name: Some("demo".to_owned()),
            installer_home: None,
            install_scope: None,
            install_root: None,
            work_root: None,
            bin_dir: None,
            data_root: None,
            install_control_level: None,
            container_runtime: None,
            wsl_distribution: None,
            docker_context: None,
            docker_host: None,
            backup_root: None,
            backup_session_dir: None,
            backup_data_dir: None,
            backup_install_dir: None,
            backup_work_dir: None,
            install_record_file: None,
            install_status: None,
        };
        let merged = merge_variables(&manifest, &runtime, &BTreeMap::new());
        assert_eq!(merged.get("demo_root").unwrap(), "/home/test/demo");
    }

    #[test]
    fn normalizes_sha256_checksum_prefix() {
        let normalized = normalize_sha256_checksum(
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )
        .unwrap();
        assert_eq!(
            normalized,
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        );
    }

    #[test]
    fn default_download_cache_uses_installer_home() {
        let cache_dir = default_package_cache_dir("C:\\Users\\tester\\.sdkwork\\hub-installer");
        assert_eq!(
            cache_dir,
            "C:\\Users\\tester\\.sdkwork\\hub-installer\\cache\\packages"
        );
    }

    #[test]
    fn windows_git_sync_command_uses_powershell_conditionals() {
        let command = build_git_sync_command(
            SupportedPlatform::Windows,
            "https://example.com/demo.git",
            "C:\\tools\\demo",
        );

        assert_eq!(
            command.shell,
            Some(crate::manifest::ManifestShell::Powershell)
        );
        assert!(command.run.contains("Test-Path"));
        assert!(command.run.contains("git clone"));
    }

    #[test]
    fn archive_entry_is_honored_for_unix_archives() {
        let request = ResolvedInstallRequest {
            source: "/tmp/demo.tar.gz".to_owned(),
            source_checksum: None,
            platform: SupportedPlatform::Ubuntu,
            format: PackageFormat::Tar,
            source_ref: SourceReference::File {
                path: "/tmp/demo.tar.gz".to_owned(),
            },
            installer_args: Vec::new(),
            manager_args: Vec::new(),
            archive_entry: Some("dist/demo".to_owned()),
            archive_command: None,
            dry_run: true,
            verbose: false,
            sudo: false,
            cwd: Some("/opt/demo".to_owned()),
            timeout_ms: None,
            download_cache_dir: None,
            download_timeout_ms: None,
            android_device_id: None,
            ios_device_id: None,
            ios_simulator: false,
            progress: false,
        };

        let steps = create_archive_steps(&request, "unix");
        assert_eq!(steps.len(), 2);
        assert!(steps[0].command.contains("dist/demo"));
        assert!(steps[1].command.contains("/opt/demo"));
    }

    #[test]
    fn render_commands_preserves_explicit_shell_kind() {
        let commands = render_commands(
            &[ManifestCommand {
                id: Some("cmd".to_owned()),
                description: Some("cmd".to_owned()),
                run: "echo hello".to_owned(),
                shell: Some(ManifestShell::Cmd),
                cwd: None,
                env: BTreeMap::new(),
                timeout_ms: None,
                continue_on_error: Some(false),
                elevated: Some(false),
                when: None,
            }],
            &BTreeMap::new(),
            SupportedPlatform::Windows,
            &crate::manifest::ManifestDefaults::default(),
        );

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].shell_kind, Some(crate::types::ShellKind::Cmd));
    }
}
