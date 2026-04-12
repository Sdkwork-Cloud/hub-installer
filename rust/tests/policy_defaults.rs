use hub_installer_rs::{
    policy::{InstallPolicyInput, resolve_install_policy},
    types::{EffectiveRuntimePlatform, InstallControlLevel, InstallScope, SupportedPlatform},
};

#[test]
fn resolves_unix_user_policy_to_sdkwork_layout() {
    let policy = resolve_install_policy(InstallPolicyInput {
        platform: SupportedPlatform::Ubuntu,
        effective_runtime_platform: EffectiveRuntimePlatform::Ubuntu,
        software_name: "codex".to_owned(),
        home_dir: "/home/tester".into(),
        local_data_dir: None,
        install_scope: InstallScope::User,
        install_control_level: InstallControlLevel::Managed,
        installer_home_override: None,
        install_root_override: None,
        work_root_override: None,
        bin_dir_override: None,
        data_root_override: None,
    });

    assert_eq!(policy.installer_home, "/home/tester/.sdkwork/hub-installer");
    assert_eq!(policy.install_root, "/home/tester/.local/opt/codex");
    assert_eq!(
        policy.work_root,
        "/home/tester/.sdkwork/hub-installer/state/sources/codex"
    );
    assert_eq!(policy.bin_dir, "/home/tester/.local/bin");
    assert_eq!(policy.data_root, "/home/tester/.local/share/codex");
}

#[test]
fn resolves_windows_user_policy_to_local_app_data_layout() {
    let policy = resolve_install_policy(InstallPolicyInput {
        platform: SupportedPlatform::Windows,
        effective_runtime_platform: EffectiveRuntimePlatform::Windows,
        software_name: "openclaw".to_owned(),
        home_dir: "C:\\Users\\tester".into(),
        local_data_dir: Some("C:\\Users\\tester\\AppData\\Local".into()),
        install_scope: InstallScope::User,
        install_control_level: InstallControlLevel::Partial,
        installer_home_override: None,
        install_root_override: None,
        work_root_override: None,
        bin_dir_override: None,
        data_root_override: None,
    });

    assert_eq!(
        policy.installer_home,
        "C:\\Users\\tester\\.sdkwork\\hub-installer"
    );
    assert_eq!(
        policy.install_root,
        "C:\\Users\\tester\\AppData\\Local\\Programs\\openclaw"
    );
    assert_eq!(
        policy.work_root,
        "C:\\Users\\tester\\.sdkwork\\hub-installer\\state\\sources\\openclaw"
    );
    assert_eq!(
        policy.bin_dir,
        "C:\\Users\\tester\\AppData\\Local\\Programs\\openclaw\\bin"
    );
    assert_eq!(
        policy.data_root,
        "C:\\Users\\tester\\AppData\\Local\\openclaw"
    );
}

#[test]
fn normalizes_separator_style_for_non_windows_target_policy() {
    let policy = resolve_install_policy(InstallPolicyInput {
        platform: SupportedPlatform::Ubuntu,
        effective_runtime_platform: EffectiveRuntimePlatform::Ubuntu,
        software_name: "openclaw".to_owned(),
        home_dir: "C:\\Users\\tester".into(),
        local_data_dir: Some("C:\\Users\\tester\\AppData\\Local".into()),
        install_scope: InstallScope::User,
        install_control_level: InstallControlLevel::Partial,
        installer_home_override: None,
        install_root_override: None,
        work_root_override: None,
        bin_dir_override: None,
        data_root_override: None,
    });

    assert_eq!(
        policy.installer_home,
        "C:/Users/tester/.sdkwork/hub-installer"
    );
    assert_eq!(policy.install_root, "C:/Users/tester/.local/opt/openclaw");
    assert_eq!(
        policy.work_root,
        "C:/Users/tester/.sdkwork/hub-installer/state/sources/openclaw"
    );
    assert_eq!(policy.bin_dir, "C:/Users/tester/.local/bin");
    assert_eq!(policy.data_root, "C:/Users/tester/.local/share/openclaw");
}

#[test]
fn resolves_wsl_user_policy_to_linux_home_layout() {
    let policy = resolve_install_policy(InstallPolicyInput {
        platform: SupportedPlatform::Windows,
        effective_runtime_platform: EffectiveRuntimePlatform::Wsl,
        software_name: "openclaw".to_owned(),
        home_dir: "/home/tester".into(),
        local_data_dir: Some("C:\\Users\\tester\\AppData\\Local".into()),
        install_scope: InstallScope::User,
        install_control_level: InstallControlLevel::Opaque,
        installer_home_override: None,
        install_root_override: None,
        work_root_override: None,
        bin_dir_override: None,
        data_root_override: None,
    });

    assert_eq!(policy.installer_home, "/home/tester/.sdkwork/hub-installer");
    assert_eq!(policy.install_root, "/home/tester/.local/opt/openclaw");
    assert_eq!(
        policy.work_root,
        "/home/tester/.sdkwork/hub-installer/state/sources/openclaw"
    );
    assert_eq!(policy.bin_dir, "/home/tester/.local/bin");
    assert_eq!(policy.data_root, "/home/tester/.local/share/openclaw");
}

#[test]
fn normalizes_windows_override_paths_for_wsl_runtime() {
    let policy = resolve_install_policy(InstallPolicyInput {
        platform: SupportedPlatform::Windows,
        effective_runtime_platform: EffectiveRuntimePlatform::Wsl,
        software_name: "openclaw".to_owned(),
        home_dir: "/home/tester".into(),
        local_data_dir: Some("C:\\Users\\tester\\AppData\\Local".into()),
        install_scope: InstallScope::User,
        install_control_level: InstallControlLevel::Opaque,
        installer_home_override: Some("D:\\hub\\home".into()),
        install_root_override: Some("D:\\apps\\openclaw".into()),
        work_root_override: Some("D:\\work\\openclaw".into()),
        bin_dir_override: Some("D:\\tools\\bin".into()),
        data_root_override: Some("D:\\data\\openclaw".into()),
    });

    assert_eq!(policy.installer_home, "/mnt/d/hub/home");
    assert_eq!(policy.install_root, "/mnt/d/apps/openclaw");
    assert_eq!(policy.work_root, "/mnt/d/work/openclaw");
    assert_eq!(policy.bin_dir, "/mnt/d/tools/bin");
    assert_eq!(policy.data_root, "/mnt/d/data/openclaw");
}
