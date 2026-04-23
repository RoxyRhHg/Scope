param(
    [int]$Port = 4173
)

$ErrorActionPreference = "Stop"

function Test-ScopeHealth {
    param([int]$CheckPort)

    try {
        Invoke-WebRequest "http://127.0.0.1:$CheckPort/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Show-LaunchError {
    param([string]$Message)

    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Message, "Scope Launch Error") | Out-Null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $projectRoot ".cache"
$pidFile = Join-Path $cacheDir "scope-server.pid"

New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null

if (Test-ScopeHealth -CheckPort $Port) {
    try {
        Start-Process "http://127.0.0.1:$Port/" -ErrorAction Stop
    } catch {
    }
    exit 0
}

try {
    $node = (Get-Command node -ErrorAction Stop).Source
} catch {
    Show-LaunchError "Node.js was not found. Please install Node.js first."
    exit 1
}

$process = Start-Process -FilePath $node -ArgumentList "src/server.js" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding UTF8

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-ScopeHealth -CheckPort $Port) {
        try {
            Start-Process "http://127.0.0.1:$Port/" -ErrorAction Stop
        } catch {
        }
        exit 0
    }
}

try {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
} catch {
}

Show-LaunchError "Scope server start timed out. Please try again."
exit 1
