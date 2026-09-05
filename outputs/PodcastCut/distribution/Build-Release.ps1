param(
    [string]$Version = '0.5.8',
    [string]$BaseUrl = 'https://github.com/novaxryzor-spec/podcast-cut/releases/latest/download',
    [string]$OutputDirectory = '',
    [string]$PublisherKeyDirectory = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$pluginRoot = Split-Path $PSScriptRoot -Parent
if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Split-Path $pluginRoot -Parent) 'PodcastCut-Release' }
if (-not $PublisherKeyDirectory) { $PublisherKeyDirectory = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PodcastCut-Publisher\keys' }
$versionObject = [version]$Version
if ($versionObject.ToString() -ne $Version) { throw 'Utilisez une version x.y.z, par exemple 1.2.0.' }

[xml]$sourceManifest = Get-Content -LiteralPath (Join-Path $pluginRoot 'CSXS\manifest.xml') -Raw
if ([version]$sourceManifest.ExtensionManifest.ExtensionBundleVersion -ne $versionObject) {
    throw "La version du manifest.xml ne correspond pas a $Version. Mettez le code a jour avant de publier."
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $PublisherKeyDirectory -Force | Out-Null
$work = Join-Path ([IO.Path]::GetTempPath()) ('PodcastCut-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $privateKeyPath = Join-Path $PublisherKeyDirectory 'update-private.xml'
    $publicKeyPath = Join-Path $PublisherKeyDirectory 'update-public.xml'
    if (-not (Test-Path -LiteralPath $privateKeyPath)) {
        $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider(3072)
        try {
            [IO.File]::WriteAllText($privateKeyPath, $rsa.ToXmlString($true), [Text.UTF8Encoding]::new($false))
            [IO.File]::WriteAllText($publicKeyPath, $rsa.ToXmlString($false), [Text.UTF8Encoding]::new($false))
        } finally { $rsa.Dispose() }
    }
    if (-not (Test-Path -LiteralPath $publicKeyPath)) {
        $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
        try { $rsa.FromXmlString((Get-Content -LiteralPath $privateKeyPath -Raw)); [IO.File]::WriteAllText($publicKeyPath, $rsa.ToXmlString($false), [Text.UTF8Encoding]::new($false)) } finally { $rsa.Dispose() }
    }

    $payloadParent = Join-Path $work 'payload'
    $payloadRoot = Join-Path $payloadParent 'PodcastCut'
    New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
    $runtimeEntries = @('CSXS','ai','index.html','index-v2.html','platform-loader.html','Installer-Mac.command','Uninstall-Mac.command','style.css','mixed.css','panel.js','core.js','mixed.js','timeline.js','ai-client.js','updater-client.js','host.jsx','package.json','LICENSE','LISEZ-MOI.md','reference-runtime-v1')
    foreach ($entry in $runtimeEntries) {
        $source = Join-Path $pluginRoot $entry
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $payloadRoot -Recurse -Force }
    }
    $packageName = "PodcastCut-$Version.zip"
    $packagePath = Join-Path $OutputDirectory $packageName
    Remove-Item -LiteralPath $packagePath -Force -ErrorAction SilentlyContinue
    Compress-Archive -LiteralPath $payloadRoot -DestinationPath $packagePath -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        schema = 1
        product = 'PodcastCut'
        channel = 'stable'
        version = $Version
        publishedUtc = (Get-Date).ToUniversalTime().ToString('o')
        packageUrl = ($BaseUrl.TrimEnd('/') + '/' + $packageName)
        sha256 = $hash
        minimumPremiere = '26.0.0'
        notes = "Podcast Cut $Version"
    }
    $manifestPath = Join-Path $OutputDirectory 'manifest.json'
    $manifestJson = $manifest | ConvertTo-Json
    [IO.File]::WriteAllText($manifestPath, $manifestJson, [Text.UTF8Encoding]::new($false))
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    try {
        $rsa.FromXmlString((Get-Content -LiteralPath $privateKeyPath -Raw))
        $signature = $rsa.SignData([IO.File]::ReadAllBytes($manifestPath), [System.Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'))
        [IO.File]::WriteAllText((Join-Path $OutputDirectory 'manifest.sig'), [Convert]::ToBase64String($signature), [Text.Encoding]::ASCII)
    } finally { $rsa.Dispose() }

    $setup = Join-Path $work 'setup'
    New-Item -ItemType Directory -Path $setup | Out-Null
    Copy-Item -LiteralPath $packagePath -Destination (Join-Path $setup 'payload.zip')
    foreach ($name in @('Setup.ps1','Updater.ps1','Uninstall.ps1','bootstrap.cmd')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $setup }
    Copy-Item -LiteralPath $publicKeyPath -Destination (Join-Path $setup 'public-key.xml')
    $channel = [ordered]@{ channel='stable'; manifestUrl=($BaseUrl.TrimEnd('/') + '/manifest.json'); checkIntervalHours=6; allowLocalTesting=$false }
    [IO.File]::WriteAllText((Join-Path $setup 'channel.json'), ($channel | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

    [IO.File]::WriteAllText((Join-Path $setup 'version.txt'), $Version, [Text.Encoding]::ASCII)

    $exePath = Join-Path $OutputDirectory "PodcastCut-Setup-$Version.exe"
    if (Test-Path -LiteralPath $exePath) { Remove-Item -LiteralPath $exePath -Force }
    $sedPath = Join-Path $work 'PodcastCut.sed'
    $sourceDir = $setup
    $targetExe = $exePath
    $files = @('bootstrap.cmd','Setup.ps1','Updater.ps1','Uninstall.ps1','channel.json','public-key.xml','version.txt','payload.zip')
    $strings = for ($i=0; $i -lt $files.Count; $i++) { "FILE$i=`"$($files[$i])`"" }
    $fileLines = for ($i=0; $i -lt $files.Count; $i++) { "%FILE$i%=" }
    $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$targetExe
FriendlyName=Podcast Cut $Version
AppLaunched=bootstrap.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=bootstrap.cmd /Quiet
UserQuietInstCmd=bootstrap.cmd /Quiet
SourceFiles=SourceFiles
[Strings]
$($strings -join "`r`n")
[SourceFiles]
SourceFiles0=$sourceDir\
[SourceFiles0]
$($fileLines -join "`r`n")
"@
    [IO.File]::WriteAllText($sedPath, $sed, [Text.Encoding]::ASCII)
    & "$env:WINDIR\System32\iexpress.exe" /N /Q $sedPath
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path -LiteralPath $exePath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path -LiteralPath $exePath)) { throw 'IExpress n a pas produit l installateur EXE.' }
    $exeHash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$exePath.sha256", "$exeHash  $(Split-Path $exePath -Leaf)`r`n", [Text.Encoding]::ASCII)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README-PUBLICATION.md') -Destination (Join-Path $OutputDirectory 'README-PUBLICATION.md') -Force
    Write-Host "Installateur: $exePath" -ForegroundColor Green
    Write-Host "Flux a publier: $manifestPath, manifest.sig, $packageName"
    Write-Host "Cle privee (ne jamais distribuer): $privateKeyPath"
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }








