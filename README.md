# 猫窝 More

WorkBuddy 账号的本地后勤台：多账号名册、批量打卡、猫猫旅行托管、俸禄流水与本地 OpenAI 兼容反代。
第三方独立工具，与 WorkBuddy 官方无关，也未获其授权或背书。

## 设计与安全取舍

本项目在若干处刻意偏离了常见做法，理由记录如下（"旧实现"指本仓库所基于的早期版本）：

| 方面 | 旧实现 | 猫窝 More |
| --- | --- | --- |
| 凭证加密 | AES-256-GCM，密钥 = `HKDF(二进制内硬编码主密钥, salt = SHA256("用户名@主机名"))`，两者都可从公开安装包与本机路径还原，等同混淆 | 首次存凭证时生成 32 字节随机主密钥，存为数据目录下的 `.vault-key`（0600）。不进安装包、不跨机器，所以「拿别人的包解密你的库」不再成立。**刻意不用系统钥匙串**：ad-hoc 签名下钥匙串 ACL 绑二进制身份，每次升级都会弹「请输入登录钥匙串密码」并阻塞进程（实测踩过）。边界写清楚：挡不住 root、以你身份运行的进程、整目录备份外泄 |
| 诊断落盘 | 无条件把 quota/usage/models/chat 原始响应写成明文 JSON，其中含用户提问原文 | 一律默认**关闭**；`debug::dump()` 在关闭时是空操作，设置页可开启并一键清理残留快照 |
| 本地反代 | 允许 `apiKey` 留空（留空即不校验），host 可填任意地址 | 前置校验：host 必须是回环地址、Key 至少 16 位、端口需 ≥1024，否则**拒绝启动**并把中文原因返回到界面；设置保存失败时不会出现"显示已启用但实际没跑" |
| 首启 | 直接可点任何功能 | 知情同意页：未同意前不启动反代、不启动调度器、不发起任何官方接口调用 |
| 自动化默认 | 猫猫旅行自动托管**默认开** | 全部默认**关**，需在「窝规」逐项打开 |
| 界面 | antd 后台管理台 | 自有暖色设计语言：猫窝总览 / 打卡日历 / 旅行明信片 / 俸禄流水，账号·反代·看板·数据管理降为「工具间」 |
| 台账 | 无 | 新增 `history.json`：按日按账号记录打卡与领取观测值，打卡日历据此绘制（安装之前显示"未知"，不编造历史） |
| 告警 | 无 | 刷新额度时低于自设阈值 → 本机通知 |

其余能力（OAuth 授权、`$wbEncrypted` 信封解析、反代选号/粘性/failover、会话迁移与备份）沿用既有实现。

## 界面

- **猫窝总览**：每只猫现在在哪、还有多久回来、口粮还剩多少、按近 30 天消耗估算能撑几天，今日待办一键处理。
- **打卡日历**：月历格子来自本机台账；连续天数、本月打卡俸禄、每只猫的今天。
- **旅行明信片**：官方旅行台账逐条渲染成明信片（地点 / 时长 / 俸禄 / 派出与到站时刻），在途的猫带实时倒计时。
- **俸禄流水**：奖励批次（来源、已用、到期）+ 消耗明细（模型 / 客户端 / 扣费），双口径归因。
- **工具间**：猫口名册、本地反代、Token 看板、数据管理、窝规。

## 微信名片（作者私有资源）

侧栏底部是**可点击的微信名片**：缩略图读 `src/assets/wechat-qr.png`（二维码方图），
点开弹出大图，大图读 `src/assets/wechat-card.png`（完整名片：头像 / 昵称 / 二维码 / 说明）。
**这两个文件都被 .gitignore 排除，不入库**——它们是个人隐私，公开仓库里不该有。
仓库里带的是 `wechat-card.placeholder.png` 占位图，`npm run build` / `npm run dev` 前会自动
`node scripts/prepare-assets.mjs`：本地没有真图就用占位图顶上，所以别人 clone 下来照样能构建，
只是看到的是占位图。

换成自己的名片：

1. 完整名片（竖图）→ `src/assets/wechat-card.png`，弹窗用；
2. 二维码方图（正方形裁切，四周留白边）→ `src/assets/wechat-qr.png`，侧栏缩略图用。

注意 `sips`/截图工具带出的 JPEG 若手工改过段结构，可能出现「sips 读得出、WebKit 解不出」的空白渲染，
所以一律用**真 PNG**（JPEG 改后缀无效，必须真的转码）。

