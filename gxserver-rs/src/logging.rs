use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::paths::GxserverPaths;

const LOG_FILE_MAX_BYTES: u64 = 25 * 1024 * 1024;
const LOG_FILE_MAX_ROTATIONS: usize = 3;
const DEBUGGING_MODE_CACHE_MS: u64 = 1_000;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug)]
pub struct GxserverLogInput {
    pub level: LogLevel,
    pub event: String,
    pub server_id: Option<String>,
    pub request_id: Option<String>,
    pub client: Option<String>,
    pub duration_ms: Option<u128>,
    pub error: Option<String>,
    pub details: Option<Value>,
}

pub struct GxserverLogger {
    paths: GxserverPaths,
    debugging_mode_cache: Mutex<DebuggingModeCache>,
}

#[derive(Debug)]
struct DebuggingModeCache {
    checked_at: Instant,
    enabled: bool,
}

/*
CDXC:GxserverLogs 2026-06-14-20:37:
Persistent Rust logs must be safe for support bundles. Persist only warn/error unless Debugging Mode is enabled, rotate before append at the TypeScript size/count, and sanitize at the JSONL writer boundary so future call sites cannot leak paths, URLs, command text, stdout/stderr, tokens, or user-owned names.
*/
impl GxserverLogger {
    pub fn new(paths: GxserverPaths) -> Self {
        Self {
            paths,
            debugging_mode_cache: Mutex::new(DebuggingModeCache {
                checked_at: Instant::now() - Duration::from_millis(DEBUGGING_MODE_CACHE_MS),
                enabled: false,
            }),
        }
    }

    pub fn log(&self, entry: GxserverLogInput) -> Result<()> {
        if !self.should_persist(entry.level) {
            return Ok(());
        }
        fs::create_dir_all(&self.paths.logs_dir)
            .with_context(|| "create gxserver logs directory")?;
        let line = serde_json::to_string(&normalize_log_entry(entry))?;
        rotate_log_if_needed(&self.paths.log_file, line.as_bytes().len() as u64 + 1)?;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.paths.log_file)
            .with_context(|| "open gxserver log file")?;
        writeln!(file, "{line}")?;
        Ok(())
    }

    fn should_persist(&self, level: LogLevel) -> bool {
        matches!(level, LogLevel::Warn | LogLevel::Error) || self.debugging_mode_enabled()
    }

    fn debugging_mode_enabled(&self) -> bool {
        let mut cache = self
            .debugging_mode_cache
            .lock()
            .expect("debug cache poisoned");
        if cache.checked_at.elapsed() < Duration::from_millis(DEBUGGING_MODE_CACHE_MS) {
            return cache.enabled;
        }
        cache.checked_at = Instant::now();
        cache.enabled = read_debugging_mode_settings_file(&self.paths);
        cache.enabled
    }
}

pub fn log_level_from_status(status: u16) -> LogLevel {
    if status >= 500 {
        LogLevel::Error
    } else if status >= 400 {
        LogLevel::Warn
    } else {
        LogLevel::Info
    }
}

fn normalize_log_entry(entry: GxserverLogInput) -> Value {
    let mut object = Map::new();
    object.insert(
        "ts".to_string(),
        json!(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
    );
    object.insert("level".to_string(), json!(entry.level));
    object.insert("event".to_string(), json!(sanitize_log_text(&entry.event)));
    if let Some(server_id) = entry.server_id {
        object.insert("serverId".to_string(), json!(server_id));
    }
    if let Some(request_id) = entry.request_id {
        object.insert("requestId".to_string(), json!(request_id));
    }
    if let Some(client) = entry.client {
        object.insert("client".to_string(), json!(sanitize_log_text(&client)));
    }
    if let Some(duration_ms) = entry.duration_ms {
        object.insert("durationMs".to_string(), json!(duration_ms));
    }
    if let Some(error) = entry.error {
        object.insert("error".to_string(), json!(sanitize_log_text(&error)));
    }
    if let Some(details) = entry.details {
        object.insert(
            "details".to_string(),
            sanitize_log_value("details", details),
        );
    }
    Value::Object(object)
}

fn sanitize_log_value(key: &str, value: Value) -> Value {
    let key = key.to_ascii_lowercase();
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => value,
        Value::String(text) => sanitize_string_field(&key, &text),
        Value::Array(items) => {
            if is_sensitive_collection_key(&key) {
                json!({ "count": items.len(), "redacted": true })
            } else {
                Value::Array(
                    items
                        .into_iter()
                        .map(|item| sanitize_log_value(&key, item))
                        .collect(),
                )
            }
        }
        Value::Object(object) => {
            if is_sensitive_collection_key(&key) {
                json!({ "redacted": true })
            } else {
                Value::Object(
                    object
                        .into_iter()
                        .map(|(entry_key, entry_value)| {
                            let sanitized = sanitize_log_value(&entry_key, entry_value);
                            (entry_key, sanitized)
                        })
                        .collect(),
                )
            }
        }
    }
}

fn sanitize_string_field(key: &str, value: &str) -> Value {
    if is_secret_key(key) {
        return json!("[redacted:secret]");
    }
    if is_identifier_key(key) && is_safe_identifier(value) {
        return json!(value);
    }
    if is_url_key(key) || looks_like_url(value) {
        return summarize_url(value);
    }
    if is_path_key(key) || looks_like_path(value) {
        return json!("[redacted:path]");
    }
    if is_sensitive_text_key(key) {
        return json!("[redacted]");
    }
    json!(sanitize_log_text(value))
}

