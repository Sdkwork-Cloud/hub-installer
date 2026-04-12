use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::{
    error::{HubError, Result},
    template::render_template,
    types::{
        ContainerRuntime, EffectiveRuntimePlatform, InstallControlLevel, InstallRequest,
        InstallScope, SupportedPlatform,
    },
};

pub const MANIFEST_SCHEMA_VERSION: &str = "1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCondition {
    #[serde(default)]
    pub platforms: Vec<SupportedPlatform>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub command_exists: Option<String>,
    #[serde(default)]
    pub file_exists: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCommand {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub run: String,
    #[serde(default)]
    pub shell: Option<ManifestShell>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub continue_on_error: Option<bool>,
    #[serde(default)]
    pub elevated: Option<bool>,
    #[serde(default)]
    pub when: Option<ManifestCondition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManifestShell {
    Auto,
    Bash,
    Powershell,
    Cmd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum DependencyCheck {
    Command {
        name: String,
    },
    File {
        path: String,
    },
    Env {
        name: String,
        #[serde(default)]
        equals: Option<String>,
    },
    Platform {
        platforms: Vec<SupportedPlatform>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDependency {
    pub id: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: Option<bool>,
    pub check: DependencyCheck,
    #[serde(default)]
    pub install: Vec<ManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactBase {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub when: Option<ManifestCondition>,
    #[serde(default)]
    pub pre_install: Vec<ManifestCommand>,
    #[serde(default)]
    pub post_install: Vec<ManifestCommand>,
    #[serde(default)]
    pub configure: Vec<ManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInstallByPlatform {
    pub by_platform: BTreeMap<String, InstallRequest>,
    #[serde(default)]
    pub fallback: Option<InstallRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageArtifact {
    #[serde(flatten)]
    pub base: ArtifactBase,
    pub install: PackageInstall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PackageInstall {
    Single(InstallRequest),
    ByPlatform(PackageInstallByPlatform),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitArtifact {
    #[serde(flatten)]
    pub base: ArtifactBase,
    pub repository: String,
    pub destination: String,
    #[serde(default)]
    pub reference: Option<String>,
    #[serde(default)]
    pub clone_depth: Option<u32>,
    #[serde(default)]
    pub strategy: Option<GitStrategy>,
    #[serde(default)]
    pub submodules: Option<bool>,
    #[serde(default)]
    pub lfs: Option<bool>,
    #[serde(default)]
    pub build: Vec<ManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitStrategy {
    CloneOrPull,
    CloneOnly,
    PullOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuggingFaceArtifact {
    #[serde(flatten)]
    pub base: ArtifactBase,
    pub repo_id: String,
    pub destination: String,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default)]
    pub method: Option<HuggingFaceMethod>,
    #[serde(default)]
    pub token_env: Option<String>,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HuggingFaceMethod {
    GitLfs,
    HuggingfaceCli,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandArtifact {
    #[serde(flatten)]
    pub base: ArtifactBase,
    pub commands: Vec<ManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceArtifact {
    #[serde(flatten)]
    pub base: ArtifactBase,
    pub source: SourceInstallSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInstallSpec {
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub archive: Option<String>,
    pub destination: String,
    #[serde(default)]
    pub reference: Option<String>,
    #[serde(default)]
    pub fetch: Vec<ManifestCommand>,
    #[serde(default)]
    pub prepare: Vec<ManifestCommand>,
    #[serde(default)]
    pub build: Vec<ManifestCommand>,
    #[serde(default)]
    pub install: Vec<ManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ManifestArtifact {
    Package(PackageArtifact),
    Git(GitArtifact),
    Huggingface(HuggingFaceArtifact),
    Command(CommandArtifact),
    Source(SourceArtifact),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDefaults {
    #[serde(default)]
    pub sudo: Option<bool>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub continue_on_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMetadata {
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub maintainers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInstallationMethod {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub summary: String,
    #[serde(default)]
    pub supported: Option<bool>,
    #[serde(default)]
    pub documentation_url: Option<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInstallationDirectory {
    #[serde(default)]
    pub id: Option<String>,
    pub path: String,
    #[serde(default)]
    pub customizable: Option<bool>,
    #[serde(default)]
    pub purpose: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInstallationDirectories {
    #[serde(default)]
    pub install_root: Option<ManifestInstallationDirectory>,
    #[serde(default)]
    pub work_root: Option<ManifestInstallationDirectory>,
    #[serde(default)]
    pub bin_dir: Option<ManifestInstallationDirectory>,
    #[serde(default)]
    pub data_root: Option<ManifestInstallationDirectory>,
    #[serde(default)]
    pub additional: Vec<ManifestInstallationDirectory>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInstallationDescriptor {
    pub method: ManifestInstallationMethod,
    #[serde(default)]
    pub alternatives: Vec<ManifestInstallationMethod>,
    #[serde(default)]
    pub directories: Option<ManifestInstallationDirectories>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDataItem {
    pub id: String,
    pub title: String,
    pub kind: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub includes: Vec<String>,
    #[serde(default)]
    pub sensitive: Option<bool>,
    #[serde(default)]
    pub backup_by_default: Option<bool>,
    #[serde(default)]
    pub uninstall_by_default: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDataLayoutDescriptor {
    #[serde(default)]
    pub items: Vec<ManifestDataItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMigrationStrategy {
    pub id: String,
    pub source: String,
    pub title: String,
    pub mode: String,
    pub summary: String,
    #[serde(default)]
    pub supported: Option<bool>,
    #[serde(default)]
    pub documentation_url: Option<String>,
    #[serde(default)]
    pub preview_commands: Vec<ManifestCommand>,
    #[serde(default)]
    pub apply_commands: Vec<ManifestCommand>,
    #[serde(default)]
    pub data_item_ids: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMigrationDescriptor {
    #[serde(default)]
    pub strategies: Vec<ManifestMigrationStrategy>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestLifecycle {
    #[serde(default)]
    pub preflight: Vec<ManifestCommand>,
    #[serde(default)]
    pub pre_install: Vec<ManifestCommand>,
    #[serde(default)]
    pub install: Vec<ManifestCommand>,
    #[serde(default)]
    pub post_install: Vec<ManifestCommand>,
    #[serde(default)]
    pub configure: Vec<ManifestCommand>,
    #[serde(default)]
    pub healthcheck: Vec<ManifestCommand>,
    #[serde(default)]
    pub backup: Vec<ManifestCommand>,
    #[serde(default)]
    pub uninstall: Vec<ManifestCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubInstallManifest {
    pub schema_version: String,
    pub metadata: ManifestMetadata,
    #[serde(default)]
    pub platforms: Vec<SupportedPlatform>,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    #[serde(default)]
    pub defaults: ManifestDefaults,
    #[serde(default)]
    pub dependencies: Vec<ManifestDependency>,
    #[serde(default)]
    pub lifecycle: ManifestLifecycle,
    #[serde(default)]
    pub installation: Option<ManifestInstallationDescriptor>,
    #[serde(default)]
    pub data_layout: Option<ManifestDataLayoutDescriptor>,
    #[serde(default)]
    pub migration: Option<ManifestMigrationDescriptor>,
    pub artifacts: Vec<ManifestArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedManifest {
    pub manifest: HubInstallManifest,
    pub absolute_path: String,
    pub base_directory: String,
    pub source_input: String,
    pub source_kind: String,
    #[serde(default)]
    pub resolved_from: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeContext {
    pub platform: SupportedPlatform,
    pub host_platform: SupportedPlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub manifest_dir: String,
    pub cwd: String,
    pub home: String,
    pub temp: String,
    pub user: String,
    pub path_separator: String,
    pub software_name: Option<String>,
    pub installer_home: Option<String>,
    pub install_scope: Option<InstallScope>,
    pub install_root: Option<String>,
    pub work_root: Option<String>,
    pub bin_dir: Option<String>,
    pub data_root: Option<String>,
    pub install_control_level: Option<InstallControlLevel>,
    pub container_runtime: Option<ContainerRuntime>,
    pub wsl_distribution: Option<String>,
    pub docker_context: Option<String>,
    pub docker_host: Option<String>,
    pub backup_root: Option<String>,
    pub backup_session_dir: Option<String>,
    pub backup_data_dir: Option<String>,
    pub backup_install_dir: Option<String>,
    pub backup_work_dir: Option<String>,
    pub install_record_file: Option<String>,
    pub install_status: Option<String>,
}

impl RuntimeContext {
    pub fn variables(&self) -> BTreeMap<String, String> {
        let mut values = BTreeMap::from([
            ("platform".to_owned(), self.platform.as_str().to_owned()),
            (
                "hub_host_platform".to_owned(),
                self.host_platform.as_str().to_owned(),
            ),
            (
                "hub_effective_runtime_platform".to_owned(),
                self.effective_runtime_platform.as_str().to_owned(),
            ),
            ("manifestDir".to_owned(), self.manifest_dir.clone()),
            ("cwd".to_owned(), self.cwd.clone()),
            ("home".to_owned(), self.home.clone()),
            ("temp".to_owned(), self.temp.clone()),
            ("user".to_owned(), self.user.clone()),
            ("pathSeparator".to_owned(), self.path_separator.clone()),
        ]);
        if let Some(value) = &self.software_name {
            values.insert("hub_software_name".to_owned(), value.clone());
        }
        if let Some(value) = &self.installer_home {
            values.insert("hub_installer_home".to_owned(), value.clone());
        }
        if let Some(value) = self.install_scope {
            values.insert(
                "hub_install_scope".to_owned(),
                match value {
                    InstallScope::System => "system",
                    InstallScope::User => "user",
                }
                .to_owned(),
            );
        }
        if let Some(value) = &self.install_root {
            values.insert("hub_install_root".to_owned(), value.clone());
        }
        if let Some(value) = &self.work_root {
            values.insert("hub_work_root".to_owned(), value.clone());
        }
        if let Some(value) = &self.bin_dir {
            values.insert("hub_bin_dir".to_owned(), value.clone());
        }
        if let Some(value) = &self.data_root {
            values.insert("hub_data_root".to_owned(), value.clone());
        }
        if let Some(value) = self.install_control_level {
            values.insert(
                "hub_install_control_level".to_owned(),
                match value {
                    InstallControlLevel::Managed => "managed",
                    InstallControlLevel::Partial => "partial",
                    InstallControlLevel::Opaque => "opaque",
                }
                .to_owned(),
            );
        }
        values.insert(
            "hub_container_runtime".to_owned(),
            match self.container_runtime {
                Some(ContainerRuntime::Host) => "host".to_owned(),
                Some(ContainerRuntime::Wsl) => "wsl".to_owned(),
                None => String::new(),
            },
        );
        values.insert(
            "hub_wsl_distribution".to_owned(),
            self.wsl_distribution.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_docker_context".to_owned(),
            self.docker_context.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_docker_host".to_owned(),
            self.docker_host.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_backup_root".to_owned(),
            self.backup_root.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_backup_session_dir".to_owned(),
            self.backup_session_dir.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_backup_data_dir".to_owned(),
            self.backup_data_dir.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_backup_install_dir".to_owned(),
            self.backup_install_dir.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_backup_work_dir".to_owned(),
            self.backup_work_dir.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_install_record_file".to_owned(),
            self.install_record_file.clone().unwrap_or_default(),
        );
        values.insert(
            "hub_install_status".to_owned(),
            self.install_status.clone().unwrap_or_default(),
        );
        values
    }
}

impl HubInstallManifest {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != MANIFEST_SCHEMA_VERSION {
            return Err(HubError::message(
                "INVALID_MANIFEST_VERSION",
                format!(
                    "manifest schemaVersion must be {MANIFEST_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.metadata.name.trim().is_empty() {
            return Err(HubError::message(
                "INVALID_MANIFEST",
                "metadata.name is required",
            ));
        }
        if self.artifacts.is_empty() {
            return Err(HubError::message(
                "INVALID_MANIFEST",
                "manifest must include at least one artifact",
            ));
        }
        Ok(())
    }
}

pub fn load_manifest(source: &str) -> Result<LoadedManifest> {
    if source.starts_with("http://") || source.starts_with("https://") {
        return load_manifest_from_url(source);
    }
    let path = PathBuf::from(source);
    let path = if path.is_dir() {
        resolve_default_manifest(&path)?
    } else {
        path
    };
    let absolute = fs::canonicalize(&path)?;
    let content = fs::read_to_string(&absolute)?;
    let manifest = parse_manifest(&content, &absolute)?;
    Ok(LoadedManifest {
        manifest,
        absolute_path: absolute.display().to_string(),
        base_directory: absolute
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .display()
            .to_string(),
        source_input: source.to_owned(),
        source_kind: "file".to_owned(),
        resolved_from: None,
    })
}

fn load_manifest_from_url(source: &str) -> Result<LoadedManifest> {
    let response = reqwest::blocking::get(source)?.error_for_status()?;
    let body = response.text()?;
    let manifest = parse_manifest(&body, Path::new("remote.hub.yaml"))?;
    let url = Url::parse(source)?;
    let base_directory = url
        .join(".")
        .map(|value| value.to_string())
        .unwrap_or_else(|_| source.to_owned());
    Ok(LoadedManifest {
        manifest,
        absolute_path: source.to_owned(),
        base_directory,
        source_input: source.to_owned(),
        source_kind: "url".to_owned(),
        resolved_from: Some(source.to_owned()),
    })
}

fn resolve_default_manifest(directory: &Path) -> Result<PathBuf> {
    for candidate in [
        "hub-installer.yaml",
        "hub-installer.yml",
        "hub-installer.json",
    ] {
        let path = directory.join(candidate);
        if path.exists() {
            return Ok(path);
        }
    }
    Err(HubError::message(
        "MANIFEST_NOT_FOUND",
        format!("no default manifest file found in {}", directory.display()),
    ))
}

fn parse_manifest(content: &str, path: &Path) -> Result<HubInstallManifest> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let manifest: HubInstallManifest = if extension.eq_ignore_ascii_case("json") {
        serde_json::from_str(content)?
    } else {
        serde_yaml::from_str(content)?
    };
    manifest.validate()?;
    Ok(manifest)
}

pub fn merge_variables(
    manifest: &HubInstallManifest,
    runtime: &RuntimeContext,
    overrides: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut values = runtime.variables();
    for (key, value) in &manifest.variables {
        values.insert(key.clone(), render_template(value, &values));
    }
    for (key, value) in overrides {
        values.insert(key.clone(), render_template(value, &values));
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_context_renders_optional_runtime_variables_as_empty_strings() {
        let runtime = RuntimeContext {
            platform: SupportedPlatform::Windows,
            host_platform: SupportedPlatform::Windows,
            effective_runtime_platform: EffectiveRuntimePlatform::Windows,
            manifest_dir: "C:\\manifests".to_owned(),
            cwd: "C:\\work".to_owned(),
            home: "C:\\Users\\tester".to_owned(),
            temp: "C:\\Temp".to_owned(),
            user: "tester".to_owned(),
            path_separator: "\\".to_owned(),
            software_name: None,
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

        let rendered = render_template(
            "runtime={{hub_container_runtime}} wsl={{hub_wsl_distribution}} context={{hub_docker_context}} host={{hub_docker_host}} backup={{hub_backup_root}} session={{hub_backup_session_dir}} data={{hub_backup_data_dir}} install={{hub_backup_install_dir}} work={{hub_backup_work_dir}} record={{hub_install_record_file}} status={{hub_install_status}}",
            &runtime.variables(),
        );

        assert_eq!(
            rendered,
            "runtime= wsl= context= host= backup= session= data= install= work= record= status="
        );
    }

    #[test]
    fn manifest_lifecycle_parses_backup_and_uninstall_stages() {
        let manifest: HubInstallManifest = serde_yaml::from_str(
            r#"
schemaVersion: "1.0"
metadata:
  name: demo
lifecycle:
  backup:
    - run: echo backup
  uninstall:
    - run: echo uninstall
artifacts:
  - id: echo
    type: command
    commands:
      - run: echo ok
"#,
        )
        .expect("manifest should parse");

        assert_eq!(manifest.lifecycle.backup.len(), 1);
        assert_eq!(manifest.lifecycle.backup[0].run, "echo backup");
        assert_eq!(manifest.lifecycle.uninstall.len(), 1);
        assert_eq!(manifest.lifecycle.uninstall[0].run, "echo uninstall");
    }
}
