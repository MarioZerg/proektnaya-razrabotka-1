# Сборка оболочки телевизора. Запускать на Windows с установленным .NET SDK.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
dotnet restore
dotnet publish -c Release -r win-x64 --self-contained false -o "$PSScriptRoot\publish"
Write-Host "Готово: $PSScriptRoot\publish\YarplanLider.exe"
