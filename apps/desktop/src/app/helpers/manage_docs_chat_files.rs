use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use super::MANAGE_DOCS_CHAT_FILE_MOUNT_SEGMENT;
use crate::shared_settings;

/// CDXC:Docs 2026-09-16 WHY:
/// Open files and drafts survive reloads, so their native file grants must too.
/// A single temporary grant was cleared by Code links and replaced by the next Docs link, invalidating open documents and aliasing same-named files in different folders.
/// Each project/file pair has a stable mount backed by a native-owned record; the renderer stores only its Docs address.
pub(crate) struct ManageChatFileAuthorization {
    pub(crate) file_name: String,
    pub(crate) project_id: String,
    pub(crate) root: PathBuf,
}

fn authorization_directory() -> PathBuf {
    shared_settings::ghostex_storage_paths()
        .state_dir
        .join("docs-chat-files")
}

impl ManageChatFileAuthorization {
    fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "fileName": self.file_name,
            "projectId": self.project_id,
            "root": self.root,
        })
    }

    fn id(&self) -> String {
        format!("{:x}", Sha256::digest(self.json().to_string().as_bytes()))
    }
}

pub(crate) fn authorize_manage_chat_file(project_id: &str, file: &Path) -> Result<String, String> {
    let file =
        fs::canonicalize(file).map_err(|_| "That document is no longer available.".to_string())?;
    if file.to_str().is_none() {
        return Err("That document has no valid file path.".to_string());
    }
    let authorization = ManageChatFileAuthorization {
        file_name: file
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "That document has no valid file name.".to_string())?
            .to_string(),
        project_id: project_id.to_string(),
        root: file
            .parent()
            .ok_or_else(|| "That document has no containing folder.".to_string())?
            .to_path_buf(),
    };
    let id = authorization.id();
    let directory = authorization_directory();
    let destination = directory.join(format!("{id}.json"));
    let bytes = authorization.json().to_string().into_bytes();
    if fs::read(&destination).ok().as_deref() != Some(bytes.as_slice()) {
        let persist = || -> std::io::Result<()> {
            fs::create_dir_all(&directory)?;
            let temporary = directory.join(format!("{id}.{}.tmp", std::process::id()));
            let mut options = fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut output = options.open(&temporary)?;
            output.write_all(&bytes)?;
            output.sync_all()?;
            drop(output);
            fs::rename(&temporary, &destination)
        };
        persist().map_err(|error| format!("Could not remember this file for Docs: {error}"))?;
    }
    Ok(format!(
        "{MANAGE_DOCS_CHAT_FILE_MOUNT_SEGMENT}/{id}/{}",
        authorization.file_name
    ))
}

/// Splits the stable grant identity from a path within its document folder.
pub(crate) fn manage_chat_file_address(path: &str) -> Option<(&str, &str)> {
    let path = path
        .strip_prefix(MANAGE_DOCS_CHAT_FILE_MOUNT_SEGMENT)?
        .strip_prefix('/')?;
    let (id, inner) = path.split_once('/')?;
    (id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
    .then_some((id, inner))
}

pub(crate) fn resolve_manage_chat_file(
    project_id: &str,
    path: &str,
) -> Option<ManageChatFileAuthorization> {
    let (id, _) = manage_chat_file_address(path)?;
    let bytes = fs::read(authorization_directory().join(format!("{id}.json"))).ok()?;
    let record: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let authorization = ManageChatFileAuthorization {
        file_name: record.get("fileName")?.as_str()?.to_string(),
        project_id: record.get("projectId")?.as_str()?.to_string(),
        root: PathBuf::from(record.get("root")?.as_str()?),
    };
    (authorization.project_id == project_id && authorization.id() == id).then_some(authorization)
}
