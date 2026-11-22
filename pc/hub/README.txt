KITCHEN HUB v11 - THE HUB ON YOUR PC (work in progress)
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

JOBS AND ALERTS
  The jobs the GitHub cloud ran (meal plan, pantry, list tidy, reminders, morning briefing, calendar...) run
  on the PC every 30 minutes (cloud/brain.js, unchanged, against the PC's list - nothing goes to GitHub).
  Status shows the last run, "Run jobs now", recent alerts and the calendar QR.
  Alerts go to the phone as web push. iPhone needs the app on its Home Screen from an HTTPS address:
    1. Tailscale on the PC and phone (phone: On Demand or always on).
    2. On the PC, once:  tailscale serve --bg 8770     (gives https://<pc-name>.<tailnet>.ts.net)
    3. Put that address in %LOCALAPPDATA%\KitchenHub\config.json as  "publicUrl": "https://..."  and restart.
    4. Pair the phone from that address, Share > Add to Home Screen, open it from there, Status > Turn on alerts.
  The fridge package (weather/news/recipes) isn't built on Windows yet (next part); the fridge keeps using
  its own fetching meanwhile.

SECURITY
  - Answers only the home network, Tailscale and the PC itself; everything else is dropped.
  - Every device signs every request with its own key; replays and requests with a clock 5+ min off are refused;
    10 bad requests lock that address out for 15 minutes.
  - Runs as your normal user. Data: %LOCALAPPDATA%\KitchenHub (hub.tsv, devices.json, queue.json, hub.log).
  - Don't forward this port on the router.

TRY IT ON ANY COMPUTER
  node pc/hub/hub.js --data ./hubdata --port 8770      then open http://127.0.0.1:8770/
  Tests: node tests/pc/hub.test.js
