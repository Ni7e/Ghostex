#[cfg(windows)]
#[path = "../native_windows_sessions/mod.rs"]
mod native_windows_sessions;

fn main() {
    #[cfg(windows)]
    if let Err(error) = native_windows_sessions::cli::run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("The native session host is only available on Windows.");
        std::process::exit(1);
    }
}
