Kitchen Hub test harness (10.5). Runs the real launcher, loop, stop script and updater on a Linux PC with
fake Kindle commands (stub/: app manager, page process, pidof, upstart) and canned web answers (fake/).
Needs: sh, busybox, python3, curl, node.  From this folder:
   KH_TESTS=$(pwd) sh t1.sh     launch: exactly one app start
   KH_TESTS=$(pwd) sh t2.sh     wake cycles, page closing, relaunch, stop
   KH_TESTS=$(pwd) sh t3.sh     double tap, repeated request, stuck loop, silent page
   KH_TESTS=$(pwd) sh t6.sh     double taps at different timings
   KH_TESTS=$(pwd) sh t7.sh     updater exit codes, rollback, tampered download
   KH_TESTS=$(pwd) sh t8.sh     update through the loop, half-installed version undone
   KH_TESTS=$(pwd) busybox sh t9.sh   sync with canned feeds, data.js parses
   KH_TESTS=$(pwd) sh t10.sh    smart wake schedule (10.6)
   KH_TESTS=$(pwd) busybox sh t11.sh  when the log goes to the cloud gist (10.7)
   node cloud/deals.test.js     deals: wishlist, similar, broader fill (10.7)
   node cloud/week.test.js      big this week: releases, headlines, related deals (10.7)
   python3 whatsnew_gen.py 10.7 rebuild mesquite/whatsnew.js from UPDATE_10.7.txt
Every line should say PASS.
