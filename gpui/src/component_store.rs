use std::{
    collections::HashMap,
    env, fs,
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use flate2::read::GzDecoder;
use sha2::{Digest as _, Sha256};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt as _;

const MANIFEST_SCHEMA_VERSION: u64 = 2;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReleaseAsset {
    pub bytes: u64,
    pub name: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComponentPlatformAsset {
    pub asset_name: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComponentDefinition {
    pub name: String,
    pub component_version: String,
    pub download_tag: String,
    pub platforms: HashMap<String, ComponentPlatformAsset>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OnDemandManifest {
    pub version: String,
    pub github_repo: String,
    pub assets: HashMap<String, ReleaseAsset>,
    pub components: HashMap<String, ComponentDefinition>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ComponentStoreProgressPhase {
    Checking,
    Downloading,
    Verifying,
    Installing,
    Pruning,
    Ready,
}

impl ComponentStoreProgressPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Checking => "checking",
            Self::Downloading => "downloading",
            Self::Verifying => "verifying",
            Self::Installing => "installing",
            Self::Pruning => "pruning",
            Self::Ready => "ready",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComponentStoreProgress {
    pub component: String,
    pub component_version: String,
    pub platform: String,
    pub phase: ComponentStoreProgressPhase,
    pub size_bytes: u64,
}

impl ComponentStoreProgress {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "component": self.component,
            "componentVersion": self.component_version,
            "platform": self.platform,
            "phase": self.phase.as_str(),
            "sizeBytes": self.size_bytes,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstalledComponent {
    pub installed: bool,
    pub name: String,
    pub version: String,
    pub platform: String,
    pub path: PathBuf,
    pub size_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReleaseAssetCachePayload<'a> {
    DownloadArchive,
    ExtractedExecutable(&'a str),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CachedReleaseAsset {
    pub asset_key: String,
    pub cached: bool,
    pub download_size_bytes: u64,
    pub path: PathBuf,
    pub size_bytes: u64,
    pub version: String,
}

pub struct ComponentStore {
    manifest: OnDemandManifest,
    root: PathBuf,
}

pub fn path_size_bytes(path: &Path) -> Result<u64, String> {
    if path.is_file() {
        return path
            .metadata()
            .map(|metadata| metadata.len())
            .map_err(|error| format!("Could not read component file size: {error}"));
    }
    directory_size(path)
}

impl OnDemandManifest {
    pub fn load(path: &Path) -> Result<Self, String> {
        let data = fs::read_to_string(path).map_err(|error| {
            format!(
                "Could not read sealed on-demand manifest {}: {error}",
                path.display()
            )
        })?;
        let payload = serde_json::from_str::<serde_json::Value>(&data).map_err(|error| {
            format!(
                "Malformed sealed on-demand manifest {}: {error}",
                path.display()
            )
        })?;
        Self::parse(&payload)
    }

    fn parse(payload: &serde_json::Value) -> Result<Self, String> {
        let root = object(payload, "root")?;
        if unsigned(root.get("schemaVersion"), "schemaVersion")? != MANIFEST_SCHEMA_VERSION {
            return Err(
                "Malformed sealed on-demand manifest: schemaVersion must equal 2".to_string(),
            );
        }
        let version = nonempty_string(root.get("version"), "version")?;
        let github_repo = nonempty_string(root.get("githubRepo"), "githubRepo")?;
        if github_repo.matches('/').count() != 1
            || github_repo.split('/').any(|part| !valid_identifier(part))
        {
            return Err(
                "Malformed sealed on-demand manifest: githubRepo must have owner/repository form"
                    .to_string(),
            );
        }

        let mut assets = HashMap::new();
        for (key, raw_asset) in object(
            root.get("assets").ok_or_else(|| missing("assets"))?,
            "assets",
        )? {
            require_identifier(key, "release asset key")?;
            let asset = object(raw_asset, &format!("assets.{key}"))?;
            assets.insert(
                key.clone(),
                ReleaseAsset {
                    bytes: unsigned(asset.get("bytes"), &format!("assets.{key}.bytes"))?,
                    name: asset_name(asset.get("name"), &format!("assets.{key}.name"))?,
                    sha256: sha256(asset.get("sha256"), &format!("assets.{key}.sha256"))?,
                },
            );
        }

        let mut components = HashMap::new();
        for (key, raw_component) in object(
            root.get("components")
                .ok_or_else(|| missing("components"))?,
            "components",
        )? {
            require_identifier(key, "component key")?;
            let component = object(raw_component, &format!("components.{key}"))?;
            let name = identifier(component.get("name"), &format!("components.{key}.name"))?;
            if name != key.as_str() {
                return Err(format!(
                    "Malformed sealed on-demand manifest: components.{key}.name must equal its map key"
                ));
            }
            let component_version = identifier(
                component.get("componentVersion"),
                &format!("components.{key}.componentVersion"),
            )?;
            let download_tag = identifier(
                component.get("downloadTag"),
                &format!("components.{key}.downloadTag"),
            )?;
            let raw_platforms = object(
                component
                    .get("platforms")
                    .ok_or_else(|| missing(&format!("components.{key}.platforms")))?,
                &format!("components.{key}.platforms"),
            )?;
            if raw_platforms.is_empty() {
                return Err(format!(
                    "Malformed sealed on-demand manifest: components.{key}.platforms must not be empty"
                ));
            }
            let mut platforms = HashMap::new();
            for (platform, raw_platform_asset) in raw_platforms {
                require_identifier(platform, "component platform")?;
                let platform_asset = object(
                    raw_platform_asset,
                    &format!("components.{key}.platforms.{platform}"),
                )?;
                platforms.insert(
                    platform.clone(),
                    ComponentPlatformAsset {
                        asset_name: asset_name(
                            platform_asset.get("assetName"),
                            &format!("components.{key}.platforms.{platform}.assetName"),
                        )?,
                        sha256: sha256(
                            platform_asset.get("sha256"),
                            &format!("components.{key}.platforms.{platform}.sha256"),
                        )?,
                        size_bytes: unsigned(
                            platform_asset.get("sizeBytes"),
                            &format!("components.{key}.platforms.{platform}.sizeBytes"),
                        )?,
                    },
                );
            }
            components.insert(
                key.clone(),
                ComponentDefinition {
                    name,
                    component_version,
                    download_tag,
                    platforms,
                },
            );
        }
        Ok(Self {
            version,
            github_repo,
            assets,
            components,
        })
    }
}

impl ComponentStore {
    pub fn from_manifest(manifest: OnDemandManifest) -> Result<Self, String> {
        Ok(Self {
            manifest,
            root: component_store_root()?,
        })
    }

    pub fn with_root(manifest: OnDemandManifest, root: PathBuf) -> Self {
        Self { manifest, root }
    }

    pub fn release_version(&self) -> &str {
        &self.manifest.version
    }

    pub fn component(&self, name: &str) -> Option<&ComponentDefinition> {
        self.manifest.components.get(name)
    }

    pub fn query(&self, name: &str, version: &str) -> Result<InstalledComponent, String> {
        require_identifier(name, "component name")?;
        require_identifier(version, "component version")?;
        let platform = current_platform()?;
        let path = self.root.join(name).join(version).join(&platform);
        let expected_sha256 = self
            .manifest
            .components
            .get(name)
            .filter(|component| component.component_version == version)
            .and_then(|component| component.platforms.get(&platform))
            .map(|asset| asset.sha256.as_str());
        let installed = installed_marker_matches(&path, name, version, &platform, expected_sha256)?;
        let size_bytes = if installed { directory_size(&path)? } else { 0 };
        Ok(InstalledComponent {
            installed,
            name: name.to_string(),
            version: version.to_string(),
            platform,
            path,
            size_bytes,
        })
    }

    pub fn query_current(&self, name: &str) -> Result<InstalledComponent, String> {
        let component = self
            .manifest
            .components
            .get(name)
            .ok_or_else(|| format!("Sealed manifest does not define component {name}"))?;
        let platform = current_platform()?;
        if !component.platforms.contains_key(&platform) {
            return Err(format!(
                "Sealed manifest does not define {} {} for {platform}",
                component.name, component.component_version
            ));
        }
        self.query(&component.name, &component.component_version)
    }

    pub fn install(
        &self,
        name: &str,
        progress: &mut dyn FnMut(ComponentStoreProgress),
    ) -> Result<InstalledComponent, String> {
        let component = self
            .manifest
            .components
            .get(name)
            .ok_or_else(|| format!("Sealed manifest does not define component {name}"))?;
        let platform = current_platform()?;
        let asset = component.platforms.get(&platform).ok_or_else(|| {
            format!(
                "Sealed manifest does not define {} {} for {platform}",
                component.name, component.component_version
            )
        })?;
        let component_root = self.root.join(&component.name);
        let version_root = component_root.join(&component.component_version);
        emit(
            progress,
            component,
            &platform,
            asset.size_bytes,
            ComponentStoreProgressPhase::Checking,
        );
        let current = self.query(&component.name, &component.component_version)?;
        if current.installed {
            prune_temporary_install_artifacts(&version_root);
            emit(
                progress,
                component,
                &platform,
                asset.size_bytes,
                ComponentStoreProgressPhase::Ready,
            );
            return Ok(current);
        }

        fs::create_dir_all(&version_root).map_err(|error| {
            format!(
                "Could not create component store directory {}: {error}",
                version_root.display()
            )
        })?;
        let unique = unique_suffix();
        let archive_path = version_root.join(format!(".download-{}-{unique}", std::process::id()));
        let install_path = version_root.join(format!(".install-{}-{unique}", std::process::id()));
        let destination = version_root.join(&platform);
        let url = download_url(
            &self.manifest.github_repo,
            &component.download_tag,
            &asset.asset_name,
        );

        emit(
            progress,
            component,
            &platform,
            asset.size_bytes,
            ComponentStoreProgressPhase::Downloading,
        );
        if let Err(error) = download(&url, &archive_path) {
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
        emit(
            progress,
            component,
            &platform,
            asset.size_bytes,
            ComponentStoreProgressPhase::Verifying,
        );
        if let Err(error) = verify_file(&archive_path, &asset.sha256, asset.size_bytes) {
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
        remove_macos_quarantine(&archive_path)?;

        emit(
            progress,
            component,
            &platform,
            asset.size_bytes,
            ComponentStoreProgressPhase::Installing,
        );
        fs::create_dir_all(&install_path)
            .map_err(|error| format!("Could not prepare atomic component install: {error}"))?;
        if let Err(error) = unpack_tar_gz(&archive_path, &install_path) {
            let _ = fs::remove_dir_all(&install_path);
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
        remove_macos_quarantine(&install_path)?;
        if let Err(error) = write_install_marker(
            &install_path,
            &component.name,
            &component.component_version,
            &platform,
            &asset.sha256,
        ) {
            let _ = fs::remove_dir_all(&install_path);
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
        let _ = fs::remove_file(&archive_path);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|error| {
                format!(
                    "Could not replace invalid component install {}: {error}",
                    destination.display()
                )
            })?;
        }
        if let Err(error) = fs::rename(&install_path, &destination) {
            let _ = fs::remove_dir_all(&install_path);
            return Err(format!(
                "Could not atomically install component at {}: {error}",
                destination.display()
            ));
        }

        /*
        CDXC:ComponentStoreInterruptedInstallCleanup 2026-08-09:
        A process terminated after downloading or unpacking cannot run its
        normal error cleanup. Once this version has been installed atomically,
        every remaining .download-* or .install-* sibling is obsolete; remove
        those artifacts so a killed first launch does not permanently retain a
        full component archive.
        */
        prune_temporary_install_artifacts(&version_root);

        emit(
            progress,
            component,
            &platform,
            asset.size_bytes,
            ComponentStoreProgressPhase::Pruning,
        );
        prune_other_versions(&component_root, &component.component_version)?;
        emit(
            progress,
            component,
            &platform,
            asset.size_bytes,
            ComponentStoreProgressPhase::Ready,
        );
        self.query(&component.name, &component.component_version)
    }

    pub fn uninstall(&self, name: &str, version: &str) -> Result<bool, String> {
        require_identifier(name, "component name")?;
        require_identifier(version, "component version")?;
        let version_path = self.root.join(name).join(version);
        if !version_path.exists() {
            return Ok(false);
        }
        fs::remove_dir_all(&version_path)
            .map_err(|error| format!("Could not uninstall component {name} {version}: {error}"))?;
        Ok(true)
    }

    pub fn download_release_asset(
        &self,
        asset_key: &str,
        progress: &mut dyn FnMut(ComponentStoreProgress),
    ) -> Result<PathBuf, String> {
        let asset =
            self.manifest.assets.get(asset_key).ok_or_else(|| {
                format!("Sealed manifest does not define release asset {asset_key}")
            })?;
        let cache_dir = legacy_asset_cache_root()?.join(&self.manifest.version);
        fs::create_dir_all(&cache_dir).map_err(|error| {
            format!(
                "Could not create release asset cache {}: {error}",
                cache_dir.display()
            )
        })?;
        let destination = cache_dir.join(&asset.name);
        let compatibility_component = ComponentDefinition {
            name: asset_key.to_string(),
            component_version: self.manifest.version.clone(),
            download_tag: format!("v{}", self.manifest.version),
            platforms: HashMap::new(),
        };
        let platform = current_platform()?;
        emit(
            progress,
            &compatibility_component,
            &platform,
            asset.bytes,
            ComponentStoreProgressPhase::Checking,
        );
        if destination.is_file() && verify_file(&destination, &asset.sha256, asset.bytes).is_ok() {
            emit(
                progress,
                &compatibility_component,
                &platform,
                asset.bytes,
                ComponentStoreProgressPhase::Ready,
            );
            return Ok(destination);
        }
        let temporary = cache_dir.join(format!(
            ".download-{}-{}",
            std::process::id(),
            unique_suffix()
        ));
        emit(
            progress,
            &compatibility_component,
            &platform,
            asset.bytes,
            ComponentStoreProgressPhase::Downloading,
        );
        let url = download_url(
            &self.manifest.github_repo,
            &compatibility_component.download_tag,
            &asset.name,
        );
        if let Err(error) = download(&url, &temporary) {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        emit(
            progress,
            &compatibility_component,
            &platform,
            asset.bytes,
            ComponentStoreProgressPhase::Verifying,
        );
        if let Err(error) = verify_file(&temporary, &asset.sha256, asset.bytes) {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        remove_macos_quarantine(&temporary)?;
        if destination.exists() {
            fs::remove_file(&destination).map_err(|error| {
                format!(
                    "Could not replace cached release asset {}: {error}",
                    destination.display()
                )
            })?;
        }
        fs::rename(&temporary, &destination).map_err(|error| {
            format!(
                "Could not atomically cache release asset {}: {error}",
                destination.display()
            )
        })?;
        emit(
            progress,
            &compatibility_component,
            &platform,
            asset.bytes,
            ComponentStoreProgressPhase::Ready,
        );
        Ok(destination)
    }

    pub fn query_release_asset_cache(
        &self,
        asset_key: &str,
        payload: ReleaseAssetCachePayload<'_>,
    ) -> Result<CachedReleaseAsset, String> {
        let asset =
            self.manifest.assets.get(asset_key).ok_or_else(|| {
                format!("Sealed manifest does not define release asset {asset_key}")
            })?;
        let cache_dir = legacy_asset_cache_root()?.join(&self.manifest.version);
        let path = match payload {
            ReleaseAssetCachePayload::DownloadArchive => cache_dir.join(&asset.name),
            ReleaseAssetCachePayload::ExtractedExecutable(name) => {
                require_cache_file_name(name)?;
                cache_dir.join(name)
            }
        };
        let size_bytes = path
            .metadata()
            .ok()
            .filter(|metadata| metadata.is_file())
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let cached = match payload {
            ReleaseAssetCachePayload::DownloadArchive => size_bytes == asset.bytes,
            ReleaseAssetCachePayload::ExtractedExecutable(_) => {
                cached_executable_is_ready(&path, size_bytes)
            }
        };
        Ok(CachedReleaseAsset {
            asset_key: asset_key.to_string(),
            cached,
            download_size_bytes: asset.bytes,
            path,
            size_bytes,
            version: self.manifest.version.clone(),
        })
    }

    pub fn remove_release_asset_cache(
        &self,
        asset_key: &str,
        payload: ReleaseAssetCachePayload<'_>,
    ) -> Result<bool, String> {
        let cached = self.query_release_asset_cache(asset_key, payload)?;
        if !cached.path.exists() {
            return Ok(false);
        }
        fs::remove_file(&cached.path).map_err(|error| {
            format!(
                "Could not remove cached release asset {}: {error}",
                cached.path.display()
            )
        })?;
        Ok(true)
    }
}

fn emit(
    progress: &mut dyn FnMut(ComponentStoreProgress),
    component: &ComponentDefinition,
    platform: &str,
    size_bytes: u64,
    phase: ComponentStoreProgressPhase,
) {
    progress(ComponentStoreProgress {
        component: component.name.clone(),
        component_version: component.component_version.clone(),
        platform: platform.to_string(),
        phase,
        size_bytes,
    });
}

fn component_store_root() -> Result<PathBuf, String> {
    if let Some(override_root) = env::var_os("GHOSTEX_COMPONENT_STORE_DIR") {
        return Ok(PathBuf::from(override_root));
    }
    #[cfg(target_os = "macos")]
    return Ok(home_dir()?.join("Library/Application Support/Ghostex/components"));
    #[cfg(target_os = "windows")]
    return env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("Ghostex/components"))
        .ok_or_else(|| {
            "LOCALAPPDATA is unavailable; cannot locate the Ghostex component store".to_string()
        });
    #[cfg(all(unix, not(target_os = "macos")))]
    return Ok(home_dir()?.join(".local/share/ghostex/components"));
}

fn legacy_asset_cache_root() -> Result<PathBuf, String> {
    if let Some(override_root) = env::var_os("GHOSTEX_ON_DEMAND_CACHE_DIR") {
        return Ok(PathBuf::from(override_root));
    }
    #[cfg(target_os = "macos")]
    return Ok(home_dir()?.join("Library/Application Support/Ghostex/on-demand"));
    #[cfg(target_os = "windows")]
    return env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|root| root.join("Ghostex/on-demand"))
        .ok_or_else(|| {
            "LOCALAPPDATA is unavailable; cannot locate the Ghostex release asset cache".to_string()
        });
    #[cfg(all(unix, not(target_os = "macos")))]
    return Ok(home_dir()?.join(".local/share/ghostex/on-demand"));
}

fn home_dir() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is unavailable; cannot locate the Ghostex component store".to_string())
}

fn current_platform() -> Result<String, String> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err(
            "This operating system is unsupported by the Ghostex component store".to_string(),
        );
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        return Err(
            "This CPU architecture is unsupported by the Ghostex component store".to_string(),
        );
    };
    Ok(format!("{os}-{arch}"))
}

fn download_url(repo: &str, tag: &str, asset_name: &str) -> String {
    let base = env::var("GHOSTEX_ON_DEMAND_BASE_URL")
        .unwrap_or_else(|_| format!("https://github.com/{repo}/releases/download"));
    format!("{}/{tag}/{asset_name}", base.trim_end_matches('/'))
}

fn download(url: &str, destination: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = Command::new("/usr/bin/curl")
        .args([
            "--fail",
            "--location",
            "--retry",
            "2",
            "--max-time",
            "900",
            "--output",
        ])
        .arg(destination)
        .arg(url)
        .status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("curl")
        .args([
            "--fail",
            "--location",
            "--retry",
            "2",
            "--max-time",
            "900",
            "--output",
        ])
        .arg(destination)
        .arg(url)
        .status();
    #[cfg(target_os = "windows")]
    let status = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Invoke-WebRequest",
            "-UseBasicParsing",
            "-Uri",
        ])
        .arg(url)
        .args(["-OutFile"])
        .arg(destination)
        .status();
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "Could not download component asset from {url}: downloader exited with {status}"
        )),
        Err(error) => Err(format!(
            "Could not launch component downloader for {url}: {error}"
        )),
    }
}

fn verify_file(path: &Path, expected_sha256: &str, expected_size: u64) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "Could not inspect downloaded component asset {}: {error}",
            path.display()
        )
    })?;
    if metadata.len() != expected_size {
        return Err(format!(
            "Downloaded component asset size mismatch: expected {expected_size} bytes, received {} bytes",
            metadata.len()
        ));
    }
    let mut file = File::open(path).map_err(|error| {
        format!(
            "Could not open downloaded component asset {}: {error}",
            path.display()
        )
    })?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| {
            format!(
                "Could not hash downloaded component asset {}: {error}",
                path.display()
            )
        })?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual != expected_sha256 {
        return Err("Downloaded component asset failed SHA-256 verification against the app's sealed manifest".to_string());
    }
    Ok(())
}

