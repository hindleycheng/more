//! More 后端库入口：模块装配 + Tauri Builder。

mod accounts;
mod api;
mod commands;
mod data;
mod debug;
mod error;
mod history;
mod oauth;
mod platform;
mod proxy;
mod scheduler;
mod state;
mod usage;
mod vault;
mod wbauth;
mod webview;

use std::io::Write;
use std::sync::{Arc, Mutex};

use state::AppState;
use tauri::Manager;

/// 日志落盘：数据目录下 logs/more.log（超过 2MB 滚动为 more.prev.log）。
///
/// 未签名的小工具收不到崩溃上报，出问题时用户能给出的唯一线索就是这份日志；
/// 之前只注册了 tracing 却没有 subscriber，日志全被丢弃，Windows 上排查基本上是盲猜。
fn init_logging() {
    let dir = platform::more_paths().logs_dir.clone();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("more.log");
    if let Ok(md) = std::fs::metadata(&path) {
        if md.len() > 2 * 1024 * 1024 {
            let _ = std::fs::rename(&path, dir.join("more.prev.log"));
        }
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
        .map(|f| Arc::new(Mutex::new(f)));

    struct FileWriter(Arc<Mutex<std::fs::File>>);
    struct FileGuard(Arc<Mutex<std::fs::File>>);
    impl Write for FileGuard {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            match self.0.lock() {
                Ok(mut f) => f.write(buf),
                Err(_) => Ok(buf.len()),
            }
        }
        fn flush(&mut self) -> std::io::Result<()> {
            match self.0.lock() {
                Ok(mut f) => f.flush(),
                Err(_) => Ok(()),
            }
        }
    }
    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for FileWriter {
        type Writer = FileGuard;
        fn make_writer(&'a self) -> Self::Writer {
            FileGuard(self.0.clone())
        }
    }

    let builder = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_max_level(tracing::Level::INFO);
    match file {
        Some(f) => {
            let _ = builder.with_writer(FileWriter(f)).try_init();
            tracing::info!("=== 启动 More {} ({}) ===", env!("CARGO_PKG_VERSION"), platform::platform_name());
        }
        None => {
            let _ = builder.try_init();
        }
    }
}

