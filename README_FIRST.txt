KITCHEN HUB 10.4 - EVERYTHING THAT CHANGED
Copy these over your 10.3 kit (same folders, replace when asked). Files not in here didn't change.
Then read UPDATE_10.4.txt and upload the kit to GitHub like before.

PHONE APP
  index.html, extra.js, extra2.js, extra3.js, sw.js, hubdata.js
CLOUD BRAIN
  cloud/brain.js, books.js, extras.js, hubdata.js, pantry.js
FRIDGE (KINDLE)
  kindle/shiftcal/mesquite/index.html, mesquite/whatsnew.js
  kindle/shiftcal/power_loop.sh, hub_books.sh, cloud.conf.example, UPDATE_10.3.txt
  kindle/shiftcal/kcurl.sh (new), hub_update.sh, hub_cloud.sh, web_fetch.sh, sync_data.sh
NOTES
  UPDATE_10.4.txt, UPDATE_10.3.txt

BEFORE YOU UPLOAD: GitHub secret HUB_PASS must equal PASSPHRASE in cloud.conf (see UPDATE_10.4.txt).
Never put your real passphrase in cloud.conf.example - the repo is public.

10.4 HANG FIX (added 2026-11-18)
  kindle/manifest.txt               upload to kindle/ on your site (replaces the old one; still version 10.4)
  kindle/shiftcal/power_loop.sh     fixed: the page listener can no longer block the hub forever, and any
                                    message from a new page confirms the update (no false rollbacks)
  kindle/shiftcal/hub_reset.sh      new: saves diag.txt, then stops every part of the hub
  kindle/Kitchen Hub Reset (copy to documents).sh
                                    library button for the reset - copy to the Kindle's documents folder
                                    as "Kitchen Hub Reset.sh" (not part of the website)

SAFE LAUNCH (added 2026-11-18)
  kindle/shiftcal/run_hub.sh        new launcher: stops anything left over, then 11 launch checks with a
                                    loading bar on the Kindle screen (battery, storage, memory, files,
                                    scripts, page version, app registration, settings port). If any check
                                    fails, nothing starts: the screen says why and goes back to Home.
  kindle/shiftcal/power_loop.sh     core first: no Wi-Fi, syncs, cloud or update jobs until the page has
                                    talked to the loop; a page silent for 90 s stops everything cleanly
                                    (a fresh update is undone first) instead of locking up the Kindle.
  kindle/manifest.txt               upload again (power_loop.sh and run_hub.sh changed; still version 10.4)
