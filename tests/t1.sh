. $KH_TESTS/env.sh
sh "$HUB_DIR/run_hub.sh" eco; echo "run_hub rc=$?"
sleep 2; echo "ping reply: $(ping_page vp=1236x1648)"; sleep 4
echo "RESULT starts=$(starts) doubles=$(doubles) loops=$(loops) pages=$(pages)"
echo "--- hub.log"; tail -22 "$HUB_DIR/hub.log"; echo "--- power.log"; cat "$HUB_DIR/power.log"
echo "$KT" > /tmp/kh_last
