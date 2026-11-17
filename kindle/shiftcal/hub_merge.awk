# Kitchen Hub store merge for BusyBox awk - must give byte-identical results to HubData.merge().
# usage: awk -v nows=<epoch seconds> -f hub_merge.awk file1 file2 ... | LC_ALL=C sort | cut -f2-
# Prints "<ts padded to 15 digits><TAB><line>" so a plain byte sort orders by time then id: no numeric
# sort and no shell arithmetic (both overflow on a 32-bit Kindle with 13-digit millisecond times).
BEGIN { FS = "\t"; cut = nows * 1000 - 30 * 86400000 }
{
    sub(/\r$/, "")
    if (NF != 5) next
    if ($1 !~ /^(0|[1-9][0-9]*)$/ || length($1) > 15) next
    if ($2 !~ /^[A-Za-z0-9._-]+$/ || length($2) > 64) next
    if ($3 !~ /^[a-z0-9:_-]+$/ || length($3) > 32) next
    if ($5 ~ /[[:cntrl:]]/) next
    if ($4 != "open" && $4 != "done" && $4 != "del") next
    id = $2; ts = $1 + 0
    if (!(id in bt) || ts > bt[id] || (ts == bt[id] && $0 > bl[id])) { bt[id] = ts; bl[id] = $0; bs[id] = $4; bk[id] = $1 }
}
END {
    for (id in bt) {
        if (bs[id] == "del" && bt[id] < cut) continue
        k = bk[id]; while (length(k) < 15) k = "0" k
        print k "\t" bl[id]
    }
}
