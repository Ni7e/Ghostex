use anyhow::{Result, bail};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path};

pub(crate) struct Storage {
    pub(crate) database: Connection,
    session: HashMap<String, String>,
}

impl Storage {
    pub(crate) fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let database = Connection::open(path)?;
        database.busy_timeout(std::time::Duration::from_secs(5))?;
        database.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, store TEXT NOT NULL, value TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS records_by_store ON records(store);
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS legacy (database_name TEXT, store TEXT, value TEXT);")?;
        Ok(Self {
            database,
            session: HashMap::new(),
        })
    }

    fn record(&self, key: &str) -> Result<Value> {
        let value: Option<String> = self
            .database
            .query_row("SELECT value FROM records WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        value
            .map(|text| serde_json::from_str(&text).map_err(Into::into))
            .unwrap_or(Ok(Value::Null))
    }
    fn scan(&self, store: Option<&str>) -> Result<Vec<Value>> {
        let mut query = self
            .database
            .prepare("SELECT value FROM records WHERE (?1 IS NULL OR store=?1)")?;
        query
            .query_map([store], |row| row.get::<_, String>(0))?
            .map(|row| Ok(serde_json::from_str(&row?)?))
            .collect()
    }
    fn metadata(&self, key: &str) -> Result<Value> {
        let value: Option<String> = self
            .database
            .query_row("SELECT value FROM metadata WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()?;
        value
            .map(|text| serde_json::from_str(&text).map_err(Into::into))
            .unwrap_or(Ok(Value::Null))
    }
    pub(crate) fn call(&mut self, operation: &str, request: &Value) -> Result<Value> {
        let key = request["key"].as_str().unwrap_or_default();
        let session = request["backend"] == "session";
        match operation {
            "preferenceRead" => Ok(if session {
                self.session.get(key).cloned()
            } else {
                self.database
                    .query_row("SELECT value FROM preferences WHERE key=?1", [key], |row| {
                        row.get::<_, String>(0)
                    })
                    .optional()?
            }
            .map(Value::String)
            .unwrap_or(Value::Null)),
            "preferenceWrite" => {
                if let Some(raw) = request["raw"].as_str() {
                    if session {
                        self.session.insert(key.to_owned(), raw.to_owned());
                    } else {
                        self.database.execute("INSERT INTO preferences VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, raw])?;
                    }
                } else if session {
                    self.session.remove(key);
                } else {
                    self.database
                        .execute("DELETE FROM preferences WHERE key=?1", [key])?;
                }
                Ok(Value::Null)
            }
            "preferenceScan" => {
                if session {
                    return Ok(json!(self.session.iter().collect::<Vec<_>>()));
                }
                let mut query = self.database.prepare("SELECT key,value FROM preferences")?;
                Ok(json!(
                    query
                        .query_map([], |row| Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?
                        )))?
                        .collect::<Result<Vec<_>, _>>()?
                ))
            }
            "recordRead" => self.record(key),
            "recordScan" => Ok(json!(self.scan(request["store"].as_str())?)),
            "recordWrite" => {
                let row = &request["row"];
                self.database.execute("INSERT INTO records VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET store=excluded.store,value=excluded.value", params![row["key"].as_str(), row["store"].as_str(), row.to_string()])?;
                Ok(Value::Null)
            }
            "recordRemove" => {
                self.database
                    .execute("DELETE FROM records WHERE key=?1", [key])?;
                Ok(Value::Null)
            }
            "metadataRead" => self.metadata(key),
            "metadataWrite" => {
                self.database.execute("INSERT INTO metadata VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, request["value"].to_string()])?;
                Ok(Value::Null)
            }
            "databaseSnapshot" => Ok(
                json!({"rows": self.scan(None)?, "revision": self.metadata("revision")?.as_u64().unwrap_or(0)}),
            ),
            "transactionBegin" => {
                self.database.execute_batch("BEGIN IMMEDIATE")?;
                Ok(Value::Null)
            }
            "transactionCommit" => {
                self.database.execute_batch("COMMIT")?;
                Ok(Value::Null)
            }
            "transactionRollback" => {
                self.database.execute_batch("ROLLBACK")?;
                Ok(Value::Null)
            }
            "legacyDatabaseRead" => {
                let mut query = self
                    .database
                    .prepare("SELECT value FROM legacy WHERE database_name=?1 AND store=?2")?;
                let values = query
                    .query_map(
                        params![request["name"].as_str(), request["store"].as_str()],
                        |row| row.get::<_, String>(0),
                    )?
                    .map(|text| Ok(serde_json::from_str::<Value>(&text?)?))
                    .collect::<Result<Vec<_>>>()?;
                Ok(json!(values))
            }
            _ => bail!("Unknown native storage operation: {operation}"),
        }
    }
}
