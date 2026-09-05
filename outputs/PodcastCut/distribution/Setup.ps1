param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$productVersion = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'version.txt')) { (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.txt') -Raw).Trim() } else { '0.3.0' }
$productName = 'Podcast Cut'
$publisher = 'Podcast Cut'
$work = $PSScriptRoot
$payloadZip = Join-Path $work 'payload.zip'
$localRoot = Join-Path $env:LOCALAPPDATA 'PodcastCut'
$extensionRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$target = Join-Path $extensionRoot 'fr.podcastcut.panel'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('PodcastCut-setup-' + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    Expand-Archive -LiteralPath $payloadZip -DestinationPath $temp -Force
    $source = Join-Path $temp 'PodcastCut'
    if (-not (Test-Path -LiteralPath (Join-Path $source 'CSXS\manifest.xml'))) { throw 'Le paquet du plugin est incomplet.' }
    New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
    $stage = "$target.new"
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath $source -Destination $stage -Recurse -Force
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Move-Item -LiteralPath $stage -Destination $target

    New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $work 'Updater.ps1') -Destination (Join-Path $localRoot 'Updater.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $work 'Uninstall.ps1') -Destination (Join-Path $localRoot 'Uninstall.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $work 'channel.json') -Destination (Join-Path $localRoot 'channel.json') -Force
    Copy-Item -LiteralPath (Join-Path $work 'public-key.xml') -Destination (Join-Path $localRoot 'public-key.xml') -Force

    # CEP development flag is required by this beta until the commercial UXP/CCX build replaces it.
    $cepKey = 'HKCU:\Software\Adobe\CSXS.12'
    New-Item -Path $cepKey -Force | Out-Null
    New-ItemProperty -Path $cepKey -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null

    $run = 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $localRoot 'Updater.ps1') + '" -Quiet'
    New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'PodcastCutUpdater' -Value $run -PropertyType String -Force | Out-Null
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PodcastCut'
    New-Item -Path $uninstallKey -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name DisplayName -Value $productName -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value $productVersion -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name Publisher -Value $publisher -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $target -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name UninstallString -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $localRoot 'Uninstall.ps1') + '"') -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

    if (-not $Quiet) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("Podcast Cut $productVersion est installe.`n`nRedemarrez Premiere Pro, puis ouvrez Fenetre > Extensions > Podcast Cut.", 'Podcast Cut', 'OK', 'Information') | Out-Null
    }
} catch {
    if (-not $Quiet) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($_.Exception.Message, 'Installation Podcast Cut', 'OK', 'Error') | Out-Null }
    exit 1
} finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
