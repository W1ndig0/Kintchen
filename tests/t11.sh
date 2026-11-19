# 10.7: when the loop sends the log to the cloud gist (daily, and after something went wrong). Run with busybox sh.
D=$(mktemp -d); DIR=$D
eval "$(sed -n '/^log_due() {/,/^}/p' $KH_TESTS/../kindle/shiftcal/power_loop.sh)"
ok() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fi; }
ok "never uploaded -> due" 'log_due'
date +%s > $D/.log_up_at
ok "just uploaded -> not due" '! log_due'
echo $(( $(date +%s) - 90000 )) > $D/.log_up_at
ok "25 h ago -> due" 'log_due'
date +%s > $D/.log_up_at
echo "rolled back 10.7 11-19 03:00" >> $D/.log_want
ok "after a rollback -> due" 'log_due'
rm -f $D/.log_want; sleep 1; echo "the page did not start" > $D/.boot_fail
ok "page failed after the last upload -> due" 'log_due'
sleep 1; date +%s > $D/.log_up_at
ok "failure already sent -> not due" '! log_due'
rm -rf $D
