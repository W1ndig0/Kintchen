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
Every line should say PASS.
