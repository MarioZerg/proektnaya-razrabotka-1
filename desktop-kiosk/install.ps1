# Ставит оболочку живого цеха на мини-ПК: копирует программу, автозагрузка,
# экран не гаснет. Запускать из папки publish (или из desktop-kiosk после build.ps1).
$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
if (-not (Test-Path (Join-Path $root "YarplanLider.exe"))) {
    $pub = Join-Path $root "publish"
    if (Test-Path (Join-Path $pub "YarplanLider.exe")) { $root = $pub }
}
$exeSrc = Join-Path $root "YarplanLider.exe"
if (-not (Test-Path $exeSrc)) {
    throw "Не найден YarplanLider.exe. Сначала запустите build.ps1."
}

$dest = Join-Path $env:LOCALAPPDATA "YarplanLider"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem $root -File | Where-Object { $_.Name -notmatch '\.pdb$' } | ForEach-Object {
    Copy-Item $_.FullName -Destination $dest -Force
}
$native = Join-Path $root "runtimes"
if (Test-Path $native) {
    Copy-Item $native -Destination $dest -Recurse -Force
}

$exe = Join-Path $dest "YarplanLider.exe"

$wv = Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if (-not $wv) {
    Write-Host "Ставим WebView2 Runtime…"
    $boot = Join-Path $env:TEMP "MicrosoftEdgeWebview2Setup.exe"
    Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $boot
    Start-Process $boot -ArgumentList "/silent","/install" -Wait
}

$startup = [Environment]::GetFolderPath("Startup")
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in @(
    (Join-Path $startup "Живой цех.lnk"),
    (Join-Path $desktop "Живой цех.lnk")
)) {
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $exe
    $sc.WorkingDirectory = $dest
    $sc.WindowStyle = 1
    $sc.Description = "Живой цех на телевизоре"
    $sc.IconLocation = "$exe,0"
    $sc.Save()
}
$legacy = Join-Path $startup "YarplanLider.lnk"
if (Test-Path $legacy) { Remove-Item $legacy -Force }

try {
    powercfg /change monitor-timeout-ac 0 | Out-Null
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change monitor-timeout-dc 0 | Out-Null
    powercfg /change standby-timeout-dc 0 | Out-Null
} catch {}

Write-Host "Установлено: $exe"
Write-Host "Автозагрузка: $lnk"
Write-Host "Выход из приложения: Ctrl+Shift+Q, PIN из kiosk.ini (по умолчанию 2580)"
Write-Host "На мини-ПК включите автоматический вход в Windows — тогда экран цеха откроется сам."
Start-Process $exe
