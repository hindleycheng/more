// 俸禄流水：奖励批次（钱从哪来、什么时候过期）+ 消耗明细（花在哪）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { CreditLedger } from "../types";
import { Chip, Empty, fmtNum } from "../ui";

export default function Ledger() {
  const accounts = useStore((s) => s.accounts);
  const live = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);
  const [uid, setUid] = useState("");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<CreditLedger | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!uid && live.length) setUid(live[0].uid);
  }, [live, uid]);

  const load = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    try {
      setData(await api.creditLedger(uid, days));
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }, [uid, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const acc = live.find((a) => a.uid === uid);
  const burn = data && data.days ? data.usage.reduce((a, u) => a + (u.credits || 0), 0) / data.days : 0;
  const remaining = acc?.quota?.remaining ?? 0;
  const expiring = (data?.rewards ?? []).filter((r) => r.expireAt && r.status !== "已过期");

  if (!live.length) {
    return (
      <div className="cn-card">
        <Empty glyph="🧾" title="还没有流水" desc="先在「猫口名册」添加账号，这里才有俸禄收支可看。" />
      </div>
    );
  }

  return (
    <div className="cn-grid" style={{ gap: 16 }}>
      <div className="cn-card">
        <div className="cn-row" style={{ gap: 10 }}>
          <select className="cn-input" style={{ width: 200 }} value={uid} onChange={(e) => setUid(e.target.value)}>
            {live.map((a) => (
              <option key={a.uid} value={a.uid}>
                {a.nickname}
              </option>
            ))}
          </select>
          <div className="cn-row" style={{ gap: 6 }}>
            {[7, 30, 90].map((d) => (
              <button key={d} className={`cn-btn sm ${days === d ? "primary" : ""}`} onClick={() => setDays(d)}>
                {d} 天
              </button>
            ))}
          </div>
          <span className="cn-sep" />
          <Chip>余额 {fmtNum(remaining, 1)}</Chip>
          <Chip tone={burn > 0 ? "warn" : ""}>日均消耗 {fmtNum(burn, 2)}</Chip>
          {burn > 0 && <Chip tone={remaining / burn < 7 ? "bad" : "good"}>约可撑 {fmtNum(remaining / burn, 1)} 天</Chip>}
        </div>
        {err && <div className="cn-hint bad" style={{ marginTop: 10 }}>{err}</div>}
        {busy && <div className="cn-hint" style={{ marginTop: 10 }}>读取中…</div>}
      </div>

      <div className="cn-cols-2 cn-grid">
        <div className="cn-card">
          <div className="cn-card-title">俸禄批次（{data?.rewardCount ?? 0}）</div>
          {!data?.rewards?.length ? (
            <div className="cn-hint">没有奖励批次</div>
          ) : (
            data.rewards.map((r, i) => (
              <div className="cn-ledger-row" key={`${r.name}-${i}`} style={{ gridTemplateColumns: "1fr auto" }}>
                <div>
                  <div className="cn-ledger-name">{r.name}</div>
                  <div className="cn-ledger-meta">
                    {r.reason} · 已用 {fmtNum(r.used, 1)} / {fmtNum(r.total, 1)}
                    {r.expireAt ? ` · ${new Date(r.expireAt).toLocaleDateString("zh-CN")} 到期` : " · 长期有效"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="cn-num">{fmtNum(r.remaining, 1)}</div>
                  <Chip tone={r.status === "已过期" ? "bad" : r.status === "使用中" ? "good" : ""}>{r.status}</Chip>
                </div>
              </div>
            ))
          )}
          {expiring.length > 0 && (
            <div className="cn-hint warn" style={{ marginTop: 12 }}>
              有 {expiring.length} 个批次带到期时间，先花快过期的更划算。
            </div>
          )}
        </div>

        <div className="cn-card">
          <div className="cn-card-title">消耗明细（近 {data?.days ?? days} 天，共 {data?.usage?.length ?? 0} 条）</div>
          {!data?.usage?.length ? (
            <div className="cn-hint">这段时间没有消耗记录</div>
          ) : (
            data.usage.slice(0, 40).map((u) => (
              <div className="cn-ledger-row" key={u.requestId} style={{ gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div className="cn-ledger-name">{u.model}</div>
                  <div className="cn-ledger-meta">
                    {new Date(u.ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {u.client}
                  </div>
                </div>
                <div className="cn-num" style={{ color: "var(--accent-ink)" }}>
                  -{fmtNum(u.credits, 2)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
