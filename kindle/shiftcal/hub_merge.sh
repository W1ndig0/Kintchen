#!/bin/sh
# hub_merge.sh OUT IN1 [IN2 ...]  - canonical merge of Kitchen Hub store files into OUT (OUT may be an input)
HERE=$(dirname "$0")
OUT=$1; shift
TMP="$OUT.m$$"
{
    echo "#hub v1"
    awk -v nows="$(date +%s)" -f "$HERE/hub_merge.awk" "$@" 2>/dev/null | LC_ALL=C sort | cut -f2-
} > "$TMP" && mv "$TMP" "$OUT"
