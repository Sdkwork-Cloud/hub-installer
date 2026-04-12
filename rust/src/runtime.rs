use std::process::{Command, Stdio};

use crate::{
    error::{HubError, Result},
    platform::detect_host_platform,
    types::{
        ContainerRuntime, ContainerRuntimePreference, EffectiveRuntimePlatform, SupportedPlatform,
    },
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuntimeOptions {
    pub effective_runtime_platform: Option<EffectiveRuntimePlatform>,
    pub container_runtime: Option<ContainerRuntimePreference>,
    pub wsl_distribution: Option<String>,
    pub docker_context: Option<String>,
    pub docker_host: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionContext {
    pub host_platform: SupportedPlatform,
    pub target_platform: SupportedPlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub container_runtime: Option<ContainerRuntime>,
    pub wsl_distribution: Option<String>,
    pub docker_context: Option<String>,
    pub docker_host: Option<String>,
    pub runtime_home_dir: Option<String>,
}

pub trait RuntimeProbe {
    fn command_exists(&self, command: &str) -> bool;
    fn list_wsl_distros(&self) -> Vec<String>;
    fn wsl_command_exists(&self, distro: Option<&str>, command: &str) -> bool;
    fn wsl_read_env(&self, distro: Option<&str>, name: &str) -> Option<String>;
    fn docker_available_on_host(&self) -> bool;
    fn wsl_docker_available(&self, distro: Option<&str>) -> bool;
    fn wsl_home_dir(&self, distro: Option<&str>) -> Option<String>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemRuntimeProbe;

impl RuntimeProbe for SystemRuntimeProbe {
    fn command_exists(&self, command: &str) -> bool {
        which::which(command).is_ok()
    }

    fn list_wsl_distros(&self) -> Vec<String> {
        if !cfg!(windows) || which::which("wsl.exe").is_err() {
            return Vec::new();
        }

        let Ok(output) = Command::new("wsl.exe").args(["-l", "-q"]).output() else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }

        decode_command_output(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    }

    fn wsl_command_exists(&self, distro: Option<&str>, command: &str) -> bool {
        if !cfg!(windows) || which::which("wsl.exe").is_err() {
            return false;
        }

        let mut process = Command::new("wsl.exe");
        if let Some(distro) = distro {
            process.args(["-d", distro]);
        }
        process.args(["--", "bash", "-lc"]);
        process.arg(format!("command -v {command} >/dev/null 2>&1"));
        process.stdout(Stdio::null()).stderr(Stdio::null());
        process
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn wsl_read_env(&self, distro: Option<&str>, name: &str) -> Option<String> {
        if !cfg!(windows) || which::which("wsl.exe").is_err() || !is_safe_env_name(name) {
            return None;
        }

        let mut process = Command::new("wsl.exe");
        if let Some(distro) = distro {
            process.args(["-d", distro]);
        }
        process.args(["--", "bash", "-lc"]);
        process.arg(format!("printenv {name}"));
        let output = process.output().ok()?;
        if !output.status.success() {
            return None;
        }

        let value = decode_command_output(&output.stdout).trim().to_owned();
        if value.is_empty() { None } else { Some(value) }
    }

    fn docker_available_on_host(&self) -> bool {
        if which::which("docker").is_err() {
            return false;
        }
        Command::new("docker")
            .args(["info", "--format", "{{json .ID}}"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn wsl_docker_available(&self, distro: Option<&str>) -> bool {
        if !cfg!(windows) || which::which("wsl.exe").is_err() {
            return false;
        }

        let mut process = Command::new("wsl.exe");
        if let Some(distro) = distro {
            process.args(["-d", distro]);
        }
        process.args(["--", "bash", "-lc", "docker info >/dev/null 2>&1"]);
        process.stdout(Stdio::null()).stderr(Stdio::null());
        process
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn wsl_home_dir(&self, distro: Option<&str>) -> Option<String> {
        if !cfg!(windows) || which::which("wsl.exe").is_err() {
            return None;
        }

        let mut process = Command::new("wsl.exe");
        if let Some(distro) = distro {
            process.args(["-d", distro]);
        }
        process.args(["--", "bash", "-lc", "printf %s \"$HOME\""]);
        let output = process.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let value = decode_command_output(&output.stdout).trim().to_owned();
        if value.is_empty() { None } else { Some(value) }
    }
}

pub fn resolve_execution_context(
    target_platform: SupportedPlatform,
    options: &RuntimeOptions,
) -> Result<ExecutionContext> {
    resolve_execution_context_with_probe(
        detect_host_platform()?,
        target_platform,
        options,
        &SystemRuntimeProbe,
    )
}

pub fn resolve_execution_context_with_probe<P: RuntimeProbe>(
    host_platform: SupportedPlatform,
    target_platform: SupportedPlatform,
    options: &RuntimeOptions,
    probe: &P,
) -> Result<ExecutionContext> {
    let explicit_wsl_distribution = options
        .wsl_distribution
        .clone()
        .filter(|value| !value.trim().is_empty());
    let candidate_wsl_distros: Vec<String> = probe
        .list_wsl_distros()
        .into_iter()
        .filter(|distro| !is_system_wsl_distribution(distro))
        .collect();
    let distro_with_bash = candidate_wsl_distros
        .iter()
        .find(|distro| probe.wsl_command_exists(Some(distro.as_str()), "bash"))
        .cloned()
        .or_else(|| candidate_wsl_distros.first().cloned());
    let distro_with_docker = candidate_wsl_distros
        .iter()
        .find(|distro| probe.wsl_docker_available(Some(distro.as_str())))
        .cloned();
    let resolved_wsl_distribution =
        explicit_wsl_distribution
            .clone()
            .or_else(|| match options.container_runtime {
                Some(ContainerRuntimePreference::Auto) | Some(ContainerRuntimePreference::Wsl) => {
                    distro_with_docker
                        .clone()
                        .or_else(|| distro_with_bash.clone())
                }
                _ => distro_with_bash.clone(),
            });

    let effective_runtime_platform = if let Some(explicit) = options.effective_runtime_platform {
        explicit
    } else {
        match (host_platform, options.container_runtime) {
            (SupportedPlatform::Windows, Some(ContainerRuntimePreference::Wsl)) => {
                EffectiveRuntimePlatform::Wsl
            }
            (SupportedPlatform::Windows, Some(ContainerRuntimePreference::Host)) => {
                EffectiveRuntimePlatform::Windows
            }
            (SupportedPlatform::Windows, Some(ContainerRuntimePreference::Auto))
                if distro_with_docker.is_some() =>
            {
                EffectiveRuntimePlatform::Wsl
            }
            _ => EffectiveRuntimePlatform::from(target_platform),
        }
    };

    if effective_runtime_platform == EffectiveRuntimePlatform::Wsl
        && resolved_wsl_distribution.is_none()
    {
        return Err(HubError::message(
            "WSL_RUNTIME_UNAVAILABLE",
            "effective runtime platform wsl requires an installed WSL distribution",
        ));
    }

    let container_runtime = match options.container_runtime {
        Some(ContainerRuntimePreference::Host) => Some(ContainerRuntime::Host),
        Some(ContainerRuntimePreference::Wsl) => Some(ContainerRuntime::Wsl),
        Some(ContainerRuntimePreference::Auto)
            if effective_runtime_platform == EffectiveRuntimePlatform::Wsl =>
        {
            Some(ContainerRuntime::Wsl)
        }
        Some(ContainerRuntimePreference::Auto) if probe.docker_available_on_host() => {
            Some(ContainerRuntime::Host)
        }
        Some(ContainerRuntimePreference::Auto) => None,
        None => None,
    };

    validate_container_runtime_configuration(
        effective_runtime_platform,
        container_runtime,
        resolved_wsl_distribution.as_deref(),
        probe,
    )?;

    let runtime_home_dir = if effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
        probe.wsl_home_dir(resolved_wsl_distribution.as_deref())
    } else {
        None
    };

    Ok(ExecutionContext {
        host_platform,
        target_platform,
        effective_runtime_platform,
        container_runtime,
        wsl_distribution: if effective_runtime_platform == EffectiveRuntimePlatform::Wsl {
            resolved_wsl_distribution
        } else {
            None
        },
        docker_context: options.docker_context.clone(),
        docker_host: options.docker_host.clone(),
        runtime_home_dir,
    })
}

fn is_system_wsl_distribution(distro: &str) -> bool {
    let normalized = distro.trim().to_ascii_lowercase();
    normalized == "docker-desktop" || normalized == "docker-desktop-data"
}

fn validate_container_runtime_configuration<P: RuntimeProbe>(
    effective_runtime_platform: EffectiveRuntimePlatform,
    container_runtime: Option<ContainerRuntime>,
    wsl_distribution: Option<&str>,
    probe: &P,
) -> Result<()> {
    if matches!(container_runtime, Some(ContainerRuntime::Wsl))
        && effective_runtime_platform != EffectiveRuntimePlatform::Wsl
    {
        return Err(HubError::message(
            "INVALID_RUNTIME_CONFIGURATION",
            format!(
                "container runtime wsl requires WSL execution, got {}",
                effective_runtime_platform.as_str()
            ),
        ));
    }

    match (effective_runtime_platform, container_runtime) {
        (EffectiveRuntimePlatform::Wsl, Some(ContainerRuntime::Wsl)) => {
            let distro = wsl_distribution.ok_or_else(|| {
                HubError::message(
                    "WSL_RUNTIME_UNAVAILABLE",
                    "WSL Docker runtime requires an installed WSL distribution",
                )
            })?;
            if !probe.wsl_docker_available(Some(distro)) {
                return Err(HubError::message(
                    "WSL_DOCKER_UNAVAILABLE",
                    format!("Docker is unavailable inside WSL distribution {distro}"),
                ));
            }
        }
        (_, Some(ContainerRuntime::Host)) if !probe.docker_available_on_host() => {
            return Err(HubError::message(
                "HOST_DOCKER_UNAVAILABLE",
                "container runtime host was requested but host Docker is unavailable",
            ));
        }
        _ => {}
    }

    Ok(())
}

pub fn normalize_path_for_runtime(
    value: &str,
    runtime_platform: EffectiveRuntimePlatform,
) -> String {
    match runtime_platform {
        EffectiveRuntimePlatform::Windows => value.replace('/', "\\"),
        EffectiveRuntimePlatform::Wsl => normalize_windows_path_for_wsl(value),
        _ => value.replace('\\', "/"),
    }
}

pub fn resolve_host_path_for_runtime(value: &str, context: &ExecutionContext) -> Result<String> {
    match (
        context.host_platform,
        context.effective_runtime_platform,
        value.trim(),
    ) {
        (_, _, "") => Ok(String::new()),
        (SupportedPlatform::Windows, EffectiveRuntimePlatform::Wsl, value) => {
            map_wsl_runtime_path_to_windows_host(value, context.wsl_distribution.as_deref())
        }
        (SupportedPlatform::Windows, _, value) => Ok(value.replace('/', "\\")),
        (_, _, value) => Ok(value.replace('\\', "/")),
    }
}

fn decode_command_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).all(|value| *value == 0) {
        let utf16: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&utf16)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

fn is_safe_env_name(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first == '_' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn normalize_windows_path_for_wsl(value: &str) -> String {
    let normalized = value.replace('\\', "/");
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

fn map_wsl_runtime_path_to_windows_host(
    value: &str,
    wsl_distribution: Option<&str>,
) -> Result<String> {
    let normalized = value.replace('\\', "/");
    if normalized.is_empty() {
        return Ok(String::new());
    }

    if normalized.len() >= 7
        && normalized.starts_with("/mnt/")
        && normalized.as_bytes()[6] == b'/'
        && normalized
            .chars()
            .nth(5)
            .map(|value| value.is_ascii_alphabetic())
            .unwrap_or(false)
    {
        let drive = normalized
            .chars()
            .nth(5)
            .unwrap_or('c')
            .to_ascii_uppercase();
        let suffix = normalized[7..].replace('/', "\\");
        return Ok(if suffix.is_empty() {
            format!("{drive}:\\")
        } else {
            format!("{drive}:\\{suffix}")
        });
    }

    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        return Ok(normalized.replace('/', "\\"));
    }

    if normalized.starts_with('/') {
        let distro = wsl_distribution.ok_or_else(|| {
            HubError::message(
                "WSL_RUNTIME_UNAVAILABLE",
                "WSL host path mapping requires a WSL distribution",
            )
        })?;
        let suffix = normalized.trim_start_matches('/').replace('/', "\\");
        return Ok(if suffix.is_empty() {
            format!("\\\\wsl$\\{distro}")
        } else {
            format!("\\\\wsl$\\{distro}\\{suffix}")
        });
    }

    Ok(normalized.replace('/', "\\"))
}
