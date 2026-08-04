use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

const PRODUCT_DIR_UNIX: &str = "ghostex";
const PRODUCT_DIR_NATIVE: &str = "Ghostex";
const LEGACY_MIGRATION_MARKER: &str = "legacy-dot-ghostex-v1.complete";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GhostexPaths {
    pub cache_dir: PathBuf,
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub home_dir: PathBuf,
    pub legacy_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub state_dir: PathBuf,
}

impl GhostexPaths {
    /// Resolve the platform-native per-user Ghostex directories.
    ///
    /// `GHOSTEX_HOME` remains an explicit compatibility override for isolated
    /// development/test profiles. When set, it intentionally keeps the old
    /// single-root shape instead of mixing that profile with platform stores.
    pub fn resolve() -> Self {
        let home_dir = user_home_dir();
        if let Some(root) = nonempty_env_path("GHOSTEX_HOME") {
            return Self::unified(home_dir, root);
        }

        Self::platform_defaults(home_dir)
    }

    /// Resolve production directories and perform the idempotent legacy
    /// migration before returning them to a runtime consumer.
    pub fn resolve_and_migrate() -> io::Result<Self> {
        let paths = Self::resolve();
        paths.migrate_legacy_layout()?;
        Ok(paths)
    }

    /// Preserve the historical explicit-home behavior used by isolated daemon
    /// runs without consulting or mutating the real user's platform stores.
    pub fn for_explicit_home(home_dir: PathBuf) -> Self {
        let legacy_dir = home_dir.join(".ghostex");
        Self::unified(home_dir, legacy_dir)
    }

    pub fn sidebar_settings_file(&self) -> PathBuf {
        self.config_dir.join("native-sidebar-settings.json")
    }

    pub fn gxserver_config_dir(&self) -> PathBuf {
        self.config_dir.join("gxserver")
    }

    pub fn gxserver_state_dir(&self) -> PathBuf {
        self.state_dir.join("gxserver")
    }

    pub fn gxserver_data_dir(&self) -> PathBuf {
        self.data_dir.join("gxserver")
    }

    pub fn clients_dir(&self) -> PathBuf {
        self.config_dir.join("clients")
    }

    pub fn hooks_dir(&self) -> PathBuf {
        self.data_dir.join("hooks")
    }

    pub fn images_dir(&self) -> PathBuf {
        self.data_dir.join("i")
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.data_dir.join("f")
    }

    pub fn icons_dir(&self) -> PathBuf {
        self.data_dir.join("icons")
    }

    pub fn source_runtime_dir(&self) -> PathBuf {
        self.data_dir.join("source-runtime")
    }

    pub fn code_server_runtime_dir(&self) -> PathBuf {
        self.data_dir.join("code-server-runtime-gpui")
    }

    pub fn t3_runtime_dir(&self) -> PathBuf {
        self.data_dir.join("t3-runtime")
    }

    pub fn cef_cache_dir(&self) -> PathBuf {
        self.cache_dir.join("cef")
    }

    pub fn migration_marker(&self) -> PathBuf {
        self.state_dir
            .join("migrations")
            .join(LEGACY_MIGRATION_MARKER)
    }

    pub fn migrate_legacy_layout(&self) -> io::Result<()> {
        if env::var_os("GHOSTEX_HOME").is_some() || self.migration_marker().exists() {
            return Ok(());
        }
        if !self.legacy_dir.is_dir() {
            return self.write_migration_marker();
        }

        fs::create_dir_all(&self.config_dir)?;
        fs::create_dir_all(&self.state_dir)?;
        fs::create_dir_all(&self.data_dir)?;
        fs::create_dir_all(&self.cache_dir)?;
        fs::create_dir_all(&self.logs_dir)?;
        fs::create_dir_all(&self.runtime_dir)?;

        // Settings are migrated first so the first updated macOS launch reads
        // the user's existing preferences from the new Application Support
        // location rather than creating defaults over them.
        move_if_missing(
            &self.legacy_dir.join("state/native-sidebar-settings.json"),
            &self.sidebar_settings_file(),
        )?;

        migrate_directory_contents(&self.legacy_dir.join("clients"), &self.clients_dir())?;
        migrate_directory_contents(&self.legacy_dir.join("logs"), &self.logs_dir)?;
        migrate_directory_contents(&self.legacy_dir.join("state"), &self.state_dir)?;
        migrate_gxserver(&self.legacy_dir.join("gxserver"), self)?;

        for (name, destination) in [
            ("hooks", self.hooks_dir()),
            ("i", self.images_dir()),
            ("f", self.attachments_dir()),
            ("icons", self.icons_dir()),
            ("source-runtime", self.source_runtime_dir()),
            ("code-server-runtime-gpui", self.code_server_runtime_dir()),
            ("t3-runtime", self.t3_runtime_dir()),
            ("chats", self.data_dir.join("chats")),
            ("cli", self.state_dir.join("cli")),
            ("remote-attach-carriers", self.state_dir.join("remote-attach-carriers")),
            ("zehn", self.cache_dir.join("zehn")),
            ("cef", self.cef_cache_dir()),
        ] {
            migrate_directory_contents(&self.legacy_dir.join(name), &destination)?;
        }

        // Unknown legacy entries are retained under Data/legacy rather than
        // discarded. This makes the migration forward-compatible with older
        // builds that may have created a top-level directory no longer known to
        // the current app.
        if let Ok(entries) = fs::read_dir(&self.legacy_dir) {
            for entry in entries.flatten() {
                let source = entry.path();
                let name = entry.file_name();
                let destination = self.data_dir.join("legacy").join(name);
                move_if_missing(&source, &destination)?;
            }
        }

        self.write_migration_marker()
    }

