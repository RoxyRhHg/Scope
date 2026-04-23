$ErrorActionPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot ".cache\scope-server.pid"
$liveCache = Join-Path $projectRoot ".cache\live-snapshot.json"

if (Test-Path -LiteralPath $pidFile) {
    $pidValue = Get-Content -LiteralPath $pidFile | Select-Object -First 1
    if ($pidValue) {
        Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $liveCache -Force -ErrorAction SilentlyContinue

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*Coding*Scope*src/server.js*" -or $_.CommandLine -like "*src/server.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