fn unpack_tar_gz(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|error| {
        format!(
            "Could not open verified component archive {}: {error}",
            archive_path.display()
        )
    })?;
    let decoder = GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(destination).map_err(|error| {
        format!(
            "Could not unpack verified component archive {}: {error}",
            archive_path.display()
        )
    })
}

#[cfg(target_os = "macos")]
fn remove_macos_quarantine(path: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(path)
        .status()
        .map_err(|error| {
            format!(
                "Could not strip macOS quarantine from verified component {}: {error}",
                path.display()
            )
        })?;
    if !status.success() {
        return Err(format!(
            "Could not strip macOS quarantine from verified component {}: xattr exited with {status}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn remove_macos_quarantine(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn write_install_marker(
    path: &Path,
    name: &str,
    version: &str,
    platform: &str,
    sha256: &str,
) -> Result<(), String> {
    let marker = serde_json::json!({
        "name": name,
        "version": version,
        "platform": platform,
        "sha256": sha256,
    });
    fs::write(
        path.join(".ghostex-component.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&marker).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| format!("Could not write component install marker: {error}"))
}

fn installed_marker_matches(
    path: &Path,
    name: &str,
    version: &str,
    platform: &str,
    expected_sha256: Option<&str>,
) -> Result<bool, String> {
    if !path.is_dir() {
        return Ok(false);
    }
    let marker_path = path.join(".ghostex-component.json");
    let data = match fs::read_to_string(&marker_path) {
        Ok(data) => data,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "Could not read component marker {}: {error}",
                marker_path.display()
            ));
        }
    };
    let marker = serde_json::from_str::<serde_json::Value>(&data).map_err(|error| {
        format!(
            "Malformed component marker {}: {error}",
            marker_path.display()
        )
    })?;
    Ok(
        marker.get("name").and_then(serde_json::Value::as_str) == Some(name)
            && marker.get("version").and_then(serde_json::Value::as_str) == Some(version)
            && marker.get("platform").and_then(serde_json::Value::as_str) == Some(platform)
            && marker
                .get("sha256")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|sha256| {
                    valid_sha256(sha256)
                        && expected_sha256.is_none_or(|expected| sha256 == expected)
                }),
    )
}

fn directory_size(path: &Path) -> Result<u64, String> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path)
        .map_err(|error| format!("Could not measure {}: {error}", path.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Could not measure {}: {error}", path.display()))?;
        let metadata = entry
            .path()
            .symlink_metadata()
            .map_err(|error| format!("Could not measure {}: {error}", entry.path().display()))?;
        if metadata.is_dir() {
            total = total.saturating_add(directory_size(&entry.path())?);
        } else {
            total = total.saturating_add(metadata.len());
        }
    }
    Ok(total)
}

