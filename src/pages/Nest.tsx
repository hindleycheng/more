// 猫窝总览：一屏看完「每只猫现在在哪、今天要做什么、额度还能撑几天」。
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { Account, CreditLedger, TravelAccountStatus, TravelOverview, TravelStatus } from "../types";
import { CatFace, Chip, Empty, Meter, fmtClock, fmtDur, fmtHM, fmtNum, placeGlyph, useNow } from "../ui";

type Status = TravelStatus | { error: string };

/** 判别旅行状态对象。后端取不到状态时会给 null，`"state" in null` 会直接抛 TypeError，
 *  所以必须先判空——这条是真实账号数据接进来后第一个崩点（界面曾整页崩溃）。 */
function isTravel(s: Status | null | undefined): s is TravelStatus {
  return !!s && typeof s === "object" && "state" in s;
}

/** 从流水里估算每日消耗，用于「还能撑几天」。 */
function dailyBurn(ledger?: CreditLedger): number {
  if (!ledger || !ledger.usage?.length || !ledger.days) return 0;
  const total = ledger.usage.reduce((a, u) => a + (u.credits || 0), 0);
  return total / Math.max(1, ledger.days);
}

function moodOf(acc: Account, st?: Status): "sleep" | "out" | "back" | "hungry" {
  const rem = acc.quota?.remaining ?? Infinity;
  if (rem < 200) return "hungry";
  if (!isTravel(st)) return "sleep";
  if (st && "state" in st) {
    if (st.state === "traveling") return "out";
    if (st.state === "arrived") return "back";
  }
  return "sleep";
}

const MOOD_TEXT: Record<string, string> = {
  sleep: "在窝里蜷着，没出门",
  out: "出门旅行了",
  back: "到站了，等他回家领俸禄",
  hungry: "口粮快见底了",
};

