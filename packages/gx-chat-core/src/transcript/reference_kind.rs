//! Which icon and colour a rendered machine-path link gets.
//!
//! **This is family d's rule** (`sessionChatReferenceKind` in
//! `packages/shared/session-chat-presentation/reference-pills.ts`), ported here because a Markdown
//! reference in the transcript carries the same classification the composer's pills do.
//! `PROGRESS.md` lists it under "to fold into family d".

use crate::transcript::jsstr::ascii_lower;

const REFERENCE_REVEAL_MARKER: char = '\u{b7}';

fn is_extensionless_file_name(basename: &str) -> bool {
    matches!(
        basename,
        "AGENTS"
            | "AUTHORS"
            | "BUILD"
            | "Brewfile"
            | "CHANGELOG"
            | "CODEOWNERS"
            | "COPYING"
            | "Caddyfile"
            | "Containerfile"
            | "Dockerfile"
            | "Gemfile"
            | "LICENSE"
            | "Makefile"
            | "NOTICE"
            | "Podfile"
            | "Procfile"
            | "README"
            | "SKILL"
            | "WORKSPACE"
    )
}

/// `\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$` case-insensitively.
fn is_image_path(path: &str) -> bool {
    let without_query = path.split(['?', '#']).next().unwrap_or_default();
    let Some(dot) = without_query.rfind('.') else {
        return false;
    };
    matches!(
        ascii_lower(&without_query[dot + 1..]).as_str(),
        "avif" | "bmp" | "gif" | "heic" | "heif" | "ico" | "jpg" | "jpeg" | "png" | "svg" | "tif" | "tiff"
            | "webp"
    )
}

/// `\.[A-Za-z][A-Za-z0-9_+-]*$`.
fn has_file_extension(basename: &str) -> bool {
    let Some(dot) = basename.rfind('.') else {
        return false;
    };
    let extension = &basename[dot + 1..];
    extension.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        && extension.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'+' | b'-'))
}

/// `^(?:Image|File|Folder) #\d+$`.
fn numbered_label(label: &str, word: &str) -> bool {
    let Some(rest) = label.strip_prefix(word).and_then(|rest| rest.strip_prefix(" #")) else {
        return false;
    };
    !rest.is_empty() && rest.bytes().all(|byte| byte.is_ascii_digit())
}

fn explicit_reference_kind(label: &str) -> Option<&'static str> {
    if label.ends_with(REFERENCE_REVEAL_MARKER) {
        return None;
    }
    if numbered_label(label, "Image") {
        return Some("image");
    }
    if numbered_label(label, "File") {
        return Some("file");
    }
    if numbered_label(label, "Folder") {
        return Some("folder");
    }
    label.starts_with('$').then_some("skill")
}

/// `(?:^|[\\/])SKILL\.md$` case-insensitively.
fn is_skill_file(path: &str) -> bool {
    let lower = ascii_lower(path);
    lower == "skill.md" || lower.ends_with("/skill.md") || lower.ends_with("\\skill.md")
}

/// `\b(?:folder|directory)\b` case-insensitively.
fn mentions_folder(label: &str) -> bool {
    let lower = ascii_lower(label);
    ["folder", "directory"].into_iter().any(|word| {
        let mut cursor = 0;
        while let Some(at) = lower[cursor..].find(word) {
            let start = cursor + at;
            let end = start + word.len();
            let before = lower[..start].chars().next_back();
            let after = lower[end..].chars().next();
            let boundary = |character: Option<char>| {
                !character.is_some_and(|value| value.is_ascii_alphanumeric() || value == '_')
            };
            if boundary(before) && boundary(after) {
                return true;
            }
            cursor = end;
        }
        false
    })
}

/// `:\d+(?::\d+)?$` removed.
fn without_position(path: &str) -> &str {
    let digits_before = |end: usize| -> Option<usize> {
        let start = path[..end].rfind(|character: char| !character.is_ascii_digit()).map_or(0, |at| at + 1);
        (start < end).then_some(start)
    };
    if let Some(start) = digits_before(path.len()) {
        if start > 0 && path.as_bytes()[start - 1] == b':' {
            if let Some(second) = digits_before(start - 1) {
                if second > 0 && path.as_bytes()[second - 1] == b':' {
                    return &path[..second - 1];
                }
            }
            return &path[..start - 1];
        }
    }
    path
}

/// Classifies any rendered machine-path link for the shared pill styling.
pub fn reference_kind(label: &str, path: &str) -> &'static str {
    let trimmed = crate::transcript::jsstr::js_trim(label);
    if let Some(explicit) = explicit_reference_kind(trimmed) {
        if explicit != "skill" || is_skill_file(path) {
            return explicit;
        }
    }
    let lower_path = ascii_lower(path);
    if lower_path.starts_with("http://") || lower_path.starts_with("https://") {
        return "url";
    }
    if is_image_path(path) {
        return "image";
    }
    if mentions_folder(label) || path.ends_with(['/', '\\']) {
        return "folder";
    }
    let stripped = without_position(path);
    let basename = match stripped.rfind(['/', '\\']) {
        Some(index) => &stripped[index + 1..],
        None => stripped,
    };
    let dotfile = basename.starts_with('.') && !basename[1..].contains('.') && basename.len() > 1;
    if !basename.is_empty()
        && !has_file_extension(basename)
        && !is_extensionless_file_name(basename)
        && !dotfile
    {
        return "folder";
    }
    "file"
}
