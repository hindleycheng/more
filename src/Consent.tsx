// 首启知情同意。未点「同意」前，后端不会启动反代与调度器（见 lib.rs 的 consent 门禁）。
import { useState } from "react";
import { api, errText } from "./api";
import { useStore } from "./store";
import { CatFace } from "./ui";

export default function Consent() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      await saveSettings({ ...structuredClone(settings), consentAccepted: true });
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="cn-consent cn-consent-inner">
      <div className="cn-consent-box">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="cn-cat-face" style={{ width: 54, height: 54 }}>
            <CatFace mood="sleep" size={36} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>猫窝 More</div>
            <div style={{ fontSize: 12, color: "var(--faint)" }}>第一次见面，有几件事必须说清楚</div>
          </div>
        </div>

        <h1>先读这三段，再决定要不要往下</h1>

        <h2>1 · 这是第三方工具，不是 WorkBuddy 官方产品</h2>
        <p>
          猫窝是第三方独立开发的本地工具，与 WorkBuddy 官方没有任何关系，也未获其授权或背书。
          它做的事情是：用你自己的账号凭证，代替你去调用官方已有的接口。
        </p>

        <h2>2 · 自动签到与自动旅行属于脚本化调用，风险由你的账号承担</h2>
        <p>
          「每天自动打卡」「自动派猫旅行」本质上是让程序按时替你操作账号。多数服务的条款并不欢迎这种行为，
          理论上可能触发限流或风控。因此在这版猫窝里：
        </p>
        <ul>
          <li>所有自动化<strong>默认关闭</strong>，需要你之后在「窝规」里逐项显式打开；</li>
          <li>旅行托管带当日熔断，不会无上限轮询官方接口；</li>
          <li>不要把不打算承担风险的账号（公司、付费主力）交给他。</li>
        </ul>

        <h2>3 · 数据怎么放、为什么这样放</h2>
        <p>
          登录凭证在<strong>本机</strong>用一把首次运行时随机生成的密钥加密（AES-256-GCM），密钥与密文都放在
          <code>~/Library/Application Support/More</code>（Windows 为 <code>%APPDATA%\More</code>），
          权限 0600，不上传、不写进安装包、换台机器也解不开。默认<strong>不</strong>把接口原始响应落盘，
          「诊断落盘」只在你排查问题时临时开启。
        </p>
        <p>
          把话说全：这把密钥<strong>挡不住</strong> root 权限、以你身份运行的其它程序、以及你把整个数据目录
          一起备份或同步出去造成的泄露。它挡住的是「安装包被公开传播后人人可解密」这一类。
          想更稳，就给这块磁盘开 FileVault，并别把数据目录放进云同步。
        </p>

        {err && <p style={{ color: "var(--danger)" }}>{err}</p>}

        <div className="cn-row" style={{ marginTop: 22, gap: 10 }}>
          <button className="cn-btn primary" onClick={accept} disabled={busy}>
            {busy ? "写入设置中…" : "我明白了，进入猫窝"}
          </button>
          <span className="cn-hint">
            不同意就留在这页：此时猫窝不会发起任何官方接口调用，也不会启动任何后台任务。
          </span>
        </div>
      </div>
    </div>
  );
}

/** 供「关于」页复用：显式调用一次健康检查，确认后端在线。 */
export async function pingBackend(): Promise<string> {
  try {
    const s = await api.proxyStatus();
    return s.running ? "反代在线" : "反代未启用";
  } catch (e) {
    return errText(e);
  }
}
