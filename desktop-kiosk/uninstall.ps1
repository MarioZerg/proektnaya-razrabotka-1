# Снимает автозагрузку и останавливает оболочку. Папку с программой можно удалить вручную.
Get-Process YarplanLider -ErrorAction SilentlyContinue | Stop-Process -Force
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "YarplanLider.lnk"
if (Test-Path $lnk) { Remove-Item $lnk -Force }
Write-Host "Автозагрузка снята. Папка %LOCALAPPDATA%\YarplanLider если нужно — удалите сами."
