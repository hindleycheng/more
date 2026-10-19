//! 诊断落盘开关。
//!
//! More 的立场：**默认不落盘任何原始响应/请求内容**。
//! 旧实现会把 quota/usage/models/chat 的原始 JSON 写到数据目录，其中
//! `usage-debug.json` 与 `proxy-chat-debug.json` 含用户完整提问原文，明文长期留存
//! 既会被备份/同步软件带走，也会被本机任意进程读取。
//!
//! 这里把「是否诊断落盘」变成一个显式的、默认关闭的开关：
//! - 关闭时（默认）：`dump()` 直接返回，一个字节都不写。
//! - 开启时：写快照文件，并提示用户可用 `debug_clear` 一键清理。

use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::Value;

use crate::error::WmResult;
use crate::platform::more_paths;

static ENABLED: AtomicBool = AtomicBool::new(false);

/// 由应用启动时与设置保存时调用。
pub fn set_enabled(v: bool) {
    ENABLED.store(v, Ordering::Relaxed);
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// 仅在开关打开时写诊断快照。关闭时为无副作用的空操作。
pub fn dump(name: &str, value: &Value) {
    if !enabled() {
        return;
    }
    let path = more_paths().root.join(name);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(value) {
        let _ = std::fs::write(&path, bytes);
    }
}

/// 已知诊断快照文件名，用于「一键清理」。
const KNOWN_DUMPS: &[&str] = &[
    "models-debug.json",
    "quota-debug.json",
    "usage-debug.json",
    "checkin-debug.json",
    "travel-status-debug.json",
    "travel-config-debug.json",
    "checkin-scheduler-debug.json",
    "travel-scheduler-debug.json",
    "proxy-chat-debug.json",
];

/// 删除全部诊断快照，返回被删掉的文件名。只碰已知快照名，不碰账号/设置/数据库。
pub fn clear() -> WmResult<Vec<String>> {
    let root = more_paths().root.clone();
    let mut removed = Vec::new();
    for name in KNOWN_DUMPS {
        let p = root.join(name);
        if p.exists() {
            std::fs::remove_file(&p)?;
            removed.push((*name).to_string());
        }
    }
    Ok(removed)
}

/// 列出当前残留的诊断快照（用于界面上的隐私提示）。
pub fn existing() -> Vec<String> {
    let root = more_paths().root.clone();
    KNOWN_DUMPS
        .iter()
        .filter(|n| root.join(n).exists())
        .map(|n| (*n).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 关闭时不落盘_开启后才写() {
        let name = "unit-debug-probe.json";
        let path = crate::platform::more_paths().root.join(name);
        std::fs::remove_file(&path).ok();

        set_enabled(false);
        dump(name, &json!({"secret": "用户提问原文"}));
        assert!(!path.exists(), "默认关闭时 dump() 必须一个字节都不写");

        set_enabled(true);
        dump(name, &json!({"ok": 1}));
        assert!(path.exists(), "显式开启后才应写快照");

        set_enabled(false);
        std::fs::remove_file(&path).ok();
    }
}