fn prune_temporary_install_artifacts(version_root: &Path) {
    let Ok(entries) = fs::read_dir(version_root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(".download-") && !name.starts_with(".install-") {
            continue;
        }
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => {
                let _ = fs::remove_dir_all(path);
            }
            Ok(_) => {
                let _ = fs::remove_file(path);
            }
            Err(_) => {}
        }
    }
}

fn prune_other_versions(component_root: &Path, retained_version: &str) -> Result<(), String> {
    for entry in fs::read_dir(component_root).map_err(|error| {
        format!(
            "Could not prune component versions under {}: {error}",
            component_root.display()
        )
    })? {
        let entry =
            entry.map_err(|error| format!("Could not inspect component version: {error}"))?;
        let name = entry.file_name();
        if name.to_string_lossy() == retained_version
            || !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
        {
            continue;
        }
        fs::remove_dir_all(entry.path()).map_err(|error| {
            format!(
                "Could not prune old component version {}: {error}",
                entry.path().display()
            )
        })?;
    }
    Ok(())
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn object<'a>(
    value: &'a serde_json::Value,
    label: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("Malformed sealed on-demand manifest: {label} must be an object"))
}

fn nonempty_string(value: Option<&serde_json::Value>, label: &str) -> Result<String, String> {
    value
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            format!("Malformed sealed on-demand manifest: {label} must be a non-empty string")
        })
}

