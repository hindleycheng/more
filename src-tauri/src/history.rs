//! 本地行为台账（history.json）。
//!
//! 为什么要它：官方接口只告诉今天有没有签到、连续几天，不给逐日历史。
//! 猫窝的「打卡日历」需要真实数据而不是推断，所以从这里开始，把每天观测到的
//! 打卡与领取结果落到本机，按日按账号记录。日历对**安装之前**的日子显示为「未知」，
//! 不编造历史。
//!
//! 结构：{ "YYYY-MM-DD": { "<uid>": { "checkedIn": bool, "reward": f64,
//!          "streak": i64, "claimed": f64 } } }

use std::collections::HashMap;

use chrono::Local;
use serde_json::{json, Value};

use crate::platform::more_paths;

type Day = HashMap<String, Value>;

fn path() -> std::path::PathBuf {
    more_paths().root.join("history.json")
}

fn read_all() -> HashMap<String, Day> {
    std::fs::read(path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_all(map: &HashMap<String, Day>) {
    if let Some(dir) = path().parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(map) {
        let _ = std::fs::write(path(), bytes);
    }
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn mutate<F: FnOnce(&mut Value)>(date: &str, uid: &str, f: F) {
    let mut all = read_all();
    let day = all.entry(date.to_string()).or_default();
    let e = day
        .entry(uid.to_string())
        .or_insert_with(|| json!({"checkedIn": false, "reward": 0.0, "streak": 0, "claimed": 0.0}));
    f(e);
    write_all(&all);
}

/// 记录一次打卡结果。
pub fn record_checkin(uid: &str, date: &str, checked_in: bool, reward: f64, streak: i64) {
    mutate(date, uid, |e| {
        // 只有真签到才把 checkedIn 置真；同日重复签到不改奖励。
        if checked_in && e.get("reward").and_then(|v| v.as_f64()).unwrap_or(0.0) == 0.0 {
            e["reward"] = json!(reward);
        }
        if checked_in {
            e["checkedIn"] = json!(true);
        }
        e["streak"] = json!(streak);
    });
}

/// 记录今日旅行俸禄领取（累加）。
pub fn record_claim(uid: &str, credits: f64) {
    mutate(&today(), uid, |e| {
        let cur = e.get("claimed").and_then(|v| v.as_f64()).unwrap_or(0.0);
        e["claimed"] = json!(cur + credits);
    });
}

/// 返回全部台账（供前端画日历）。
pub fn all() -> Value {
    serde_json::to_value(read_all()).unwrap_or(json!({}))
}

/// 最近 n 天里有打卡记录的天数，用于「本机已记录 X 天」。
pub fn recorded_days(n: i64) -> i64 {
    let all = read_all();
    let today = Local::now().date_naive();
    (0..n.max(0))
        .filter_map(|i| today.checked_sub_days(chrono::Days::new(i as u64)))
        .filter(|d| {
            all.get(&d.format("%Y-%m-%d").to_string())
                .map(|m| {
                    m.values()
                        .any(|v| v.get("checkedIn").and_then(|x| x.as_bool()).unwrap_or(false))
                })
                .unwrap_or(false)
        })
        .count() as i64
}
