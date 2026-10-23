//! 主窗口创建与 WebView2 健康自愈。
//!
//! ## 为什么窗口不在 tauri.conf.json 里声明
//! 声明式窗口在进程启动阶段就被创建，创建参数编译期固定。而 WebView2 在部分
//! Windows 机器上（虚拟显卡 / 远程桌面 / 安全软件注入 GPU 进程 / 老旧驱动）会
//! 起不来 GPU 进程，Chromium 随即以
//! `FATAL:gpu_data_manager_impl_private.cc GPU process isn't usable. Goodbye.`
//! 让浏览器进程退出——窗口还在，内容永远空白。这种失败无法在界面上提示（界面
//! 就是那个没起来的东西），所以必须在**创建窗口时**就掌握参数控制权：
//!   1. 先按默认参数创建（硬件加速，性能最好）；
//!   2. 前端启动后回报一次 `frontend_ready`，视为健康；
//!   3. 若超时仍无回报，落盘 `webview.json` 标记「安全模式」，重启进程并改用
//!      `--disable-gpu`（软件渲染）重建窗口；
//!   4. 安全模式仍失败则弹原生提示，把原因直接说清楚，而不是留一屏白底。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::platform::more_paths;

/// 主窗口 label，与 capabilities/default.json 中的 "main" 对应。
pub const MAIN_LABEL: &str = "main";

/// 前端是否已成功挂载并回报。仅用于开机自检，不参与业务逻辑。
static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

/// 前端就绪等待上限。宽松一点：低配机器冷启动 + 杀软扫描可能很慢，
/// 宁可多等，也别把「只是慢」误判成「白屏」。
/// 开发构建走 Vite dev server（冷启动更慢），给更宽的窗口，避免边写边调时被重启打断。
fn ready_timeout() -> Duration {
    if cfg!(debug_assertions) {
        Duration::from_secs(120)
    } else {
        Duration::from_secs(25)
    }
}
/// 最多自动降级重启的次数，防止无限重启。
const MAX_AUTO_RESTARTS: u32 = 2;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WebviewMode {
    /// 安全模式：禁用 GPU 硬件加速（软件渲染）。
    pub safe: bool,
    /// 已自动重启次数，前端就绪后清零。
    pub restarts: u32,
}

fn mode_path() -> PathBuf {
    more_paths().root.join("webview.json")
}

fn read_mode() -> WebviewMode {
    std::fs::read(mode_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_mode(m: &WebviewMode) {
    if let Some(dir) = mode_path().parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(m) {
        let _ = std::fs::write(mode_path(), bytes);
    }
}

/// 附加给 WebView2 的浏览器参数。
///
/// 基础串与 Tauri/Wry 的默认值保持一致（少了它会丢掉中文界面的部分修复），
/// 再按模式追加。`MORE_WEBVIEW_DEBUG_PORT` 是排障用出口：设了才会开 CDP 端口，
/// 默认不监听任何端口。
fn browser_args(safe: bool) -> String {
    let mut args = String::from(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
    );
    if safe {
        // 软件渲染：完全不启动 GPU 进程，绕开 GPU 进程被注入/无显卡导致的崩溃。
        args.push_str(" --disable-gpu --disable-gpu-compositing");
    }
    if let Ok(port) = std::env::var("MORE_WEBVIEW_DEBUG_PORT") {
        let port = port.trim();
        if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) {
            args.push_str(&format!(" --remote-debugging-port={port}"));
        }
    }
    args
}

fn build_window(app: &AppHandle, safe: bool) -> tauri::Result<WebviewWindow> {
    let args = browser_args(safe);
    tracing::info!("创建主窗口：safe={safe} args={args}");
    WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html".into()))
        .title("猫窝 More")
        .inner_size(1240.0, 800.0)
        .min_inner_size(980.0, 640.0)
        .resizable(true)
        .center()
        .theme(Some(tauri::Theme::Light))
        .additional_browser_args(&args)
        .build()
}

/// 创建主窗口：先按当前模式建，失败就换另一种模式再试一次。
pub fn create_main(app: &AppHandle) -> Option<WebviewWindow> {
    let mode = read_mode();
    // 已标记安全模式的机器优先走软件渲染，避免每次启动都先白屏一次。
    let order = if mode.safe { [true, false] } else { [false, true] };
    for safe in order {
        match build_window(app, safe) {
            Ok(w) => return Some(w),
            Err(e) => {
                tracing::error!("窗口创建失败（safe={safe}）：{e}");
                // 失败的窗口若残留，先清掉，避免下一次创建撞 label。
                if let Some(w) = app.get_webview_window(MAIN_LABEL) {
                    let _ = w.destroy();
                }
            }
        }
    }
    None
}

/// 前端挂载完成后回报。
pub fn mark_ready() {
    let first = !FRONTEND_READY.swap(true, Ordering::SeqCst);
    if first {
        // 跑通了就把重启计数清零；safe 标记保留，避免下次启动又白屏一轮。
        let mut m = read_mode();
        if m.restarts != 0 {
            m.restarts = 0;
            write_mode(&m);
        }
        tracing::info!("前端已就绪（safe={}）", m.safe);
    }
}

/// 探一次「WebView2 到底活着没」：往页面里塞一行调用，走 Tauri 的 IPC 桥回到
/// `frontend_ready`。Tauri 的初始化脚本在业务 bundle 之前注入，所以桥能通，
/// 就说明内核和页面都活着——只是资源慢或在业务代码里出错，不该判定成白屏。
fn ping_bridge(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN_LABEL) {
        let _ = w.eval(
            "try{window.__TAURI_INTERNALS__&&window.__TAURI_INTERNALS__.invoke('frontend_ready')}catch(e){}",
        );
    }
}

