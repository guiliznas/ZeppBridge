//! 交给 AI 的最后一步（计划 12.1）：交出去的 `.md` 以「文件」放进系统剪贴板，任何浏览器里 Ctrl+V 就附上；
//! 打开「全自动」时，等那个 AI 网页到了前台，替用户按 Ctrl+V、贴开场白、回车。
//!
//! 全自动每一下按键之前都核对前台窗口标题还是那个 AI；用户按 Esc、切走窗口、45 秒还没等到，就停下，
//! 剪贴板里留着文件，用户自己粘。系统能力在 `crate::clipboard_files`。

use crate::app_state::AppState;
use crate::clipboard_files::{self, ClipboardError};
use crate::ipc_error::AppError;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const AUTO_EVENT: &str = "ai-handoff://auto";
/// 等 AI 网页到前台的期限：浏览器冷启动 + 首屏，45 秒足够。
const WAIT_FOREGROUND: Duration = Duration::from_secs(45);
/// 标题对上以后再等这么久：网页把输入框挂好、自动聚焦。
const SETTLE: Duration = Duration::from_millis(1500);
/// 粘完文件等它传上去；粘完开场白再等一会儿才回车（上传没完时网站会挡住发送，回车不会发出半截）。
const UPLOAD_WAIT: Duration = Duration::from_millis(2500);
const TEXT_WAIT: Duration = Duration::from_millis(600);
/// 交出去的 `.md` 上限（按 token 预算裁过，正常远小于这个数）。
const MAX_HANDOFF_BYTES: u64 = 16 * 1024 * 1024;

/// 认 AI 网页的标题关键字（区分大小写：网页还没加载完时标题是小写的网址，不算）。
const TITLES: &[(&str, &[&str])] = &[
    ("chatgpt", &["ChatGPT"]),
    ("claude", &["Claude"]),
    ("gemini", &["Gemini"]),
    ("kimi", &["Kimi"]),
    ("doubao", &["豆包", "Doubao"]),
    ("deepseek", &["DeepSeek"]),
    ("grok", &["Grok"]),
];

static GENERATION: AtomicU64 = AtomicU64::new(0);

/// 只交 `ai_task_prepare` 写出来的那种文件：输出目录里的 `.md`。
fn handoff_file(state: &AppState, raw: &str) -> Result<PathBuf, AppError> {
    let missing = || AppError::new("err.ai_handoff.file", "找不到要交出去的文件");
    let path = Path::new(raw).canonicalize().map_err(|_| missing())?;
    let is_md = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    let roots = [
        directories::UserDirs::new()
            .and_then(|dirs| dirs.desktop_dir().map(|path| path.join("ZeppBridge AI"))),
        Some(state.data_dir.join("exports").join("ai-tasks")),
    ];
    let inside = roots
        .iter()
        .flatten()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| path.starts_with(root));
    let size = std::fs::metadata(&path).map_err(|_| missing())?.len();
    if !is_md || !inside || size > MAX_HANDOFF_BYTES {
        return Err(missing());
    }
    Ok(path)
}

fn clipboard_error(error: ClipboardError) -> AppError {
    match error {
        ClipboardError::Unsupported => AppError::new(
            "err.ai_handoff.unsupported",
            "这个系统上还不能把文件放进剪贴板",
        ),
        ClipboardError::Busy => AppError::new(
            "err.ai_handoff.clipboard",
            "剪贴板正被别的程序占用，稍后再试",
        ),
    }
}

