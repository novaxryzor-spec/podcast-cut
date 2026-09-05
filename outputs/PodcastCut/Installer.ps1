$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'CSXS\manifest.xml'
if (-not (Test-Path -LiteralPath $source)) { throw 'Extrayez tout le ZIP avant de lancer Installer.ps1.' }
$extensionRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$target = Join-Path $extensionRoot 'fr.podcastcut.panel'
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($entry in @('CSXS', 'index.html', 'style.css', 'mixed.css', 'panel.js', 'core.js', 'mixed.js', 'timeline.js', 'ai-client.js', 'updater-client.js', 'ai', 'host.jsx', 'package.json')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry) -Destination $target -Recurse -Force
}
# Enable unsigned local CEP extensions for CEP 12 (Premiere 2026).
$key = 'HKCU:\Software\Adobe\CSXS.12'
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
Write-Host 'Podcast Cut installe. Redemarrez Premiere Pro.' -ForegroundColor Green
Write-Host 'Ouvrez Fenetre > Extensions > Podcast Cut.'
Write-Host 'Le mode developpeur CEP 12 a ete active pour ce compte Windows.'
Write-Host "Dossier : $target"
