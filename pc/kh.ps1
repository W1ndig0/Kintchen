<#
  Kitchen Hub from the PC (Windows PowerShell 5.1 or PowerShell 7).

  First time:   powershell -ExecutionPolicy Bypass -File kh.ps1 pair "<pairing link from the phone app: Copy pairing link>"
  Then:
     kh add milk eggs "paper towels"      add to the shopping list
     kh list                              what's on the list
     kh done milk                         tick something off
     kh note "Back at 6, love you"        pin a note on the fridge
     kh timer 10                          start a 10 minute timer on the fridge (next wake)
     kh event 2026-11-20 15:30 Dentist    calendar event (time optional)
     kh chore weekly:2 19:00 "Garbage out" repeating chore (daily | weekly:1,4 | every2w:2:2026-11-17 | monthly:15 | monthly:last | yearly:11-17)
     kh recipe https://site/recipe        import a recipe (the cloud brain fetches it)
     kh plan                              this week's dinners
     kh status                            fridge battery, last check-in, cloud brain
     kh log                               the fridge's last uploaded log
     kh tv                                open the TV dashboard full screen in your browser
     kh cal                               subscribe to the calendar (opens Outlook / your calendar app)
     kh sync | kh update | kh remotelog   remote control: sync, install update, upload a log (next wake)
     kh rollback                          undo the fridge's last update (next wake)
     kh web https://text.npr.org          open a page in the fridge's web reader (or: kh web some search words)
     kh spend 42.50 groceries             log a purchase (categories: groceries, eating out, gas, household, bills, fun, other)
     kh food chicken 2                    something in the fridge, best before in 2 days
     kh version                           the fridge's version and update setting
     kh books                             your book cloud: what's in it and what's on the Kindle
     kh book https://site/article         send an article to the Kindle library (the cloud makes it a book)
     kh book 1342                         add a free classic from Project Gutenberg by its number
  Tip: make it a command:  Set-Alias kh "$HOME\KitchenHub\kh.ps1"  in your PowerShell profile.
  Your settings live in %APPDATA%\KitchenHub\kh.json (the token is only stored there).
