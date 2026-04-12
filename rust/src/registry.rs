use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::{
    error::{HubError, Result},
    types::SupportedPlatform,
};

pub const SOFTWARE_REGISTRY_SCHEMA_VERSION: &str = "1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryManifestByPlatform {
    pub by_platform: BTreeMap<String, String>,
    #[serde(default)]
    pub fallback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RegistryManifestSource {
    Single(String),
    ByPlatform(RegistryManifestByPlatform),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareRegistryEntry {
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub manifest: RegistryManifestSource,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareRegistryMetadata {
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareRegistry {
    pub schema_version: String,
    pub metadata: SoftwareRegistryMetadata,
    pub entries: Vec<SoftwareRegistryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedSoftwareRegistry {
    pub registry: SoftwareRegistry,
    pub absolute_path: String,
    pub base_directory: String,
    pub source_input: String,
    pub source_kind: String,
    #[serde(default)]
    pub resolved_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveSoftwareEntryResult {
    pub entry: SoftwareRegistryEntry,
    pub manifest_source: String,
}

impl SoftwareRegistry {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != SOFTWARE_REGISTRY_SCHEMA_VERSION {
            return Err(HubError::message(
                "INVALID_REGISTRY_VERSION",
                format!(
                    "registry schemaVersion must be {SOFTWARE_REGISTRY_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.entries.is_empty() {
            return Err(HubError::message(
                "INVALID_REGISTRY",
                "registry must contain at least one entry",
            ));
        }
        Ok(())
    }
}

pub fn load_registry(source: &str) -> Result<LoadedSoftwareRegistry> {
    if source.starts_with("http://") || source.starts_with("https://") {
        return load_registry_from_url(source);
    }
    let path = PathBuf::from(source);
    let path = if path.is_dir() {
        resolve_default_registry(&path)?
    } else {
        path
    };
    let absolute = fs::canonicalize(&path)?;
    let content = fs::read_to_string(&absolute)?;
    let registry = parse_registry(&content, &absolute)?;
    Ok(LoadedSoftwareRegistry {
        registry,
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

fn load_registry_from_url(source: &str) -> Result<LoadedSoftwareRegistry> {
    let response = reqwest::blocking::get(source)?.error_for_status()?;
    let body = response.text()?;
    let registry = parse_registry(&body, Path::new("software-registry.yaml"))?;
    let url = Url::parse(source)?;
    Ok(LoadedSoftwareRegistry {
        registry,
        absolute_path: source.to_owned(),
        base_directory: url.join(".")?.to_string(),
        source_input: source.to_owned(),
        source_kind: "url".to_owned(),
        resolved_from: Some(source.to_owned()),
    })
}

fn parse_registry(content: &str, path: &Path) -> Result<SoftwareRegistry> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let registry: SoftwareRegistry = if extension.eq_ignore_ascii_case("json") {
        serde_json::from_str(content)?
    } else {
        serde_yaml::from_str(content)?
    };
    registry.validate()?;
    Ok(registry)
}

fn resolve_default_registry(directory: &Path) -> Result<PathBuf> {
    for candidate in [
        "registry/software-registry.yaml",
        "registry/software-registry.yml",
        "registry/software-registry.json",
        "software-registry.yaml",
        "software-registry.yml",
        "software-registry.json",
    ] {
        let path = directory.join(candidate);
        if path.exists() {
            return Ok(path);
        }
    }
    Err(HubError::message(
        "REGISTRY_NOT_FOUND",
        format!("no default registry found in {}", directory.display()),
    ))
}

pub fn resolve_software_entry(
    loaded_registry: &LoadedSoftwareRegistry,
    software_name: &str,
    platform: SupportedPlatform,
) -> Result<ResolveSoftwareEntryResult> {
    let needle = software_name.trim().to_lowercase();
    let entry = loaded_registry
        .registry
        .entries
        .iter()
        .find(|entry| {
            entry.name.to_lowercase() == needle
                || entry
                    .aliases
                    .iter()
                    .any(|alias| alias.to_lowercase() == needle)
        })
        .cloned()
        .ok_or_else(|| {
            HubError::message(
                "REGISTRY_ENTRY_NOT_FOUND",
                format!(
                    "software \"{software_name}\" not found in registry {}",
                    loaded_registry.absolute_path
                ),
            )
        })?;

    let raw_manifest = match &entry.manifest {
        RegistryManifestSource::Single(value) => value.clone(),
        RegistryManifestSource::ByPlatform(map) => map
            .by_platform
            .get(platform.as_str())
            .cloned()
            .or_else(|| map.fallback.clone())
            .ok_or_else(|| {
                HubError::message(
                    "REGISTRY_MANIFEST_MISSING",
                    format!(
                        "software \"{}\" has no manifest for platform {}",
                        entry.name,
                        platform.as_str()
                    ),
                )
            })?,
    };

    let manifest_source = if raw_manifest.starts_with("http://")
        || raw_manifest.starts_with("https://")
        || Path::new(&raw_manifest).is_absolute()
    {
        raw_manifest
    } else if loaded_registry.source_kind == "url" {
        Url::parse(
            loaded_registry
                .resolved_from
                .as_deref()
                .unwrap_or(&loaded_registry.source_input),
        )?
        .join(&raw_manifest)?
        .to_string()
    } else {
        Path::new(&loaded_registry.base_directory)
            .join(&raw_manifest)
            .display()
            .to_string()
    };

    Ok(ResolveSoftwareEntryResult {
        entry,
        manifest_source,
    })
}
