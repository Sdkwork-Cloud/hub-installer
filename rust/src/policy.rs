use crate::types::{
    EffectiveRuntimePlatform, InstallControlLevel, InstallScope, SupportedPlatform,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPolicyInput {
    pub platform: SupportedPlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub software_name: String,
    pub home_dir: String,
    pub local_data_dir: Option<String>,
    pub install_scope: InstallScope,
    pub install_control_level: InstallControlLevel,
    pub installer_home_override: Option<String>,
    pub install_root_override: Option<String>,
    pub work_root_override: Option<String>,
    pub bin_dir_override: Option<String>,
    pub data_root_override: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedInstallPolicy {
    pub platform: SupportedPlatform,
    pub effective_runtime_platform: EffectiveRuntimePlatform,
    pub software_name: String,
    pub installer_home: String,
    pub install_scope: InstallScope,
    pub install_root: String,
    pub work_root: String,
    pub bin_dir: String,
    pub data_root: String,
    pub install_control_level: InstallControlLevel,
}

pub fn resolve_install_policy(input: InstallPolicyInput) -> ResolvedInstallPolicy {
    let installer_home = input
        .installer_home_override
        .clone()
        .map(|value| normalize_path_for_runtime(&value, input.effective_runtime_platform))
        .unwrap_or_else(|| {
            default_installer_home_for(&input.home_dir, input.effective_runtime_platform)
        });

    let install_root = input
        .install_root_override
        .clone()
        .map(|value| normalize_path_for_runtime(&value, input.effective_runtime_platform))
        .unwrap_or_else(|| default_install_root(&input));

    let work_root = input.work_root_override.clone().unwrap_or_else(|| {
        default_work_root(
            &installer_home,
            &input.software_name,
            input.effective_runtime_platform,
        )
    });
    let work_root = normalize_path_for_runtime(&work_root, input.effective_runtime_platform);

    let bin_dir = input
        .bin_dir_override
        .clone()
        .map(|value| normalize_path_for_runtime(&value, input.effective_runtime_platform))
        .unwrap_or_else(|| default_bin_dir(&input, &install_root));

    let data_root = input
        .data_root_override
        .clone()
        .map(|value| normalize_path_for_runtime(&value, input.effective_runtime_platform))
        .unwrap_or_else(|| default_data_root(&input));

    ResolvedInstallPolicy {
        platform: input.platform,
        effective_runtime_platform: input.effective_runtime_platform,
        software_name: input.software_name,
        installer_home,
        install_scope: input.install_scope,
        install_root,
        work_root,
        bin_dir,
        data_root,
        install_control_level: input.install_control_level,
    }
}

pub fn default_installer_home_for(
    home_dir: &str,
    runtime_platform: EffectiveRuntimePlatform,
) -> String {
    join_segments(runtime_platform, &[home_dir, ".sdkwork", "hub-installer"])
}

pub fn default_package_cache_dir(installer_home: &str) -> String {
    if installer_home.contains('\\') || looks_like_windows_drive(installer_home) {
        join_segments(
            EffectiveRuntimePlatform::Windows,
            &[installer_home, "cache", "packages"],
        )
    } else {
        join_segments(
            EffectiveRuntimePlatform::Ubuntu,
            &[installer_home, "cache", "packages"],
        )
    }
}

fn default_install_root(input: &InstallPolicyInput) -> String {
    match (input.effective_runtime_platform, input.install_scope) {
        (EffectiveRuntimePlatform::Windows, InstallScope::System) => join_segments(
            EffectiveRuntimePlatform::Windows,
            &["C:\\Program Files", &input.software_name],
        ),
        (EffectiveRuntimePlatform::Windows, InstallScope::User) => {
            let local_data_dir = input
                .local_data_dir
                .as_deref()
                .unwrap_or("C:\\Users\\Default\\AppData\\Local");
            join_segments(
                EffectiveRuntimePlatform::Windows,
                &[local_data_dir, "Programs", &input.software_name],
            )
        }
        (_, InstallScope::System) => join_segments(
            input.effective_runtime_platform,
            &["/opt", &input.software_name],
        ),
        (_, InstallScope::User) => join_segments(
            input.effective_runtime_platform,
            &[&input.home_dir, ".local", "opt", &input.software_name],
        ),
    }
}

fn default_work_root(
    installer_home: &str,
    software_name: &str,
    runtime_platform: EffectiveRuntimePlatform,
) -> String {
    join_segments(
        runtime_platform,
        &[installer_home, "state", "sources", software_name],
    )
}

fn default_bin_dir(input: &InstallPolicyInput, install_root: &str) -> String {
    match (input.effective_runtime_platform, input.install_scope) {
        (EffectiveRuntimePlatform::Windows, _) => {
            join_segments(EffectiveRuntimePlatform::Windows, &[install_root, "bin"])
        }
        (_, InstallScope::System) => "/usr/local/bin".to_owned(),
        (_, InstallScope::User) => join_segments(
            input.effective_runtime_platform,
            &[&input.home_dir, ".local", "bin"],
        ),
    }
}

fn default_data_root(input: &InstallPolicyInput) -> String {
    match (input.effective_runtime_platform, input.install_scope) {
        (EffectiveRuntimePlatform::Windows, InstallScope::System) => join_segments(
            EffectiveRuntimePlatform::Windows,
            &["C:\\ProgramData", &input.software_name],
        ),
        (EffectiveRuntimePlatform::Windows, InstallScope::User) => {
            let local_data_dir = input
                .local_data_dir
                .as_deref()
                .unwrap_or("C:\\Users\\Default\\AppData\\Local");
            join_segments(
                EffectiveRuntimePlatform::Windows,
                &[local_data_dir, &input.software_name],
            )
        }
        (_, InstallScope::System) => join_segments(
            input.effective_runtime_platform,
            &["/var/lib", &input.software_name],
        ),
        (_, InstallScope::User) => join_segments(
            input.effective_runtime_platform,
            &[&input.home_dir, ".local", "share", &input.software_name],
        ),
    }
}

fn join_segments(runtime_platform: EffectiveRuntimePlatform, segments: &[&str]) -> String {
    let separator = if runtime_platform == EffectiveRuntimePlatform::Windows {
        '\\'
    } else {
        '/'
    };
    let mut output = String::new();

    for (index, raw_segment) in segments.iter().enumerate() {
        let segment = normalize_segment(raw_segment.trim(), runtime_platform);
        if segment.is_empty() {
            continue;
        }

        if index == 0 {
            output.push_str(segment.trim_end_matches(['\\', '/']));
            continue;
        }

        if !output.ends_with(separator) {
            output.push(separator);
        }
        output.push_str(segment.trim_matches(['\\', '/']));
    }

    output
}

fn looks_like_windows_drive(value: &str) -> bool {
    value.len() >= 2 && value.as_bytes()[1] == b':'
}

fn normalize_segment(value: &str, runtime_platform: EffectiveRuntimePlatform) -> String {
    if runtime_platform == EffectiveRuntimePlatform::Windows {
        value.replace('/', "\\")
    } else if runtime_platform == EffectiveRuntimePlatform::Wsl {
        normalize_windows_path_for_wsl(value)
    } else {
        value.replace('\\', "/")
    }
}

fn normalize_path_for_runtime(value: &str, runtime_platform: EffectiveRuntimePlatform) -> String {
    normalize_segment(value.trim(), runtime_platform)
}

fn normalize_windows_path_for_wsl(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    if looks_like_windows_drive(&normalized) {
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
