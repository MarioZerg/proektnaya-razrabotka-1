# Собирает установщик Windows: desktop-kiosk\dist\YarplanLiderSetup.exe
# Не нужен Visual Studio / dotnet SDK — только csc из .NET Framework 4.8.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Не найден csc.exe (.NET Framework 4.8 x64)." }

$lib = Join-Path $PSScriptRoot "lib"
$dist = Join-Path $PSScriptRoot "dist"
$payload = Join-Path $dist "payload"
New-Item -ItemType Directory -Force -Path $lib, $dist, $payload | Out-Null

function Save-PngIcon([System.Drawing.Bitmap]$bmp, [string]$path) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $ms.ToArray()
    $fs = [System.IO.File]::Open($path, "Create")
    $bw = New-Object System.IO.BinaryWriter $fs
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]1)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([int32]$png.Length)
    $bw.Write([int32]22)
    $bw.Write($png)
    $bw.Flush()
    $bw.Close()
}

Add-Type -AssemblyName System.Drawing
$icoPath = Join-Path $PSScriptRoot "kiosk.ico"
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 28, 28, 30))
$orange = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 102, 55))
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 20, 20, 22))
$g.FillRectangle($orange, 36, 48, 184, 128)
$g.FillRectangle($dark, 48, 60, 160, 104)
$g.FillRectangle($orange, 108, 176, 40, 22)
$g.FillRectangle($orange, 72, 196, 112, 16)
$font = New-Object System.Drawing.Font("Segoe UI", [float]32, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("ЦЕХ", $font, $orange, (New-Object System.Drawing.RectangleF 0, 52, 256, 120), $sf)
Save-PngIcon $bmp $icoPath
$g.Dispose(); $bmp.Dispose()

$wvDll = Join-Path $lib "Microsoft.Web.WebView2.WinForms.dll"
$loader = Join-Path $lib "WebView2Loader.dll"
if (-not (Test-Path $wvDll) -or -not (Test-Path $loader)) {
    Write-Host "Скачиваем Microsoft.Web.WebView2…"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $nupkg = Join-Path $lib "webview2.zip"
    Invoke-WebRequest -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2849.39" -OutFile $nupkg -UseBasicParsing
    $extract = Join-Path $lib "nupkg"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $nupkg -DestinationPath $extract -Force
    Copy-Item (Join-Path $extract "lib\net462\Microsoft.Web.WebView2.Core.dll") $lib -Force
    Copy-Item (Join-Path $extract "lib\net462\Microsoft.Web.WebView2.WinForms.dll") $lib -Force
    Copy-Item (Join-Path $extract "runtimes\win-x64\native\WebView2Loader.dll") $lib -Force
}

Write-Host "Компилируем YarplanLider.exe…"
& $csc /nologo /optimize+ /target:winexe /platform:x64 `
    /out:"$payload\YarplanLider.exe" `
    /win32manifest:"$PSScriptRoot\app.manifest" `
    /win32icon:"$icoPath" `
    /r:"$lib\Microsoft.Web.WebView2.Core.dll" `
    /r:"$lib\Microsoft.Web.WebView2.WinForms.dll" `
    "$PSScriptRoot\Program.cs" `
    "$PSScriptRoot\MainForm.cs" `
    "$PSScriptRoot\PinForm.cs" `
    "$PSScriptRoot\KeyboardLock.cs" `
    "$PSScriptRoot\KioskConfig.cs"
if ($LASTEXITCODE -ne 0) { throw "csc не собрал YarplanLider.exe" }

Copy-Item "$lib\Microsoft.Web.WebView2.Core.dll" $payload -Force
Copy-Item "$lib\Microsoft.Web.WebView2.WinForms.dll" $payload -Force
Copy-Item "$lib\WebView2Loader.dll" $payload -Force
Copy-Item "$PSScriptRoot\kiosk.ini" $payload -Force
Copy-Item $icoPath $payload -Force

$zip = Join-Path $dist "payload.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $payload "*") -DestinationPath $zip -Force

Write-Host "Компилируем YarplanLiderSetup.exe…"
& $csc /nologo /optimize+ /target:winexe /platform:x64 `
    /out:"$dist\YarplanLiderSetup.exe" `
    /win32icon:"$icoPath" `
    /r:System.Windows.Forms.dll `
    /r:System.Drawing.dll `
    /r:System.IO.Compression.dll `
    /r:System.IO.Compression.FileSystem.dll `
    /resource:"$zip,payload.zip" `
    "$PSScriptRoot\setup\Setup.cs"
if ($LASTEXITCODE -ne 0) { throw "csc не собрал YarplanLiderSetup.exe" }

Write-Host "Готово: $dist\YarplanLiderSetup.exe"
Write-Host "Скопируйте этот файл на мини-ПК у телевизора и запустите."
