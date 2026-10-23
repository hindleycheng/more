# Windows 版验证记录

> 结论先行：Windows 版可正常运行。本文记录 2026-10-23 在真实 Windows 11 机器上做过的验证、
> 已修的问题、以及明确**没有**测过的东西。没测过的部分不写成「可用」。

## 1. 验证环境

| 项 | 值 |
|---|---|
| 系统 | Windows 11（NT 10.0.26200.8246），x64 |
| WebView2 Runtime | 155.0.4283.62 |
| 机器特征 | 装有企业级文档安全软件（进程注入型），对图形子进程有拦截能力 |
| 构建 | MSVC（GitHub Actions）与 MinGW-w64（本机验证构建）各出过一份 |

## 2. 测过的项目

| 项目 | 结果 | 证据 |
|---|---|---|
| 0.1.1 发布版（CI/MSVC 构建）双击启动 | 通过 | 主界面完整渲染，6 个 WebView2 进程存活，无崩溃转储 |
| 0.1.2 发行版启动与渲染 | 通过 | 日志 `前端已就绪（safe=false）`，主界面截图正常 |
| 数据目录 `%APPDATA%\More` | 通过 | settings.json / more-usage.db / logs/more.log / webview.json 均按约定落盘 |
| 运行日志 | 通过 | 启动、窗口创建、前端就绪、调度器启动都有记录 |
| 单实例 + 托盘唤回 | 通过 | 代码路径在非 macOS 建托盘；进程被杀再启动走单实例唤起 |
| 微信名片：侧栏缩略图 | 通过 | 正方形裁切对准二维码区域（图中 y≈211..615） |
| 微信名片：点击弹窗 | 通过 | 弹窗含标题、名片大图、扫码提示、关闭按钮；Esc/点背景可关 |
| WebView2 白屏自愈 | 通过 | 受限启动上下文下，watchdog 检测未就绪 → 自动切软件渲染重启；IPC 桥探活避免「只是慢」被误判 |

## 3. 没测过的项目（明确不背书）

这些都需要真实 WorkBuddy 账号，且属于对官方服务的调用，本次验证**没有执行**：

- 网页授权登录（OAuth）与 token 落盘解密
- 批量打卡、旅行自动托管、俸禄领取
- 本地反代对外转发与多账号选号/故障转移
- 本机通知（低额度提醒）
- NSIS 安装包的安装/卸载流程（本地网络拿不到 NSIS 工具链，安装包由 CI 产出）

## 4. 本次顺手修掉的问题

1. **白屏不可诊断**：WebView2 图形进程起不来时，窗口在、内容永远空白，之前没有任何提示。
   现在主窗口改为代码创建（见 `src-tauri/src/webview.rs`）：先默认参数，前端未就绪则探 IPC 桥，
   确认内核没起来才切软件渲染重启，仍失败才给非阻塞提示 + 日志路径。
2. **日志全被丢弃**：`tracing` 没有 subscriber，出问题无从排查。现在写
   `%APPDATA%\More\logs\more.log`，超 2MB 滚动。
3. **侧栏名片被挤出可视区**：导航区现在单独滚动，名片固定在侧栏底部。
4. **名片必须是真 PNG**：JPEG 改后缀在 WebKit 里会解出空白，本机转换为 600×762 PNG。
5. **NSIS 改为当前用户级安装**（免管理员），并带简体中文语言。

## 5. 已知限制

- **未代码签名**：SmartScreen 会拦一下，点「更多信息 → 仍要运行」。
- **MinGW 构建需要附带 `WebView2Loader.dll`**（放在 exe 同目录）。CI 的 MSVC 构建是静态链接，
  单文件即可运行。对外发版以 CI 产物为准。
- **MinGW 构建需把 `src-tauri/Cargo.toml` 的 `crate-type` 临时收成 `["rlib"]`**，
  否则链接报 `export ordinal too large`。CI/MSVC 不受影响。

## 6. 复现验证

```powershell
# 构建
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1

# 白屏自愈是否触发，看日志
Get-Content $env:APPDATA\More\logs\more.log -Tail 20

# 排障：给 WebView2 开远程调试端口后启动（默认不开任何端口）
$env:MORE_WEBVIEW_DEBUG_PORT = "9333"
```
