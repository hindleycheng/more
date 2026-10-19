import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ConfigProvider, Layout, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { ThemeConfig } from "antd";
import { useStore } from "./store";
import { api } from "./api";
import { ContactCard } from "./ui";
import "./nest.css";

import Nest from "./pages/Nest";
import CheckinCalendar from "./pages/CheckinCalendar";
import Postcards from "./pages/Postcards";
import Ledger from "./pages/Ledger";
import Settings from "./pages/Settings";
import Consent from "./Consent";

// 二级「工具间」沿用上游的 antd 页面，先把能跑的东西留住，视觉后续再统一。
import Accounts from "./pages/Accounts";
import ProxySettings from "./pages/Proxy";
import DataPage from "./pages/Data";
import Dashboard from "./pages/Dashboard";

const PRIMARY = [
  { key: "nest", icon: "🏠", label: "猫窝总览" },
  { key: "calendar", icon: "📅", label: "打卡日历" },
  { key: "postcards", icon: "📮", label: "旅行明信片" },
  { key: "ledger", icon: "🧾", label: "俸禄流水" },
];

const UTILITY = [
  { key: "accounts", icon: "🐈", label: "猫口名册" },
  { key: "proxy", icon: "🔌", label: "本地反代" },
  { key: "dashboard", icon: "📊", label: "Token 看板" },
  { key: "data", icon: "🗂️", label: "数据管理" },
  { key: "settings", icon: "⚙️", label: "窝规" },
];

/** 崩溃时至少告诉用户发生了什么，而不是留一屏白底。 */
class ErrorBoundary extends Component<{ children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("界面崩溃:", err, info.componentStack);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="cn-root" style={{ display: "grid", placeItems: "center", padding: 32 }}>
          <div className="cn-card" style={{ maxWidth: 560 }}>
            <div className="cn-card-title">界面包崩了</div>
            <div className="cn-hint bad" style={{ marginBottom: 10 }}>
              {this.state.err.message || String(this.state.err)}
            </div>
            <div className="cn-hint" style={{ marginBottom: 14 }}>
              你的账号数据没有受影响（都在本机数据目录里）。可以重启猫窝；若反复出现，请在「窝规」里开启诊断落盘后再操作一次，
              把数据目录里的快照发给作者。
            </div>
            <button className="cn-btn primary" onClick={() => this.setState({ err: undefined })}>
              重新加载界面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function useSystemDark() {
  const [sysDark, setSysDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return sysDark;
}

export default function App() {
  const [active, setActive] = useState("nest");
  const init = useStore((s) => s.init);
  const loading = useStore((s) => s.loading);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const bootError = useStore((s) => s.bootError);
  const setThemePref = useStore((s) => s.setThemePref);
  const platform = useStore((s) => s.info?.platform);
  const sysDark = useSystemDark();

  useEffect(() => {
    void init();
  }, [init]);

  const isDark = settings.theme === "dark" || (settings.theme === "system" && sysDark);

  // 猫窝自己的配色挂在 <html data-cn> 上，与 antd 的主题分开。
  useEffect(() => {
    document.documentElement.dataset.cn = isDark ? "dark" : "light";
  }, [isDark]);

  const antTheme = useMemo<ThemeConfig>(
    () => ({
      token: { colorPrimary: "#e8734a", borderRadius: 12 },
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    }),
    [isDark],
  );

  // 先等后端把设置读回来，否则首屏会闪一下同意页再切主界面。
  if (bootError) {
    return (
      <div className="cn-root" style={{ display: "grid", placeItems: "center", padding: 32 }}>
        <div className="cn-card" style={{ maxWidth: 560 }}>
          <div className="cn-card-title">猫窝没能连上自己的后端</div>
          <div className="cn-hint bad" style={{ marginBottom: 12 }}>{bootError}</div>
          <div className="cn-hint" style={{ marginBottom: 14 }}>
            通常是数据目录权限或磁盘空间问题。可以重试一次，或退出后重新打开。
          </div>
          <div className="cn-row" style={{ gap: 8 }}>
            <button className="cn-btn primary" onClick={() => void init()}>
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (loading || !settings || !info) return null;
  if (!settings.consentAccepted) return <Consent />;

  const title = [...PRIMARY, ...UTILITY].find((m) => m.key === active)?.label ?? "";

  const render = () => {
    switch (active) {
      case "nest":
        return <Nest />;
      case "calendar":
        return <CheckinCalendar />;
      case "postcards":
        return <Postcards />;
      case "ledger":
        return <Ledger />;
      case "settings":
        return <Settings />;
      case "accounts":
        return <Accounts />;
      case "proxy":
        return <ProxySettings />;
      case "dashboard":
        return <Dashboard />;
      case "data":
        return <DataPage />;
      default:
        return null;
    }
  };

  return (
    <ErrorBoundary>
    <ConfigProvider locale={zhCN} theme={antTheme}>
      <div className="cn-root">
        <aside className="cn-side">
          <div className="cn-brand">
            <div className="cn-cat-face" style={{ width: 42, height: 42, borderRadius: 14 }}>
              <span style={{ fontSize: 20 }}>🐾</span>
            </div>
            <div>
              <div className="cn-brand-name">猫窝</div>
              <div className="cn-brand-sub">WorkBuddy 账号后勤</div>
            </div>
          </div>

          <div className="cn-nav-group">猫 窝</div>
          {PRIMARY.map((m) => (
            <button
              key={m.key}
              className={`cn-nav-item ${active === m.key ? "on" : ""}`}
              onClick={() => setActive(m.key)}
            >
              <span className="cn-nav-ico">{m.icon}</span>
              {m.label}
            </button>
          ))}

          <div className="cn-nav-group">工 具 间</div>
          {UTILITY.map((m) => (
            <button
              key={m.key}
              className={`cn-nav-item ${active === m.key ? "on" : ""}`}
              onClick={() => setActive(m.key)}
            >
              <span className="cn-nav-ico">{m.icon}</span>
              {m.label}
            </button>
          ))}

          <div className="cn-side-foot">
            <ContactCard />
            <div style={{ marginTop: 10 }}>
              第三方独立工具，与 WorkBuddy 官方无关
              <br />
              <span className="lnk" onClick={() => setThemePref(isDark ? "light" : "dark")}>
                {isDark ? "切到暖白" : "切到夜间"}
              </span>
            </div>
          </div>
        </aside>

        <main className="cn-main">
          <div className="cn-top">
            <div>
              <div className="cn-top-title">{title}</div>
              <div className="cn-top-sub">
                {settings.travel.autoEnabled || settings.checkin.autoEnabled
                  ? "后台自动化运行中 · 可在「窝规」里关闭"
                  : "所有自动化均关闭 · 一切由你手动触发"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {(platform === "windows" || platform === "linux") && (
                <button className="cn-btn sm" onClick={() => void api.hideToTray()}>
                  缩到托盘
                </button>
              )}
              <button className="cn-btn sm" onClick={() => void api.refreshQuota()}>
                刷新额度
              </button>
            </div>
          </div>
          <div className="cn-scroll">{render()}</div>
        </main>
      </div>
    </ConfigProvider>
    </ErrorBoundary>
  );
}
