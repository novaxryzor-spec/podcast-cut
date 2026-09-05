param(
    [switch]$Quiet,
    [switch]$Force,
    [string]$ManifestUrl = '',
    [string]$InstallRoot = '',
    [string]$ExtensionRoot = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Log([string]$Message) {
    $stamp = (Get-Date).ToUniversalTime().ToString('o')
    Add-Content -LiteralPath $script:LogPath -Value "$stamp $Message" -Encoding UTF8
}
function Convert-FileUri([string]$Uri) {
    if ($Uri -match '^file://') { return ([Uri]$Uri).LocalPath }
    return $null
}
function Get-Bytes([string]$Uri, [string]$Destination) {
    $local = Convert-FileUri $Uri
    if ($local) { Copy-Item -LiteralPath $local -Destination $Destination -Force; return }
    if ($Uri -notmatch '^https://') { throw 'Le flux de production doit utiliser HTTPS.' }
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination -TimeoutSec 90
}
function Test-Signature([byte[]]$Data, [byte[]]$Signature, [string]$PublicKeyXml) {
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    try {
        $rsa.PersistKeyInCsp = $false
        $rsa.FromXmlString($PublicKeyXml)
        return $rsa.VerifyData($Data, [System.Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'), $Signature)
    } finally { $rsa.Dispose() }
}
function Get-InstalledVersion([string]$ExtensionPath) {
    $manifest = Join-Path $ExtensionPath 'CSXS\manifest.xml'
    if (-not (Test-Path -LiteralPath $manifest)) { return [version]'0.0.0' }
    [xml]$xml = Get-Content -LiteralPath $manifest -Raw
    return [version]$xml.ExtensionManifest.ExtensionBundleVersion
}

if (-not $InstallRoot) { $InstallRoot = Join-Path $env:LOCALAPPDATA 'PodcastCut' }
if (-not $ExtensionRoot) { $ExtensionRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions\fr.podcastcut.panel' }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$script:LogPath = Join-Path $InstallRoot 'update.log'
$statePath = Join-Path $InstallRoot 'update-state.json'
$configPath = Join-Path $InstallRoot 'channel.json'
$publicKeyPath = Join-Path $InstallRoot 'public-key.xml'
$mutex = New-Object Threading.Mutex($false, 'Local\PodcastCutUpdater')
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
    if (-not (Test-Path -LiteralPath $configPath)) { Write-Log 'Aucun canal de mise a jour configure.'; exit 0 }
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $ManifestUrl) { $ManifestUrl = [string]$config.manifestUrl }
    if (-not $ManifestUrl -or $ManifestUrl -match 'VOTRE-DOMAINE') { Write-Log 'Flux distant en attente de configuration.'; exit 0 }
    if ($ManifestUrl -match '^file://' -and -not $config.allowLocalTesting) { throw 'Flux file:// interdit en production.' }

    $interval = if ($config.checkIntervalHours) { [double]$config.checkIntervalHours } else { 6 }
    if (-not $Force -and (Test-Path -LiteralPath $statePath)) {
        try {
            $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
            if ($state.lastCheckUtc -and ((Get-Date).ToUniversalTime() - [datetime]$state.lastCheckUtc).TotalHours -lt $interval) { exit 0 }
        } catch { Write-Log "Etat ignore: $($_.Exception.Message)" }
    }
    @{ lastCheckUtc = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

    $temp = Join-Path ([IO.Path]::GetTempPath()) ('PodcastCut-update-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        $manifestFile = Join-Path $temp 'manifest.json'
        $signatureFile = Join-Path $temp 'manifest.sig'
        Get-Bytes $ManifestUrl $manifestFile
        $sigUrl = $ManifestUrl.Substring(0, $ManifestUrl.LastIndexOf('/') + 1) + 'manifest.sig'
        Get-Bytes $sigUrl $signatureFile
        $manifestBytes = [IO.File]::ReadAllBytes($manifestFile)
        $signature = [Convert]::FromBase64String((Get-Content -LiteralPath $signatureFile -Raw).Trim())
        $publicKey = Get-Content -LiteralPath $publicKeyPath -Raw
        if (-not (Test-Signature $manifestBytes $signature $publicKey)) { throw 'Signature du manifeste invalide.' }
        $release = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
        if ($release.product -ne 'PodcastCut' -or $release.schema -ne 1) { throw 'Manifeste de mise a jour incompatible.' }
        $installed = Get-InstalledVersion $ExtensionRoot
        $available = [version]$release.version
        if ($available -le $installed) { Write-Log "Version $installed deja a jour."; exit 0 }

        $packageFile = Join-Path $temp 'package.zip'
        Get-Bytes ([string]$release.packageUrl) $packageFile
        $actualHash = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne ([string]$release.sha256).ToLowerInvariant()) { throw 'Empreinte SHA-256 du paquet invalide.' }
        $expanded = Join-Path $temp 'expanded'
        Expand-Archive -LiteralPath $packageFile -DestinationPath $expanded -Force
        $payload = Join-Path $expanded 'PodcastCut'
        if (-not (Test-Path -LiteralPath (Join-Path $payload 'CSXS\manifest.xml'))) { throw 'Paquet incomplet.' }
        if ((Get-InstalledVersion $payload) -ne $available) { throw 'Version du paquet incoherente.' }

        $stage = "$ExtensionRoot.new"
        $backup = "$ExtensionRoot.previous"
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $payload -Destination $stage -Recurse -Force
        Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $ExtensionRoot) { Move-Item -LiteralPath $ExtensionRoot -Destination $backup -Force }
        try { Move-Item -LiteralPath $stage -Destination $ExtensionRoot -Force }
        catch {
            if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $ExtensionRoot -Force }
            throw
        }
        Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
        @{ lastCheckUtc=(Get-Date).ToUniversalTime().ToString('o'); installedVersion=$available.ToString(); restartPremiere=$true } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
        Write-Log "Mise a jour installee: $installed -> $available. Redemarrage de Premiere requis."
    } finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
} catch {
    Write-Log "ECHEC: $($_.Exception.Message)"
    if (-not $Quiet) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("La mise a jour Podcast Cut a echoue.`n`n$($_.Exception.Message)", 'Podcast Cut', 'OK', 'Error') | Out-Null }
    exit 1
} finally {
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
}
