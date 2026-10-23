// More 通用 UI 组件与格式化：猫脸、倒计时、地点插画、数字与日期。
import { useEffect, useState } from "react";
import wechatCard from "./assets/wechat-card.png";
import wechatQr from "./assets/wechat-qr.png";

/** 猫脸：纯 SVG，随状态换表情（睡觉 / 出门 / 回来 / 饿了）。 */
export function CatFace({
  mood,
  size = 40,
}: {
  mood: "sleep" | "out" | "back" | "hungry";
  size?: number;
}) {
  const eye =
    mood === "sleep"
      ? { closed: true, happy: false }
      : mood === "hungry"
        ? { closed: false, happy: false }
        : { closed: false, happy: true };
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M9 16 6 6l9 5h14l9-5-3 10z" fill="currentColor" opacity="0.16" />
      <path
        d="M24 8c9.4 0 16 6.2 16 15.4C40 33.4 33 40 24 40S8 33.4 8 23.4C8 14.2 14.6 8 24 8z"
        fill="currentColor"
        opacity="0.1"
      />
      <circle cx="18" cy="24" r={eye.closed ? 2.6 : 3} fill="currentColor" opacity={eye.closed ? 0.5 : 0.85} />
      <circle cx="30" cy="24" r={eye.closed ? 2.6 : 3} fill="currentColor" opacity={eye.closed ? 0.5 : 0.85} />
      {eye.closed && (
        <>
          <path d="M14.5 24h7M26.5 24h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
        </>
      )}
      <path d="M24 29.5c-1.2 0-2-.7-2-1.5h4c0 .8-.8 1.5-2 1.5z" fill="currentColor" opacity="0.6" />
      <path
        d={eye.happy ? "M24 31c0 2 1.8 3 3.6 2M24 31c0 2-1.8 3-3.6 2" : "M21 32.5h6"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
        opacity="0.65"
      />
      {mood === "out" && <text x="34" y="14" fontSize="10" fill="currentColor" opacity="0.7">🐾</text>}
    </svg>
  );
}

/** 旅行地点 → 插画字符。取不到就用通用行囊。 */
export function placeGlyph(name: string, code?: string): string {
  const byCode: Record<string, string> = {
    mall: "🛍️",
    park: "🌳",
    cafe: "☕️",
    beach: "🏖️",
    mountain: "⛰️",
    library: "📚",
    market: "🧺",
    station: "🚉",
    home: "🏠",
  };
  if (code && byCode[code]) return byCode[code];
  const n = name || "";
  if (/商场|购物|店铺|超市/.test(n)) return "🛍️";
  if (/公园|森林|草/.test(n)) return "🌳";
  if (/咖啡|茶|甜品/.test(n)) return "☕️";
  if (/海|河|湖|水/.test(n)) return "🏖️";
  if (/山|坡|岭/.test(n)) return "⛰️";
  if (/图书馆|书店|书/.test(n)) return "📚";
  if (/市集|菜场|夜市/.test(n)) return "🧺";
  if (/站|机场|码头/.test(n)) return "🚉";
  if (/家|窝|房间/.test(n)) return "🏠";
  if (/庙|寺|宫|馆/.test(n)) return "⛩️";
  return "🎒";
}

export function fmtNum(n: number | undefined | null, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 秒 → 「3小时12分」/「12分09秒」，用于旅行剩余时间。 */
export function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} 小时 ${String(m).padStart(2, "0")} 分`;
  if (m > 0) return `${m} 分 ${String(sec).padStart(2, "0")} 秒`;
  return `${sec} 秒`;
}

export function fmtClock(unixSec: number | undefined | null): string {
  if (!unixSec) return "—";
  const d = new Date(unixSec * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtHM(ms: number | undefined | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function dayKey(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 每秒跳一次的本地时钟，供倒计时使用。 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Chip({
  tone = "",
  children,
}: {
  tone?: "good" | "warn" | "bad" | "accent" | "";
  children: React.ReactNode;
}) {
  return <span className={`cn-chip ${tone}`}>{children}</span>;
}

export function Meter({ pct, low }: { pct: number; low?: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={`cn-meter ${low ? "low" : ""}`}>
      <i style={{ width: `${p}%` }} />
    </div>
  );
}

export function Empty({ glyph, title, desc }: { glyph: string; title: string; desc?: string }) {
  return (
    <div className="cn-empty">
      <div className="big">{glyph}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{title}</div>
      {desc ? <div style={{ marginTop: 6 }}>{desc}</div> : null}
    </div>
  );
}

/** 作者微信名片：侧栏里是缩略图，点开看大图（朋友扫码用）。
 *  图片已剥掉 EXIF/IPTC，只留 JFIF 与 ICC 色彩描述，不带拍摄时间与位置信息。
 *  必须是真 PNG：JPEG 改后缀在 WebKit 里会解出空白（实测踩过）。 */
export function ContactCard() {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // 打开弹窗时锁掉背后页面的滚动，避免滚轮把弹窗顶走。
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="cn-qr-btn"
        onClick={() => setOpen(true)}
        title="点开看大图，扫码加我微信"
        aria-label="打开微信二维码"
      >
        <img
          src={wechatQr}
          alt="作者微信二维码"
          className="cn-qr"
          onError={() => setBroken(true)}
        />
        <span className="cn-qr-cap">
          {broken ? "名片图丢了，点这里试试" : "扫这个加我微信 · 点开看大图"}
        </span>
      </button>
      {open && (
        <div
          className="cn-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="微信二维码"
          onClick={() => setOpen(false)}
        >
          <div className="cn-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="cn-lightbox-title">加我微信</div>
            <div className="cn-lightbox-sub">猫窝的问题、想加新功能，直接找我</div>
            {broken ? (
              <div className="cn-lightbox-miss">
                名片图片没打进包里（构建时缺少 <code>src/assets/wechat-card.png</code>）。
              </div>
            ) : (
              <img
                src={wechatCard}
                alt="作者微信二维码，放大版"
                className="cn-lightbox-img"
                onError={() => setBroken(true)}
              />
            )}
            <div className="cn-lightbox-tip">
              用微信「扫一扫」对着这个码即可。按 Esc 或点背景关闭。
            </div>
            <button className="cn-btn sm" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}