/// 把交出去的 `.md` 以「文件」放进剪贴板（同资源管理器里 Ctrl+C）。
#[tauri::command]
pub async fn ai_handoff_copy_file(
    state: tauri::State<'_, AppState>,
    md_path: String,
) -> std::result::Result<(), AppError> {
    let path = handoff_file(&state, &md_path)?;
    clipboard_files::copy_file(&path).map_err(clipboard_error)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHandoffAutoRequest {
    provider: String,
    md_path: String,
    kickoff: String,
    send: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
struct AutoStage {
    ticket: u64,
    /// waiting → file → filled / sent；中途停下是 aborted（Esc、切走窗口）或 timeout。
    stage: &'static str,
}

/// 全自动：文件先进剪贴板，等 AI 网页到前台再替用户粘贴、回车。立刻返回这一次的编号，进度走事件。
/// 再调一次（或别的交接）会顶掉还在等的那一次。
#[tauri::command]
pub async fn ai_handoff_autopaste(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    request: AiHandoffAutoRequest,
) -> std::result::Result<u64, AppError> {
    let titles = TITLES
        .iter()
        .find(|(id, _)| *id == request.provider)
        .map(|(_, titles)| *titles)
        .ok_or_else(|| AppError::new("err.ai_handoff.provider", "目标 AI 不在允许列表里"))?;
    let path = handoff_file(&state, &request.md_path)?;
    clipboard_files::copy_file(&path).map_err(clipboard_error)?;
    let ticket = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let stage = run_auto(ticket, titles, &request.kickoff, request.send, |stage| {
            let _ = app.emit(AUTO_EVENT, AutoStage { ticket, stage });
        });
        // 不管停在哪一步，剪贴板里都放回那份文件：用户接着自己粘也行。
        if stage != "superseded" {
            let _ = clipboard_files::copy_file(&path);
            let _ = app.emit(AUTO_EVENT, AutoStage { ticket, stage });
        }
    });
    Ok(ticket)
}

/// 收回还在等前台的那一次（界面上点了取消、换了别的 AI）。
#[tauri::command]
pub fn ai_handoff_cancel() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

fn run_auto(
    ticket: u64,
    titles: &[&str],
    kickoff: &str,
    send: bool,
    emit: impl Fn(&'static str),
) -> &'static str {
    let live = || GENERATION.load(Ordering::SeqCst) == ticket;
    let in_front = || {
        clipboard_files::foreground_title()
            .is_some_and(|title| titles.iter().any(|t| title.contains(t)))
    };
    emit("waiting");
    // 1. 等 AI 网页到前台，标题对上并稳住一会儿。
    let deadline = Instant::now() + WAIT_FOREGROUND;
    let mut since: Option<Instant> = None;
    loop {
        if !live() {
            return "superseded";
        }
        if clipboard_files::escape_down() {
            return "aborted";
        }
        if Instant::now() > deadline {
            return "timeout";
        }
        if in_front() {
            if since.get_or_insert_with(Instant::now).elapsed() >= SETTLE {
                break;
            }
        } else {
            since = None;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    // 之后的每一段等待：被顶掉、按了 Esc、切走了窗口，都立刻停。
    let hold = |duration: Duration| -> Option<&'static str> {
        let end = Instant::now() + duration;
        while Instant::now() < end {
            if !live() {
                return Some("superseded");
            }
            if clipboard_files::escape_down() || !in_front() {
                return Some("aborted");
            }
            std::thread::sleep(Duration::from_millis(60));
        }
        None
    };
    // 2. 粘文件。
    if !in_front() || !clipboard_files::press_paste() {
        return "aborted";
    }
    emit("file");
    if let Some(stop) = hold(UPLOAD_WAIT) {
        return stop;
    }
    // 3. 粘开场白。
    if !kickoff.trim().is_empty() {
        if clipboard_files::copy_text(kickoff).is_err()
            || !in_front()
            || !clipboard_files::press_paste()
        {
            return "aborted";
        }
        if let Some(stop) = hold(TEXT_WAIT) {
            return stop;
        }
    }
    if !send {
        return "filled";
    }
    // 4. 回车发送。上传还没完时网站自己会挡住发送，这一下不会发出半截。
    if let Some(stop) = hold(UPLOAD_WAIT) {
        return stop;
    }
    if !in_front() || !clipboard_files::press_enter() {
        return "aborted";
    }
    "sent"
}
