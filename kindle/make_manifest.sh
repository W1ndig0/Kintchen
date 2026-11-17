#!/bin/sh
# kindle/manifest.txt: what the fridge downloads when it updates itself.
# line 1: version X     then: sha256 md5 size path   (paths inside shiftcal/)
cd "$(dirname "$0")" || exit 1
V=$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' shiftcal/power_loop.sh | head -1)
{
    echo "version $V"
    find shiftcal -type f | sed 's#^shiftcal/##' | LC_ALL=C sort | while read -r F; do
        case "$F" in cloud.conf|hub.tsv|eco.conf|stocks.conf|news.conf|.*|*/.*|mesquite/data.js|mesquite/state.js|mesquite/hub_items.js|mesquite/cloud.js|mesquite/battery.js) continue ;; esac
        S=$(sha256sum "shiftcal/$F" | cut -c1-64); M=$(md5sum "shiftcal/$F" | cut -c1-32); Z=$(wc -c < "shiftcal/$F" | tr -d ' ')
        echo "$S $M $Z $F"
    done
} > manifest.txt
echo "manifest: $(($(wc -l < manifest.txt) - 1)) files, version $V"
