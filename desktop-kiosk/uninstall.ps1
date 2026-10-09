# Снимает автозагрузку и останавливает оболочку. Папку с программой можно удалить вручную.
Get-Process YarplanLider -ErrorAction SilentlyContinue | Stop-Process -Force
$names = @("Живой цех.lnk", "YarplanLider.lnk")
$folders = @(
    [Environment]::GetFolderPath("Startup"),
    [Environment]::GetFolderPath("Desktop")
)
foreach ($dir in $folders) {
    foreach ($name in $names) {
        $lnk = Join-Path $dir $name
        if (Test-Path $lnk) { Remove-Item $lnk -Force }
    }
}
Write-Host "Ярлыки и автозагрузка сняты. Папка %LOCALAPPDATA%\YarplanLider если нужно — удалите сами."