/// 从隐藏/托盘状态唤回主窗口：显示 + 取消最小化 + 抢焦点。跨平台一致。
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 路径与日志必须先就绪：后面所有模块都要写数据目录。
    platform::init_paths();
    init_logging();

    let mut builder = tauri::Builder::default();

    // 单实例：已缩到托盘时再次双击 exe，不新起进程，而是唤回已有主窗口。
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        show_main_window(app);
    }));
    builder = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ));

    // 登录窗口被关闭/销毁时终止对应 OAuth 会话，避免前端弹窗卡在 pending。
    // 主窗口点 X 不退出，收进托盘继续跑（打卡/旅行托管靠进程活着）：
    // 真正退出走托盘菜单「退出 More」。macOS 没有托盘（用 Dock），保持原生关闭即退出。
    builder = builder.on_window_event(|window, event| {
        match event {
            tauri::WindowEvent::Destroyed => oauth::on_window_event(window.label(), true),
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let label = window.label();
                // macOS 没有托盘（用 Dock），保持原生「关闭即退出」；
                // 其余平台点 X 收进托盘，退出走托盘菜单。这里用运行时判断而不是 #[cfg]：
                // cfg 写在 match 臂里的块语句上时会被静默剥离，行为对不上源码（实测踩过）。
                let hide_to_tray_on_close =
                    crate::platform::platform_name() != "macos" && label == crate::webview::MAIN_LABEL;
                tracing::info!("CloseRequested: label={label} hide_to_tray={hide_to_tray_on_close}");
                if hide_to_tray_on_close {
                    api.prevent_close();
                    let _ = window.hide();
                    tracing::info!("已收进托盘（退出请用托盘菜单）");
                    return;
                }
                oauth::on_window_event(label, false)
            }
            _ => {}
        }
    });

    builder = builder.setup(|app| {
        platform::init_paths();
        let app_state = Arc::new(AppState::load()?);
        app.manage(app_state.clone());

        // 主窗口在代码里建（不再由 tauri.conf.json 声明）：只有这样才能在
        // WebView2 起不来时改参数重建，而不是给用户留一屏白底。详见 webview.rs。
        if webview::create_main(app.handle()).is_none() {
            tracing::error!("主窗口创建失败：默认与安全模式都没能建起 WebView2");
        }
        webview::spawn_watchdog(app.handle().clone());

        // More 的 token 主密钥由钥匙串保管，不再需要历史上「钥匙串 → vault」的单向迁移。

        // 账号统一通过"网页授权"添加（扫描无法取得可用 token，已退役）。
        // 登录窗会话隔离（清掉上一个账号的 WebView 会话、避免"选择账号"弹窗）已下沉到 oauth::begin，
        // 每次开窗前清一次并等清理跑完再导航；不在此处启动时清，避免与快速点击的 begin 清理重叠。

        // 未签署首启知情同意前：不起反代、不起调度器、不碰任何官方接口。
        if app_state.consent_accepted() {
            // 启动反代（若配置为启用；前置校验不通过则记录原因、不静默半启动）
            if app_state.proxy_settings().enabled {
                let st = app_state.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = proxy::start(st).await {
                        tracing::error!("反代启动被拒绝: {e}");
                    }
                });
            }

            // 启动调度器（传 AppHandle 用于旅行自动领取通知）
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match scheduler::start(handle, app_state.clone()).await {
                    Ok(sched) => {
                        // 持有 scheduler 防止被 drop
                        use std::sync::OnceLock;
                        static SCHED: OnceLock<tokio_cron_scheduler::JobScheduler> = OnceLock::new();
                        let _ = SCHED.set(sched);
                    }
                    Err(e) => tracing::error!("调度器启动失败: {e}"),
                }
            });
        } else {
            tracing::info!("等待首启知情同意，反代与自动化调度均未启动");
        }
    
        // 系统托盘：左键点击唤回主窗口；右键菜单「打开主窗口 / 退出」。
        // 与 hide_to_tray 命令配合，实现“缩到托盘不退出、随时唤回”。
        // 仅 Windows/Linux：macOS 有 Dock + 程序切换，不需要该功能，故不建托盘。
        #[cfg(not(target_os = "macos"))]
        {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let show_i = MenuItem::with_id(app, "show", "打开 More 主窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出 More", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let _tray = TrayIconBuilder::new()
                // Windows 托盘按 32×32 取图：直接喂 512 的 icon.png 会被系统
                // 缩放出毛边，这里换成已经准备好尺寸的文件。
                .icon(tauri::include_image!("icons/32x32.png"))
                .tooltip("More")
                .title("More")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
        }

        Ok(())
    });

    builder = builder.invoke_handler(tauri::generate_handler![
        commands::app_info,
        commands::frontend_ready,
        commands::hide_to_tray,
        commands::get_settings,
        commands::save_settings,
        commands::proxy_status,
        commands::proxy_generate_key,
        commands::privacy_status,
        commands::history_get,
        commands::history_recorded_days,
        commands::automation_status,
        commands::debug_clear,
        commands::vault_purge,
        commands::list_accounts,
        commands::credential_status,
        commands::set_account_enabled,
        commands::set_account_tags,
        commands::delete_account,
        commands::refresh_quota,
        commands::credit_ledger,
        commands::list_models,
        commands::oauth_begin,
        commands::oauth_poll,
        commands::checkin_status,
        commands::sync_checkin_states,
        commands::checkin_all,
        commands::checkin_one,
        commands::travel_overview,
        commands::travel_depart,
        commands::travel_claim,
        commands::travel_records,
        commands::data_list,
        commands::data_read,
        commands::data_delete,
        commands::data_export,
        commands::data_backup,
        commands::data_migrate,
        commands::data_uids,
        commands::dashboard_summary,
        commands::dashboard_trend,
        commands::dashboard_top,
        commands::dashboard_heatmap,
        commands::dashboard_balances,
        commands::dashboard_import_app,
        commands::dashboard_requests,
        commands::dashboard_account_billing,
    ]);

    builder.run(tauri::generate_context!()).expect("运行 More 失败");
}
