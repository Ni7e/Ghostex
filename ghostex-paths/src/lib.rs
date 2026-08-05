use std::{
    env,
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
};

const PRODUCT_DIR_UNIX: &str = "ghostex";
#[cfg(target_os = "windows")]
const PRODUCT_DIR_NATIVE: &str = "Ghostex";
const LEGACY_MIGRATION_MARKER: &str = "legacy-storage-v3.complete";
const PREVIOUS_LEGACY_MIGRATION_MARKER: &str = "legacy-storage-v2.complete";

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
    /// Resolve the per-user Ghostex directories.
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
        if nonempty_env_path("GHOSTEX_HOME").is_some() || self.migration_marker().exists() {
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        self.migrate_legacy_macos_layout()?;

        self.migrate_legacy_dot_directory()?;
        self.write_migration_marker()
    }

    fn migrate_legacy_dot_directory(&self) -> io::Result<()> {
        let legacy_type = match fs::symlink_metadata(&self.legacy_dir) {
            Ok(metadata) => Some(metadata.file_type()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        let previous_marker_exists = self
            .state_dir
            .join("migrations")
            .join(PREVIOUS_LEGACY_MIGRATION_MARKER)
            .is_file();
        if legacy_type.is_some_and(|file_type| !file_type.is_dir()) {
            return move_if_missing(
                &self.legacy_dir,
                &self.data_dir.join("legacy/legacy-dot-ghostex"),
            );
        }
        if legacy_type.is_none() && !previous_marker_exists {
            return Ok(());
        }

        fs::create_dir_all(&self.config_dir)?;
        fs::create_dir_all(&self.state_dir)?;
        fs::create_dir_all(&self.data_dir)?;
        fs::create_dir_all(&self.cache_dir)?;
        fs::create_dir_all(&self.logs_dir)?;
        fs::create_dir_all(&self.runtime_dir)?;

        if legacy_type.is_some() {
            // Settings are migrated first so the first updated launch reads the
            // user's existing preferences rather than creating defaults over them.
            move_if_missing(
                &self.legacy_dir.join("state/native-sidebar-settings.json"),
                &self.sidebar_settings_file(),
            )?;
            move_if_missing(
                &self.legacy_dir.join("editor-window-frame.json"),
                &self.state_dir.join("editor-window-frame.json"),
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
                (
                    "remote-attach-carriers",
                    self.state_dir.join("remote-attach-carriers"),
                ),
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
        }

        #[cfg(unix)]
        for (name, destination) in [
            ("i", self.images_dir()),
            ("f", self.attachments_dir()),
            ("chats", self.data_dir.join("chats")),
            ("icons", self.icons_dir()),
        ] {
            ensure_legacy_directory_link(&self.legacy_dir.join(name), &destination)?;
        }

        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn migrate_legacy_macos_layout(&self) -> io::Result<()> {
        let application_support = self
            .home_dir
            .join("Library/Application Support")
            .join("Ghostex");
        let legacy_cache = self.home_dir.join("Library/Caches/Ghostex");
        let legacy_logs = self.home_dir.join("Library/Logs/Ghostex");
        let archive_root = self.data_dir.join("legacy/macos-platform-storage");

        for (name, source, destination) in [
            (
                "Config",
                application_support.join("Config"),
                self.config_dir.clone(),
            ),
            (
                "Data",
                application_support.join("Data"),
                self.data_dir.clone(),
            ),
            (
                "State",
                application_support.join("State"),
                self.state_dir.clone(),
            ),
            (
                "Runtime",
                application_support.join("Runtime"),
                self.runtime_dir.clone(),
            ),
            (
                "components",
                application_support.join("components"),
                self.data_dir.join("components"),
            ),
            (
                "on-demand",
                application_support.join("on-demand"),
                self.data_dir.join("on-demand"),
            ),
            ("Cache", legacy_cache.clone(), self.cache_dir.clone()),
            ("Logs", legacy_logs.clone(), self.logs_dir.clone()),
        ] {
            migrate_directory_contents(&source, &destination)?;
            move_if_missing(&source, &archive_root.join(name))?;
        }

        remove_empty_directory(&application_support)?;
        move_if_missing(
            &application_support,
            &archive_root.join("ApplicationSupport"),
        )?;
        Ok(())
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

        #[cfg(target_os = "windows")]
        {
            let roaming =
                nonempty_env_path("APPDATA").unwrap_or_else(|| home_dir.join("AppData/Roaming"));
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

        #[cfg(not(target_os = "windows"))]
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
        fs::write(marker, b"Ghostex XDG storage migration v3\n")
    }
}

fn migrate_gxserver(source: &Path, paths: &GhostexPaths) -> io::Result<()> {
    if !fs::symlink_metadata(source).is_ok_and(|metadata| metadata.file_type().is_dir()) {
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
    let source_type = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata.file_type(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !source_type.is_dir() {
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
    let source_type = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata.file_type(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let destination_type = match fs::symlink_metadata(destination) {
        Ok(metadata) => Some(metadata.file_type()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    if let Some(destination_type) = destination_type {
        if source_type.is_dir() && destination_type.is_dir() {
            return migrate_directory_contents(source, destination);
        }
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {
            copy_recursively(source, destination)?;
            if source_type.is_dir() {
                fs::remove_dir_all(source)
            } else {
                fs::remove_file(source)
            }
        }
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn ensure_legacy_directory_link(link: &Path, destination: &Path) -> io::Result<()> {
    if fs::symlink_metadata(link).is_ok() {
        return Ok(());
    }
    fs::create_dir_all(destination)?;
    if let Some(parent) = link.parent() {
        fs::create_dir_all(parent)?;
    }
    std::os::unix::fs::symlink(destination, link)
}

fn copy_recursively(source: &Path, destination: &Path) -> io::Result<()> {
    let source_type = fs::symlink_metadata(source)?.file_type();
    if source_type.is_symlink() {
        let target = fs::read_link(source)?;
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, destination);
        #[cfg(windows)]
        {
            return if fs::metadata(source).is_ok_and(|metadata| metadata.is_dir()) {
                std::os::windows::fs::symlink_dir(target, destination)
            } else {
                std::os::windows::fs::symlink_file(target, destination)
            };
        }
        #[cfg(not(any(unix, windows)))]
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "copying symbolic links is unsupported on this platform",
        ));
    }
    if source_type.is_dir() {
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
    env::var_os(variable).and_then(|value| absolute_nonempty_path(&value))
}

fn absolute_nonempty_path(value: &OsStr) -> Option<PathBuf> {
    (!value.is_empty())
        .then(|| PathBuf::from(value))
        .filter(|path| path.is_absolute())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_resolves_the_same_xdg_layout_as_linux() {
        if nonempty_env_path("GHOSTEX_HOME").is_some() {
            return;
        }
        let home = user_home_dir();
        let paths = GhostexPaths::resolve();
        assert_eq!(
            paths.config_dir,
            xdg_base("XDG_CONFIG_HOME", &home, ".config").join("ghostex")
        );
        assert_eq!(
            paths.data_dir,
            xdg_base("XDG_DATA_HOME", &home, ".local/share").join("ghostex")
        );
        assert_eq!(
            paths.state_dir,
            xdg_base("XDG_STATE_HOME", &home, ".local/state").join("ghostex")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn migrates_the_previous_macos_library_layout_without_overwriting() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let test_root = env::temp_dir().join(format!(
            "ghostex-paths-macos-migration-{}-{unique}",
            std::process::id()
        ));
        let home = test_root.join("home");
        let config_dir = home.join(".config/ghostex");
        let data_dir = home.join(".local/share/ghostex");
        let state_dir = home.join(".local/state/ghostex");
        let cache_dir = home.join(".cache/ghostex");
        let legacy_app_support = home.join("Library/Application Support/Ghostex");

        fs::create_dir_all(legacy_app_support.join("Config/gxserver")).expect("old config");
        fs::create_dir_all(legacy_app_support.join("Data/hooks")).expect("old data");
        fs::create_dir_all(legacy_app_support.join("State/gxserver")).expect("old state");
        fs::create_dir_all(legacy_app_support.join("components/cef")).expect("old components");
        fs::create_dir_all(config_dir.join("gxserver")).expect("new config");
        fs::write(
            legacy_app_support.join("Config/gxserver/config.json"),
            b"old",
        )
        .expect("old config file");
        fs::write(config_dir.join("gxserver/config.json"), b"new").expect("new config file");
        fs::write(
            legacy_app_support.join("Config/gxserver/legacy-client.json"),
            b"legacy client",
        )
        .expect("non-conflicting nested config file");
        fs::write(legacy_app_support.join("Data/hooks/notify"), b"hook").expect("old hook");
        fs::write(legacy_app_support.join("State/gxserver/state.db"), b"state")
            .expect("old state file");
        fs::write(
            legacy_app_support.join("components/cef/payload"),
            b"component",
        )
        .expect("old component file");

        let paths = GhostexPaths {
            cache_dir,
            config_dir: config_dir.clone(),
            data_dir: data_dir.clone(),
            home_dir: home.clone(),
            legacy_dir: home.join(".ghostex"),
            logs_dir: state_dir.join("logs"),
            runtime_dir: state_dir.join("runtime"),
            state_dir: state_dir.clone(),
        };
        paths
            .migrate_legacy_macos_layout()
            .expect("migrate old macOS layout");

        assert_eq!(
            fs::read(config_dir.join("gxserver/config.json")).unwrap(),
            b"new"
        );
        assert_eq!(
            fs::read(config_dir.join("gxserver/legacy-client.json")).unwrap(),
            b"legacy client"
        );
        assert_eq!(fs::read(data_dir.join("hooks/notify")).unwrap(), b"hook");
        assert_eq!(
            fs::read(state_dir.join("gxserver/state.db")).unwrap(),
            b"state"
        );
        assert_eq!(
            fs::read(data_dir.join("components/cef/payload")).unwrap(),
            b"component"
        );
        assert_eq!(
            fs::read(data_dir.join("legacy/macos-platform-storage/Config/gxserver/config.json"))
                .unwrap(),
            b"old"
        );

        fs::remove_dir_all(&test_root).expect("remove temp tree");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn public_migration_combines_both_legacy_layouts_and_is_idempotent() {
        if nonempty_env_path("GHOSTEX_HOME").is_some() {
            return;
        }
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let test_root = env::temp_dir().join(format!(
            "ghostex-paths-complete-migration-{}-{unique}",
            std::process::id()
        ));
        let home = test_root.join("home");
        let config_dir = home.join(".config/ghostex");
        let data_dir = home.join(".local/share/ghostex");
        let state_dir = home.join(".local/state/ghostex");
        let cache_dir = home.join(".cache/ghostex");
        let legacy_app_support = home.join("Library/Application Support/Ghostex");
        let legacy_dir = home.join(".ghostex");

        fs::create_dir_all(legacy_app_support.join("Config")).expect("library config");
        fs::create_dir_all(legacy_app_support.join("Data")).expect("library data");
        fs::create_dir_all(legacy_app_support.join("Runtime")).expect("library runtime");
        fs::create_dir_all(home.join("Library/Caches/Ghostex")).expect("library cache");
        fs::create_dir_all(home.join("Library/Logs/Ghostex")).expect("library logs");
        fs::create_dir_all(legacy_dir.join("i")).expect("dot images");
        fs::create_dir_all(legacy_dir.join("clients")).expect("dot clients");
        fs::create_dir_all(&config_dir).expect("new config");
        fs::write(legacy_app_support.join("Config/current.json"), b"old")
            .expect("old conflict");
        fs::write(config_dir.join("current.json"), b"new").expect("new conflict");
        fs::write(legacy_app_support.join("Data/library-data"), b"library")
            .expect("library data file");
        fs::write(legacy_app_support.join("Runtime/socket"), b"runtime")
            .expect("runtime file");
        fs::write(home.join("Library/Caches/Ghostex/cache"), b"cache").expect("cache file");
        fs::write(home.join("Library/Logs/Ghostex/log"), b"log").expect("log file");
        fs::write(legacy_dir.join("i/old.png"), b"image").expect("dot image");
        fs::write(legacy_dir.join("clients/client.json"), b"client").expect("dot client");

        let paths = GhostexPaths {
            cache_dir: cache_dir.clone(),
            config_dir: config_dir.clone(),
            data_dir: data_dir.clone(),
            home_dir: home.clone(),
            legacy_dir: legacy_dir.clone(),
            logs_dir: state_dir.join("logs"),
            runtime_dir: state_dir.join("runtime"),
            state_dir: state_dir.clone(),
        };
        paths.migrate_legacy_layout().expect("public migration");

        assert_eq!(fs::read(config_dir.join("current.json")).unwrap(), b"new");
        assert_eq!(fs::read(data_dir.join("library-data")).unwrap(), b"library");
        assert_eq!(fs::read(data_dir.join("i/old.png")).unwrap(), b"image");
        assert_eq!(fs::read(config_dir.join("clients/client.json")).unwrap(), b"client");
        assert_eq!(fs::read(cache_dir.join("cache")).unwrap(), b"cache");
        assert_eq!(fs::read(state_dir.join("logs/log")).unwrap(), b"log");
        assert_eq!(fs::read(state_dir.join("runtime/socket")).unwrap(), b"runtime");
        assert_eq!(
            fs::read(data_dir.join("legacy/macos-platform-storage/Config/current.json")).unwrap(),
            b"old"
        );
        assert!(paths.migration_marker().is_file());
        assert_eq!(fs::read_link(legacy_dir.join("i")).unwrap(), paths.images_dir());

        fs::write(legacy_dir.join("after-marker"), b"leave in place")
            .expect("post-migration legacy file");
        paths.migrate_legacy_layout().expect("idempotent migration");
        assert_eq!(
            fs::read(legacy_dir.join("after-marker")).unwrap(),
            b"leave in place"
        );

        fs::remove_dir_all(&test_root).expect("remove temp tree");
    }

    #[test]
    fn environment_paths_must_be_nonempty_and_absolute() {
        assert_eq!(absolute_nonempty_path(OsStr::new("")), None);
        assert_eq!(absolute_nonempty_path(OsStr::new("relative/path")), None);
        assert_eq!(
            absolute_nonempty_path(OsStr::new("/absolute/path")),
            Some(PathBuf::from("/absolute/path"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn directory_merge_does_not_follow_conflicting_symlinks() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let test_root = env::temp_dir().join(format!(
            "ghostex-paths-symlink-migration-{}-{unique}",
            std::process::id()
        ));
        let source = test_root.join("source");
        let destination = test_root.join("destination");
        let external = test_root.join("external");
        fs::create_dir_all(&source).expect("source");
        fs::create_dir_all(destination.join("linked")).expect("destination collision");
        fs::create_dir_all(&external).expect("external");
        fs::write(external.join("outside"), b"untouched").expect("external file");
        std::os::unix::fs::symlink(&external, source.join("linked")).expect("legacy symlink");

        migrate_directory_contents(&source, &destination).expect("safe merge");

        assert!(fs::symlink_metadata(source.join("linked"))
            .expect("symlink remains")
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(external.join("outside")).unwrap(), b"untouched");
        assert!(!destination.join("linked/outside").exists());

        fs::remove_dir_all(&test_root).expect("remove temp tree");
    }
}
