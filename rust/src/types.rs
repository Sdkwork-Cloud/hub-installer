use clap::ValueEnum;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum SupportedPlatform {
    Windows,
    Macos,
    Ubuntu,
    Android,
    Ios,
}

impl SupportedPlatform {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Macos => "macos",
            Self::Ubuntu => "ubuntu",
            Self::Android => "android",
            Self::Ios => "ios",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum EffectiveRuntimePlatform {
    Windows,
    Macos,
    Ubuntu,
    Android,
    Ios,
    Wsl,
}

impl EffectiveRuntimePlatform {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Macos => "macos",
            Self::Ubuntu => "ubuntu",
            Self::Android => "android",
            Self::Ios => "ios",
            Self::Wsl => "wsl",
        }
    }
}

impl From<SupportedPlatform> for EffectiveRuntimePlatform {
    fn from(value: SupportedPlatform) -> Self {
        match value {
            SupportedPlatform::Windows => Self::Windows,
            SupportedPlatform::Macos => Self::Macos,
            SupportedPlatform::Ubuntu => Self::Ubuntu,
            SupportedPlatform::Android => Self::Android,
            SupportedPlatform::Ios => Self::Ios,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum ContainerRuntimePreference {
    Auto,
    Host,
    Wsl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerRuntime {
    Host,
    Wsl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageFormat {
    Exe,
    Msi,
    Msix,
    Pkg,
    Dmg,
    Deb,
    Rpm,
    Appimage,
    Apk,
    Ipa,
    Zip,
    Tar,
    Manager,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Winget,
    Choco,
    Brew,
    Apt,
    Snap,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum InstallScope {
    System,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum InstallControlLevel {
    Managed,
    Partial,
    Opaque,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellKind {
    Bash,
    Powershell,
    Cmd,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceReference {
    File {
        path: String,
    },
    Manager {
        manager: PackageManager,
        package_name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub source: String,
    #[serde(default)]
    pub source_checksum: Option<String>,
    #[serde(default)]
    pub platform: Option<SupportedPlatform>,
    #[serde(default)]
    pub format: Option<PackageFormat>,
    #[serde(default)]
    pub installer_args: Vec<String>,
    #[serde(default)]
    pub manager_args: Vec<String>,
    #[serde(default)]
    pub archive_entry: Option<String>,
    #[serde(default)]
    pub archive_command: Option<String>,
    #[serde(default)]
    pub dry_run: Option<bool>,
    #[serde(default)]
    pub verbose: Option<bool>,
    #[serde(default)]
    pub sudo: Option<bool>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub download_cache_dir: Option<String>,
    #[serde(default)]
    pub download_timeout_ms: Option<u64>,
    #[serde(default)]
    pub android_device_id: Option<String>,
    #[serde(default)]
    pub ios_device_id: Option<String>,
    #[serde(default)]
    pub ios_simulator: Option<bool>,
    #[serde(default)]
    pub progress: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ResolvedInstallRequest {
    pub source: String,
    pub source_checksum: Option<String>,
    pub platform: SupportedPlatform,
    pub format: PackageFormat,
    pub source_ref: SourceReference,
    pub installer_args: Vec<String>,
    pub manager_args: Vec<String>,
    pub archive_entry: Option<String>,
    pub archive_command: Option<String>,
    pub dry_run: bool,
    pub verbose: bool,
    pub sudo: bool,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub download_cache_dir: Option<String>,
    pub download_timeout_ms: Option<u64>,
    pub android_device_id: Option<String>,
    pub ios_device_id: Option<String>,
    pub ios_simulator: bool,
    pub progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallStep {
    pub id: String,
    pub description: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub shell: bool,
    #[serde(default)]
    pub shell_kind: Option<ShellKind>,
    #[serde(default)]
    pub requires_elevation: bool,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub continue_on_error: bool,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallPlan {
    pub request: InstallRequestSummary,
    pub steps: Vec<InstallStep>,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub guidance: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallRequestSummary {
    pub source: String,
    pub platform: SupportedPlatform,
    pub format: PackageFormat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepExecutionResult {
    pub step: InstallStep,
    pub command_line: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: u128,
    pub exit_code: Option<i32>,
    pub success: bool,
    #[serde(default)]
    pub stdout: String,
    #[serde(default)]
    pub stderr: String,
    #[serde(default)]
    pub skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallExecutionResult {
    pub plan: InstallPlan,
    pub success: bool,
    pub steps: Vec<StepExecutionResult>,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: u128,
}
