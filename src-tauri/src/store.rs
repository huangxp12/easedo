use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
use winreg::RegKey;

/// 设置文件固定在 %APPDATA%\TodayTrace\config.json，与数据目录解耦，
/// 不受文档目录重定向影响。
pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .or_else(|| dirs::home_dir())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TodayTrace")
        .join("config.json")
}

/// 读取整个设置文件（不存在或损坏时返回空对象，不阻塞启动）。
pub fn load_all(path: &Path) -> serde_json::Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// 合并写入单个设置键，保留文件中其余键（含 data_dir）。
pub fn write_key_to(path: &Path, key: &str, value: &serde_json::Value) -> Result<(), String> {
    let mut v = load_all(path);
    v[key] = value.clone();
    let bytes = serde_json::to_vec_pretty(&v).map_err(|e| e.to_string())?;
    atomic_write(path, &bytes)
}

fn read_custom_dir_from(path: &Path) -> Option<PathBuf> {
    let v = load_all(path);
    let s = v.get("data_dir")?.as_str()?.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s))
    }
}

pub fn save_custom_dir_to(path: &Path, dir: Option<&Path>) -> Result<(), String> {
    let body = serde_json::json!(dir.map(|d| d.display().to_string()).unwrap_or_default());
    write_key_to(path, "data_dir", &body)
}

fn load_custom_dir() -> Option<PathBuf> {
    read_custom_dir_from(&config_path())
}

pub fn save_custom_dir(dir: Option<&Path>) -> Result<(), String> {
    save_custom_dir_to(&config_path(), dir)
}

/* ---------------- 开机自启（当前用户注册表 Run 键，无需管理员） ---------------- */

const RUN_KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE_NAME: &str = "TodayTrace";

pub fn set_autostart(enable: bool) -> Result<(), String> {
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let key = hk
        .open_subkey_with_flags(RUN_KEY_PATH, KEY_SET_VALUE | KEY_QUERY_VALUE)
        .map_err(|e| format!("无法访问注册表启动项：{e}"))?;
    if enable {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_value(RUN_VALUE_NAME, &format!("\"{}\"", exe.display()))
            .map_err(|e| format!("写入启动项失败：{e}"))?;
    } else {
        let _ = key.delete_value(RUN_VALUE_NAME);
    }
    Ok(())
}

pub fn autostart_enabled() -> bool {
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    hk.open_subkey(RUN_KEY_PATH)
        .map(|k| k.get_value::<String, _>(RUN_VALUE_NAME).is_ok())
        .unwrap_or(false)
}

pub fn resolve_data_dir() -> PathBuf {
    if let Some(custom) = load_custom_dir() {
        return custom;
    }
    let base = dirs::document_dir()
        .or_else(|| dirs::home_dir())
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("TodayTrace")
}

pub fn ensure_layout(dir: &Path) {
    for sub in ["notes", "trace", "export"] {
        let _ = fs::create_dir_all(dir.join(sub));
    }
}

/// 原子写：先写临时文件，再用 rename 顶替，任何时刻磁盘上都是完整的旧版或新版。
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tttmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

/// 启动维护：备份 .prev 副本；校验快照流水账，末尾撕裂行自动截断。
pub fn maintain_snapshots(dir: &Path) {
    let sp = dir.join("trace").join("snapshots.jsonl");
    if !sp.exists() {
        return;
    }
    let _ = fs::copy(&sp, sp.with_extension("prev"));
    let bytes = match fs::read(&sp) {
        Ok(b) => b,
        Err(_) => return,
    };
    let text = match String::from_utf8(bytes) {
        Ok(t) => t,
        Err(_) => return,
    };
    let mut offset = 0usize;
    let mut last_ok_end = 0usize;
    for line in text.split_inclusive('\n') {
        let t = line.trim_end_matches('\n').trim();
        if !t.is_empty() && serde_json::from_str::<serde_json::Value>(t).is_ok() {
            last_ok_end = offset + line.len();
        }
        offset += line.len();
    }
    if last_ok_end < text.len() {
        let _ = atomic_write(&sp, &text.as_bytes()[..last_ok_end]);
    }
}

pub fn append_events(dir: &Path, events: &[serde_json::Value]) -> Result<(), String> {
    let path = dir.join("trace").join("snapshots.jsonl");
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    for ev in events {
        let line = serde_json::to_string(ev).map_err(|e| e.to_string())?;
        f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        f.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    f.flush().map_err(|e| e.to_string())
}

pub fn load_events(dir: &Path) -> Vec<serde_json::Value> {
    let path = dir.join("trace").join("snapshots.jsonl");
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    text.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
        .collect()
}

pub fn valid_date(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() && s.len() == 10
}

pub fn list_days(dir: &Path) -> Vec<String> {
    let mut days = Vec::new();
    if let Ok(rd) = fs::read_dir(dir.join("notes")) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(stem) = name.strip_suffix(".txt") {
                if valid_date(stem) {
                    days.push(stem.to_string());
                }
            }
        }
    }
    days.sort();
    days
}

/// 数据目录内的受限写：拒绝路径穿越，用于导出报告等。
pub fn safe_join(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains("..") || rel.starts_with('/') || rel.starts_with('\\') {
        return Err("illegal path".into());
    }
    let p = dir.join(rel);
    let canon_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    let parent = p.parent().unwrap_or(dir);
    if !parent.starts_with(&canon_dir) && parent != canon_dir.as_path() {
        // canonicalize parent may not exist yet; fall back to lexical check
        if rel.split(['/', '\\']).any(|seg| seg == "..") {
            return Err("illegal path".into());
        }
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_dir_roundtrip() {
        let cfg = std::env::temp_dir().join(format!("tt-cfg-{}.json", std::process::id()));
        let _ = fs::remove_file(&cfg);
        assert_eq!(read_custom_dir_from(&cfg), None);
        let target = std::env::temp_dir().join("tt-data-x");
        save_custom_dir_to(&cfg, Some(&target)).unwrap();
        assert_eq!(read_custom_dir_from(&cfg), Some(target));
        save_custom_dir_to(&cfg, None).unwrap();
        assert_eq!(read_custom_dir_from(&cfg), None);
        let _ = fs::remove_file(&cfg);
    }
}