/// 开机自检：超时未见前端回报 → 先探内核活性，再决定降级还是明确告知。
pub fn spawn_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let timeout = ready_timeout();
        tokio::time::sleep(timeout).await;
        if FRONTEND_READY.load(Ordering::SeqCst) {
            return;
        }

        // 慢机器上「前端慢」和「内核死了」在时间上没法区分，先探活性。
        ping_bridge(&app);
        tokio::time::sleep(Duration::from_secs(3)).await;
        if FRONTEND_READY.load(Ordering::SeqCst) {
            tracing::info!("前端迟到但已就绪（内核正常，只是加载慢）");
            return;
        }

        let mut mode = read_mode();
        tracing::error!(
            "前端 {} 秒内未就绪且 IPC 桥无响应：safe={} restarts={}",
            timeout.as_secs(),
            mode.safe,
            mode.restarts
        );
        if !mode.safe && mode.restarts < MAX_AUTO_RESTARTS {
            mode.safe = true;
            mode.restarts += 1;
            write_mode(&mode);
            tracing::warn!("已切到安全模式（软件渲染），重启进程再试一次");
            app.restart();
        }

        // 到这里 IPC 桥都调不通，基本可以断定 WebView2 内核没起来。
        // 开发构建里只记日志：调试期常见的是 dev server 慢，弹窗只会添乱。
        #[cfg(debug_assertions)]
        tracing::error!("[dev] 跳过失败弹窗，见日志与 %APPDATA%\\More\\webview.json");

        #[cfg(not(debug_assertions))]
        {
            let log = more_paths().logs_dir.join("more.log");
            use tauri_plugin_dialog::DialogExt;
            // 非阻塞：别把进程卡在对话框上（用户可能只是想让它在托盘里待着）。
            app.dialog()
                .message(format!(
                    "界面没能加载出来：WebView2 内核在这台机器上没能启动（常见于虚拟显卡、远程桌面、\
                     或安全软件拦截图形子进程）。\n\n已自动试过软件渲染。\n\n\
                     可以尝试：\n1. 更新「Microsoft Edge WebView2 Runtime」后重开；\n\
                     2. 关闭安全软件对图形子进程的拦截；\n3. 把日志发给作者：{}",
                    log.display()
                ))
                .title("猫窝 More · 界面没加载出来")
                .show(|_| {});
        }
    });
}
