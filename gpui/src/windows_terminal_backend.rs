//! Windows terminal/backend integration.
//!
//! Windows currently runs only through WSL2, using Linux gxserver, zmx,
//! Source/code-server, and T3 Code runtimes inside an initialized distribution.
//! PowerShell support remains a later phase and is never selected as a fallback.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowsTerminalBackendPreference {
    Automatic,
    Wsl,
    PowerShell,
}

impl WindowsTerminalBackendPreference {
    pub(crate) fn from_settings_value(_value: Option<&str>) -> Self {
        Self::Wsl
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ResolvedWindowsTerminalBackend {
    Wsl { distribution: String },
    PowerShell,
}

pub(crate) fn current_preference() -> WindowsTerminalBackendPreference {
    let settings = crate::shared_settings::shared_sidebar_settings_snapshot();
    WindowsTerminalBackendPreference::from_settings_value(
        settings
            .object()
            .get("windowsTerminalBackend")
            .and_then(serde_json::Value::as_str),
    )
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{ResolvedWindowsTerminalBackend, WindowsTerminalBackendPreference};
    use std::{
        env,
        ffi::OsString,
        fs, io,
        path::{Path, PathBuf},
        process::{Command, Stdio},
        sync::{Mutex, OnceLock},
    };

    use std::os::windows::process::CommandExt as _;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const WSL_GXSERVER_PATH: &str = "$HOME/.ghostex/gxserver/package/bin/gxserver";
    const WSL_ZMX_PATH: &str = "$HOME/.ghostex/gxserver/package/bin/zmx";
    const WSL_PACKAGE_IDENTITY_PATH: &str = "$HOME/.ghostex/gxserver/windows-app-runtime.sha256";
    const WSL_SOURCE_RUNTIME_PATH: &str = "$HOME/.ghostex/source-runtime/package";
    const WSL_SOURCE_RUNTIME_IDENTITY_PATH: &str =
        "$HOME/.ghostex/source-runtime/windows-app-runtime.sha256";
    const WSL_T3_RUNTIME_ENTRYPOINT_PATH: &str =
        "$HOME/.ghostex/source-runtime/package/t3code-server/dist/bin.mjs";
    const WSL_T3_RUNTIME_NODE_PATH: &str =
        "$HOME/.ghostex/source-runtime/package/t3code-server/lib/node";

    struct PackagedGxserver {
        archive_path: PathBuf,
        sha256: Option<String>,
    }

    struct PackagedSourceRuntime {
        archive_path: PathBuf,
        sha256: Option<String>,
    }

    #[derive(Default)]
    struct WindowsWslState {
        detection_complete: bool,
        requested_distribution: Option<String>,
        distribution: Option<String>,
        auth_token: Option<String>,
        package_update_required: bool,
    }

    static STATE: OnceLock<Mutex<WindowsWslState>> = OnceLock::new();

    fn state() -> &'static Mutex<WindowsWslState> {
        STATE.get_or_init(|| Mutex::new(WindowsWslState::default()))
    }

    pub(super) fn reset() {
        if let Ok(mut state) = state().lock() {
            *state = WindowsWslState::default();
        }
    }

    pub(super) fn mark_package_update_required() {
        if let Ok(mut state) = state().lock() {
            state.package_update_required = true;
        }
    }

    pub(super) fn auth_token() -> Option<String> {
        state().lock().ok()?.auth_token.clone()
    }

    pub(super) fn t3_runtime_launch_plan() -> Result<(PathBuf, PathBuf), String> {
        /*
        CDXC:GPUIWindowsT3Code 2026-07-26:
        Windows does not execute the managed T3 server on the Win32 host. Resolve
        the exact packaged Node/entrypoint paths from the selected WSL
        distribution so the WSL gxserver can validate and own the launch plan.
        Do not translate these paths through the Windows filesystem or probe a
        second distribution.
        */
        let ResolvedWindowsTerminalBackend::Wsl { distribution } =
            resolve(super::current_preference())?
        else {
            unreachable!("PowerShell is not a selectable Windows terminal backend")
        };
        let output = run_wsl_capture(
            &distribution,
            &format!(
                "set -eu; node={WSL_T3_RUNTIME_NODE_PATH}; entrypoint={WSL_T3_RUNTIME_ENTRYPOINT_PATH}; test -x \"$node\"; test -f \"$entrypoint\"; printf '%s\\n%s\\n' \"$node\" \"$entrypoint\""
            ),
        )
        .ok_or_else(|| {
            "The managed T3 Code runtime is unavailable in the selected WSL2 distribution. Reinstall this Ghostex build."
                .to_string()
        })?;
        let mut lines = output.lines().map(str::trim).filter(|line| !line.is_empty());
        let node_path = lines
            .next()
            .and_then(validated_wsl_path)
            .ok_or_else(|| "WSL returned an invalid T3 Code Node path.".to_string())?;
        let entrypoint_path = lines
            .next()
            .and_then(validated_wsl_path)
            .ok_or_else(|| "WSL returned an invalid T3 Code entrypoint path.".to_string())?;
        if lines.next().is_some() {
            return Err("WSL returned an invalid T3 Code launch plan.".to_string());
        }
        Ok((PathBuf::from(node_path), PathBuf::from(entrypoint_path)))
    }

    pub(super) fn t3_owner_bearer_token() -> Result<String, String> {
        let ResolvedWindowsTerminalBackend::Wsl { distribution } =
            resolve(super::current_preference())?
        else {
            unreachable!("PowerShell is not a selectable Windows terminal backend")
        };
        run_wsl_capture(
            &distribution,
            "set -eu; token_file=\"$HOME/.ghostex/t3-runtime/auth-state.json\"; test -r \"$token_file\"; cat \"$token_file\"",
        )
        .and_then(|text| {
            let value = serde_json::from_str::<serde_json::Value>(&text).ok()?;
            let object = value.as_object()?;
            (object.get("provider").and_then(serde_json::Value::as_str) == Some("t3code"))
                .then_some(())?;
            object
                .get("ownerBearerToken")
                .and_then(serde_json::Value::as_str)
                .and_then(validated_t3_owner_bearer_token)
        })
        .ok_or_else(|| "T3 owner authorization is unavailable in WSL.".to_string())
    }

    pub(super) fn resolve(
        _preference: WindowsTerminalBackendPreference,
    ) -> Result<ResolvedWindowsTerminalBackend, String> {
        let requested_distribution = configured_wsl_distribution()?;
        let cached = state().lock().ok().and_then(|state| {
            (state.detection_complete && state.requested_distribution == requested_distribution)
                .then(|| state.distribution.clone())
        });
        let distribution = match cached {
            Some(distribution) => distribution,
            None => {
                let detected = match requested_distribution.as_deref() {
                    Some(requested) => resolve_initialized_wsl2_distribution(requested)
                        .ok_or_else(|| {
                            format!(
                                "The configured WSL distribution '{requested}' is not an initialized WSL2 distribution. Update Windows Settings > Terminal > WSL Distribution using the exact name from `wsl.exe --list --verbose`."
                            )
                        })
                        .map(Some)?,
                    None => detect_initialized_wsl2_distribution(),
                };
                if let Ok(mut state) = state().lock() {
                    state.detection_complete = true;
                    state.requested_distribution = requested_distribution.clone();
                    state.distribution = detected.clone();
                    if detected.is_none() {
                        state.auth_token = None;
                    }
                }
                detected
            }
        };

        distribution
            .map(|distribution| ResolvedWindowsTerminalBackend::Wsl { distribution })
            .ok_or_else(|| {
                "Ghostex for Windows requires WSL2 and an initialized Linux distribution. Install and open a distribution once, or set Windows Settings > Terminal > WSL Distribution to its exact name; Ghostex will not run `wsl --install` automatically."
                    .to_string()
            })
    }

    pub(super) fn prepare_gxserver(
        preference: WindowsTerminalBackendPreference,
    ) -> Result<ResolvedWindowsTerminalBackend, String> {
        let backend = resolve(preference)?;
        let ResolvedWindowsTerminalBackend::Wsl { distribution } = &backend else {
            return Ok(backend);
        };
        if let Ok(mut state) = state().lock() {
            // A failed restart must never leave a previously read daemon token
            // available to a new sidebar bootstrap.
            state.auth_token = None;
        }

        let package = resolve_packaged_gxserver().ok_or_else(|| {
            "The Ghostex installer does not contain the WSL gxserver runtime for this Windows architecture. Reinstall this Ghostex build."
                .to_string()
        })?;
        let update_required = state()
            .lock()
            .map(|state| state.package_update_required)
            .unwrap_or(false);
        let installed = run_wsl_status(distribution, &format!("test -x {WSL_GXSERVER_PATH}"));
        let installed_package_matches = package.sha256.as_deref().is_none_or(|expected| {
            run_wsl_capture(
                distribution,
                &format!("test -r {WSL_PACKAGE_IDENTITY_PATH} && cat {WSL_PACKAGE_IDENTITY_PATH}"),
            )
            .is_some_and(|actual| actual.trim() == expected)
        });
        if update_required || !installed || !installed_package_matches {
            install_packaged_gxserver(distribution, &package)?;
        }

        let source_package = resolve_packaged_source_runtime().ok_or_else(|| {
            "The Ghostex installer does not contain the WSL Source runtime for this Windows architecture. Reinstall this Ghostex build."
                .to_string()
        })?;
        let source_installed = run_wsl_status(
            distribution,
            &format!(
                "test -x {WSL_SOURCE_RUNTIME_PATH}/lib/node && test -f {WSL_SOURCE_RUNTIME_PATH}/out/node/entry.js && test -x {WSL_T3_RUNTIME_NODE_PATH} && test -f {WSL_T3_RUNTIME_ENTRYPOINT_PATH}"
            ),
        );
        let source_package_matches =
            source_package.sha256.as_deref().is_none_or(|expected| {
                run_wsl_capture(
                    distribution,
                    &format!(
                        "test -r {WSL_SOURCE_RUNTIME_IDENTITY_PATH} && cat {WSL_SOURCE_RUNTIME_IDENTITY_PATH}"
                    ),
                )
                .is_some_and(|actual| actual.trim() == expected)
            });
        if update_required || !source_installed || !source_package_matches {
            install_packaged_source_runtime(distribution, &source_package)?;
        }
        if let Ok(mut state) = state().lock() {
            state.package_update_required = false;
        }

        let start_script = format!(
            "set -eu; test -x {WSL_GXSERVER_PATH}; GHOSTEX_T3_RUNTIME_COMMAND_SHELL=/bin/sh {WSL_GXSERVER_PATH} start --json >/dev/null"
        );
        if !run_wsl_status(distribution, &start_script) {
            return Err("gxserver could not start inside the selected WSL2 distribution.".into());
        }
        let token = run_wsl_capture(
            distribution,
            "set -eu; token_file=\"$HOME/.ghostex/gxserver/auth/token\"; test -f \"$token_file\"; cat \"$token_file\"",
        )
        .and_then(|value| validated_auth_token(&value))
        .ok_or_else(|| "gxserver started in WSL, but its authentication token is unavailable.".to_string())?;
        if let Ok(mut state) = state().lock() {
            state.distribution = Some(distribution.clone());
            state.auth_token = Some(token);
        }
        Ok(backend)
    }

    pub(super) fn terminal_invocation(
        command: Option<String>,
        working_directory: Option<&std::path::Path>,
    ) -> (String, Vec<String>) {
        match resolve(super::current_preference()) {
            Ok(ResolvedWindowsTerminalBackend::Wsl { distribution }) => {
                let mut command = command.unwrap_or_else(|| {
                    "if [ -n \"${SHELL:-}\" ] && [ -x \"$SHELL\" ]; then exec \"$SHELL\" -l; elif [ -x /bin/bash ]; then exec /bin/bash -l; else exec /bin/sh -l; fi".to_string()
                });
                let mut args = vec![
                    "--distribution".to_string(),
                    distribution,
                    "--exec".to_string(),
                    "sh".to_string(),
                    "-lc".to_string(),
                ];
                if let Some(working_directory) = working_directory {
                    /*
                    Pass the Windows path as an argv value, never shell text.
                    wslpath performs the drive/UNC translation inside the
                    selected distribution before the requested command runs.
                    Attach payloads already contain authoritative WSL paths
                    from gxserver and therefore normally have no host cwd here.
                    */
                    command =
                        format!("wsl_cwd=$(wslpath -a -u \"$1\") && cd \"$wsl_cwd\" && {command}");
                    args.push(command);
                    args.push("ghostex-wsl".to_string());
                    args.push(working_directory.to_string_lossy().into_owned());
                } else {
                    args.push(command);
                }
                ("wsl.exe".to_string(), args)
            }
            Ok(ResolvedWindowsTerminalBackend::PowerShell) => {
                unreachable!("PowerShell is not a selectable Windows terminal backend")
            }
            Err(message) => (
                "wsl.exe".to_string(),
                vec![
                    "--exec".to_string(),
                    "sh".to_string(),
                    "-lc".to_string(),
                    format!(
                        "printf '%s\\n' {} >&2; exit 1",
                        posix_single_quote(&message)
                    ),
                ],
            ),
        }
    }

    pub(super) fn spawn_zmx_refresh(
        distribution: &str,
        session_name: &str,
        rows: u16,
        columns: u16,
    ) -> Result<std::process::Child, String> {
        let script = format!(
            "exec {WSL_ZMX_PATH} refresh-if-stale {} {} {}",
            posix_single_quote(session_name),
            rows,
            columns,
        );
        hidden_command("wsl.exe")
            .args([
                "--distribution",
                distribution,
                "--exec",
                "sh",
                "-lc",
                script.as_str(),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not request a WSL zmx viewport refresh.".to_string())
    }

    pub(super) fn source_code_server_command(
        project_path: &Path,
        required_node_major: u64,
        bind_address: &str,
        link_vscode_user_config: bool,
        use_vscode_insiders_user_config: bool,
    ) -> Result<Command, String> {
        let ResolvedWindowsTerminalBackend::Wsl { distribution } =
            resolve(super::current_preference())?
        else {
            unreachable!("PowerShell is not a selectable Windows terminal backend")
        };
        let wsl_project_path = source_runtime_wsl_path(project_path)?;
        let script = r#"set -eu
repo_root="$HOME/.ghostex/source-runtime/package"
project_path="$1"
required_node_major="$2"
bind_address="$3"
link_vscode_user_config="$4"
use_vscode_insiders_user_config="$5"

test -f "$repo_root/out/node/entry.js"
test -d "$project_path"

test -x "$repo_root/lib/node"
node="$repo_root/lib/node"
node_major="$("$node" -p 'process.versions.node.split(".")[0]')"
test "$node_major" = "$required_node_major"

unset VSCODE_IPC_HOOK_CLI
unset CODE_SERVER_PARENT_PID
unset VSCODE_DEV
export NODE_ENV=production
storage_root="$HOME/.ghostex/code-server-runtime-gpui"
user_data_dir="$storage_root/user-data"
extensions_dir="$storage_root/extensions"
mkdir -p "$user_data_dir" "$extensions_dir"

set -- "$node" "$repo_root/out/node/entry.js"
if [ "$use_vscode_insiders_user_config" = "1" ]; then
    vscode_user_config_dir="$HOME/.config/Code - Insiders/User"
else
    vscode_user_config_dir="$HOME/.config/Code/User"
fi
if [ "$link_vscode_user_config" = "1" ]; then
    set -- "$@" --link-vscode-user-config --vscode-user-config-dir "$vscode_user_config_dir"
fi
if [ "$link_vscode_user_config" != "1" ] || [ ! -f "$vscode_user_config_dir/settings.json" ]; then
    settings_path="$user_data_dir/User/settings.json"
    if [ ! -e "$settings_path" ]; then
        mkdir -p "$user_data_dir/User"
        printf '%s\n' '{' '  "workbench.colorTheme": "Dark 2026"' '}' >"$settings_path"
    fi
fi

cd "$project_path"
exec "$@" \
    --auth none \
    --bind-addr "$bind_address" \
    --disable-telemetry \
    --disable-update-check \
    --disable-workspace-trust \
    --disable-getting-started-override \
    --ignore-last-opened \
    --app-name "ghostex Code" \
    --user-data-dir "$user_data_dir" \
    --extensions-dir "$extensions_dir"
"#;
        let required_node_major = required_node_major.to_string();
        let mut command = hidden_command("wsl.exe");
        command.args([
            "--distribution",
            distribution.as_str(),
            "--exec",
            "sh",
            "-lc",
            script,
            "ghostex-source",
            wsl_project_path.as_str(),
            required_node_major.as_str(),
            bind_address,
            if link_vscode_user_config { "1" } else { "0" },
            if use_vscode_insiders_user_config {
                "1"
            } else {
                "0"
            },
        ]);
        Ok(command)
    }

    pub(super) fn source_code_server_open_file_command(
        file_path: &Path,
        required_node_major: u64,
    ) -> Result<Command, String> {
        let ResolvedWindowsTerminalBackend::Wsl { distribution } =
            resolve(super::current_preference())?
        else {
            unreachable!("PowerShell is not a selectable Windows terminal backend")
        };
        let wsl_file_path = source_runtime_wsl_path(file_path)?;
        let script = r#"set -eu
repo_root="$HOME/.ghostex/source-runtime/package"
file_path="$1"
required_node_major="$2"
node="$repo_root/lib/node"
test -x "$node"
test -f "$repo_root/out/node/entry.js"
node_major="$("$node" -p 'process.versions.node.split(".")[0]')"
test "$node_major" = "$required_node_major"
unset VSCODE_IPC_HOOK_CLI
unset CODE_SERVER_PARENT_PID
unset VSCODE_DEV
export NODE_ENV=production
user_data_dir="$HOME/.ghostex/code-server-runtime-gpui/user-data"
session_socket="$user_data_dir/code-server-ipc.sock"
cd "$(dirname "$file_path")"
exec "$node" "$repo_root/out/node/entry.js" \
    --user-data-dir "$user_data_dir" \
    --session-socket "$session_socket" \
    --reuse-window \
    "$file_path"
"#;
        let required_node_major = required_node_major.to_string();
        let mut command = hidden_command("wsl.exe");
        command.args([
            "--distribution",
            distribution.as_str(),
            "--exec",
            "sh",
            "-lc",
            script,
            "ghostex-source-open-file",
            wsl_file_path.as_str(),
            required_node_major.as_str(),
        ]);
        Ok(command)
    }

    pub(super) fn wsl_path_for_windows_path(path: &Path) -> Result<String, String> {
        let ResolvedWindowsTerminalBackend::Wsl { distribution } =
            resolve(super::current_preference())?
        else {
            unreachable!("PowerShell is not a selectable Windows terminal backend")
        };
        let output = hidden_command("wsl.exe")
            .args([
                "--distribution",
                distribution.as_str(),
                "--exec",
                "wslpath",
                "-a",
                "-u",
                "--",
            ])
            .arg(path)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map_err(|_| "Could not translate the selected Windows folder into WSL.".to_string())?;
        if !output.status.success() {
            return Err("Could not translate the selected Windows folder into WSL.".to_string());
        }
        let translated = decode_windows_command_output(&output.stdout);
        let translated = translated.trim();
        if !translated.starts_with('/')
            || translated.len() > 32_768
            || translated
                .chars()
                .any(|ch| ch == '\0' || ch == '\r' || ch == '\n')
        {
            return Err(
                "WSL returned an invalid path for the selected Windows folder.".to_string(),
            );
        }
        Ok(translated.to_string())
    }

    fn validated_wsl_path(path: &str) -> Option<String> {
        (path.starts_with('/')
            && path.len() <= 32_768
            && !path
                .chars()
                .any(|ch| ch == '\0' || ch == '\r' || ch == '\n'))
        .then(|| path.to_string())
    }

    fn source_runtime_wsl_path(path: &Path) -> Result<String, String> {
        let path = path.to_string_lossy();
        if path.starts_with('/') {
            return validated_wsl_path(&path)
                .ok_or_else(|| "Source path is not a valid WSL path.".to_string());
        }
        wsl_path_for_windows_path(Path::new(path.as_ref()))
    }

    fn configured_wsl_distribution() -> Result<Option<String>, String> {
        let configured = env::var("GHOSTEX_WINDOWS_WSL_DISTRIBUTION")
            .ok()
            .or_else(|| {
                crate::shared_settings::shared_sidebar_settings_snapshot()
                    .object()
                    .get("windowsWslDistribution")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default();
        let configured = configured.trim();
        if configured.is_empty() {
            return Ok(None);
        }
        if configured.len() > 128 || configured.chars().any(char::is_control) {
            return Err(
                "The configured WSL distribution name is invalid. Use the exact name from `wsl.exe --list --verbose`."
                    .to_string(),
            );
        }
        Ok(Some(configured.to_string()))
    }

    #[derive(Clone)]
    struct Wsl2Distribution {
        name: String,
        is_default: bool,
    }

    fn initialized_wsl2_distributions() -> Vec<Wsl2Distribution> {
        let output = hidden_command("wsl.exe")
            .args(["--list", "--verbose"])
            .stdin(Stdio::null())
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        let listing = decode_windows_command_output(&output.stdout);
        let mut candidates = Vec::new();
        for raw_line in listing.lines().skip(1) {
            let line = raw_line.trim_matches(|ch: char| ch == '\0' || ch.is_whitespace());
            if line.is_empty() {
                continue;
            }
            let is_default = line.starts_with('*');
            let columns = line
                .trim_start_matches('*')
                .trim()
                .split_whitespace()
                .collect::<Vec<_>>();
            if columns.len() < 3 || columns.last().copied() != Some("2") {
                continue;
            }
            // NAME may contain spaces; STATE and VERSION are the final two columns.
            let name = columns[..columns.len() - 2].join(" ");
            let normalized_name = name.to_ascii_lowercase();
            if name.is_empty()
                || normalized_name == "docker-desktop"
                || normalized_name == "docker-desktop-data"
                || !wsl_distribution_is_initialized(&name)
            {
                continue;
            }
            candidates.push(Wsl2Distribution { name, is_default });
        }
        candidates
    }

    fn detect_initialized_wsl2_distribution() -> Option<String> {
        let candidates = initialized_wsl2_distributions();
        candidates
            .iter()
            .find(|candidate| candidate.is_default)
            .or_else(|| candidates.first())
            .map(|candidate| candidate.name.clone())
    }

    fn resolve_initialized_wsl2_distribution(requested: &str) -> Option<String> {
        initialized_wsl2_distributions()
            .into_iter()
            .find(|candidate| candidate.name.eq_ignore_ascii_case(requested))
            .map(|candidate| candidate.name)
    }

    fn wsl_distribution_is_initialized(distribution: &str) -> bool {
        run_wsl_status(
            distribution,
            "test -n \"${HOME:-}\" && test -r /etc/os-release && command -v sh >/dev/null",
        )
    }

    fn install_packaged_gxserver(
        distribution: &str,
        package: &PackagedGxserver,
    ) -> Result<(), String> {
        let mut archive = fs::File::open(&package.archive_path)
            .map_err(|_| "The packaged WSL gxserver runtime could not be read.".to_string())?;
        let script = "set -eu; install_root=\"$HOME/.ghostex/gxserver\"; release_dir=\"$install_root/releases/windows-app-$(date +%s)-$$\"; mkdir -p \"$release_dir\"; tar -xzf - -C \"$release_dir\"; test -x \"$release_dir/bin/gxserver\"; \"$release_dir/bin/gxserver\" setup --install-root \"$install_root\" --release-dir \"$release_dir\" >/dev/null; if [ -n \"$1\" ]; then printf '%s\\n' \"$1\" >\"$install_root/windows-app-runtime.sha256\"; else rm -f \"$install_root/windows-app-runtime.sha256\"; fi";
        let mut child = hidden_command("wsl.exe")
            .args([
                "--distribution",
                distribution,
                "--exec",
                "sh",
                "-lc",
                script,
                "ghostex-wsl-installer",
                package.sha256.as_deref().unwrap_or(""),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start WSL to install gxserver.".to_string())?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Could not stream the gxserver runtime into WSL.".to_string())?;
        if io::copy(&mut archive, &mut stdin).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Could not stream the gxserver runtime into WSL.".to_string());
        }
        drop(stdin);
        let status = child
            .wait()
            .map_err(|_| "The WSL gxserver installer did not finish.".to_string())?;
        status.success().then_some(()).ok_or_else(|| {
            "The WSL gxserver runtime could not be installed in the selected distribution."
                .to_string()
        })
    }

    fn install_packaged_source_runtime(
        distribution: &str,
        package: &PackagedSourceRuntime,
    ) -> Result<(), String> {
        let mut archive = fs::File::open(&package.archive_path)
            .map_err(|_| "The packaged WSL Source runtime could not be read.".to_string())?;
        let script = "set -eu; install_root=\"$HOME/.ghostex/source-runtime\"; release_dir=\"$install_root/releases/windows-app-$(date +%s)-$$\"; mkdir -p \"$release_dir\"; tar -xzf - -C \"$release_dir\"; test -x \"$release_dir/lib/node\"; test -f \"$release_dir/out/node/entry.js\"; test -f \"$release_dir/lib/vscode/out/server-main.js\"; test -x \"$release_dir/t3code-server/lib/node\"; test -f \"$release_dir/t3code-server/dist/bin.mjs\"; \"$release_dir/lib/node\" \"$release_dir/out/node/entry.js\" --version >/dev/null; \"$release_dir/t3code-server/lib/node\" \"$release_dir/t3code-server/dist/bin.mjs\" --help >/dev/null; ln -sfn \"$release_dir\" \"$install_root/package\"; if [ -n \"$1\" ]; then printf '%s\\n' \"$1\" >\"$install_root/windows-app-runtime.sha256\"; else rm -f \"$install_root/windows-app-runtime.sha256\"; fi";
        let mut child = hidden_command("wsl.exe")
            .args([
                "--distribution",
                distribution,
                "--exec",
                "sh",
                "-lc",
                script,
                "ghostex-wsl-source-installer",
                package.sha256.as_deref().unwrap_or(""),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start WSL to install Source.".to_string())?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Could not stream the Source runtime into WSL.".to_string())?;
        if io::copy(&mut archive, &mut stdin).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Could not stream the Source runtime into WSL.".to_string());
        }
        drop(stdin);
        let status = child
            .wait()
            .map_err(|_| "The WSL Source runtime installer did not finish.".to_string())?;
        status.success().then_some(()).ok_or_else(|| {
            "The WSL Source runtime could not be installed in the selected distribution."
                .to_string()
        })
    }

    fn resolve_packaged_gxserver() -> Option<PackagedGxserver> {
        if let Some(path) = env::var_os("GHOSTEX_WSL_GXSERVER_ARCHIVE") {
            let path = PathBuf::from(path);
            if path.is_absolute() && path.is_file() {
                let sha256 = packaged_archive_identity(&path);
                return Some(PackagedGxserver {
                    archive_path: path,
                    sha256,
                });
            }
            return None;
        }
        #[cfg(target_arch = "x86_64")]
        const ARCHIVE_NAME: &str = "gxserver-linux-x64.tar.gz";
        #[cfg(target_arch = "aarch64")]
        const ARCHIVE_NAME: &str = "gxserver-linux-arm64.tar.gz";
        let executable_dir = env::current_exe().ok()?.parent()?.to_path_buf();
        let archive_path = executable_dir
            .join("resources")
            .join("wsl")
            .join(ARCHIVE_NAME);
        archive_path.is_file().then(|| PackagedGxserver {
            sha256: packaged_archive_identity(&archive_path),
            archive_path,
        })
    }

    fn resolve_packaged_source_runtime() -> Option<PackagedSourceRuntime> {
        if let Some(path) = env::var_os("GHOSTEX_WSL_CODE_SERVER_ARCHIVE") {
            let path = PathBuf::from(path);
            if path.is_absolute() && path.is_file() {
                let sha256 = packaged_archive_identity(&path);
                return Some(PackagedSourceRuntime {
                    archive_path: path,
                    sha256,
                });
            }
            return None;
        }
        #[cfg(target_arch = "x86_64")]
        const ARCHIVE_NAME: &str = "code-server-linux-x64.tar.gz";
        #[cfg(target_arch = "aarch64")]
        const ARCHIVE_NAME: &str = "code-server-linux-arm64.tar.gz";
        let executable_dir = env::current_exe().ok()?.parent()?.to_path_buf();
        let archive_path = executable_dir
            .join("resources")
            .join("wsl")
            .join(ARCHIVE_NAME);
        archive_path.is_file().then(|| PackagedSourceRuntime {
            sha256: packaged_archive_identity(&archive_path),
            archive_path,
        })
    }

    fn packaged_archive_identity(archive_path: &Path) -> Option<String> {
        let mut sidecar_name: OsString = archive_path.as_os_str().to_owned();
        sidecar_name.push(".sha256");
        let value = fs::read_to_string(PathBuf::from(sidecar_name)).ok()?;
        let sha256 = value.trim();
        (sha256.len() == 64
            && sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
        .then(|| sha256.to_string())
    }

    fn run_wsl_status(distribution: &str, script: &str) -> bool {
        hidden_command("wsl.exe")
            .args([
                "--distribution",
                distribution,
                "--exec",
                "sh",
                "-lc",
                script,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn run_wsl_capture(distribution: &str, script: &str) -> Option<String> {
        let output = hidden_command("wsl.exe")
            .args([
                "--distribution",
                distribution,
                "--exec",
                "sh",
                "-lc",
                script,
            ])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| decode_windows_command_output(&output.stdout))
    }

    fn validated_auth_token(value: &str) -> Option<String> {
        let token = value.trim_matches(|ch: char| ch == '\0' || ch.is_whitespace());
        (!token.is_empty()
            && token.len() <= 256
            && token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
        .then(|| token.to_string())
    }

    fn validated_t3_owner_bearer_token(value: &str) -> Option<String> {
        let token = value.trim();
        (!token.is_empty()
            && token.chars().count() <= 16 * 1024
            && !token.chars().any(char::is_control))
        .then(|| token.to_string())
    }

    fn decode_windows_command_output(bytes: &[u8]) -> String {
        if bytes.len() >= 2
            && (bytes.starts_with(&[0xff, 0xfe])
                || bytes
                    .iter()
                    .skip(1)
                    .step_by(2)
                    .take(8)
                    .any(|byte| *byte == 0))
        {
            let start = usize::from(bytes.starts_with(&[0xff, 0xfe])) * 2;
            let units = bytes[start..]
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]));
            return String::from_utf16_lossy(&units.collect::<Vec<_>>());
        }
        String::from_utf8_lossy(bytes).replace('\0', "")
    }

    fn hidden_command(program: &str) -> Command {
        let mut command = Command::new(program);
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    fn posix_single_quote(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn mark_package_update_required() {
    platform::mark_package_update_required();
}

#[cfg(target_os = "windows")]
pub(crate) fn reset() {
    platform::reset();
}

#[cfg(target_os = "windows")]
pub(crate) fn auth_token() -> Option<String> {
    platform::auth_token()
}

#[cfg(target_os = "windows")]
pub(crate) fn t3_runtime_launch_plan() -> Result<
    (std::path::PathBuf, std::path::PathBuf),
    String,
> {
    platform::t3_runtime_launch_plan()
}

#[cfg(target_os = "windows")]
pub(crate) fn t3_owner_bearer_token() -> Result<String, String> {
    platform::t3_owner_bearer_token()
}

#[cfg(target_os = "windows")]
pub(crate) fn resolve_current() -> Result<ResolvedWindowsTerminalBackend, String> {
    platform::resolve(current_preference())
}

#[cfg(target_os = "windows")]
pub(crate) fn prepare_gxserver_for_current_settings()
-> Result<ResolvedWindowsTerminalBackend, String> {
    platform::prepare_gxserver(current_preference())
}

#[cfg(target_os = "windows")]
pub(crate) fn terminal_invocation(
    command: Option<String>,
    working_directory: Option<&std::path::Path>,
) -> (String, Vec<String>) {
    platform::terminal_invocation(command, working_directory)
}

#[cfg(target_os = "windows")]
pub(crate) fn spawn_zmx_refresh(
    distribution: &str,
    session_name: &str,
    rows: u16,
    columns: u16,
) -> Result<std::process::Child, String> {
    platform::spawn_zmx_refresh(distribution, session_name, rows, columns)
}

#[cfg(target_os = "windows")]
pub(crate) fn source_code_server_command(
    project_path: &std::path::Path,
    required_node_major: u64,
    bind_address: &str,
    link_vscode_user_config: bool,
    use_vscode_insiders_user_config: bool,
) -> Result<std::process::Command, String> {
    platform::source_code_server_command(
        project_path,
        required_node_major,
        bind_address,
        link_vscode_user_config,
        use_vscode_insiders_user_config,
    )
}

#[cfg(target_os = "windows")]
pub(crate) fn source_code_server_open_file_command(
    file_path: &std::path::Path,
    required_node_major: u64,
) -> Result<std::process::Command, String> {
    platform::source_code_server_open_file_command(file_path, required_node_major)
}

#[cfg(target_os = "windows")]
pub(crate) fn wsl_path_for_windows_path(path: &std::path::Path) -> Result<String, String> {
    platform::wsl_path_for_windows_path(path)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn auth_token() -> Option<String> {
    None
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn mark_package_update_required() {}

#[cfg(not(target_os = "windows"))]
pub(crate) fn reset() {}