fn identifier(value: Option<&serde_json::Value>, label: &str) -> Result<String, String> {
    let value = nonempty_string(value, label)?;
    require_identifier(&value, label)?;
    Ok(value)
}

fn asset_name(value: Option<&serde_json::Value>, label: &str) -> Result<String, String> {
    let value = nonempty_string(value, label)?;
    if value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err(format!(
            "Malformed sealed on-demand manifest: {label} must be a plain file name"
        ));
    }
    Ok(value)
}

fn sha256(value: Option<&serde_json::Value>, label: &str) -> Result<String, String> {
    let value = nonempty_string(value, label)?;
    if !valid_sha256(&value) {
        return Err(format!(
            "Malformed sealed on-demand manifest: {label} must be 64 lowercase hex characters"
        ));
    }
    Ok(value)
}

fn unsigned(value: Option<&serde_json::Value>, label: &str) -> Result<u64, String> {
    value.and_then(serde_json::Value::as_u64).ok_or_else(|| {
        format!("Malformed sealed on-demand manifest: {label} must be a non-negative integer")
    })
}

fn require_identifier(value: &str, label: &str) -> Result<(), String> {
    if valid_identifier(value) {
        Ok(())
    } else {
        Err(format!(
            "Malformed sealed on-demand manifest: {label} must be an identifier"
        ))
    }
}

fn require_cache_file_name(value: &str) -> Result<(), String> {
    if value.is_empty() || Path::new(value).components().count() != 1 || matches!(value, "." | "..")
    {
        return Err("Release asset cache file name must be a single file name".to_string());
    }
    Ok(())
}

fn cached_executable_is_ready(path: &Path, size_bytes: u64) -> bool {
    if size_bytes == 0 {
        return false;
    }
    #[cfg(unix)]
    return path
        .metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
    #[cfg(not(unix))]
    return true;
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn missing(label: &str) -> String {
    format!("Malformed sealed on-demand manifest: missing {label}")
}
