# Kitchen Hub setup - run by double-clicking "Install Kitchen Hub.cmd". No administrator, no password.
#   1. makes sure Node.js is installed (installs it with winget if it can, otherwise opens the download page)
#   2. puts a shortcut in YOUR Startup folder so the hub starts (hidden) whenever you sign in to Windows
#   3. starts it now and opens the control panel
# Windows may ask once "Allow Node.js on networks?": tick Private networks and click Allow (that lets the fridge
# and your phone reach it at home). Undo: double-click "Uninstall Kitchen Hub.cmd".
param([switch]$Remove)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Kitchen Hub.lnk"
function Stop-Hub {
    Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe' OR Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$here*") -and $_.ProcessId -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
if ($Remove) {
    Stop-Hub; Remove-Item $lnk -ErrorAction SilentlyContinue
    Write-Host "Kitchen Hub removed from startup and stopped. Your data stays in $env:LOCALAPPDATA\KitchenHub."
    exit 0
}

Write-Host "Kitchen Hub setup" -ForegroundColor Cyan
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Host "Node.js isn't installed - installing it..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
        $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    }
    if (-not $node) {
        Write-Host "Please install Node.js (the LTS button) from the page that just opened, then double-click Install Kitchen Hub.cmd again." -ForegroundColor Yellow
        Start-Process "https://nodejs.org/en/download"
        exit 1
    }
}
$v = [int]((& $node -v).TrimStart("v").Split(".")[0])
if ($v -lt 20) { Write-Host "Node.js $v is too old - install the LTS version from nodejs.org and try again." -ForegroundColor Yellow; Start-Process "https://nodejs.org/en/download"; exit 1 }
Write-Host "Node.js $v found."

if ($here -match '\\Downloads\\|\\Temp\\|\.zip\\') {
    Write-Host "This folder looks temporary ($here)." -ForegroundColor Yellow
    Write-Host "Move the whole KitchenHub folder somewhere it can stay (e.g. C:\KitchenHub), then run Install again." -ForegroundColor Yellow
    exit 1
}

Stop-Hub
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = "wscript.exe"
$s.Arguments = '"' + (Join-Path $here "start-hidden.vbs") + '"'
$s.WorkingDirectory = $here
$s.Save()
Write-Host "Starts by itself when you sign in to Windows."

Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $here "start-hidden.vbs") + '"')
Write-Host "Starting..."
$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) { Start-Sleep 1; try { Invoke-RestMethod "http://127.0.0.1:8770/api/hello" -TimeoutSec 2 | Out-Null; $ok = $true } catch {} }
if ($ok) {
    Write-Host "Kitchen Hub is running." -ForegroundColor Green
    Start-Process "http://127.0.0.1:8770/"
} else {
    Write-Host "The hub didn't answer yet. Look at $env:LOCALAPPDATA\KitchenHub\hub.log and send it to Claude." -ForegroundColor Yellow
}
