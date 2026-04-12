use std::process::ExitCode;

fn main() -> ExitCode {
    match hub_installer_rs::cli::run(std::env::args_os()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