## 安装包

各平台构建产物在 [Releases](https://github.com/hindleycheng/more/releases)：
`More_<版本>_aarch64.dmg`（Apple 芯片）、`More_<版本>_x64.dmg`（Intel）、
`More_<版本>_x64-setup.exe`（Windows 安装包，当前用户级安装、免管理员）、`More.exe`（Windows 免安装绿色版，需 WebView2 运行时）。
由 `.github/workflows/release.yml` 在打 tag 时自动构建。注意 macOS runner 按 10 倍计入
GitHub Actions 免费额度，手动重复触发前留意配额。

Windows 包已在真实 Windows 11（x64，WebView2 Runtime 155）实机跑通主界面与托盘，
记录见 `docs/Windows-验证记录.md`。macOS 侧未做付费签名与公证，Windows 侧未做代码签名，
首次运行 SmartScreen 提示属正常。

## Windows 白屏自愈

WebView2 在少数机器上会起不来图形进程（虚拟显卡、远程桌面、安全软件拦截图形子进程），
表现是窗口出来了、内容永远空白，且此时没有界面可以提示——界面本身就是那个没起来的东西。

因此主窗口不再由 `tauri.conf.json` 声明，而是在 `src-tauri/src/webview.rs` 里创建：

1. 先按默认参数创建（硬件加速）；
2. 前端渲染首帧后回报 `frontend_ready`，视为健康；
3. 25 秒内没回报 → 写 `webview.json` 标记「安全模式」，重启进程并追加
   `--disable-gpu --disable-gpu-compositing`（软件渲染）重建窗口；
4. 安全模式仍失败 → 弹原生提示说明原因并给出日志路径，而不是留一屏白底。

排障时可用 `MORE_WEBVIEW_DEBUG_PORT=9333` 启动，会给 WebView2 追加
`--remote-debugging-port`，之后可接 CDP 直接看 DOM。默认不监听任何端口。

## 构建

```bash
npm install
npx tauri build          # macOS 产出 src-tauri/target/release/bundle/dmg/*.dmg
```

Windows 上一条命令出安装包与绿色版：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
# 产物：dist-windows\More.exe 与 dist-windows\More_<版本>_x64-setup.exe
```

需要 Rust stable（`rustup toolchain install stable`）、Node 18+；Windows 另需
MSVC Build Tools（官方推荐）与 WebView2 Runtime。

Windows 用 GNU 工具链（`x86_64-pc-windows-gnu` + MinGW-w64）也能编出可运行 exe，
但需把 `src-tauri/Cargo.toml` 的 `[lib] crate-type` 临时收成 `["rlib"]`：保持
`cdylib` 时链接器会因导出序数超过 65535 报 `export ordinal too large`。对外发版请用 MSVC。


## 安装（未签名）

本项目未做 Apple 付费签名与公证，首次打开可能被 macOS 提示"已损坏"。这不是文件坏了，是隔离标记：

```bash
xattr -cr /Applications/More.app
```

Windows 为绿色版，双击即用。详见 `docs/给朋友的安装说明.md`。

## 数据位置

macOS `~/Library/Application Support/More`，Windows `%APPDATA%\More`。
内含账号名册、设置、加密后的 `tokens.vault`、用量库 `more-usage.db`、本地台账 `history.json`、
`logs/more.log`（运行日志，超 2MB 滚动一份 `more.prev.log`）与 `webview.json`（是否已切安全模式）。
卸载：删除 App 与这个目录即可，不留任何东西在系统里。

Windows 的 WebView2 缓存另在 `%LOCALAPPDATA%\com.more.app`，不含账号凭证，可随时删除。

## 风险声明

自动打卡与自动旅行是对官方服务的脚本化调用，可能不符合服务条款，理论上有触发限流或风控的风险。
所有自动化默认关闭，是否开启由使用者自己判断并承担后果。请勿把不愿承担风险的账号交给它。同一台机器上不要同时开两个同类工具的自动化（会成倍放大对同一账号的轮询）。

## 许可

本项目以 MIT 许可发布（见 `LICENSE`）。本仓库包含受另一份 MIT 许可约束的第三方代码，其原始版权声明保留在 `LICENSE` 与 `UPSTREAM-LICENSE.txt` 中——**这是该许可证对再分发的硬性要求，不得删除**，与界面署名无关。
