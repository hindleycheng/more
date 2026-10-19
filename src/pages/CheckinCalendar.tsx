// 打卡日历：格子来自本机台账（history.json）。
// 诚实前提：官方接口不提供逐日签到历史，只给「今天是否已签 + 连续天数」。
// 所以安装猫窝之前的日子一律显示为「未知」，不拿推断冒充事实。
import { useEffect, useMemo, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { HistoryMap } from "../types";
import { Chip, fmtNum } from "../ui";

const WD = ["一", "二", "三", "四", "五", "六", "日"];

function key(y: number, m: number, d: number) {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${y}-${p(m + 1)}-${p(d)}`;
}

export default function CheckinCalendar() {
  const accounts = useStore((s) => s.accounts);
  const reloadAccounts = useStore((s) => s.reloadAccounts);
  const [hist, setHist] = useState<HistoryMap>({});
  const [recorded, setRecorded] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const load = async () => {
    try {
      setHist(await api.historyGet());
      setRecorded(await api.historyRecordedDays(120));
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1);
    const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
    // 周一为首列
    const lead = (first.getDay() + 6) % 7;
    const out: ({ day: number; dateKey: string; state: string; reward: number; who: string[] } | null)[] = [];
    for (let i = 0; i < lead; i++) out.push(null);
    const nowDay = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = key(ym.y, ym.m, d);
      const dayMap = hist[dk];
      const entries = dayMap ? Object.values(dayMap) : [];
      const done = entries.some((e) => e.checkedIn);
      const reward = entries.reduce((a, e) => a + (e.reward || 0), 0);
      const who = dayMap ? Object.keys(dayMap).length : 0;
      const isToday = d === nowDay.getDate() && ym.m === nowDay.getMonth() && ym.y === nowDay.getFullYear();
      const future = new Date(ym.y, ym.m, d) > nowDay;
      const state = isToday ? "today" : future ? "future" : done ? "done" : dayMap ? "miss" : "unknown";
      out.push({ day: d, dateKey: dk, state, reward, who: Array.from({ length: who }) as unknown as string[] });
    }
    return out;
  }, [ym, hist]);

  const monthStats = useMemo(() => {
    const days = Object.keys(hist).filter((d) => d.startsWith(`${ym.y}-${String(ym.m + 1).padStart(2, "0")}`));
    const hit = days.filter((d) => Object.values(hist[d]).some((e) => e.checkedIn)).length;
    const reward = days.reduce(
      (a, d) => a + Object.values(hist[d]).reduce((x, e) => x + (e.reward || 0), 0),
      0,
    );
    return { hit, reward };
  }, [hist, ym]);

  const best = accounts.reduce((a, b) => (b.streak_days > a.streak_days ? b : a), accounts[0]);
  const live = accounts.filter((a) => a.enabled);

  return (
    <div className="cn-grid" style={{ gap: 16 }}>
      <div className="cn-cols-3 cn-grid">
        <div className="cn-card">
          <div className="cn-stat-label">最长连续</div>
          <div className="cn-stat-num">
            {best?.streak_days ?? 0}
            <span className="unit">天</span>
          </div>
          <div className="cn-hint" style={{ marginTop: 6 }}>{best ? `由「${best.nickname}」保持` : "还没有账号"}</div>
        </div>
        <div className="cn-card">
          <div className="cn-stat-label">本月已记录</div>
          <div className="cn-stat-num">
            {monthStats.hit}
            <span className="unit">天</span>
          </div>
          <div className="cn-hint" style={{ marginTop: 6 }}>本月打卡俸禄 +{fmtNum(monthStats.reward, 1)}</div>
        </div>
        <div className="cn-card">
          <div className="cn-stat-label">本机台账覆盖</div>
          <div className="cn-stat-num">
            {recorded}
            <span className="unit">天</span>
          </div>
          <div className="cn-hint" style={{ marginTop: 6 }}>安装猫窝之后才会记录</div>
        </div>
      </div>

      <div className="cn-card">
        <div className="cn-row" style={{ marginBottom: 14 }}>
          <button className="cn-btn sm ghost" onClick={() => setYm((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}>
            ← 上一月
          </button>
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            {ym.y} 年 {ym.m + 1} 月
          </div>
          <button className="cn-btn sm ghost" onClick={() => setYm((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}>
            下一月 →
          </button>
          <span className="cn-sep" />
          <Chip tone={live.every((a) => a.today_checked_in) ? "good" : "warn"}>
            今天 {live.filter((a) => a.today_checked_in).length}/{live.length} 只已打卡
          </Chip>
          <button
            className="cn-btn sm primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.checkinAll();
                await Promise.all([load(), reloadAccounts()]);
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "打卡中…" : "全部打卡"}
          </button>
        </div>

        <div className="cn-cal">
          {WD.map((w) => (
            <div className="cn-cal-head" key={w}>
              {w}
            </div>
          ))}
          {cells.map((c, i) =>
            c === null ? (
              <div key={`e${i}`} style={{ visibility: "hidden" }} className="cn-cell" />
            ) : (
              <div
                key={c.dateKey}
                className={`cn-cell ${c.state === "unknown" ? "miss" : c.state}`}
                title={
                  c.state === "unknown"
                    ? "这几天猫窝还没安装，无数据"
                    : `${c.dateKey} · ${c.state === "done" ? `已打卡 +${fmtNum(c.reward, 1)}` : c.state === "future" ? "未到" : "未记录到打卡"}`
                }
              >
                {c.day}
                {c.state === "done" && c.reward > 0 ? <small>+{fmtNum(c.reward, 0)}</small> : null}
              </div>
            ),
          )}
        </div>

        <div className="cn-row" style={{ marginTop: 14, gap: 14 }}>
          <span className="cn-hint">图例：</span>
          <span className="cn-hint">
            <i className="cn-cell done" style={{ display: "inline-grid", width: 14, height: 14, verticalAlign: -2 }} /> 已打卡
          </span>
          <span className="cn-hint">
            <i className="cn-cell miss" style={{ display: "inline-grid", width: 14, height: 14, verticalAlign: -2 }} /> 没打 / 未知
          </span>
          <span className="cn-hint">
            <i className="cn-cell today" style={{ display: "inline-grid", width: 14, height: 14, verticalAlign: -2 }} /> 今天
          </span>
        </div>
        {err && <div className="cn-hint bad" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <div className="cn-card">
        <div className="cn-card-title">每只猫的今天</div>
        {live.map((a) => (
          <div className="cn-ledger-row" key={a.uid} style={{ gridTemplateColumns: "1fr auto auto" }}>
            <div>
              <div className="cn-ledger-name">{a.nickname}</div>
              <div className="cn-ledger-meta">连续 {a.streak_days} 天 · 凭证 {a.has_local_token ? "已保存" : "缺失"}</div>
            </div>
            <Chip tone={a.today_checked_in ? "good" : "warn"}>{a.today_checked_in ? "已打卡" : "待打卡"}</Chip>
            <button
              className="cn-btn sm"
              disabled={busy || a.today_checked_in || !a.has_local_token}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.checkinOne(a.uid);
                  await Promise.all([load(), reloadAccounts()]);
                } catch (e) {
                  setErr(errText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              打卡
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