fn sanitize_log_text(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    for word in value.split_whitespace() {
        let replacement = if looks_like_url(word) {
            "[redacted:url]"
        } else if looks_like_path(word) {
            "[redacted:path]"
        } else if contains_secret_marker(word) {
            "[redacted:secret]"
        } else {
            word
        };
        if !sanitized.is_empty() {
            sanitized.push(' ');
        }
        sanitized.push_str(replacement);
    }
    sanitized
}

fn summarize_url(value: &str) -> Value {
    match url::Url::parse(value) {
        Ok(url) => json!({
            "host": url.host_str().unwrap_or_default(),
            "protocol": url.scheme(),
            "redacted": true,
            "type": "url",
        }),
        Err(_) => json!({ "redacted": true, "type": "url" }),
    }
}

fn read_debugging_mode_settings_file(paths: &GxserverPaths) -> bool {
    let settings_path = paths
        .home_dir
        .join(".ghostex")
        .join("state")
        .join("native-sidebar-settings.json");
    let Ok(text) = fs::read_to_string(settings_path) else {
        return false;
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.get("debuggingMode").and_then(Value::as_bool))
        == Some(true)
}

fn rotate_log_if_needed(log_file: &Path, incoming_byte_count: u64) -> Result<()> {
    let size = fs::metadata(log_file)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size + incoming_byte_count <= LOG_FILE_MAX_BYTES {
        return Ok(());
    }
    let _ = fs::remove_file(rotated_log_file(log_file, LOG_FILE_MAX_ROTATIONS));
    for index in (1..LOG_FILE_MAX_ROTATIONS).rev() {
        let source = rotated_log_file(log_file, index);
        let destination = rotated_log_file(log_file, index + 1);
        match fs::rename(&source, &destination) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).with_context(|| "rotate gxserver log"),
        }
    }
    match fs::rename(log_file, rotated_log_file(log_file, 1)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| "rotate gxserver log"),
    }
}

fn rotated_log_file(log_file: &Path, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", log_file.display(), index))
}

fn is_identifier_key(key: &str) -> bool {
    key == "id"
        || key.ends_with("id")
        || key.ends_with("ids")
        || key.ends_with("ref")
        || key.ends_with("refs")
}

fn is_safe_identifier(value: &str) -> bool {
    value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
}

fn is_secret_key(key: &str) -> bool {
    key.contains("token")
        || key.contains("bearer")
        || key.contains("secret")
        || key.contains("credential")
        || key.contains("password")
        || key.contains("cookie")
        || key.contains("authorization")
        || key.contains("auth")
}

fn is_url_key(key: &str) -> bool {
    key == "url" || key.ends_with("url") || key.contains("uri") || key == "href" || key == "origin"
}

fn is_path_key(key: &str) -> bool {
    key == "path"
        || key == "cwd"
        || key.ends_with("path")
        || key.ends_with("dir")
        || key.ends_with("directory")
        || key.ends_with("root")
        || key.ends_with("file")
        || key.ends_with("filename")
        || key.contains("workspace")
}

fn is_sensitive_text_key(key: &str) -> bool {
    key == "title"
        || key.ends_with("title")
        || key == "name"
        || key.ends_with("name")
        || key == "message"
        || key == "details"
        || key.ends_with("details")
        || key == "input"
        || key == "text"
        || key.ends_with("text")
        || key == "comment"
        || key == "description"
        || key == "label"
        || key == "preview"
        || key.ends_with("preview")
        || key == "command"
        || key.ends_with("command")
        || key == "stdout"
        || key == "stderr"
        || key == "body"
        || key.ends_with("body")
}

fn is_sensitive_collection_key(key: &str) -> bool {
    key == "args" || key.ends_with("args") || key == "arguments" || key.ends_with("arguments")
}

fn looks_like_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn looks_like_path(value: &str) -> bool {
    value.starts_with("~/")
        || value.starts_with("/Users/")
        || value.starts_with("/Volumes/")
        || value.starts_with("/private/")
        || value.starts_with("/tmp/")
        || value.starts_with("/var/folders/")
}

fn contains_secret_marker(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("bearer")
        || lower.contains("token")
        || lower.contains("authorization")
        || lower.contains("password")
        || lower.contains("secret")
        || lower.contains("credential")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::get_gxserver_paths;

    #[test]
    fn warn_log_redacts_private_values() {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = get_gxserver_paths(Some(temp.path().to_path_buf()));
        let logger = GxserverLogger::new(paths.clone());
        logger
            .log(GxserverLogInput {
                level: LogLevel::Warn,
                event: "test".to_string(),
                server_id: Some("S1a".to_string()),
                request_id: Some("request-1".to_string()),
                client: None,
                duration_ms: None,
                error: Some("failed /Users/alice/project token=secret".to_string()),
                details: Some(json!({
                    "path": "/Users/alice/project",
                    "url": "https://example.com/private?token=secret",
                    "command": "cat ~/.ssh/id_rsa",
                    "args": ["--token", "secret"],
                    "projectId": "P1abc"
                })),
            })
            .expect("log");
        let text = fs::read_to_string(paths.log_file).expect("read log");
        assert!(!text.contains("/Users/alice"));
        assert!(!text.contains("id_rsa"));
        assert!(!text.contains("token=secret"));
        assert!(text.contains("P1abc"));
    }
}
