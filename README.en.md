# EaseDo

[English](README.en.md) | [简体中文](README.md)

An ADHD-friendly, **zero-attention-overhead** desktop notepad: plain TXT notes + clickable to-dos + automatic full history. Write in the Today view, replay a task's whole life in the Trace view, export weekly / monthly reports in one click.

## Why: for easily distracted minds

This tool started from one simple need: **when I write, the tool itself must not steal my attention.**

Most to-do apps burden an easily distracted brain (ADHD or not) — open them and you get unread badges, red dots, overdue warnings, streaks. The cognitive load starts before the first word is written. EaseDo is designed the opposite way:

- **Open and write**: on launch there is no text, no button, no badge in sight. The sidebar, the date, the hints are all hidden behind hover gestures — the only action is typing
- **One page a day**: Today shows only today. Yesterday's unfinished items never chase you; import them by right-click when you actually need them
- **Zero pressure**: no streaks, no overdue red, no progress shaming — come back after a week away and the page is still blank and clean
- **Plain TXT**: your data is ordinary text files you can open in Notepad. No lock-in, ever
- **Look back later, not nagged now**: the Trace view and weekly / monthly reports put "tracking" where you choose to look, instead of pushing interruptions at you

> Attention works differently for everyone: this is not a medical tool and makes no diagnosis. If UI chrome itself distracts you, this design should fit.

## Where your data lives

`Documents\EaseDo\`

```
EaseDo/
  notes/2026-10-16.txt     one plain text file per day, opens in Notepad
  trace/snapshots.jsonl    task snapshot journal (append-only, with a .prev fallback copy)
  export/                  weekly / monthly report exports (Markdown + HTML)
```

Syntax inside TXT: `- [ ] task` / `- [x] done`, two-space indent for subtasks, `# heading` for a time-block label.

## Daily reset & importing past items

- **6:00 AM day boundary**: "today" splits at 6 AM — anything written before 6 AM belongs to the previous day, so late-night work isn't interrupted by midnight. Crossing the boundary, the app flips to a fresh page every 30 seconds (old content is saved first). Trace grouping, weekly / monthly stats and the import dialog all use the same boundary
- **One page per day**: one txt per day in Today; a day you didn't write is simply blank
- **Right-click import**: right-click in the editor → "Import unfinished…" → unfinished items grouped by day (completed and deleted ones don't appear); check them to bring them back to today
- Imports **keep the original task identity**: Trace still shows one continuous life for the task (the timeline gains an "imported · from <date>" entry), and reports count it as "in progress", not newly created

## Minimal view

- Launch into a pure input surface: sidebar hidden (14px hot zone on the left edge slides it in as a floating layer), date & progress hidden (fade in on hover at the top), footer hints hidden (only appear when hovering the hint text itself) — by default the only visible thing is an empty checkbox, zero distraction while typing
- **Frameless minimal mode**: the system title bar is hidden by default; drag via the top edge or the date area (double-click to maximize), hover the top-right corner for minimize / close buttons; can be switched off in Settings
- **Shrinks to a sticky-note size**: minimum window 280×200; narrow windows (≤620px) automatically tighten margins, fold the Trace date bar horizontally, and switch reports to a single column

## Settings

Opened from the gear in the sidebar, in three sections; appearance and window options apply instantly:

- **Appearance**: theme (follow system / light / dark), body font (sans / serif / mono), body size (12–20px slider with live preview)
- **Window & system**: always on top, hide title bar (frameless minimal, instant), tray resident (closing hides to tray; left-click the tray icon to restore; menu has show / quit), launch at login (writes to the current user's registry Run key, no admin needed)
- **Storage**: custom data directory (an absolute path moves notes / trace / export there and reloads automatically; "restore default" goes back to `Documents\EaseDo`, switching never deletes old data)
- All settings live in `%APPDATA%\EaseDo\config.json`, merged key-by-key, decoupled from the data directory; pin and tray state are restored on launch

## Download

Grab `easedo.exe` (about 3.4 MB, single file, no install) from [Releases](https://github.com/huangxp12/easedo/releases):

- Requirements: Windows 10 / 11 (WebView2 ships with the OS, nothing extra to install)
- Double-click and go; data lands in `Documents\EaseDo\`, uninstalling is just deleting files, and the app never touches the network
- Measured memory usage: ~36 MB

## Build from source

Standard Windows environment (MSVC toolchain, works for most developers):

```bash
# 1. Install Rust via rustup (default MSVC toolchain)
#    https://rustup.rs ; the MSVC linker comes from Visual Studio Build Tools
#    (workload: "Desktop development with C++")
# 2. Clone and build
git clone https://github.com/huangxp12/easedo.git
cd easedo/src-tauri
cargo build --release
# Output: target/release/easedo.exe
```

The frontend is plain static files (HTML/CSS/JS) — no npm install, no frontend build step; resources are bundled at Rust compile time. With Rust installed, it's a one-command build.

### Local dev environment notes (GNU toolchain variant)

Without MSVC you can substitute w64devkit (portable MinGW). Verified configuration, not required for regular users:

Dependencies: Rust stable (x86_64-pc-windows-gnu) + w64devkit (portable MinGW), no admin rights needed.

```bash
export PATH="$HOME/.cargo/bin:$HOME/.workbuddy/binaries/mingw64/w64devkit/bin:$PATH"
export RUSTFLAGS="-Clink-self-contained=n -Cdlltool=C:/Users/huang/.workbuddy/binaries/mingw64/w64devkit/bin/dlltool.exe"
```

Toolchain notes: rustup's self-contained components lack `as.exe` (required by dlltool); w64devkit lacks `libgcc_eh.a` (patched by copying libgcc.a in `lib/gcc/x86_64-w64-mingw32/16.2.0/`). The RUSTFLAGS disable Rust's self-contained linking so the CRT and import libraries all come from w64devkit.

Window permissions: `capabilities/default.json` explicitly allows `core:window:allow-minimize / allow-close / allow-set-decorations / allow-start-dragging / allow-internal-toggle-maximize` on top of `core:default` (Tauri 2's default permission set is query-only; frameless window controls and dragging need these write permissions).

```bash
cd src-tauri
cargo build          # debug build, output at target/debug/easedo.exe
cargo build --release  # release build (opt-level=s + lto + strip)
cargo run            # build and launch
```

## Architecture

| Layer | Location | Responsibility |
|---|---|---|
| Data | `src-tauri/src/store.rs` | data dir resolution, atomic writes (tmp + rename), snapshot append & startup validation, restricted-path writes, settings key-value store, registry autostart |
| Commands | `src-tauri/src/main.rs` | Tauri commands: app_init / load_day / save_day / append_events / load_events / list_days / save_file / get_settings / set_setting; system tray, always-on-top, close-to-tray interception |
| Store adapter | `src/core.js` | dual channel: Tauri command calls and browser preview mode (localStorage) |
| Editor | `src/editor.js` | line-based editing, invisible task IDs & identity matching, snapshot event generation, debounced persistence |
| Trace | `src/trace.js` | per-day replay of a task's whole life (timeline) |
| Reports | `src/report.js` | weekly / monthly summaries, Markdown + HTML export |

## Reliability

- `notes/*.txt` atomic writes: the disk always holds either the complete old version or the complete new version
- `snapshots.jsonl` append-only + startup validation: a torn trailing line is truncated automatically; `.prev` keeps the previous copy
- Write order: state first (txt), history second (snapshots) — a crash loses at most one history event, the current state is always correct
- Everything is UTF-8 (no BOM), fully compatible with Notepad and VS Code
