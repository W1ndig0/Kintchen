# 10.9: the task manager / hub-mode probe (hub_sys.sh) only looks, and its output parses. Run: KH_TESTS=$(pwd) busybox sh t16.sh
[ -n "$KH_TESTS" ] || KH_TESTS=$(pwd)
ok() { echo "PASS $*"; }; bad() { echo "FAIL $*"; }
KT=$(mktemp -d /tmp/khsys.XXXX); cp -r "$KH_TESTS/../kindle/shiftcal" "$KT/hub"; mkdir -p "$KT/bin"
printf '#!/bin/sh\n[ "$1" = list ] || { echo "CHANGED $*" >> "%s/changes"; exit 0; }\nprintf "powerd start/running, process 12\\nindexer stop/waiting\\nweird<name> start/running\\n"\n' "$KT" > "$KT/bin/initctl"
for C in start stop restart; do printf '#!/bin/sh\necho "CHANGED %s $*" >> "%s/changes"\n' "$C" "$KT" > "$KT/bin/$C"; done
chmod +x "$KT/bin/"*
T0=$(date +%s); PATH="$KT/bin:$PATH" HUB_DIR="$KT/hub" sh "$KT/hub/hub_sys.sh"; T1=$(date +%s)
[ $((T1 - T0)) -le 6 ] && ok "probe took $((T1 - T0)) s" || bad "probe took $((T1 - T0)) s"
node -e 'global.window = {}; eval(require("fs").readFileSync(process.argv[1], "utf8")); const s = window.HUB_SYS;
  if (!(s.cpu >= 0 && s.cpu <= 100 && s.memTotal > 0 && s.top.length > 0)) process.exit(1);
  if (JSON.stringify(s.svc) !== JSON.stringify([["indexer",0],["powerd",1],["weirdname",1]])) { console.log(JSON.stringify(s.svc)); process.exit(2); }' "$KT/hub/mesquite/sys.js" && ok "sys.js parses: cpu, memory, processes, services (odd names cleaned)" || bad "sys.js: $(head -c 300 "$KT/hub/mesquite/sys.js")"
grep -q 'services (2 running of 3)' "$KT/hub/.sysprobe.txt" && ok "plain-text probe for the cloud log" || bad "probe text: $(cat "$KT/hub/.sysprobe.txt" | tail -2)"
[ ! -f "$KT/changes" ] && ok "nothing was started, stopped or changed" || bad "the probe changed something: $(cat "$KT/changes")"
rm -rf "$KT"
