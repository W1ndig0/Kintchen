# Kitchen Hub v11 - set up the hub on this PC (Windows 10). Run once in PowerShell AS ADMINISTRATOR from the repo folder:
#     powershell -ExecutionPolicy Bypass -File pc\hub\install.ps1
# What it does (and nothing else):
#   1. checks Node.js 20 or newer is installed (https://nodejs.org, LTS)
#   2. scheduled task "Kitchen Hub": starts the hub at boot, as YOUR user (not administrator), restarts it if it stops
#   3. firewall rule: the hub's port only from the home network and Tailscale (no port forwarding on the router - don't add any)
#   4. a shortcut in Startup so the tray icon appears when you sign in
# Undo: powershell -ExecutionPolicy Bypass -File pc\hub\install.ps1 -Remove
param([switch]$Remove, [int]$Port = 8770)
$ErrorActionPreference = "Stop"
$task = "Kitchen Hub"; $rule = "Kitchen Hub (home network)"
$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "Kitchen Hub tray.lnk"

if ($Remove) {
    Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
    Remove-Item $startup -ErrorAction SilentlyContinue
    Write-Host "Removed. Your data stays in $env:LOCALAPPDATA\KitchenHub."; exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js isn't installed. Install the LTS version from https://nodejs.org and run this again." }
$v = [int]((& $node -v).TrimStart("v").Split(".")[0]); if ($v -lt 20) { throw "Node.js $v is too old: install 20 or newer." }

$hub = (Resolve-Path (Join-Path $PSScriptRoot "hub.js")).Path
$data = Join-Path $env:LOCALAPPDATA "KitchenHub"
New-Item -ItemType Directory -Force $data | Out-Null
if ($Port -ne 8770) { @{ port = $Port } | ConvertTo-Json | Set-Content (Join-Path $data "config.json") }

# 2. the hub at boot, as this user, whether signed in or not (Windows asks for your password once)
$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$hub`" --data `"$data`"" -WorkingDirectory (Split-Path $hub)
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$cred = Get-Credential -UserName $user -Message "Your Windows password, so the hub can start at boot before you sign in"
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -User $user `
    -Password $cred.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null

# 3. firewall: home network ranges + Tailscale only
Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain `
    -RemoteAddress @("LocalSubnet", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "fd7a:115c:a1e0::/48") | Out-Null

# 4. tray icon at sign-in
$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut($startup)
$lnk.TargetPath = "powershell.exe"
$lnk.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"" + (Join-Path $PSScriptRoot "tray.ps1") + "`""
$lnk.Save()

Start-ScheduledTask -TaskName $task
Start-Sleep 3
try { $s = Invoke-RestMethod "http://127.0.0.1:$Port/api/status" -TimeoutSec 5; Write-Host "Kitchen Hub $($s.version) is running on port $Port." }
catch { Write-Host "The task is set up but the hub didn't answer yet - look at $data\hub.log" }
Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'tray.ps1')`""
Write-Host "Open http://127.0.0.1:$Port/ on this PC (or double-click the tray icon). Pair other devices under Devices."
Write-Host "Note: the Windows network must be set to Private for the firewall rule to apply."
