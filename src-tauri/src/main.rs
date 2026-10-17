#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod store;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub data_dir: Mutex<PathBuf>,
    /// Some(tray) 表示托盘驻留开启（关闭窗口 = 隐藏到托盘）；Drop 时自动移除托盘图标。
    pub tray: Mutex<Option<TrayIcon>>,
}

impl AppState {
    fn tray_on(&self) -> bool {
        self.tray.lock().expect("tray lock").is_some()
    }
}

fn main() {
    let data_dir = store::resolve_data_dir();
    store::ensure_layout(&data_dir);
    store::maintain_snapshots(&data_dir);

    tauri::Builder::default()
        .manage(AppState {
            data_dir: Mutex::new(data_dir),
            tray: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            app_init,
            get_data_dir,
            set_data_dir,
            get_settings,
            set_setting,
            load_day,
            save_day,
            append_events,
            load_events,
            list_days,
            save_file
        ])
        .setup(|app| {
            let s = store::load_all(&store::config_path());
            let tray_on = s.get("tray").and_then(|v| v.as_bool()).unwrap_or(false);
            let pin_on = s.get("pin_top").and_then(|v| v.as_bool()).unwrap_or(false);

            if let Some(w) = app.get_webview_window("main") {
                if pin_on {
                    let _ = w.set_always_on_top(true);
                }
                // 托盘驻留：拦截关闭请求，改为隐藏窗口
                let h = app.handle().clone();
                w.on_window_event(move |ev| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = ev {
                        if h.state::<AppState>().tray_on() {
                            api.prevent_close();
                            if let Some(w2) = h.get_webview_window("main") {
                                let _ = w2.hide();
                            }
                        }
                    }
                });
            }

            if tray_on {
                let st = app.state::<AppState>();
                if let Err(e) = ensure_tray(app.handle(), &st) {
                    eprintln!("tray init failed: {e}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn ensure_tray(app: &AppHandle, state: &State<AppState>) -> Result<(), String> {
    let mut guard = state.tray.lock().expect("tray lock");
    if guard.is_some() {
        return Ok(());
    }
    let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit_i = MenuItem::with_id(app, "quit", "退出 TodayTrace", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i]).map_err(|e| e.to_string())?;
    let mut b = tauri::tray::TrayIconBuilder::with_id("tt-tray")
        .tooltip("TodayTrace")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        b = b.icon(icon);
    }
    let tray = b.build(app).map_err(|e| e.to_string())?;
    *guard = Some(tray);
    Ok(())
}

fn current_dir(state: &State<AppState>) -> PathBuf {
    state.data_dir.lock().expect("data_dir lock").clone()
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<serde_json::Value, String> {
    let s = store::load_all(&store::config_path());
    Ok(serde_json::json!({
        "theme": s.get("theme").and_then(|v| v.as_str()).unwrap_or("auto"),
        "font_family": s.get("font_family").and_then(|v| v.as_str()).unwrap_or("default"),
        "font_size": s.get("font_size").and_then(|v| v.as_u64()).unwrap_or(15) as u32,
        "pin_top": s.get("pin_top").and_then(|v| v.as_bool()).unwrap_or(false),
        "tray": s.get("tray").and_then(|v| v.as_bool()).unwrap_or(false),
        "autostart": store::autostart_enabled(),
        "data_dir": current_dir(&state).display().to_string(),
    }))
}

#[tauri::command]
fn set_setting(
    app: AppHandle,
    state: State<AppState>,
    key: String,
    value: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if key == "data_dir" {
        return Err("存储目录请走 set_data_dir".into());
    }
    store::write_key_to(&store::config_path(), &key, &value)?;
    match key.as_str() {
        "pin_top" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_always_on_top(value.as_bool().unwrap_or(false));
            }
        }
        "tray" => {
            let on = value.as_bool().unwrap_or(false);
            if on {
                ensure_tray(&app, &state)?;
            } else {
                *state.tray.lock().expect("tray lock") = None;
            }
        }
        "autostart" => {
            store::set_autostart(value.as_bool().unwrap_or(false))?;
        }
        _ => {}
    }
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn app_init(state: State<AppState>) -> Result<serde_json::Value, String> {
    let data_dir = current_dir(&state);
    let days = store::list_days(&data_dir);
    Ok(serde_json::json!({
        "dataDir": data_dir.display().to_string(),
        "days": days,
    }))
}

#[tauri::command]
fn get_data_dir(state: State<AppState>) -> Result<serde_json::Value, String> {
    let data_dir = current_dir(&state);
    Ok(serde_json::json!({
        "dataDir": data_dir.display().to_string(),
        "isCustom": store::config_path().exists(),
    }))
}

#[tauri::command]
fn set_data_dir(state: State<AppState>, path: Option<String>) -> Result<serde_json::Value, String> {
    let new_dir = match path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => {
            let pb = PathBuf::from(p);
            if !pb.is_absolute() {
                return Err("请填写绝对路径（如 D:\\Notes\\TodayTrace）".into());
            }
            std::fs::create_dir_all(&pb).map_err(|e| format!("目录无法创建：{e}"))?;
            store::save_custom_dir(Some(&pb))?;
            pb
        }
        None => {
            store::save_custom_dir(None)?;
            store::resolve_data_dir()
        }
    };
    store::ensure_layout(&new_dir);
    store::maintain_snapshots(&new_dir);
    *state.data_dir.lock().expect("data_dir lock") = new_dir.clone();
    Ok(serde_json::json!({ "dataDir": new_dir.display().to_string() }))
}

#[tauri::command]
fn load_day(state: State<AppState>, date: String) -> Result<serde_json::Value, String> {
    if !store::valid_date(&date) {
        return Err("bad date".into());
    }
    let data_dir = current_dir(&state);
    let p = data_dir.join("notes").join(format!("{date}.txt"));
    if p.exists() {
        let content = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "content": content }))
    } else {
        Ok(serde_json::json!({ "content": null }))
    }
}

#[tauri::command]
fn save_day(state: State<AppState>, date: String, content: String) -> Result<(), String> {
    if !store::valid_date(&date) {
        return Err("bad date".into());
    }
    let data_dir = current_dir(&state);
    let p = data_dir.join("notes").join(format!("{date}.txt"));
    store::atomic_write(&p, content.as_bytes())
}

#[tauri::command]
fn append_events(state: State<AppState>, events: Vec<serde_json::Value>) -> Result<(), String> {
    store::append_events(&current_dir(&state), &events)
}

#[tauri::command]
fn load_events(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    Ok(store::load_events(&current_dir(&state)))
}

#[tauri::command]
fn list_days(state: State<AppState>) -> Result<Vec<String>, String> {
    Ok(store::list_days(&current_dir(&state)))
}

#[tauri::command]
fn save_file(state: State<AppState>, rel: String, content: String) -> Result<String, String> {
    let p = store::safe_join(&current_dir(&state), &rel)?;
    store::atomic_write(&p, content.as_bytes())?;
    Ok(p.display().to_string())
}
