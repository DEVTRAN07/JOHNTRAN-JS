use serde_json::{json, Map, Value};
use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const MAX_ENTRIES: usize = 50_000;
const EVICTION_BATCH: usize = 2_500;

struct CacheState {
    entries: Map<String, Value>,
    versions: HashMap<String, u64>,
    order: VecDeque<(String, u64)>,
    sequence: u64,
    dirty: bool,
    file_path: PathBuf,
}

impl CacheState {
    fn load(file_path: PathBuf) -> Self {
        let mut state = Self {
            entries: Map::new(),
            versions: HashMap::new(),
            order: VecDeque::new(),
            sequence: 0,
            dirty: false,
            file_path,
        };

        if let Ok(contents) = fs::read_to_string(&state.file_path) {
            if let Ok(Value::Object(entries)) = serde_json::from_str::<Value>(&contents) {
                for (key, value) in entries {
                    state.insert_loaded(key, value);
                }
            }
        }

        if state.entries.len() > MAX_ENTRIES {
            state.evict_to_limit();
        }
        state
    }

    fn next_version(&mut self) -> u64 {
        self.sequence = self.sequence.saturating_add(1);
        self.sequence
    }

    fn insert_loaded(&mut self, key: String, value: Value) {
        let version = self.next_version();
        self.entries.insert(key.clone(), value);
        self.versions.insert(key.clone(), version);
        self.order.push_back((key, version));
    }

    fn upsert(&mut self, key: String, value: Value) {
        let version = self.next_version();
        self.entries.insert(key.clone(), value);
        self.versions.insert(key.clone(), version);
        self.order.push_back((key, version));
        self.dirty = true;
        self.evict_to_limit();
    }

    fn delete(&mut self, key: &str) {
        if self.entries.shift_remove(key).is_some() {
            self.versions.remove(key);
            self.dirty = true;
        }
    }

    fn evict_to_limit(&mut self) {
        if self.entries.len() <= MAX_ENTRIES {
            return;
        }

        let remove_count = (self.entries.len() - MAX_ENTRIES)
            .max(EVICTION_BATCH.min((MAX_ENTRIES as f64 * 0.05).ceil() as usize));
        let mut removed = 0usize;

        while removed < remove_count {
            let Some((key, version)) = self.order.pop_front() else {
                break;
            };
            if self.versions.get(&key).copied() == Some(version) {
                self.entries.shift_remove(&key);
                self.versions.remove(&key);
                removed += 1;
            }
        }

        if removed > 0 {
            self.dirty = true;
        }
    }

    fn flush(&mut self) -> Result<(usize, usize), String> {
        let serialized = serde_json::to_vec(&Value::Object(self.entries.clone()))
            .map_err(|error| format!("serialize failed: {error}"))?;

        let parent = self.file_path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(|error| format!("mkdir failed: {error}"))?;

        let temp_path = PathBuf::from(format!(
            "{}.{}.rust-tmp",
            self.file_path.display(),
            std::process::id()
        ));
        fs::write(&temp_path, &serialized)
            .map_err(|error| format!("write temp file failed: {error}"))?;
        if let Err(error) = fs::rename(&temp_path, &self.file_path) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("atomic rename failed: {error}"));
        }

        self.dirty = false;
        Ok((serialized.len(), self.entries.len()))
    }
}

fn response(id: u64, result: Result<(usize, usize), String>, elapsed_ms: f64) {
    let payload = match result {
        Ok((bytes, entries)) => json!({
            "id": id,
            "ok": true,
            "bytes": bytes,
            "entries": entries,
            "durationMs": elapsed_ms
        }),
        Err(error) => json!({
            "id": id,
            "ok": false,
            "error": error,
            "durationMs": elapsed_ms
        }),
    };
    println!("{payload}");
    let _ = io::stdout().flush();
}

fn main() {
    let Some(file_arg) = env::args_os().nth(1) else {
        eprintln!("usage: jt-message-cache <cache-file>");
        std::process::exit(2);
    };

    let mut cache = CacheState::load(PathBuf::from(file_arg));
    let stdin = io::stdin();

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }

        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            eprintln!("ignored malformed cache command");
            continue;
        };

        match request.get("op").and_then(Value::as_str).unwrap_or("") {
            "upsert" => {
                let key = request.get("key").and_then(Value::as_str);
                let value = request.get("value");
                if let (Some(key), Some(value)) = (key, value) {
                    cache.upsert(key.to_string(), value.clone());
                }
            }
            "delete" => {
                if let Some(key) = request.get("key").and_then(Value::as_str) {
                    cache.delete(key);
                }
            }
            "flush" => {
                let id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
                let started = Instant::now();
                let result = cache.flush();
                response(id, result, started.elapsed().as_secs_f64() * 1000.0);
            }
            "stats" => {
                let id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
                let started = Instant::now();
                response(id, Ok((0, cache.entries.len())), started.elapsed().as_secs_f64() * 1000.0);
            }
            _ => {
                eprintln!("ignored unknown cache command");
            }
        }
    }

    // The Node process writes its authoritative in-memory snapshot during its
    // exit handler. Do not write again here: a late sidecar snapshot must never
    // overwrite that newer shutdown snapshot.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_refreshes_key_and_eviction_is_bounded() {
        let dir = std::env::temp_dir().join(format!("jt-cache-rust-test-{}", std::process::id()));
        let file = dir.join("cache.json");
        let mut cache = CacheState::load(file);
        for index in 0..(MAX_ENTRIES + 1) {
            cache.upsert(format!("message-{index}"), json!({"id": index}));
        }
        assert!(cache.entries.len() <= MAX_ENTRIES);
        assert!(!cache.entries.contains_key("message-0"));
        assert!(cache.entries.contains_key(&format!("message-{}", MAX_ENTRIES)));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn latest_update_survives_old_lru_ticket() {
        let dir = std::env::temp_dir().join(format!("jt-cache-version-test-{}", std::process::id()));
        let mut cache = CacheState::load(dir.join("cache.json"));
        cache.upsert("same".to_string(), json!({"value": 1}));
        cache.upsert("same".to_string(), json!({"value": 2}));
        let (_, entries) = cache.flush().expect("flush should succeed");
        assert_eq!(entries, 1);
        assert_eq!(cache.entries.get("same").and_then(|v| v.get("value")).and_then(Value::as_i64), Some(2));
        let _ = fs::remove_dir_all(dir);
    }
}
