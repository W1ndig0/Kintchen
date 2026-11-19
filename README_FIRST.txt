KITCHEN HUB 10.5 - THE WHOLE KIT
This is a complete kit (not just the changed files): upload all of it to GitHub, replacing what is
there, including the .github folder. Read UPDATE_10.5.txt first - it says how to put 10.5 on the fridge
over USB once, since the fridge may still be running a mix of older files.

WHAT IS WHERE
  index.html, extra*.js, hubdata.js, sw.js, tv.html, manifest.json   the phone app and TV page
  cloud/                    the cloud brain (runs on GitHub Actions)
  kindle/shiftcal/          the fridge: copy this folder to extensions/shiftcal on the Kindle
  kindle/documents/         the library buttons: copy to the Kindle's documents folder
                            (Display, Stats, Kill Background, Soft Reset, Reset)
  kindle/manifest.txt       what the fridge downloads when it updates itself (GitHub rebuilds it)
  pc/                       the PC tool (kh.cmd, kh.ps1)
  tests/                    checks for the launcher, loop and updater on a Linux PC (not needed on
                            the fridge or the website; see tests/README.txt)

BEFORE YOU UPLOAD: GitHub secret HUB_PASS must equal PASSPHRASE in cloud.conf (see UPDATE_10.4.txt).
Never put your real passphrase in cloud.conf.example - the repo is public.

NEW FILES ON THE FRIDGE IN 10.5
  hub_common.sh   the one place that starts the page, stops programs and repairs system state
  stop_hub.sh     rewritten: the one way to stop the hub (used by every button and the launcher)
  cacert.pem      an up-to-date list of trusted certificates, so every download is checked
  hub_stats.sh, hub_killbg.sh, hub_softreset.sh   the diagnostics buttons, now part of the kit
