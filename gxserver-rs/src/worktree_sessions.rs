/*
CDXC:SidebarV2Worktrees 2026-07-29-00:00:
Sidebar V2 treats a worktree as an ATTRIBUTE of a session (its cwd plus the
branch checked out there), never as a registered sibling project. This module
owns the parts of that model that are pure or process-local:

- the temp-branch vocabulary (`ghostex/<8 lowercase hex>`) and the worktree
  directory naming that pairs with it,
- the marker gxserver stamps on a session it created inside a worktree, which is
  the ONLY authority the later branch auto-rename trusts,
- the small, time-boxed git plumbing those two need.

The endpoint orchestration (`/api/createWorktreeSession`,
`/api/removeSessionWorktree`) lives in `server.rs` next to the other worktree
endpoints, because it composes registered-project scope resolution, the typed
operation command builders, and the ordinary session-creation machinery.
*/

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use rand::Rng;
use serde_json::{json, Map, Value};

use crate::session_git_status::{resolve_default_branch, DefaultBranch};

/// Every branch gxserver creates for a worktree session starts here.
pub const WORKTREE_TEMP_BRANCH_PREFIX: &str = "ghostex/";
/// `ghostex/<8 lowercase hex>` — the temporary name a worktree session starts on.
pub const WORKTREE_TEMP_BRANCH_SUFFIX_LENGTH: usize = 8;
/// Runtime-settings key holding the marker described at the top of this file.
pub const WORKTREE_SESSION_RUNTIME_KEY: &str = "worktreeSession";
/// Cadence of the temp-branch auto-rename pass.
pub const WORKTREE_BRANCH_RENAME_SWEEP_INTERVAL_SECONDS: u64 = 60;
/// At most this many branches are renamed per pass, so a machine that somehow
/// accumulated many pending renames still spends bounded time per minute.
pub const WORKTREE_BRANCH_RENAME_MAX_PER_PASS: usize = 8;

const RENAMED_BRANCH_SLUG_MAX_CHARS: usize = 48;
const BRANCH_COLLISION_ATTEMPTS: usize = 20;
const COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Local git plumbing (rev-parse, symbolic-ref, branch -m) is fast on a healthy
/// repository; anything slower is a wedged repository, not work worth waiting on.
pub const WORKTREE_GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);
/// `git fetch origin` talks to a network remote, so it gets a real budget.
pub const WORKTREE_FETCH_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

// ---------------------------------------------------------------------------
// temp-branch vocabulary
// ---------------------------------------------------------------------------

/// A fresh 8-character lowercase hex suffix. Randomness is what makes a retry
/// after a failed create collide with neither a leftover branch nor a leftover
/// directory; cleanup still runs, this is the belt to that suspenders.
pub fn create_temp_branch_suffix() -> String {
    let mut rng = rand::thread_rng();
    (0..WORKTREE_TEMP_BRANCH_SUFFIX_LENGTH)
        .map(|_| {
            let digit: u8 = rng.gen_range(0..16);
            char::from_digit(u32::from(digit), 16).unwrap_or('0')
        })
        .collect()
}

pub fn temp_branch_name(suffix: &str) -> String {
    format!("{WORKTREE_TEMP_BRANCH_PREFIX}{suffix}")
}

