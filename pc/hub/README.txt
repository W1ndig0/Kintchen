KITCHEN HUB v11 - THE HUB ON YOUR PC (work in progress: first part)
===================================================================
The PC becomes the hub's brain and storage. This first part is the hub service and the control panel
web app. The fridge and the phone still use the GitHub cloud until a later part switches them over.

WHAT'S HERE
  hub.js          the hub (Node.js, no extra packages)
  lib/            store (the list, plain text), auth (pairing + signed requests), server (web + API)
  web/            the app: phone layout, and desktop mode on wide screens (or the "Desktop mode" switch)
  install.ps1     sets it up on Windows 10 (start at boot, firewall, tray icon)
  tray.ps1        the tray icon (open, data folder, restart)

INSTALL (Windows 10)
  1. Install Node.js LTS from https://nodejs.org
  2. PowerShell as administrator, in the repo folder:
       powershell -ExecutionPolicy Bypass -File pc\hub\install.ps1
  3. Double-click the tray icon (or open http://127.0.0.1:8770/).
  To bring your current list over: save hub.tsv from your gist as %LOCALAPPDATA%\KitchenHub\import.tsv,
  put your passphrase in import.pass in the same folder, restart the hub (tray > Restart). The items are
  unlocked to plain text, import.pass is deleted, and hub.log says how many came over.

PAIRING A PHONE OR ANOTHER COMPUTER
  Desktop mode > Devices > Pair a device. Scan the code with the phone camera (phone on home Wi-Fi or
  Tailscale) or type it. The code works once, for 10 minutes. Remove a device there any time.

SECURITY
  - Answers only the home network, Tailscale and the PC itself; everything else is dropped.
  - Every device signs every request with its own key; replays and requests with a clock 5+ min off are refused;
    10 bad requests lock that address out for 15 minutes.
  - Runs as your normal user. Data: %LOCALAPPDATA%\KitchenHub (hub.tsv, devices.json, queue.json, hub.log).
  - Don't forward this port on the router.

TRY IT ON ANY COMPUTER
  node pc/hub/hub.js --data ./hubdata --port 8770      then open http://127.0.0.1:8770/
  Tests: node tests/pc/hub.test.js
