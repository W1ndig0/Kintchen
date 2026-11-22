KITCHEN HUB v11 - THE HUB ON YOUR PC (work in progress)
===================================================================
The PC becomes the hub's brain and storage: the list, the jobs (meal plan, pantry, reminders, calendar),
the fridge's package (weather, news, recipes...), recipe search, alerts and logs. GitHub keeps only the
fridge's updates and the code.

WHAT'S HERE
  hub.js          the hub (Node.js, no extra packages)
  lib/            store (the list, plain text), auth (pairing + signed requests), server (web + API)
  web/            the app: phone layout, and desktop mode on wide screens (or the "Desktop mode" switch)
  setup.ps1       sets it up (run by "Install Kitchen Hub.cmd" in the kit folder)
  run-hub.cmd     keeps the hub running; start-hidden.vbs starts it without windows
  tray.ps1        the tray icon (open, data folder, restart)

INSTALL (Windows 10) - no administrator, no password
  1. Unzip the kit to a folder that can stay, e.g. C:\KitchenHub (not Downloads).
  2. Double-click "Install Kitchen Hub.cmd" in that folder. It installs Node.js if needed (winget), makes the
     hub start by itself when you sign in to Windows, starts it, and opens the control panel.
  3. If Windows asks "Allow Node.js on networks?": tick Private networks, click Allow.
  The PC must sign in to Windows after a restart (automatic sign-in is fine) for the hub to start.
  Tray icon: open, data folder, restart. "Uninstall Kitchen Hub.cmd" stops it and removes it from startup.
  To bring your current list over: save hub.tsv from your gist as %LOCALAPPDATA%\KitchenHub\import.tsv,
  put your passphrase in import.pass in the same folder, restart the hub (tray > Restart). The items are
  unlocked to plain text (the passphrase moves into config.json so items still locked on the fridge are
  unlocked as they arrive), import.pass is deleted, and hub.log says how many came over.

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
  The fridge's package (weather, news, markets, what's on, recipes, horoscopes) is built on the PC too.

MOVING THE FRIDGE TO THE PC (no USB)
  On the PC: Desktop mode > Devices > Pair a device (it shows a code). On the fridge: Settings > PC >
  PAIR WITH YOUR PC, type the PC's home address (192.168...., the panel shows it) and the code.
  (The older way still works: Devices > Pair the fridge shows 3 lines for cloud.conf.)
  From its next sync the fridge talks only to the PC over home Wi-Fi: list, check-in, logs, package, recipe
  search. If the PC is off the fridge keeps its list and fetches just weather and news itself.
  Needs openssl on the Kindle (to sign); if it's missing the fridge's status says so.
  GO BACK TO GITHUB: delete the 3 lines. Nothing else changes, the GitHub cloud is left running until you
  say it can be switched off.
  Fridge actions (sync, timer, update, note...) go in Fridge queue; logs land in the data folder\logs.

KEEP IT REACHABLE (two things that make the fridge say "the PC didn't answer")
  - The PC must not go to sleep: Windows Settings > System > Power & sleep > Sleep > Never (when plugged in).
    A sleeping PC answers nobody; the fridge keeps its list and fetches weather and news itself until it wakes.
  - Give the PC a fixed address: in your router's settings reserve its current 192.168.x.x address for it
    ("DHCP reservation" / "static lease"). If the address changes the fridge can't find it until you pair again.

SAFETY
  Only your home network and Tailscale can reach the hub, and everything except the web app's own page needs a
  paired device. The PC's own browser (127.0.0.1) is the owner and needs no pairing - but only when the request
  really comes from that browser itself: requests that arrive through "tailscale serve" or from a web page
  open in the PC's browser must pair like any other device (11.2.1).

FRIDGE UPDATES FROM THE PC (no GitHub)
  A paired fridge gets its updates from the PC: the PC signs the list of files with the fridge's key, the
  fridge checks it and every file's checksum. Status > Fridge updates shows both versions; "Install on the
  fridge" queues it. New versions reach the PC by:
    - Status > Install a kit file (.zip): the whole kit, checked (versions match, every file parses) and kept
      in the data folder\kits (last 3). The hub restarts on it; if it won't start, the built-in copy runs.
    - or "Get the newest kit" (git pull) while the repo still lives on GitHub.

BOOK FOLDER
  Documents\Kitchen Hub Books (or "booksDir" in config.json). Every book in it goes to the fridge's library
  at its next sync; take it out and it leaves the fridge. EPUB is converted with Calibre if it is installed.

PRICE CHECK (Prices tab, phone and desktop)
  Checks the open list at Costco, Superstore, Walmart and Save-On-Foods: the cheapest single store, every
  store's total, what each is missing, and the difference on the items both stores have. Prices come from
  your price book (type them in, or import a CSV - the only source for most Costco prices) and the stores'
  flyers / Walmart online prices via Flipp (unofficial; if it stops working the price book still does).
  Change any pick and it is remembered. Postal code: "postal" in config.json (default V2L5M1).

SECURITY
  - Answers only the home network, Tailscale and the PC itself; everything else is dropped.
  - Every device signs every request with its own key; replays and requests with a clock 5+ min off are refused;
    10 bad requests lock that address out for 15 minutes.
  - Runs as your normal user. Data: %LOCALAPPDATA%\KitchenHub (hub.tsv, devices.json, queue.json, hub.log).
  - Don't forward this port on the router.

TRY IT ON ANY COMPUTER
  node pc/hub/hub.js --data ./hubdata --port 8770      then open http://127.0.0.1:8770/
  Tests: node tests/pc/hub.test.js
