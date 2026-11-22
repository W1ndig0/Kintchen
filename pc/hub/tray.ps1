# Kitchen Hub tray icon: shows the hub is running and opens the control panel. Started with the hub at sign-in
# (start-hidden.vbs). The hub itself runs in run-hub.cmd, which starts it again whenever it stops.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$port = 8770
$cfg = Join-Path $env:LOCALAPPDATA "KitchenHub\config.json"
if (Test-Path $cfg) { try { $p = (Get-Content $cfg -Raw | ConvertFrom-Json).port; if ($p) { $port = [int]$p } } catch {} }
$url = "http://127.0.0.1:$port/"

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Text = "Kitchen Hub"
$icon.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add("Open Kitchen Hub", $null, { Start-Process $url })
[void]$menu.Items.Add("Open data folder", $null, { Start-Process (Join-Path $env:LOCALAPPDATA "KitchenHub") })
$here = $PSScriptRoot
$hubProcs = { Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$here*hub.js*" } }
# restart = stop node; run-hub.cmd starts it again within a few seconds
[void]$menu.Items.Add("Restart the hub", $null, { & $hubProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } })
[void]$menu.Items.Add("Close this icon", $null, { $icon.Visible = $false; [System.Windows.Forms.Application]::Exit() })
$icon.ContextMenuStrip = $menu
$icon.add_MouseDoubleClick({ Start-Process $url })

# every 30 s: is the hub answering? (tooltip says so)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 30000
$check = {
    try { $r = Invoke-RestMethod -Uri ($url + "api/status") -TimeoutSec 5; $icon.Text = "Kitchen Hub " + $r.version + " - running" }
    catch { $icon.Text = "Kitchen Hub - NOT running (right-click > Restart)" }
}
$timer.add_Tick($check); $timer.Start(); & $check
[System.Windows.Forms.Application]::Run()