export default function Nest() {
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const reloadAccounts = useStore((s) => s.reloadAccounts);
  const [ov, setOv] = useState<TravelOverview | null>(null);
  const [ledgers, setLedgers] = useState<Record<string, CreditLedger>>({});
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const now = useNow(1000);

  const live = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);

  const load = useCallback(async () => {
    try {
      // 先把官方打卡状态同步进名册，否则 streak_days 会停在 0（与真实连续天数不符）。
      await api.syncCheckinStates().catch(() => null);
      await reloadAccounts();
      const o = await api.travelOverview();
      setOv(o);
      const entries = await Promise.all(
        o.accounts.map(async (a) => {
          try {
            return [a.uid, await api.creditLedger(a.uid, 30)] as const;
          } catch {
            return null;
          }
        }),
      );
      setLedgers(Object.fromEntries(entries.filter(Boolean) as [string, CreditLedger][]));
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, label: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      await Promise.all([load(), reloadAccounts()]);
      setMsg({ tone: "good", text: label });
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e) });
    } finally {
      setBusy("");
    }
  }

  const byUid = useMemo(() => {
    const m: Record<string, TravelAccountStatus> = {};
    (ov?.accounts ?? []).forEach((a) => (m[a.uid] = a));
    return m;
  }, [ov]);

  // 今日待办：把「没签到的猫」「到站没领的猫」「在家闲着的猫」列成清单
  const todos = useMemo(() => {
    const out: { key: string; icon: string; text: string; action?: { label: string; run: () => Promise<unknown> } }[] = [];
    live.forEach((a) => {
      const rec = byUid[a.uid];
      const st = rec?.status;
      if (!a.today_checked_in) {
        out.push({
          key: `ci-${a.uid}`,
          icon: "🐾",
          text: `「${a.nickname}」今天还没打卡（已连续 ${a.streak_days} 天）`,
          action: { label: "打卡", run: () => api.checkinOne(a.uid) },
        });
      }
      if (isTravel(st) && st.state === "arrived") {
        out.push({
          key: `cl-${a.uid}`,
          icon: "🎁",
          text: `「${a.nickname}」从${st.locationName}回来了，俸禄还没领`,
          action: { label: "领俸禄", run: () => api.travelClaim(a.uid) },
        });
      }
      if (isTravel(st) && st.state === "idle" && !st.dailyLimitReached) {
        const best = (ov?.config ?? []).slice().sort((x, y) => y.durationMaxHours - x.durationMaxHours)[0];
        if (best) {
          out.push({
            key: "dp-" + a.uid,
            icon: "🧳",
            text: `「${a.nickname}」在家闲着，可以派去${best.name}`,
            action: { label: "派它出门", run: () => api.travelDepart(a.uid, best.id) },
          });
        }
      }
    });
    return out;
  }, [live, byUid, ov]);

  const totalRemaining = live.reduce((s, a) => s + (a.quota?.remaining ?? 0), 0);
  const totalBurn = live.reduce((s, a) => s + dailyBurn(ledgers[a.uid]), 0);
  const daysLeft = totalBurn > 0 ? totalRemaining / totalBurn : null;

  const hour = new Date(now).getHours();
  const greet = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "午安" : hour < 18 ? "下午好" : "晚上好";

  if (!live.length) {
    return (
      <div className="cn-card">
        <Empty
          glyph="🐈"
          title="窝里还没有猫"
          desc="去「猫口名册」用网页授权添加你的 WorkBuddy 账号，添加完这里就会出现每只猫的状态。"
        />
      </div>
    );
  }

  return (
    <div className="cn-grid" style={{ gap: 16 }}>
      <div className="cn-card">
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
          {new Date(now).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{greet}，窝里一切如常</div>
        <div className="cn-row" style={{ marginTop: 14, gap: 10 }}>
          <Chip tone="accent">{live.length} 只猫</Chip>
          <Chip>口粮合计 {fmtNum(totalRemaining, 1)}</Chip>
          {daysLeft != null ? (
            <Chip tone={daysLeft < 7 ? "warn" : "good"}>按近 30 天消耗，约可撑 {fmtNum(daysLeft, 1)} 天</Chip>
          ) : (
            <Chip>暂无消耗记录</Chip>
          )}
          {settings.travel.autoEnabled ? <Chip tone="good">自动托管已开</Chip> : <Chip>自动托管关闭</Chip>}
          {!settings.consentAccepted && <Chip tone="bad">尚未完成知情同意</Chip>}
        </div>
        {msg && (
          <div className={`cn-hint ${msg.tone === "bad" ? "bad" : "good"}`} style={{ marginTop: 12 }}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="cn-cols-2 cn-grid">
        {live.map((a) => {
          const rec = byUid[a.uid];
          const st = rec?.status;
          const travel = isTravel(st) ? st : null;
          const md = moodOf(a, st);
          const q = a.quota;
          const pct = q && q.total > 0 ? (q.remaining / q.total) * 100 : 0;
          const burn = dailyBurn(ledgers[a.uid]);
          const left = travel && travel.state === "traveling" ? travel.arriveAt - Math.floor(now / 1000) : 0;
          return (
            <div className="cn-card" key={a.uid}>
              <div className="cn-cat">
                <div className="cn-cat-face">
                  <CatFace mood={md} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="cn-cat-name">
                    {a.nickname}{" "}
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                      · {a.account_type === "personal" ? "个人" : a.account_type}
                    </span>
                  </div>
                  <div className="cn-cat-mood">
                    {travel && travel.state === "traveling" ? (
                      <>
                        正在 <b>{placeGlyph(travel.locationName)} {travel.locationName || "途中"}</b> 旅行，还有{" "}
                        <span className="cn-countdown">{fmtDur(left)}</span>
                        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2 }}>
                          {fmtClock(travel.departAt)} 出发 · {fmtClock(travel.arriveAt)} 到站
                        </div>
                      </>
                    ) : travel && travel.state === "arrived" ? (
                      <>
                        从 <b>{travel.locationName}</b> 回来了，俸禄在门口等你领
                      </>
                    ) : travel && travel.dailyLimitReached ? (
                      <>今天已经跑满，歇着了</>
                    ) : (
                      MOOD_TEXT[md]
                    )}
                  </div>
                  {!rec || !isTravel(rec.status) ? (
                    <div className="cn-hint bad">
                      {rec && rec.status && "error" in rec.status ? `状态读取失败：${(rec.status as { error: string }).error}` : "没有读到旅行状态"}
                    </div>
                  ) : null}
                  {q ? (
                    <div style={{ marginTop: 6 }}>
                      <div className="cn-row" style={{ justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>口粮</span>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>
                          {fmtNum(q.remaining, 1)} / {fmtNum(q.total)}
                        </span>
                      </div>
                      <Meter pct={pct} low={pct < 15} />
                      <div className="cn-row" style={{ marginTop: 8, gap: 6 }}>
                        <Chip tone={a.today_checked_in ? "good" : "warn"}>
                          {a.today_checked_in ? "已打卡" : "未打卡"} · 连续 {a.streak_days} 天
                        </Chip>
                        {burn > 0 && <Chip>日耗 {fmtNum(burn, 2)}</Chip>}
                        {q.expiring_soon && <Chip tone="bad">有资源包即将到期</Chip>}
                      </div>
                    </div>
                  ) : (
                    <div className="cn-hint">还没刷新过额度</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cn-card">
        <div className="cn-card-title">今天要做的事</div>
        {todos.length === 0 ? (
          <div className="cn-hint good">没有待办，猫都喂饱了 🐾</div>
        ) : (
          <div>
            {todos.map((t) => (
              <div className="cn-ledger-row" key={t.key} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                <div style={{ fontSize: 16 }}>{t.icon}</div>
                <div>
                  <div className="cn-ledger-name">{t.text}</div>
                </div>
                <button
                  className="cn-btn sm primary"
                  disabled={busy === t.key || !t.action}
                  onClick={() => t.action && act(t.key, "办好了", t.action.run)}
                >
                  {busy === t.key ? "处理中…" : t.action?.label}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="cn-row" style={{ marginTop: 14 }}>
          <button className="cn-btn" disabled={busy === "all"} onClick={() => act("all", "已批量打卡", () => api.checkinAll())}>
            {busy === "all" ? "处理中…" : "全部打卡"}
          </button>
          <button
            className="cn-btn"
            disabled={busy === "q"}
            onClick={() => act("q", "额度已刷新", () => api.refreshQuota(live.map((a) => a.uid)))}
          >
            {busy === "q" ? "读取中…" : "刷新额度"}
          </button>
          <span className="cn-sep" />
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>上次读取 {fmtHM(Date.now())}</span>
        </div>
      </div>
    </div>
  );
}
