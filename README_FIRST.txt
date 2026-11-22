KITCHEN HUB 11 - THE WHOLE KIT
==============================
Kitchen Hub turns a Kindle into a kitchen display. Since 11.0 the brain runs on your own Windows PC: the
list, the jobs (meal plan, pantry, reminders), the fridge's weather/news/recipes package, phone alerts,
fridge updates, books and the price check. Nothing needs GitHub to run.

WHAT IS WHERE
  Install Kitchen Hub.cmd   double-click on the PC (no administrator, no password) - see pc/hub/README.txt
  Uninstall Kitchen Hub.cmd stops it and removes it from startup (your data stays)
  pc/hub/                   the hub and its control panel (phone layout + desktop mode)
  cloud/                    the jobs the hub runs (brain.js, the package builder, deals, pantry...)
  kindle/shiftcal/          the fridge: copy to extensions/shiftcal on the Kindle (first time only; after
                            that it updates itself from the PC)
  kindle/documents/         the library buttons: Display and Reset
  tests/                    checks (Linux): node tests/pc/*.test.js, KH_TESTS=$(pwd) sh tests/tNN.sh
  HISTORY.txt               every update note before 11
  UPDATE_11.*.txt           what changed in each 11.x version

PAIRING
  Fridge:  Settings > PC > PAIR WITH YOUR PC (the PC's address + the code from control panel > Devices >
           Pair a device), or paste the 3 lines from "Pair the fridge" into cloud.conf.
  Phone:   control panel > Devices > Pair a device, scan the code. With Tailscale for away from home.

STILL HERE FROM BEFORE 11 (until you switch the GitHub cloud off)
  index.html, extra*.js, hubdata.js, sw.js, tv.html, tvctl.js, manifest.json, photos/   the old phone app and
  TV page on GitHub Pages;  .github/   the old cloud brain;  GITHUB_SETUP.txt   how that was set up.
