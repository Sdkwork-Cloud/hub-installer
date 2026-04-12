pub mod cli;
pub mod engine;
pub mod error;
pub mod executor;
pub mod manifest;
pub mod platform;
pub mod policy;
pub mod progress;
pub mod registry;
pub mod runtime;
pub mod state;
pub mod template;
pub mod types;

pub use crate::engine::{
    ApplyManifestOptions, ApplyManifestResult, BackupManifestOptions, BackupManifestResult,
    BackupTarget, BackupTargetReport, DependencyInstallOptions, DependencyInstallReport,
    DependencyInstallResult, InstallAssessmentCommand, InstallAssessmentDependency,
    InstallAssessmentIssue, InstallAssessmentResult, InstallAssessmentRuntime, InstallEngine,
    RegistryBackupOptions, RegistryBackupResult, RegistryDependencyInstallOptions,
    RegistryDependencyInstallResult, RegistryInstallAssessmentResult, RegistryInstallOptions,
    RegistryInstallResult, RegistryUninstallOptions, RegistryUninstallResult,
    UninstallManifestOptions, UninstallManifestResult, UninstallTargetReport,
};
pub use crate::error::{HubError, Result};
pub use crate::manifest::{
    HubInstallManifest, LoadedManifest, ManifestDataItem, ManifestDataLayoutDescriptor,
    ManifestInstallationDescriptor, ManifestInstallationDirectories, ManifestInstallationDirectory,
    ManifestInstallationMethod, ManifestMigrationDescriptor, ManifestMigrationStrategy,
};
pub use crate::policy::{InstallPolicyInput, ResolvedInstallPolicy, resolve_install_policy};
pub use crate::progress::{ProgressEvent, ProgressObserver, ProgressStream};
pub use crate::registry::{LoadedSoftwareRegistry, SoftwareRegistry};
pub use crate::runtime::{
    ExecutionContext, RuntimeOptions, RuntimeProbe, SystemRuntimeProbe, resolve_execution_context,
    resolve_host_path_for_runtime,
};
pub use crate::state::{
    InstallRecord, InstallRecordStatus, read_install_record, resolve_backup_root_dir,
    resolve_backup_session_dir, resolve_install_record_file, write_install_record,
};
