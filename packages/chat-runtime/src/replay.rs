//! The sink for the chat brain's replay recording.
//!
//! CDXC:SessionChat 2026-09-22 WHY:
//! A recording is the conversation itself, so it never joins the support logs: it goes to one
//! owner-only file under /tmp, which the operating system clears on restart, and the runtime
//! refuses to record at all when that file cannot be made private. The engine writes through a
//! host function rather than buffering inside QuickJS so a recording survives a crash of the
//! chat it is observing.

use anyhow::{Context as _, Result};
use std::cell::RefCell;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::rc::Rc;

/// Opens `path` for appending with owner-only permissions, creating its directory the same way.
fn open_private(path: &Path) -> Result<File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| "create the chat recording directory".to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
                .context("restrict the chat recording directory")?;
        }
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).context("open the chat recording")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // An earlier run, or another process, may have left a readable file at this path.
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .context("restrict the chat recording")?;
    }
    Ok(file)
}

/// Installs the append function and asks the bundle to route its host seam into it.
pub(crate) fn install(ctx: &rquickjs::Ctx<'_>, path: &Path) -> Result<()> {
    let file = Rc::new(RefCell::new(open_private(path)?));
    ctx.globals()
        .set(
            "ghostexChatReplayAppend",
            rquickjs::Function::new(ctx.clone(), move |line: String| {
                let mut file = file.borrow_mut();
                let _ = file.write_all(line.as_bytes());
                let _ = file.write_all(b"\n");
            })
            .context("create the chat recording sink")?,
        )
        .context("install the chat recording sink")?;
    ctx.eval::<(), _>("nativeChat.replay(ghostexChatReplayAppend)")
        .map_err(|_| anyhow::anyhow!("the chat runtime refused the replay hooks"))
}