    fn unified(home_dir: PathBuf, root: PathBuf) -> Self {
        Self {
            cache_dir: root.join("cache"),
            config_dir: root.clone(),
            data_dir: root.clone(),
            home_dir,
            legacy_dir: root.clone(),
            logs_dir: root.join("logs"),
            runtime_dir: root.join("runtime"),
            state_dir: root.join("state"),
        }
    }

    fn platform_defaults(home_dir: PathBuf) -> Self {
        let legacy_dir = home_dir.join(".ghostex");

        #[cfg(target_os = "macos")]
        {
            let application_support = home_dir
                .join("Library/Application Support")
                .join(PRODUCT_DIR_NATIVE);
            return Self {
                cache_dir: home_dir.join("Library/Caches").join(PRODUCT_DIR_NATIVE),
                config_dir: application_support.join("Config"),
                data_dir: application_support.join("Data"),
                home_dir: home_dir.clone(),
                legacy_dir,
                logs_dir: home_dir.join("Library/Logs").join(PRODUCT_DIR_NATIVE),
                runtime_dir: application_support.join("Runtime"),
                state_dir: application_support.join("State"),
            };
        }

        #[cfg(target_os = "windows")]
        {
            let roaming = nonempty_env_path("APPDATA")
                .unwrap_or_else(|| home_dir.join("AppData/Roaming"));
            let local = nonempty_env_path("LOCALAPPDATA")
                .unwrap_or_else(|| home_dir.join("AppData/Local"))
                .join(PRODUCT_DIR_NATIVE);
            return Self {
                cache_dir: local.join("Cache"),
                config_dir: roaming.join(PRODUCT_DIR_NATIVE),
                data_dir: local.join("Data"),
                home_dir,
                legacy_dir,
                logs_dir: local.join("Logs"),
                runtime_dir: local.join("Runtime"),
                state_dir: local.join("State"),
            };
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let config_base = xdg_base("XDG_CONFIG_HOME", &home_dir, ".config");
            let state_base = xdg_base("XDG_STATE_HOME", &home_dir, ".local/state");
            let data_base = xdg_base("XDG_DATA_HOME", &home_dir, ".local/share");
            let cache_base = xdg_base("XDG_CACHE_HOME", &home_dir, ".cache");
            let state_dir = state_base.join(PRODUCT_DIR_UNIX);
            let runtime_dir = nonempty_env_path("XDG_RUNTIME_DIR")
                .map(|base| base.join(PRODUCT_DIR_UNIX))
                .unwrap_or_else(|| state_dir.join("runtime"));
            Self {
                cache_dir: cache_base.join(PRODUCT_DIR_UNIX),
                config_dir: config_base.join(PRODUCT_DIR_UNIX),
                data_dir: data_base.join(PRODUCT_DIR_UNIX),
                home_dir,
                legacy_dir,
                logs_dir: state_dir.join("logs"),
                runtime_dir,
                state_dir,
            }
        }
    }

    fn write_migration_marker(&self) -> io::Result<()> {
        let marker = self.migration_marker();
        if let Some(parent) = marker.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(marker, b"Ghostex platform storage migration v1\n")
    }
}

fn migrate_gxserver(source: &Path, paths: &GhostexPaths) -> io::Result<()> {
    if !source.is_dir() {
        return Ok(());
    }
    let config_dir = paths.gxserver_config_dir();
    move_if_missing(&source.join("config.json"), &config_dir.join("config.json"))?;

    let data_dir = paths.gxserver_data_dir();
    for name in ["package", "releases", "windows-app-runtime.sha256"] {
        move_if_missing(&source.join(name), &data_dir.join(name))?;
    }

    migrate_directory_contents(source, &paths.gxserver_state_dir())
}

fn migrate_directory_contents(source: &Path, destination: &Path) -> io::Result<()> {
    if !source.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        move_if_missing(&entry.path(), &destination.join(entry.file_name()))?;
    }
    remove_empty_directory(source)
}

fn move_if_missing(source: &Path, destination: &Path) -> io::Result<()> {
    if !source.exists() || destination.exists() {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {
            copy_recursively(source, destination)?;
            if source.is_dir() {
                fs::remove_dir_all(source)
            } else {
                fs::remove_file(source)
            }
        }
        Err(error) => Err(error),
    }
}

fn copy_recursively(source: &Path, destination: &Path) -> io::Result<()> {
    if source.is_dir() {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_recursively(&entry.path(), &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }
    fs::copy(source, destination).map(|_| ())
}

fn remove_empty_directory(path: &Path) -> io::Result<()> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::DirectoryNotEmpty => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn user_home_dir() -> PathBuf {
    nonempty_env_path("HOME")
        .or_else(|| nonempty_env_path("USERPROFILE"))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn xdg_base(variable: &str, home_dir: &Path, fallback: &str) -> PathBuf {
    nonempty_env_path(variable).unwrap_or_else(|| home_dir.join(fallback))
}

fn nonempty_env_path(variable: &str) -> Option<PathBuf> {
    env::var_os(variable).and_then(|value| {
        (!value.is_empty())
            .then_some(value)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
    })
}
