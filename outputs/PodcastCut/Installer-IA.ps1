param([string]$PythonExe = '', [string]$Destination = '')
$ErrorActionPreference = 'Stop'
if (-not $Destination) { $Destination = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PodcastCut\AI' }
if (-not $PythonExe) {
    $privatePython = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PodcastCut\Python312\python.exe'
    if (Test-Path -LiteralPath $privatePython) { $PythonExe = $privatePython }
}
if (-not $PythonExe) {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) { $PythonExe = & $launcher.Source -3 -c 'import sys; print(sys.executable)' }
    if (-not $PythonExe) {
        $candidate = Get-Command python.exe -ErrorAction SilentlyContinue
        if ($candidate -and $candidate.Source -notmatch 'WindowsApps') { $PythonExe = $candidate.Source }
    }
}
if (-not $PythonExe -or -not (Test-Path -LiteralPath $PythonExe)) { throw 'Python 3.10 a 3.13 (64 bits) requis. Installez-le depuis python.org, puis relancez. Ou utilisez -PythonExe avec son chemin complet.' }
& $PythonExe -c 'import sys,struct; assert (3,10) <= sys.version_info[:2] <= (3,13) and struct.calcsize("P")==8, "Python 3.10 a 3.13, 64 bits requis"'
if ($LASTEXITCODE -ne 0) { throw 'Version Python incompatible.' }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$venv = Join-Path $Destination 'runtime'
& $PythonExe -m venv $venv
if ($LASTEXITCODE -ne 0) { throw 'Creation de l environnement Python impossible.' }
$runtime = Join-Path $venv 'Scripts\python.exe'
& $runtime -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'ai\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Installation des dependances IA impossible.' }
& $runtime (Join-Path $PSScriptRoot 'ai\download_models.py') (Join-Path $Destination 'models')
if ($LASTEXITCODE -ne 0) { throw 'Telechargement des modeles impossible.' }
Write-Host 'Mode audio mixe pret. Ouvrez Podcast Cut et selectionnez Audio mixe.' -ForegroundColor Green
