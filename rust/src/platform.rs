use std::{env, fs};

use crate::{
    error::{HubError, Result},
    types::SupportedPlatform,
};

pub fn detect_host_platform() -> Result<SupportedPlatform> {
    match env::consts::OS {
        "windows" => Ok(SupportedPlatform::Windows),
        "macos" => Ok(SupportedPlatform::Macos),
        "linux" => Ok(detect_linux_platform()),
        other => Err(HubError::message(
            "UNSUPPORTED_HOST",
            format!("unsupported host platform: {other}"),
        )),
    }
}

fn detect_linux_platform() -> SupportedPlatform {
    let _os_release = fs::read_to_string("/etc/os-release")
        .unwrap_or_default()
        .to_lowercase();
    SupportedPlatform::Ubuntu
}
