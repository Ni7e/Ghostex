use std::{env, path::PathBuf};

#[derive(Clone, Debug)]
pub struct GxserverPaths {
    pub auth_dir: PathBuf,
    pub auth_token_file: PathBuf,
    pub config_file: PathBuf,
    pub home_dir: PathBuf,
    pub identity_file: PathBuf,
    pub logs_dir: PathBuf,
    pub log_file: PathBuf,
    pub migrations_dir: PathBuf,
    pub root_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub runtime_metadata_file: PathBuf,
    pub state_db_file: PathBuf,
    pub zmx_dir: PathBuf,
}

/*
CDXC:GxserverStorage 2026-06-14-20:37:
The Rust daemon must use the same durable path contract as the TypeScript source of truth: shared daemon state stays under ~/.ghostex/gxserver, while support-bundle-safe JSONL diagnostics stay under ~/.ghostex/logs.
*/
pub fn get_gxserver_paths(home_dir: Option<PathBuf>) -> GxserverPaths {
    let home_dir = home_dir.unwrap_or_else(default_home_dir);
    let root_dir = home_dir.join(".ghostex").join("gxserver");
    let auth_dir = root_dir.join("auth");
    let logs_dir = home_dir.join(".ghostex").join("logs");
    let migrations_dir = root_dir.join("migrations");
    let runtime_dir = root_dir.join("runtime");
    let zmx_dir = root_dir.join("zmx");

    GxserverPaths {
        auth_token_file: auth_dir.join("token"),
        auth_dir,
        config_file: root_dir.join("config.json"),
        home_dir,
        identity_file: root_dir.join("identity.json"),
        log_file: logs_dir.join("gxserver.jsonl"),
        logs_dir,
        migrations_dir,
        runtime_metadata_file: runtime_dir.join("server.json"),
        runtime_dir,
        state_db_file: root_dir.join("state.db"),
        zmx_dir,
        root_dir,
    }
}

fn default_home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
