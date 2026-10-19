// 窝规（设置）：自动化开关、隐私与安全状态、外观。
// 所有会调用官方接口的自动化，默认关闭且必须显式开启。
import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useStore } from "../store";
import type { AppSettings, AutomationStatus, PrivacyStatus } from "../types";
import { Chip } from "../ui";

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const root = useStore((s) => s.info?.paths.moreRoot);
  const version = useStore((s) => s.info?.version);
  const [pv, setPv] = useState<PrivacyStatus | null>(null);
  const [auto, setAuto] = useState<AutomationStatus | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadPrivacy = () => api.privacyStatus().then(setPv).catch((e) => setMsg({ tone: "bad", text: errText(e) }));
  const reloadHealth = () => api.automationStatus().then(setAuto).catch(() => setAuto(null));
  useEffect(() => {
    void reloadPrivacy();
    void reloadHealth();
  }, []);

  async function patch(fn: (s: AppSettings) => AppSettings, label: string) {
    setBusy(true);
    setMsg(null);
    try {
      await saveSettings(fn(structuredClone(settings)));
      setMsg({ tone: "good", text: label });
      void reloadPrivacy();
      void reloadHealth();
    } catch (e) {
      // 反代前置校验失败等情形会在这里以中文原因呈现
      setMsg({ tone: "bad", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  const Sw = ({
    on,
    title,
    desc,
    onChange,
  }: {
    on: boolean;
    title: string;
    desc: string;
    onChange: (v: boolean) => void;
  }) => (
    <label className="cn-switch">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} disabled={busy} />
      <span>
        <span className="t">{title}</span>
        <span className="d">{desc}</span>
      </span>
    </label>
  );

  return (
    <div className="cn-grid" style={{ gap: 16 }}>
      <div className="cn-card">
        <div className="cn-card-title">自动化</div>
        <Sw
          on={settings.checkin.autoEnabled}
          title="每天自动打卡"
          desc={`到点自动为所有启用的账号签到（当前设定 ${settings.checkin.dailyTime}）。这是对官方服务的脚本化调用，请自行判断是否接受。`}
          onChange={(v) =>
            patch(
              (s) => ({ ...s, checkin: { ...s.checkin, autoEnabled: v } }),
              v ? "已开启自动打卡" : "已关闭自动打卡",
            )
          }
        />
        <Sw
          on={settings.travel.autoEnabled}
          title="自动托管猫猫旅行"
          desc="自动派猫出行、到点自动领俸禄，后台每 60 分钟巡检，达当日上限后熔断。默认关闭。"
          onChange={(v) =>
            patch((s) => ({ ...s, travel: { ...s.travel, autoEnabled: v } }), v ? "已开启旅行托管" : "已关闭旅行托管")
          }
        />
        <div className="cn-field" style={{ marginTop: 12 }}>
          <label>低额提醒阈值（0 = 不提醒）</label>
          <input
            className="cn-input"
            style={{ width: 180 }}
            type="number"
            value={settings.lowBalanceAlert}
            onChange={(e) => setMsg(null)}
            onBlur={(e) =>
              patch(
                (s) => ({ ...s, lowBalanceAlert: Number(e.target.value) || 0 }),
                "提醒阈值已保存",
              )
            }
          />
          <span className="cn-hint">刷新额度时，若某只猫余额低于此值，弹一条本机通知。</span>
        </div>
        <Sw
          on={settings.autostart}
          title="登录后自动启动猫窝"
          desc="开机后自动运行，自动任务才会在我不在场时也跑。"
          onChange={(v) => patch((s) => ({ ...s, autostart: v }), v ? "已设为开机启动" : "已取消开机启动")}
        />
      </div>

      <div className="cn-card">
        <div className="cn-card-title">隐私与安全</div>
        <div className="cn-row" style={{ marginBottom: 12, gap: 8 }}>
          <Chip tone={pv?.vaultKeySource === "file" ? "good" : ""}>
            主密钥：
            {pv?.vaultKeySource === "file"
              ? "本机随机密钥（.vault-key，0600）"
              : "尚未生成（存过凭证后才有）"}
          </Chip>
          <Chip tone={pv?.debugDumps ? "warn" : "good"}>
            诊断落盘：{pv?.debugDumps ? "已开启（会写明文）" : "关闭"}
          </Chip>
        </div>
        <Sw
          on={settings.debugDumps}
          title="诊断落盘"
          desc="开启后会把官方接口原始响应与反代请求内容写成 JSON 明文存在数据目录，用于排查问题。里面包含你的提问原文，用完请关掉并清理。"
          onChange={(v) => patch((s) => ({ ...s, debugDumps: v }), v ? "已开启诊断落盘" : "已关闭诊断落盘")}
        />
        {pv?.existingDumps && pv.existingDumps.length > 0 && (
          <div className="cn-hint warn" style={{ marginBottom: 10 }}>
            数据目录里还有 {pv.existingDumps.length} 个诊断快照：{pv.existingDumps.join("、")}
          </div>
        )}
        <div className="cn-row" style={{ gap: 8 }}>
          <button
            className="cn-btn"
            disabled={busy}
            onClick={async () => {
              try {
                const removed = await api.debugClear();
                setMsg({
                  tone: "good",
                  text: removed.length ? `已清理 ${removed.length} 个快照` : "没有需要清理的快照",
                });
                void reloadPrivacy();
              } catch (e) {
                setMsg({ tone: "bad", text: errText(e) });
              }
            }}
          >
            清理诊断快照
          </button>
          <button
            className="cn-btn"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("抹掉本机保存的全部登录凭证？账号名册会保留，但每只猫都需要重新网页授权。")) return;
              try {
                await api.vaultPurge();
                setMsg({ tone: "good", text: "已抹掉凭证，请重新授权" });
              } catch (e) {
                setMsg({ tone: "bad", text: errText(e) });
              }
            }}
          >
            抹掉登录凭证
          </button>
        </div>
        <div className="cn-hint" style={{ marginTop: 14 }}>
          数据目录：<code style={{ fontSize: 11.5 }}>{root}</code>
          <br />
          猫窝完全在本机运行；凭证用本机随机密钥加密后存在这个目录，不上传、不进安装包、换机器解不开。
          <br />
          它挡不住 root、以你身份运行的程序、以及整个目录被备份/同步出去的泄露；要更强保护请开 FileVault
          并把此目录排除在云同步之外。
        </div>
      </div>

      <div className="cn-card">
        <div className="cn-card-title">自动化健康</div>
        {!auto ? (
          <div className="cn-hint">读不到后端状态（可能刚保存设置，稍后自动重试）</div>
        ) : (
          <>
            <div className="cn-row" style={{ gap: 8, marginBottom: 12 }}>
              <Chip tone={auto.consentAccepted ? "good" : "bad"}>
                知情同意{auto.consentAccepted ? "已完成" : "未完成"}
              </Chip>
              <Chip tone={auto.checkinAuto ? "good" : ""}>
                自动打卡 {auto.checkinAuto ? `每天 ${auto.checkinDailyTime}` : "关闭"}
              </Chip>
              <Chip tone={auto.travelAuto ? "good" : ""}>旅行托管 {auto.travelAuto ? "开启" : "关闭"}</Chip>
              <Chip tone={auto.proxyRunning ? "good" : ""}>反代 {auto.proxyRunning ? "运行中" : "未运行"}</Chip>
              <Chip tone={auto.autostart ? "good" : ""}>开机启动 {auto.autostart ? "开" : "关"}</Chip>
            </div>
            {auto.travelCircuitOpenOn && (
              <div className="cn-hint" style={{ marginBottom: 6 }}>
                旅行熔断生效于 {auto.travelCircuitOpenOn}：当日所有账号都跑满了，今天不再轮询官方接口（这是防风控设计，不是故障）。
              </div>
            )}
            {auto.autoCheckinDoneOn && (
              <div className="cn-hint" style={{ marginBottom: 6 }}>
                今天（{auto.autoCheckinDoneOn}）的自动打卡已经跑过，不会重复触发。
              </div>
            )}
            {auto.proxyBlocker && (
              <div className="cn-hint bad" style={{ marginBottom: 6 }}>反代没能启动：{auto.proxyBlocker}</div>
            )}
            {auto.coolingAccounts.length > 0 && (
              <div className="cn-hint warn" style={{ marginBottom: 6 }}>
                冷却中的账号：{auto.coolingAccounts.map((c) => `${c.nickname}（约 ${Math.ceil(c.remainSec / 60)} 分钟）`).join("、")}
              </div>
            )}
            {auto.accountsMissingToken.length > 0 && (
              <div className="cn-hint bad">
                缺凭证、任何自动化都跑不动：{auto.accountsMissingToken.map((a) => a.nickname).join("、")} —— 去「猫口名册」重新授权。
              </div>
            )}
            <div className="cn-hint" style={{ marginTop: 10 }}>
              {auto.coolingAccounts.length === 0 && auto.accountsMissingToken.length === 0 && !auto.proxyBlocker
                ? "没有异常：该开的都开着，没有账号在冷却或缺凭证。"
                : "上面列出的就是今天没按预期运行的原因。"}
            </div>
          </>
        )}
        <div className="cn-row" style={{ marginTop: 12 }}>
          <button className="cn-btn sm" onClick={() => void reloadHealth()}>
            重新检查
          </button>
        </div>
      </div>

      <div className="cn-card">
        <div className="cn-card-title">外观</div>
        <div className="cn-row" style={{ gap: 8 }}>
          {["light", "dark", "system"].map((t) => (
            <button
              key={t}
              className={`cn-btn sm ${settings.theme === t ? "primary" : ""}`}
              onClick={() => patch((s) => ({ ...s, theme: t }), "主题已切换")}
            >
              {t === "light" ? "暖白" : t === "dark" ? "夜间" : "跟随系统"}
            </button>
          ))}
        </div>
        <div className="cn-hint" style={{ marginTop: 14, lineHeight: 1.9 }}>
          猫窝 More v{version} · 第三方独立工具
          <br />
          与 WorkBuddy 官方无关，也未获其授权。自动化功能请自行评估服务条款风险。
        </div>
      </div>

      {msg && (
        <div className={`cn-card ${msg.tone === "bad" ? "cn-card-flat" : ""}`}>
          <div className={`cn-hint ${msg.tone === "bad" ? "bad" : "good"}`}>{msg.text}</div>
        </div>
      )}
    </div>
  );
}
