// 明信片墙：每次猫猫旅行 = 一张明信片。数据来自官方旅行台账，不编造。
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { TravelLocation, TravelOverview, TravelRecord, TravelStatus } from "../types";
import { Chip, Empty, fmtClock, fmtDur, placeGlyph, useNow } from "../ui";

interface Card extends TravelRecord {
  nickname: string;
}

export default function Postcards() {
  const accounts = useStore((s) => s.accounts);
  const reloadAccounts = useStore((s) => s.reloadAccounts);
  const [ov, setOv] = useState<TravelOverview | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [pickUid, setPickUid] = useState<string>("");
  const [pickLoc, setPickLoc] = useState<number>(0);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const now = useNow(1000);

  const live = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);

  const load = useCallback(async () => {
    try {
      const o = await api.travelOverview();
      setOv(o);
      const uid = pickUid || o.accounts[0]?.uid || "";
      if (uid) setPickUid(uid);
      const all = await Promise.all(
        o.accounts.map(async (a) => {
          try {
            const rs = await api.travelRecords(a.uid);
            return rs.map((r) => ({ ...r, nickname: a.nickname }));
          } catch {
            return [] as Card[];
          }
        }),
      );
      const flat = all.flat().sort((a, b) => b.departAt - a.departAt);
      setCards(flat);
      if (!pickLoc && o.config.length) {
        const best = o.config.slice().sort((x, y) => y.durationMaxHours - x.durationMaxHours)[0];
        setPickLoc(best.id);
      }
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e) });
    }
  }, [pickUid, pickLoc]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      await Promise.all([load(), reloadAccounts()]);
      setMsg({ tone: "good", text: "办好了" });
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e) });
    } finally {
      setBusy("");
    }
  }

  const locOf = (id: number): TravelLocation | undefined => ov?.config.find((c) => c.id === id);
  const chosen = locOf(pickLoc);

  return (
    <div className="cn-grid" style={{ gap: 16 }}>
      <div className="cn-card">
        <div className="cn-card-title">派一只猫出门</div>
        <div className="cn-cols-3 cn-grid" style={{ alignItems: "end" }}>
          <div className="cn-field" style={{ marginBottom: 0 }}>
            <label>选猫</label>
            <select className="cn-input" value={pickUid} onChange={(e) => setPickUid(e.target.value)}>
              {live.map((a) => (
                <option key={a.uid} value={a.uid}>
                  {a.nickname}
                </option>
              ))}
            </select>
          </div>
          <div className="cn-field" style={{ marginBottom: 0 }}>
            <label>目的地</label>
            <select className="cn-input" value={pickLoc} onChange={(e) => setPickLoc(Number(e.target.value))}>
              {(ov?.config ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {placeGlyph(c.name)} {c.name}（{c.durationMinHours}-{c.durationMaxHours} 小时）
                </option>
              ))}
            </select>
          </div>
          <button
            className="cn-btn primary"
            disabled={!pickUid || !chosen || busy !== ""}
            onClick={() => act("depart", () => api.travelDepart(pickUid, pickLoc))}
          >
            {busy ? "处理中…" : "出发 🧳"}
          </button>
        </div>
        {chosen && (
          <div className="cn-hint" style={{ marginTop: 10 }}>
            {chosen.name} 通常要 {chosen.durationMinHours}–{chosen.durationMaxHours} 小时，回来后按官方台账发俸禄。
            自动托管{ov?.autoEnabled ? "已开启（到点自动领）" : "未开启（需要你手动点领取）"}。
          </div>
        )}
        {msg && (
          <div className={`cn-hint ${msg.tone === "bad" ? "bad" : "good"}`} style={{ marginTop: 10 }}>
            {msg.text}
          </div>
        )}
      </div>

      {/* 在途的猫：单独一块，带实时倒计时 */}
      {(ov?.accounts ?? []).some(
        (a) => !!a.status && typeof a.status === "object" && "state" in a.status && (a.status as TravelStatus).state === "traveling",
      ) && (
        <div className="cn-card">
          <div className="cn-card-title">正在路上</div>
          {ov!.accounts.map((a) => {
            const st = a.status as TravelStatus;
            if (!st || st.state !== "traveling") return null;
            const left = st.arriveAt - Math.floor(now / 1000);
            const total = Math.max(1, st.arriveAt - st.departAt);
            const pct = Math.max(0, Math.min(100, ((total - left) / total) * 100));
            return (
              <div key={a.uid} style={{ marginBottom: 14 }}>
                <div className="cn-row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {placeGlyph(st.locationName)} {a.nickname} → {st.locationName || "途中"}
                  </div>
                  <span className="cn-countdown">{fmtDur(left)}</span>
                </div>
                <div className="cn-meter" style={{ marginTop: 7 }}>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="cn-hint" style={{ marginTop: 5 }}>
                  {fmtClock(st.departAt)} 派出 · {fmtClock(st.arriveAt)} 到站
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div className="cn-row" style={{ marginBottom: 12 }}>
          <div className="cn-card-title" style={{ margin: 0 }}>
            收到的明信片（{cards.length}）
          </div>
          <span className="cn-sep" />
          <Chip>官方台账 · 最近 50 条/账号</Chip>
        </div>
        {cards.length === 0 ? (
          <div className="cn-card">
            <Empty glyph="📮" title="还没有明信片" desc="派一只猫出门，回来后这里会攒出它的旅行纪念册。" />
          </div>
        ) : (
          <div className="cn-postcards">
            {cards.map((c) => {
              const claimed = c.claimedAt > 0;
              const dur = Math.max(0, c.arriveAt - c.departAt);
              return (
                <div className="cn-postcard" key={`${c.recordId}-${c.nickname}`}>
                  <div className="cn-pc-top">
                    <div>
                      <div className="cn-pc-place">
                        {placeGlyph(c.locationName)} {c.locationName || "未知地点"}
                      </div>
                      <div className="cn-pc-date">
                        {c.travelDate} · {c.nickname}
                      </div>
                    </div>
                    <div className="cn-pc-stamp">
                      +{c.rewardCredit}
                      <small>俸禄</small>
                    </div>
                  </div>
                  <div className="cn-pc-body">
                    {fmtClock(c.departAt)} 出发，{fmtClock(c.arriveAt)} 到站，路上 {fmtDur(dur)}。
                    <br />
                    {claimed ? `${fmtClock(c.claimedAt)} 已领取俸禄。` : "俸禄还没领。"}
                  </div>
                  <div className="cn-pc-foot">
                    <span>#{c.recordId}</span>
                    {claimed ? <Chip tone="good">已领取</Chip> : (
                      <button
                        className="cn-btn sm primary"
                        disabled={busy !== ""}
                        onClick={() => act("claim", () => api.travelClaim(uidOf(live, c.nickname)))}
                      >
                        {busy ? "…" : "领取"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function uidOf(list: { uid: string; nickname: string }[], nickname: string): string {
  return list.find((a) => a.nickname === nickname)?.uid ?? "";
}
