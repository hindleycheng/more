# 在 Windows 上打 More 的安装包与绿色版。
#
# 用法（在仓库根目录）：
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1 -SkipInstaller
#
# 前置条件
#   1. Node 18+（npm 可用）
#   2. Rust stable。官方推荐 MSVC 工具链：
#        winget install Microsoft.VisualStudio.2022.BuildTools `
#          --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
#      GNU 工具链（x86_64-pc-windows-gnu + MinGW-w64）也能出可运行的 exe，
#      但不是官方支持路径；对外发版请用 MSVC。
#   3. NSIS 安装包由 tauri-cli 自动下载（首次构建需要联网）。
#   4. 运行期依赖 WebView2 Runtime：Win11 自带，Win10 需装 Evergreen Runtime。
#
# 产物
#   src-tauri\target\release\more.exe                     绿色版（改名 More.exe 即可分发）
#   src-tauri\target\release\bundle\nsis\*.exe            安装包

param(
    [switch]$SkipInstaller,
    [string]$OutDir = "dist-windows"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Require-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "缺少 $name。$hint"
    }
}

Require-Command node "请安装 Node 18+：https://nodejs.org/"
Require-Command cargo "请安装 Rust stable：https://rustup.rs/"

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "==> More $version · Windows 构建" -ForegroundColor Cyan

Write-Host "==> npm ci" -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci 失败" }

if ($SkipInstaller) {
    Write-Host "==> 只构建可执行文件（跳过 NSIS）" -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
    Push-Location src-tauri
    cargo build --release
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { throw "Rust release 构建失败" }
} else {
    Write-Host "==> tauri build --bundles nsis" -ForegroundColor Cyan
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "tauri build 失败" }
}

$rel = Join-Path $root "src-tauri\target\release"
$exe = Join-Path $rel "more.exe"
if (-not (Test-Path $exe)) { throw "未找到构建产物：$exe" }

New-Item -ItemType Directory -Force -Path (Join-Path $root $OutDir) | Out-Null
Copy-Item $exe (Join-Path $root "$OutDir\More.exe") -Force

$nsis = Get-ChildItem (Join-Path $rel "bundle\nsis") -Filter "*.exe" -ErrorAction SilentlyContinue
if ($nsis) {
    Copy-Item $nsis.FullName (Join-Path $root "$OutDir\$($nsis.Name)") -Force
}

Write-Host "==> 产物已归拢到 $OutDir" -ForegroundColor Green
Get-ChildItem (Join-Path $root $OutDir) | Select-Object Name, @{n = "SizeMB"; e = { [math]::Round($_.Length / 1MB, 2) } } | Format-Table -AutoSize