/// True only for the exact `ghostex/<8 lowercase hex>` shape this module mints.
/// A branch a human named `ghostex/my-fix` is deliberately NOT a temp branch:
/// auto-rename and rollback branch deletion both key off this.
pub fn is_worktree_temp_branch(branch: &str) -> bool {
    let Some(suffix) = branch.strip_prefix(WORKTREE_TEMP_BRANCH_PREFIX) else {
        return false;
    };
    suffix.len() == WORKTREE_TEMP_BRANCH_SUFFIX_LENGTH
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// A branch gxserver is allowed to delete as part of worktree cleanup: either a
/// still-unnamed temp branch or the `ghostex/<slug>` it was renamed to.
pub fn is_managed_worktree_branch(branch: &str) -> bool {
    if is_worktree_temp_branch(branch) {
        return true;
    }
    let Some(slug) = branch.strip_prefix(WORKTREE_TEMP_BRANCH_PREFIX) else {
        return false;
    };
    !slug.is_empty()
        && slug != "automation"
        && !slug.starts_with("automation/")
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Worktrees stay siblings of the project directory, matching the existing
/// `createProjectWorktree` convention (`<project>-<name>`), so the typed
/// operation path guard ("inside the worktree family directory") accepts them.
pub fn worktree_directory_name(project_folder_name: &str, suffix: &str) -> String {
    let folder = project_folder_name.trim();
    if folder.is_empty() {
        format!("worktree-{suffix}")
    } else {
        format!("{folder}-{suffix}")
    }
}

/// `origin/main`, `refs/remotes/origin/main` and `main` all name the same branch
/// on the remote; `startFromOrigin` needs the bare name to look it up.
pub fn base_branch_short_name(base_ref: &str) -> String {
    let trimmed = base_ref.trim();
    trimmed
        .strip_prefix("refs/remotes/origin/")
        .or_else(|| trimmed.strip_prefix("refs/heads/"))
        .or_else(|| trimmed.strip_prefix("origin/"))
        .unwrap_or(trimmed)
        .to_string()
}

// ---------------------------------------------------------------------------
// title slugs
// ---------------------------------------------------------------------------

/// `"Fix the flaky login test"` → `"fix-the-flaky-login-test"`. Restricted to
/// `[a-z0-9-]` so the result is always a legal ref component; `None` when a
/// title carries no usable characters at all (emoji-only, CJK-only, …).
pub fn slugify_branch_title(title: &str) -> Option<String> {
    let mut slug = String::new();
    for character in title.trim().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return None;
    }
    let truncated = if slug.len() <= RENAMED_BRANCH_SLUG_MAX_CHARS {
        slug
    } else {
        let cut = &slug[..RENAMED_BRANCH_SLUG_MAX_CHARS];
        match cut.rfind('-') {
            Some(boundary) if boundary > 0 => cut[..boundary].to_string(),
            _ => cut.to_string(),
        }
    };
    let truncated = truncated.trim_matches('-').to_string();
    (!truncated.is_empty()).then_some(truncated)
}

/// The `ghostex/<slug>` name to rename onto, with a numeric suffix when the
/// obvious name is taken. `None` when the title yields no slug, or when every
/// candidate collides.
pub fn resolve_renamed_branch_name(
    title: &str,
    current_branch: &str,
    branch_exists: &dyn Fn(&str) -> bool,
) -> Option<String> {
    let slug = slugify_branch_title(title)?;
    for index in 0..BRANCH_COLLISION_ATTEMPTS {
        let candidate = if index == 0 {
            format!("{WORKTREE_TEMP_BRANCH_PREFIX}{slug}")
        } else {
            format!("{WORKTREE_TEMP_BRANCH_PREFIX}{slug}-{}", index + 1)
        };
        if candidate == current_branch {
            return None;
        }
        if !branch_exists(&candidate) {
            return Some(candidate);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// session marker
// ---------------------------------------------------------------------------

/// What gxserver remembers about a session it started inside a worktree it made.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorktreeSessionMarker {
    pub branch: String,
    pub initial_title: String,
    pub path: String,
    pub renamed_at: Option<String>,
}

pub fn worktree_session_marker_value(
    branch: &str,
    path: &str,
    initial_title: &str,
    created_at: &str,
) -> Value {
    json!({
        "branch": branch,
        "createdAt": created_at,
        "initialTitle": initial_title,
        "path": path,
    })
}

pub fn read_worktree_session_marker(session: &Value) -> Option<WorktreeSessionMarker> {
    let marker = session
        .get("runtimeSettings")
        .and_then(Value::as_object)?
        .get(WORKTREE_SESSION_RUNTIME_KEY)
        .and_then(Value::as_object)?;
    let text = |key: &str| {
        marker
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    Some(WorktreeSessionMarker {
        branch: text("branch")?,
        initial_title: text("initialTitle").unwrap_or_default(),
        path: text("path")?,
        renamed_at: text("renamedAt"),
    })
}

/// The rename this session is due, or `None`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorktreeBranchRenamePlan {
    pub from_branch: String,
    pub project_id: String,
    pub session_id: String,
    pub title: String,
    pub worktree_path: String,
}

/*
Auto-rename gate. All of these must hold, and they are deliberately strict:
renaming a branch is a mutation on the user's repository, so gxserver only ever
touches a branch it minted itself, on a session it created, that still carries
its original placeholder title source, and only once.

- the session carries this module's marker (so the branch is ours),
- the recorded branch is still the `ghostex/<8hex>` temp shape (a branch already
  renamed, or one the user renamed by hand, is finished business),
- the session has a REAL title: different from the one gxserver created it with,
  and no longer the placeholder title source every fresh row starts on.
*/
pub fn plan_worktree_branch_rename(session: &Value) -> Option<WorktreeBranchRenamePlan> {
    let marker = read_worktree_session_marker(session)?;
    if marker.renamed_at.is_some() || !is_worktree_temp_branch(&marker.branch) {
        return None;
    }
    let title = session
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())?;
    if title == marker.initial_title {
        return None;
    }
    let title_source = session
        .get("runtimeSettings")
        .and_then(Value::as_object)
        .and_then(|settings| settings.get("titleSource"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("placeholder");
    if title_source.is_empty() || title_source == "placeholder" {
        return None;
    }
    Some(WorktreeBranchRenamePlan {
        from_branch: marker.branch,
        project_id: session
            .get("projectId")
            .and_then(Value::as_str)?
            .to_string(),
        session_id: session
            .get("sessionId")
            .and_then(Value::as_str)?
            .to_string(),
        title: title.to_string(),
        worktree_path: marker.path,
    })
}

/// The session's runtime settings with the marker's branch replaced and the
/// rename stamped, ready to hand to `update_session`.
pub fn runtime_settings_with_renamed_worktree_branch(
    session: &Value,
    branch: &str,
    renamed_at: &str,
) -> Option<Map<String, Value>> {
    let mut runtime_settings = session
        .get("runtimeSettings")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut marker = runtime_settings
        .get(WORKTREE_SESSION_RUNTIME_KEY)
        .and_then(Value::as_object)
        .cloned()?;
    marker.insert("branch".to_string(), json!(branch));
    marker.insert("renamedAt".to_string(), json!(renamed_at));
    runtime_settings.insert(
        WORKTREE_SESSION_RUNTIME_KEY.to_string(),
        Value::Object(marker),
    );
    Some(runtime_settings)
}

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

/*
A time-boxed `git` capture, shaped like the session-git-status probe's: stdout is
drained by a helper thread for the child's whole lifetime (a poll-then-read loop
deadlocks against a child blocked on a full pipe), optional locks are disabled so
gxserver never contends with the user's own git, and terminal prompts are off so
a credential prompt cannot wedge the daemon. A timeout kills the child and reads
as an ordinary failure.
*/
pub fn run_worktree_git(cwd: &str, args: &[&str], timeout: Duration) -> Option<String> {
    if cwd.trim().is_empty() || !Path::new(cwd).is_dir() {
        return None;
    }
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        buffer
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(COMMAND_POLL_INTERVAL);
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let output = reader.join().unwrap_or_default();
    if !status?.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output).trim().to_string())
}

/// The repository default branch, resolved by P3's shared rules (origin/HEAD →
/// origin/main|master → local main|master).
pub fn resolve_repository_default_branch(repository_path: &str) -> Option<DefaultBranch> {
    resolve_default_branch(&|args| {
        run_worktree_git(repository_path, args, WORKTREE_GIT_COMMAND_TIMEOUT)
    })
}

pub fn worktree_branch_exists(repository_path: &str, branch: &str) -> bool {
    run_worktree_git(
        repository_path,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
        WORKTREE_GIT_COMMAND_TIMEOUT,
    )
    .map(|value| !value.trim().is_empty())
    .unwrap_or(false)
}

pub fn current_worktree_branch(worktree_path: &str) -> Option<String> {
    run_worktree_git(
        worktree_path,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        WORKTREE_GIT_COMMAND_TIMEOUT,
    )
    .map(|value| value.trim().to_string())
    .filter(|branch| !branch.is_empty())
}

/// `git fetch origin` in the repository the worktree will be cut from.
pub fn fetch_worktree_origin(repository_path: &str) -> bool {
    run_worktree_git(
        repository_path,
        &["fetch", "origin"],
        WORKTREE_FETCH_COMMAND_TIMEOUT,
    )
    .is_some()
}

/// The commit `origin/<base>` points at, which is what "start from origin"
/// means: base the new branch on the REMOTE tip, not on whatever the local
/// branch happens to be.
pub fn resolve_origin_base_commit(repository_path: &str, base_branch: &str) -> Option<String> {
    let short = base_branch_short_name(base_branch);
    if short.is_empty() {
        return None;
    }
    run_worktree_git(
        repository_path,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/remotes/origin/{short}^{{commit}}"),
        ],
        WORKTREE_GIT_COMMAND_TIMEOUT,
    )
    .map(|value| value.trim().to_string())
    .filter(|commit| !commit.is_empty())
}

/// Renames the branch checked out in a worktree. Returns false on any failure;
/// the caller leaves the marker untouched so the next pass can retry.
pub fn rename_worktree_branch(worktree_path: &str, from_branch: &str, to_branch: &str) -> bool {
    run_worktree_git(
        worktree_path,
        &["branch", "-m", from_branch, to_branch],
        WORKTREE_GIT_COMMAND_TIMEOUT,
    )
    .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_branch_names_are_eight_lowercase_hex_characters() {
        for _ in 0..64 {
            let suffix = create_temp_branch_suffix();
            assert_eq!(suffix.len(), 8);
            assert!(suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
            assert!(is_worktree_temp_branch(&temp_branch_name(&suffix)));
        }
    }

    #[test]
    fn only_the_exact_temp_shape_counts_as_a_temp_branch() {
        assert!(is_worktree_temp_branch("ghostex/0123abcd"));
        assert!(!is_worktree_temp_branch("ghostex/0123ABCD"));
        assert!(!is_worktree_temp_branch("ghostex/0123abc"));
        assert!(!is_worktree_temp_branch("ghostex/0123abcde"));
        assert!(!is_worktree_temp_branch("ghostex/my-fix"));
        assert!(!is_worktree_temp_branch("feature/0123abcd"));
        assert!(!is_worktree_temp_branch("main"));
    }

    #[test]
    fn managed_branches_cover_renamed_slugs_but_not_foreign_or_automation_branches() {
        assert!(is_managed_worktree_branch("ghostex/0123abcd"));
        assert!(is_managed_worktree_branch("ghostex/fix-the-login-test"));
        assert!(!is_managed_worktree_branch("ghostex/automation/abc"));
        assert!(!is_managed_worktree_branch("ghostex/Mixed-Case"));
        assert!(!is_managed_worktree_branch("ghostex/"));
        assert!(!is_managed_worktree_branch("main"));
        assert!(!is_managed_worktree_branch("release/1.0"));
    }

    #[test]
    fn worktree_directories_stay_siblings_named_after_the_project() {
        assert_eq!(
            worktree_directory_name("Ghostex", "0123abcd"),
            "Ghostex-0123abcd"
        );
        assert_eq!(
            worktree_directory_name("  ", "0123abcd"),
            "worktree-0123abcd"
        );
    }

    #[test]
    fn base_branch_short_names_drop_every_remote_prefix_form() {
        assert_eq!(base_branch_short_name("main"), "main");
        assert_eq!(base_branch_short_name("origin/main"), "main");
        assert_eq!(base_branch_short_name("refs/remotes/origin/main"), "main");
        assert_eq!(
            base_branch_short_name("refs/heads/release/1.0"),
            "release/1.0"
        );
    }

    #[test]
    fn slugs_are_lowercase_hyphenated_and_bounded() {
        assert_eq!(
            slugify_branch_title("Fix the flaky login test"),
            Some("fix-the-flaky-login-test".to_string())
        );
        assert_eq!(
            slugify_branch_title("  Add __CACHE__ v2!! "),
            Some("add-cache-v2".to_string())
        );
        assert_eq!(slugify_branch_title("🎉🎉"), None);
        assert_eq!(slugify_branch_title(""), None);
        let long = slugify_branch_title(
            "Rewrite the entire presentation snapshot projection pipeline for sidebar v2",
        )
        .expect("slug");
        assert!(long.len() <= RENAMED_BRANCH_SLUG_MAX_CHARS);
        assert!(!long.ends_with('-'));
        assert!(long.starts_with("rewrite-the-entire-presentation-snapshot"));
    }

    #[test]
    fn renamed_branches_get_a_numeric_suffix_when_the_obvious_name_is_taken() {
        let taken = |branch: &str| branch == "ghostex/fix-login" || branch == "ghostex/fix-login-2";
        assert_eq!(
            resolve_renamed_branch_name("Fix login", "ghostex/0123abcd", &|_| false),
            Some("ghostex/fix-login".to_string())
        );
        assert_eq!(
            resolve_renamed_branch_name("Fix login", "ghostex/0123abcd", &taken),
            Some("ghostex/fix-login-3".to_string())
        );
        assert_eq!(
            resolve_renamed_branch_name("🎉", "ghostex/0123abcd", &|_| false),
            None
        );
        assert_eq!(
            resolve_renamed_branch_name("fix login", "ghostex/fix-login", &|_| false),
            None
        );
        assert_eq!(
            resolve_renamed_branch_name("Fix login", "ghostex/0123abcd", &|_| true),
            None
        );
    }

    fn worktree_session(title: &str, marker: Value, title_source: &str) -> Value {
        json!({
            "projectId": "P1ab",
            "runtimeSettings": {
                "titleSource": title_source,
                WORKTREE_SESSION_RUNTIME_KEY: marker,
            },
            "sessionId": "G1ab",
            "title": title,
        })
    }

    fn temp_marker() -> Value {
        worktree_session_marker_value(
            "ghostex/0123abcd",
            "/repos/project-0123abcd",
            "Codex Session",
            "2026-07-29T00:00:00.000Z",
        )
    }

    #[test]
    fn a_real_title_on_a_temp_branch_plans_a_rename() {
        let plan =
            plan_worktree_branch_rename(&worktree_session("Fix login", temp_marker(), "generated"))
                .expect("plan");
        assert_eq!(plan.from_branch, "ghostex/0123abcd");
        assert_eq!(plan.title, "Fix login");
        assert_eq!(plan.worktree_path, "/repos/project-0123abcd");
        assert_eq!(plan.project_id, "P1ab");
        assert_eq!(plan.session_id, "G1ab");
    }

    #[test]
    fn placeholder_unchanged_already_renamed_and_foreign_branches_plan_nothing() {
        assert_eq!(
            plan_worktree_branch_rename(&worktree_session(
                "Fix login",
                temp_marker(),
                "placeholder"
            )),
            None,
            "a placeholder title source is not a real title"
        );
        assert_eq!(
            plan_worktree_branch_rename(&worktree_session(
                "Codex Session",
                temp_marker(),
                "generated"
            )),
            None,
            "the title gxserver created the row with is not a rename"
        );
        let mut renamed = temp_marker();
        renamed
            .as_object_mut()
            .expect("marker")
            .insert("renamedAt".to_string(), json!("2026-07-29T01:00:00.000Z"));
        assert_eq!(
            plan_worktree_branch_rename(&worktree_session("Fix login", renamed, "generated")),
            None,
            "a branch is renamed at most once"
        );
        let human_branch = worktree_session_marker_value(
            "feature/login",
            "/repos/project-0123abcd",
            "Codex Session",
            "2026-07-29T00:00:00.000Z",
        );
        assert_eq!(
            plan_worktree_branch_rename(&worktree_session("Fix login", human_branch, "generated")),
            None,
            "only branches gxserver minted are renamed"
        );
        assert_eq!(
            plan_worktree_branch_rename(&json!({
                "projectId": "P1ab",
                "sessionId": "G1ab",
                "title": "Fix login",
            })),
            None,
            "a session without the marker is not a worktree session"
        );
    }

    #[test]
    fn applying_a_rename_updates_the_marker_in_place() {
        let session = worktree_session("Fix login", temp_marker(), "generated");
        let runtime_settings = runtime_settings_with_renamed_worktree_branch(
            &session,
            "ghostex/fix-login",
            "2026-07-29T02:00:00.000Z",
        )
        .expect("runtime settings");
        let marker = runtime_settings
            .get(WORKTREE_SESSION_RUNTIME_KEY)
            .and_then(Value::as_object)
            .expect("marker");
        assert_eq!(marker.get("branch"), Some(&json!("ghostex/fix-login")));
        assert_eq!(
            marker.get("renamedAt"),
            Some(&json!("2026-07-29T02:00:00.000Z"))
        );
        assert_eq!(marker.get("initialTitle"), Some(&json!("Codex Session")));
        assert_eq!(
            runtime_settings.get("titleSource"),
            Some(&json!("generated")),
            "unrelated runtime settings survive"
        );
        assert_eq!(
            plan_worktree_branch_rename(&json!({
                "projectId": "P1ab",
                "runtimeSettings": Value::Object(runtime_settings),
                "sessionId": "G1ab",
                "title": "Fix login",
            })),
            None,
            "the updated marker is no longer due a rename"
        );
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git command");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn branch_helpers_read_and_rename_a_real_repository() {
        if !git_available() {
            return;
        }
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().join("repo");
        std::fs::create_dir_all(&root).expect("repo dir");
        git(&root, &["init", "--quiet", "-b", "main"]);
        git(&root, &["config", "user.email", "tests@example.invalid"]);
        git(&root, &["config", "user.name", "Ghostex Tests"]);
        std::fs::write(root.join("README.md"), "hello\n").expect("readme");
        git(&root, &["add", "README.md"]);
        git(&root, &["commit", "--quiet", "-m", "initial"]);
        git(&root, &["checkout", "--quiet", "-b", "ghostex/0123abcd"]);

        let root_path = root.to_string_lossy().to_string();
        assert_eq!(
            current_worktree_branch(&root_path).as_deref(),
            Some("ghostex/0123abcd")
        );
        assert!(worktree_branch_exists(&root_path, "main"));
        assert!(!worktree_branch_exists(&root_path, "ghostex/fix-login"));
        assert_eq!(
            resolve_repository_default_branch(&root_path).map(|branch| branch.name),
            Some("main".to_string())
        );
        assert!(rename_worktree_branch(
            &root_path,
            "ghostex/0123abcd",
            "ghostex/fix-login"
        ));
        assert_eq!(
            current_worktree_branch(&root_path).as_deref(),
            Some("ghostex/fix-login")
        );
        assert!(!rename_worktree_branch(
            &root_path,
            "ghostex/0123abcd",
            "ghostex/fix-login"
        ));
        assert_eq!(
            resolve_origin_base_commit(&root_path, "main"),
            None,
            "a repository without an origin has no remote tip to start from"
        );
        assert_eq!(
            run_worktree_git(
                "/definitely/not/a/directory",
                &["status"],
                WORKTREE_GIT_COMMAND_TIMEOUT
            ),
            None
        );
    }
}
