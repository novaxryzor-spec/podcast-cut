$ErrorActionPreference = 'SilentlyContinue'
$target = Join-Path $env:APPDATA 'Adobe\CEP\extensions\fr.podcastcut.panel'
$localRoot = Join-Path $env:LOCALAPPDATA 'PodcastCut'
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'PodcastCutUpdater'
Remove-Item -LiteralPath $target -Recurse -Force
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PodcastCut' -Recurse -Force
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show('Podcast Cut a ete desinstalle. Les projets Premiere et les medias sont conserves.', 'Podcast Cut', 'OK', 'Information') | Out-Null
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-Command',"Start-Sleep -Seconds 2; Remove-Item -LiteralPath '$localRoot' -Recurse -Force")
