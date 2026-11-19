. $KH_TESTS/env.sh
for d in 0 0.05 0.3 1; do
  sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1 & sleep $d; sh "$HUB_DIR/run_hub.sh" eco >/dev/null 2>&1; wait; sleep 2
  echo "gap $d: starts=$(starts) loops=$(loops) pages=$(pages) doubles=$(doubles) stepped-aside=$(grep -c 'this one stops' $HUB_DIR/hub.log)"
  sh "$HUB_DIR/stop_hub.sh" >/dev/null 2>&1; : > "$KT/lipc.log"; : > "$HUB_DIR/hub.log"
done