#>
param([Parameter(Position = 0)][string]$Cmd = "help", [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$ErrorActionPreference = "Stop"
$ConfDir = Join-Path $env:APPDATA "KitchenHub"; if (-not $env:APPDATA) { $ConfDir = Join-Path $HOME ".kitchenhub" }
$ConfFile = Join-Path $ConfDir "kh.json"
$Api = "https://api.github.com"
$Sha = [System.Security.Cryptography.SHA256]::Create()
$Utf8 = New-Object System.Text.UTF8Encoding($false)

# ---------------- HubCrypt (same as hubdata.js) ----------------
function Sha([byte[]]$b) { return ,$Sha.ComputeHash($b) }
function Cat([byte[]]$a, [byte[]]$b) { $o = New-Object byte[] ($a.Length + $b.Length); [Array]::Copy($a, 0, $o, 0, $a.Length); [Array]::Copy($b, 0, $o, $a.Length, $b.Length); return ,$o }
$KeyCache = @{}
function KeyOf([string]$pass) {
  if ($KeyCache.ContainsKey($pass)) { return ,$KeyCache[$pass] }
  [byte[]]$k = $Utf8.GetBytes("kitchenhub|" + $pass)
  for ($i = 0; $i -lt 1000; $i++) { $k = Sha $k }
  $KeyCache[$pass] = $k; return ,$k
}
function Stream([byte[]]$key, [byte[]]$iv, [int]$n) {
  $out = New-Object System.Collections.Generic.List[byte]; $j = 0
  while ($out.Count -lt $n) {
    [byte[]]$ctr = @([byte](($j -shr 24) -band 255), [byte](($j -shr 16) -band 255), [byte](($j -shr 8) -band 255), [byte]($j -band 255))
    $out.AddRange([byte[]](Sha (Cat (Cat $key $iv) $ctr))); $j++
  }
  return ,$out.ToArray()
}
function Tag([byte[]]$key, [byte[]]$iv, [byte[]]$ct) { [byte[]]$h = Sha (Cat (Cat (Cat $key ([byte[]]@(116))) $iv) $ct); return ,$h[0..7] }
function B64u([byte[]]$b) { return [Convert]::ToBase64String($b).TrimEnd("=").Replace("+", "-").Replace("/", "_") }
function UnB64u([string]$s) { $s = $s.Replace("-", "+").Replace("_", "/"); while ($s.Length % 4) { $s += "=" }; return ,[Convert]::FromBase64String($s) }
function Lock([string]$text, [string]$pass) {
  if (-not $pass) { return $text }
  $key = KeyOf $pass; [byte[]]$pt = $Utf8.GetBytes($text)
  [byte[]]$iv = New-Object byte[] 8; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($iv)
  [byte[]]$ks = Stream $key $iv $pt.Length; [byte[]]$ct = New-Object byte[] $pt.Length
  for ($i = 0; $i -lt $pt.Length; $i++) { $ct[$i] = $pt[$i] -bxor $ks[$i] }
  return "~" + (B64u (Cat (Cat $iv ([byte[]](Tag $key $iv $ct))) $ct))
}
function Unlock([string]$text, [string]$pass) {
  if (-not $text.StartsWith("~")) { return $text }
  if (-not $pass) { return $null }
  try { [byte[]]$b = UnB64u $text.Substring(1) } catch { return $null }
  if ($b.Length -lt 16) { return $null }
  $key = KeyOf $pass; [byte[]]$iv = $b[0..7]; [byte[]]$tg = $b[8..15]
  [byte[]]$ct = if ($b.Length -gt 16) { $b[16..($b.Length - 1)] } else { New-Object byte[] 0 }
  [byte[]]$t2 = Tag $key $iv $ct
  for ($i = 0; $i -lt 8; $i++) { if ($tg[$i] -ne $t2[$i]) { return $null } }
  [byte[]]$ks = Stream $key $iv $ct.Length; [byte[]]$pt = New-Object byte[] $ct.Length
  for ($i = 0; $i -lt $ct.Length; $i++) { $pt[$i] = $ct[$i] -bxor $ks[$i] }
  return $Utf8.GetString($pt)
}
function SelfTest {   # a line locked by the phone/Kindle code must open here, or nothing is written
  $v = Unlock "~nGjclQxPadCO4oJvpJoJS3lwQgasbBqfLsZhKEtcnoBy" "test"
  if ($v -ne ("kitchen hub ok " + [char]0xE9)) { throw "Crypto self-test failed on this PC - please tell Claude (nothing was changed)." }
  $r = Lock "round trip" "test"; if ((Unlock $r "test") -ne "round trip") { throw "Crypto round-trip failed (nothing was changed)." }
}

# ---------------- store lines: ts<TAB>id<TAB>kind<TAB>state<TAB>text ----------------
function EscT([string]$s) { return $s.Replace("\", "\\").Replace("`t", "\t").Replace("`r", "").Replace("`n", "\n") }
function UnescT([string]$s) { return [regex]::Replace($s, '\\(.)', { param($m) if ($m.Groups[1].Value -eq "t") { "`t" } elseif ($m.Groups[1].Value -eq "n") { "`n" } else { $m.Groups[1].Value } }) }
function Items([string]$store, [string]$kind) {
  $best = @{}
  foreach ($l in ($store -split "`n")) {
    $f = $l.TrimEnd("`r") -split "`t", 5
    if ($f.Count -lt 5 -or $f[0] -notmatch '^\d+$') { continue }
    $it = [pscustomobject]@{ ts = [int64]$f[0]; id = $f[1]; kind = $f[2]; state = $f[3]; raw = (UnescT $f[4]) }
    if (-not $best.ContainsKey($it.id) -or $best[$it.id].ts -lt $it.ts) { $best[$it.id] = $it }
  }
  $o = @(); foreach ($it in $best.Values) { if ($it.state -ne "del" -and (-not $kind -or $it.kind -eq $kind)) { $it | Add-Member -NotePropertyName text -NotePropertyValue (Unlock $it.raw $C.pass); $o += $it } }
  return ,($o | Sort-Object ts)
}
function NowMs { return [int64](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()) }
$Seq = 0
function NewId { $script:Seq++; return "w" + [Convert]::ToString((NowMs), 16) + (Get-Random -Maximum 46655) + $script:Seq }

# ---------------- GitHub ----------------
function Gh([string]$method, [string]$url, $body) {
  $h = @{ Authorization = "Bearer " + $C.token; Accept = "application/vnd.github+json"; "User-Agent" = "KitchenHubPC"; "X-GitHub-Api-Version" = "2022-11-28" }
  if ($body) { return Invoke-RestMethod -Method $method -Uri ($Api + $url) -Headers $h -ContentType "application/json; charset=utf-8" -Body ($Utf8.GetBytes(($body | ConvertTo-Json -Depth 6 -Compress))) }
  return Invoke-RestMethod -Method $method -Uri ($Api + $url) -Headers $h
}
function FileText($g, [string]$name) {
  $f = $g.files.$name; if (-not $f) { return $null }
  if ($f.truncated) { return (Invoke-WebRequest -UseBasicParsing -Uri $f.raw_url).Content }
  return [string]$f.content
}
function AddLines([object[]]$adds) {   # each @(kind, state, text, id)
  SelfTest
  $g = Gh GET ("/gists/" + $C.gist); $store = FileText $g "hub.tsv"; if (-not $store) { $store = "#hub v1`n" }
  if (-not $store.EndsWith("`n")) { $store += "`n" }
  $base = $store; $lines = ""; $ids = @(); $ts = NowMs
  foreach ($a in $adds) { $id = if ($a[3]) { $a[3] } else { NewId }; $ids += $id; $lines += "$ts`t$id`t$($a[0])`t$($a[1])`t" + (EscT (Lock $a[2] $C.pass)) + "`n"; $ts++ }
  # 10.1.2: the phone or the fridge may write in the same second; check our lines landed, else add them to the newer copy and try again
  for ($try = 0; $try -lt 3; $try++) {
    Gh PATCH ("/gists/" + $C.gist) @{ files = @{ "hub.tsv" = @{ content = ($base + $lines) } } } | Out-Null
    Start-Sleep -Seconds 2
    $now = FileText (Gh GET ("/gists/" + $C.gist)) "hub.tsv"; if (-not $now) { $now = "" }
    $missing = @($ids | Where-Object { $now -notmatch ("`t" + [regex]::Escape($_) + "`t") })
    if (-not $missing) { return }
    $base = $now; if (-not $base.EndsWith("`n")) { $base += "`n" }
  }
  throw "Couldn't save after 3 tries (someone else kept writing). Nothing lost - run the command again."
}
function Extras {
  $g = Gh GET ("/gists/" + $C.gist)
  $b = $null; $k = $null
  try { $b = (FileText $g "brain.json") | ConvertFrom-Json } catch {}
  try { $k = (FileText $g "kindle.json") | ConvertFrom-Json } catch {}
  return @{ g = $g; brain = $b; kindle = $k }
}

# ---------------- commands ----------------
if ($Cmd -eq "pair") {
  $link = ($Rest -join " ")
  if ($link -notmatch 'pair=([A-Za-z0-9]+)\.([A-Za-z0-9_]+)') { throw "Paste the pairing link (phone app: Copy pairing link)" }
  $c = @{ gist = $Matches[1]; token = $Matches[2]; pass = ""; pages = "" }
  if ($link -match '[&#?]k=([^&\s]+)') { $c.pass = [uri]::UnescapeDataString($Matches[1]) }
  if ($link -match '^(https://[^#]+/)') { $c.pages = $Matches[1] }
  New-Item -ItemType Directory -Force -Path $ConfDir | Out-Null
  $c | ConvertTo-Json | Set-Content -Encoding UTF8 $ConfFile
  Write-Host "Paired. Try: kh list"; exit 0
}
if (-not (Test-Path $ConfFile)) { Write-Host "Not paired yet. Run: kh pair `"<pairing link>`" (phone app > Copy pairing link)"; exit 1 }
$C = Get-Content -Raw $ConfFile | ConvertFrom-Json
$arg = ($Rest -join " ").Trim()

switch ($Cmd) {
  "add" {
    if (-not $Rest) { throw "kh add milk eggs" }
    $adds = New-Object System.Collections.ArrayList; foreach ($r in $Rest) { [void]$adds.Add(@("shop", "open", $r, $null)) }
    AddLines $adds.ToArray(); Write-Host ("Added: " + ($Rest -join ", "))
  }
  "list" {
    $g = Gh GET ("/gists/" + $C.gist); $its = Items (FileText $g "hub.tsv") "shop"
    $open = @($its | Where-Object { $_.state -eq "open" }); Write-Host ("SHOPPING LIST - " + $open.Count)
    function Nice($t) { if ($t -eq $null) { return "(locked)" }; $f = $t -split '\|'; $o = $f[0]; if ($f.Count -gt 2 -and [int]("0" + $f[2]) -gt 1) { $o += " x" + $f[2] }; if ($f.Count -gt 3 -and $f[3]) { $o += " (" + $f[3] + ")" }; return $o }
    $open | Sort-Object { $_.text } | ForEach-Object { Write-Host ("  [ ] " + (Nice $_.text)) }
    $its | Where-Object { $_.state -eq "done" } | ForEach-Object { Write-Host ("  [x] " + (Nice $_.text)) -ForegroundColor DarkGray }
  }
  "done" {
    if (-not $arg) { throw "kh done milk   (say which item - this used to tick off the whole list)" }
    $g = Gh GET ("/gists/" + $C.gist); $its = Items (FileText $g "hub.tsv") "shop"
    $hit = @($its | Where-Object { $_.state -eq "open" -and $_.text -like "*$arg*" })
    if (-not $hit) { Write-Host "Nothing open matches '$arg'"; exit 1 }
    $adds = New-Object System.Collections.ArrayList; foreach ($h in $hit) { [void]$adds.Add(@("shop", "done", $h.text, $h.id)) }
    AddLines $adds.ToArray(); Write-Host ("Ticked: " + (($hit | ForEach-Object { $_.text }) -join ", "))
  }
  "note" { AddLines @(, @("msg", "open", $arg.Substring(0, [Math]::Min(280, $arg.Length)), $null)); Write-Host "Pinned on the fridge (shows at its next wake)." }
  "timer" { $m = 0; if (-not [int]::TryParse([string]$Rest[0], [ref]$m) -or $m -lt 1 -or $m -gt 240) { throw "kh timer 10   (1 to 240 minutes)" }; AddLines @(, @("cmd", "open", "timer|" + $m, $null)); Write-Host "Timer queued." }
  "sync" { AddLines @(, @("cmd", "open", "sync", $null)); Write-Host "The fridge syncs at its next wake." }
  "update" { AddLines @(, @("cmd", "open", "update|install", $null)); Write-Host "The fridge installs the update from your GitHub site at its next wake." }
  "rollback" { AddLines @(, @("cmd", "open", "update|rollback", $null)); Write-Host "The fridge goes back to its previous version at its next wake." }
  "web" {
    if (-not $arg) { throw "kh web https://text.npr.org   (or some search words)" }
    $u = if ($arg -match '^https?://') { $arg } elseif ($arg -notmatch '\s' -and $arg -match '\.[a-z]{2,}') { "https://" + $arg } else { "q:" + $arg }
    AddLines @(, @("cmd", "open", "web|" + $u, $null)); Write-Host "Sent - it opens in the fridge's WEB app at its next wake."
  }
  "spend" {
    $amt = 0.0; if (-not [double]::TryParse([string]$Rest[0], [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$amt) -or $amt -le 0) { throw "kh spend 42.50 groceries" }
    $cats = @("Groceries", "Eating out", "Gas", "Household", "Bills", "Fun", "Other"); $want = (($Rest | Select-Object -Skip 1) -join " ").Trim(); $cat = "Other"
    foreach ($c in $cats) { if ($want -and $c.ToLower().StartsWith($want.ToLower())) { $cat = $c; break } }
    $d = (Get-Date).ToString("yyyy-MM-dd")
    AddLines @(, @("spend", "open", ("{0}|{1}|{2}|p1||" -f $d, $amt.ToString("0.00", [System.Globalization.CultureInfo]::InvariantCulture), $cat), $null)); Write-Host ("Logged {0:0.00} for {1}." -f $amt, $cat)
  }
  "food" {
    if (-not $Rest) { throw "kh food chicken 2   (name, then days until best before)" }
    $days = 3; $last = [string]$Rest[-1]; $nameParts = $Rest
    if ($Rest.Count -gt 1 -and $last -match '^\d{1,3}$') { $days = [int]$last; $nameParts = $Rest[0..($Rest.Count - 2)] }
    $name = ($nameParts -join " ").Replace("|", "/"); $exp = (Get-Date).AddDays($days).ToString("yyyy-MM-dd")
    AddLines @(, @("pantry", "open", "$name|$exp|1|fridge", $null)); Write-Host "Added $name (best before $exp)."
  }
  "books" {
    $g = Gh GET ("/gists/" + $C.gist); $store = FileText $g "hub.tsv"
    $bs = @(Items $store "book" | Where-Object { $_.state -eq "open" -and $_.text })
    if (-not $bs) { Write-Host "Your book cloud is empty. Add books from the phone app's BOOKS tab."; exit 0 }
    foreach ($b in $bs) { $f = $b.text -split "\|"; Write-Host ("{0,-40} {1,-22} {2,-5} {3,7} KB  {4}" -f $f[0], $f[1], $f[2], [int]([double]("0" + $f[3]) / 1024), $(if ($f[4] -eq "kindle") { "on the Kindle" } else { "cloud only" })) }
  }
  "book" {
    if (-not $arg) { throw "kh book https://site/article   or   kh book 1342 (a Project Gutenberg number)" }
    if ($arg -match '^\d+$') { AddLines @(, @("req", "open", "book|gut|$arg", $null)); Write-Host "Asked the cloud for Project Gutenberg book $arg - on the Kindle after the next sync or two." }
    elseif ($arg -match '^https?://\S+$') { AddLines @(, @("req", "open", "book|url|$arg", $null)); Write-Host "Sent - the cloud turns it into a book for the Kindle library." }
    else { throw "kh book needs a web address or a Gutenberg number" }
  }
  "version" {
    $x = Extras; $k = $x.kindle
    if (-not $k) { Write-Host "No check-in from the fridge yet."; exit 0 }
    $au = @("only when you tap", "tells you", "installs at night")[$(if ($null -eq $k.auto) { 2 } else { [int]$k.auto })]
    Write-Host ("Fridge v{0} - updates: {1}{2}{3}" -f $k.v, $au, $(if ($k.avail) { " - $($k.avail) is ready" } else { "" }), $(if ($k.upd) { " - last: " + (($k.upd -split " ")[1..3] -join " ") } else { "" }))
  }
  "remotelog" { AddLines @(, @("cmd", "open", "log", $null)); Write-Host "The fridge uploads its log at the next wake; then: kh log" }
  "event" {
    if ($Rest[0] -notmatch '^\d{4}-\d\d-\d\d$') { throw "kh event 2026-11-20 15:30 Dentist" }
    $t = ""; $i = 1; if ($Rest[1] -match '^([01]?\d|2[0-3]):([0-5]\d)$') { $t = "{0:D2}:{1}" -f [int]$Matches[1], $Matches[2]; $i = 2 }
    if ($i -ge $Rest.Count) { throw "kh event 2026-11-20 15:30 Dentist   (needs a title)" }
    $title = ($Rest[$i..($Rest.Count - 1)] -join " ").Replace("|", "/")
    AddLines @(, @("event", "open", "$($Rest[0])|$t|$title|", $null)); Write-Host "Event added."
  }
  "chore" {
    $t = ""; $i = 1; if ($Rest[1] -match '^(\d{1,2}):(\d\d)$') { $t = "{0:D2}:{1}" -f [int]$Matches[1], $Matches[2]; $i = 2 }
    $title = ($Rest[$i..($Rest.Count - 1)] -join " ").Replace("|", "/")
    if ($Rest[0] -notmatch '^(daily|weekly:[0-6](,[0-6])*|every2w:[0-6]:\d{4}-\d\d-\d\d|monthly:(\d{1,2}|last)|yearly:\d\d-\d\d|months:\d{1,2}:\d{4}-\d\d-\d\d)$') { throw "rule: daily | weekly:1,4 | every2w:2:2026-11-17 | monthly:15 | monthly:last | yearly:11-17  (0=Sunday)" }
    AddLines @(, @("repeat", "open", "$($Rest[0])|$t|$title|", $null)); Write-Host "Chore added."
  }
  "recipe" { if ($arg -notmatch '^https?://') { throw "kh recipe https://..." }; AddLines @(, @("req", "open", "import|" + $arg, $null)); Write-Host "The cloud brain imports it within ~15 min." }
  "plan" {
    $g = Gh GET ("/gists/" + $C.gist); $its = Items (FileText $g "hub.tsv") "plan"
    $today = (Get-Date).ToString("yyyy-MM-dd")
    $its | Where-Object { $_.text -and $_.text.Length -ge 10 -and $_.text.Substring(0, 10) -ge $today } | Sort-Object { $_.text } | ForEach-Object { $f = $_.text -split "\|"; Write-Host ("  " + ([datetime]$f[0]).ToString("ddd MMM d") + "  " + $f[1]) }
  }
  "status" {
    $x = Extras; $k = $x.kindle; $b = $x.brain
    if ($k) {
      $mins = [int](([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $k.ts) / 60)
      Write-Host ("Fridge: battery {0}%{1}, about {2} h left, checked in {3} min ago, v{4}" -f $k.pct, $(if ($k.charging) { " (charging)" } else { "" }), $k.left7, $mins, $k.v)
    } else { Write-Host "Fridge: no check-in yet" }
    if ($b) { Write-Host ("Cloud brain: last run {0} min ago" -f [int](([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $b.lastRun) / 60000)) } else { Write-Host "Cloud brain: not running yet" }
  }
  "log" {
    $x = Extras; if (-not $x.brain -or -not $x.brain.cloudGist) { throw "No cloud gist yet" }
    $cg = Gh GET ("/gists/" + $x.brain.cloudGist); $t = FileText $cg "kindle-log.txt"
    if ($t) { $t } else { "No log yet: kh remotelog" }
  }
  "tv" {
    $x = Extras; if (-not $x.brain -or -not $x.brain.tv) { throw "The cloud brain hasn't run yet" }
    $u = $C.pages + "tv.html#g=" + $x.brain.tv + "&k=" + [uri]::EscapeDataString($C.pass)
    Start-Process $u; Write-Host "Opened. Press F11 for full screen; arrow keys change screens."
  }
  "cal" { $x = Extras; if (-not $x.brain -or -not $x.brain.ics) { throw "The cloud brain hasn't run yet" }; Start-Process ($x.brain.ics -replace '^https:', 'webcal:'); Write-Host $x.brain.ics }
  "selftest" { SelfTest; Write-Host "Crypto matches the fridge and phone." }
  default { Get-Help $PSCommandPath; Write-Host "Commands: add list done note timer event chore recipe plan spend food web book books status version log tv cal sync update rollback remotelog selftest pair" }
}
