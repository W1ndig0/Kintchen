#!/bin/sh
# Kitchen Hub background sync: weather + news (with photos) + markets + On This Day -> mesquite/data.js
# 10.5: a time budget (SYNC_BUDGET, 240 s) - the slow extras are skipped once it is used up, so a bad
# network can't keep Wi-Fi on for 10+ minutes; the last good weather and news are kept when a fetch
# fails; news.conf saved on Windows works; photos are capped at 3 MB and the ones in use are kept.
# Called by power_loop.sh with Wi-Fi already up. Everything lands in one atomic data.js write.
#
# v9.2 fixes: photos from CBC (single-quoted src) now found; image names are md5-based (no collisions);
# a story without a photo no longer inherits the previous story's photo; downloads are checked for a
# real JPEG/PNG/GIF header; markets send raw numbers (the page formats them); On This Day rotates daily.
DIR="${HUB_DIR:-/mnt/us/extensions/shiftcal}"
MESQ="$DIR/mesquite"
DATA_JS="$MESQ/data.js"
IMG_DIR="$MESQ/img"
TMP="$DIR/.data.tmp"
LOG="$DIR/sync.log"
STOCKS_CONF="$DIR/stocks.conf"
MAX_NEW_IMAGES=8

export TZ="PCT7"
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 50000 ] && tail -n 150 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exec >> "$LOG" 2>&1
echo "=== sync at $(date) ==="

CURL="${CURL_BIN:-/usr/bin/curl}"
[ -x "$CURL" ] || CURL="curl"
[ -f "$DIR/kcurl.sh" ] && . "$DIR/kcurl.sh"; command -v kcurl >/dev/null 2>&1 || kcurl() { "$CURL" "$@"; }     # 10.5: never unchecked when kcurl.sh is missing
mkdir -p "$IMG_DIR" 2>/dev/null
rm -f "$IMG_DIR"/*.part 2>/dev/null          # 10.5: left over from a sync that was cut off
SYNC_T0=$(date +%s)
over() { [ $(( $(date +%s) - SYNC_T0 )) -ge "${SYNC_BUDGET:-240}" ]; }
IMGMAX="--max-filesize 3000000"

# ---------- 10.0: deals, money, pantry and fun from the cloud brain (one small locked file; the page unlocks it)
if [ "$1" != "search" ] && [ -z "$CLOUD_BUNDLE" ] && [ -s "$DIR/.cloud_links" ]; then
    XU=$(sed -n 's/^EXTRA_URL=\(https*:[^ ]*\)$/\1/p' "$DIR/.cloud_links" | head -1)
    if [ -n "$XU" ] && ( KC_STRICT=1; kcurl -s --connect-timeout 6 --max-time 25 -o "$MESQ/extra.js.part" "$XU?t=$(date +%s)" 2>/dev/null ) && head -c 26 "$MESQ/extra.js.part" | grep -q '^window.HUB_EXTRA_LOCKED'; then
        mv "$MESQ/extra.js.part" "$MESQ/extra.js"; echo "Extras: deals/money/fun updated"
    else rm -f "$MESQ/extra.js.part"; fi
fi

# ---------- 9.8.5: cloud data. The GitHub Action already fetched weather, news, what's on, recipes and
# horoscopes into ONE file (bundle.txt in your cloud gist). One download instead of ~25 = Wi-Fi off sooner.
# Falls through to the normal fetches below when it's missing, broken or older than 2 hours.
if [ "$1" != "search" ] && [ -z "$CLOUD_BUNDLE" ] && [ "${USE_CLOUD_DATA:-1}" = "1" ] && [ -s "$DIR/.cloud_links" ]; then
    BU=$(sed -n 's/^BUNDLE_URL=\(https*:[^ ]*\)$/\1/p' "$DIR/.cloud_links" | head -1)
    BP="$DIR/.bundle.part"; rm -f "$BP"
    if [ -n "$BU" ] && ( KC_STRICT=1; kcurl -s --max-filesize 20000000 --connect-timeout 6 --max-time 45 -o "$BP" "$BU?t=$(date +%s)" 2>/dev/null ) &&
       head -1 "$BP" | grep -q '^@@KH-BUNDLE [0-9][0-9]*$' && tail -1 "$BP" | grep -q '^@@END$'; then
        BTS=$(head -1 "$BP" | cut -d' ' -f2); AGE=$(( $(date +%s) - BTS ))
        if [ "$AGE" -lt 7200 ] && [ "$AGE" -gt -900 ]; then
            mkdir -p "$MESQ/rcp"
            awk -v D="$MESQ" '
                /^@@FILE / { if (f != "") close(f); p = substr($0, 8); f = ""
                             if (p ~ /^mesquite\/(data|whatson|rfeed|horo)\.js$/ || p ~ /^mesquite\/rcp\/[0-9a-z]+\.js$/) { f = D "/" substr(p, 10) ".new"; printf "" > f; print f > (D "/.bundle_list") }
                             next }
                /^@@(IMG|END|KH-BUNDLE)/ { if (f != "") close(f); f = ""; next }
                { if (f != "") print > f }' "$BP"
            NF=0
            while read -r F; do [ -s "$F" ] && mv "$F" "${F%.new}" && NF=$((NF + 1)); rm -f "$F"; done < "$MESQ/.bundle_list"
            rm -f "$MESQ/.bundle_list"
            NI=0
            grep '^@@IMG img/[0-9a-z]*\.\(jpg\|png\|gif\) http' "$BP" | while read -r X P U; do
                [ -f "$MESQ/$P" ] && { touch "$MESQ/$P"; continue; }     # 10.7: still in use - keep it through the trim
                [ "$NI" -ge 12 ] && break
                kcurl -sL $IMGMAX --connect-timeout 4 --max-time 10 -A "Mozilla/5.0" -o "$MESQ/$P.part" "$U" 2>/dev/null
                SIG=$(od -An -tx1 -N4 "$MESQ/$P.part" 2>/dev/null | tr -d ' \n')
                case "$SIG" in ffd8*|89504e47|47494638) mv "$MESQ/$P.part" "$MESQ/$P"; NI=$((NI + 1)) ;; *) rm -f "$MESQ/$P.part" ;; esac
            done
            ls -1t "$MESQ/rcp" 2>/dev/null | tail -n +61 | while read F; do rm -f "$MESQ/rcp/$F"; done
            COUNT=$(ls -1 "$IMG_DIR" 2>/dev/null | wc -l)
            [ "$COUNT" -gt 60 ] && ls -1t "$IMG_DIR" | tail -n +61 | while read F; do rm -f "$IMG_DIR/$F"; done     # 10.7: news + deal photos
            rm -f "$BP"; date +%s > "$DIR/.cloud_data_at"
            echo "Cloud data: $NF files from the cloud brain ($((AGE / 60)) min old) - skipped the direct fetches"
            exit 0
        fi
        echo "Cloud data: bundle is $((AGE / 60)) min old - fetching directly"
    else
        [ -n "$BU" ] && echo "Cloud data: no bundle - fetching directly"
    fi
    rm -f "$BP"
fi

jesc() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# ---------- Weather (raw Open-Meteo JSON embedded as-is) ----------
WX_JSON="null"
W_URL="https://api.open-meteo.com/v1/forecast?latitude=53.9171&longitude=-122.7497&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,snowfall_sum,precipitation_probability_max&timezone=Etc%2FGMT%2B7&forecast_days=5"
W_RAW=""; [ "$1" = "search" ] || W_RAW=$(kcurl -s --connect-timeout 6 --max-time 12 "$W_URL" | tr '\r\n' '  ')
# 10.9.3: a download cut off by --max-time still contains "hourly" and "daily" but isn't whole JSON, and went
# into data.js as-is (data.js then fails to load: no weather, no news). Only a reply that ends with } counts.
case "$W_RAW" in *"}"|*"} "|*"}  ") ;; *) W_RAW="" ;; esac
case "$W_RAW" in
    "{"*'"hourly"'*'"daily"'*) WX_JSON="$W_RAW"; echo "Weather synced"; printf '%s' "$W_RAW" > "$DIR/.wx_cache" ;;
    *) if [ "$1" != "search" ] && [ -s "$DIR/.wx_cache" ] && [ $(( $(date +%s) - $(date -r "$DIR/.wx_cache" +%s 2>/dev/null || echo 0) )) -lt 21600 ]; then
           WX_JSON=$(cat "$DIR/.wx_cache"); echo "Weather fetch failed - kept the last forecast"
           case "$WX_JSON" in "{"*"}"|"{"*"} "|"{"*"}  ") ;; *) WX_JSON="null" ;; esac     # 10.9.3: never a cut-off cache
       else [ "$1" = "search" ] || echo "Weather fetch failed"; fi ;;
esac

# ---------- News + photos ----------
ARTS=""
ACOUNT=0
IMGS_NEW=0

tag() { sed -n "s#.*<$1[^>]*>\(.*\)</$1>.*#\1#p" | head -1; }
clean() {
    sed -e 's#<!\[CDATA\[##g' -e 's#\]\]>##g' \
        -e 's#</p>#@@P@@#g' -e 's#</div>#@@P@@#g' -e 's#<br */\{0,1\}>#@@P@@#g' \
        -e 's#<[^>]*>##g' -e 's/  */ /g'
}
# first image for an RSS item: <enclosure type=image>, <media:content>, <media:thumbnail>, then <img src=...>
# (CBC writes src='...' with single quotes, WordPress feeds use double quotes - both handled)
extract_image_url() {
    R=$(printf '%s' "$1" | sed -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&quot;/"/g' -e "s/&#039;/'/g")
    for PAT in \
        's#.*<enclosure[^>]*url="\([^"]*\)"[^>]*type="image[^"]*".*#\1#p' \
        's#.*<media:content[^>]*url="\([^"]*\)".*#\1#p' \
        's#.*<media:thumbnail[^>]*url="\([^"]*\)".*#\1#p' \
        's#.*<img[^>]*src="\([^"]*\)".*#\1#p' \
        "s#.*<img[^>]*src='\([^']*\)'.*#\1#p"
    do
        U=$(printf '%s' "$R" | sed -n "$PAT" | head -1)
        case "$U" in http*) echo "$U" | sed 's/&amp;/\&/g'; return ;; esac
    done
}
url_hash() {
    H=$(printf '%s' "$1" | md5sum 2>/dev/null | cut -c1-12)
    [ -z "$H" ] && H=$(printf '%s' "$1" | cksum | awk '{print $1}')
    echo "$H"
}
# prints jpg/png/gif from the file's first bytes, nothing if it is not an image
img_ext() {
    SIG=$(od -An -tx1 -N4 "$1" 2>/dev/null | tr -d ' \n')
    case "$SIG" in ffd8*) echo jpg ;; 89504e47) echo png ;; 47494638) echo gif ;; esac
}

add_feed() {  # $1=url  $2=source tag  $3=max items
    over && { echo "No time left for $2"; return; }
    S_J=$(printf '%s' "$2" | tr -d '\r' | jesc)      # 10.5: the source name comes from news.conf
    RAW=$(kcurl -sL -A "Mozilla/5.0" --connect-timeout 6 --max-time 15 "$1")
    case "$RAW" in *"<item"*) ;; *) echo "No items from $2"; return ;; esac
    N=0; WITH_IMG=0
    ITEMS=$(printf '%s' "$RAW" | tr '\r\n\t' '   ' | sed 's#</item>#\
#g' | grep '<item')
    OLDIFS="$IFS"; IFS='
'
    for LINE in $ITEMS; do
        [ "$N" -ge "$3" ] && break
        L=$(printf '%s' "$LINE" | sed 's#^.*<item[ >]##')
        T=$(printf '%s' "$L" | tag title | clean | sed 's/@@P@@/ /g' | jesc)
        [ "${#T}" -lt 8 ] && continue
        P=$(printf '%s' "$L" | tag pubDate | clean | jesc)
        K=$(printf '%s' "$L" | tag link | clean | jesc)
        B=$(printf '%s' "$L" | tag 'content:encoded')
        [ -z "$B" ] && B=$(printf '%s' "$L" | tag description)
        IMG_URL=$(extract_image_url "$L")
        B=$(printf '%s' "$B" | clean | cut -c1-3000 | jesc)
        IMG_FIELD=""; IMG_PATH=""
        if [ -n "$IMG_URL" ]; then
            HASH=$(url_hash "$IMG_URL")
            if [ -n "$HASH" ]; then
                for E in jpg png gif; do [ -f "$IMG_DIR/$HASH.$E" ] && { IMG_PATH="img/$HASH.$E"; touch "$IMG_DIR/$HASH.$E"; }; done     # 10.5: in use = newest
                if [ -z "$IMG_PATH" ] && [ "$IMGS_NEW" -lt "$MAX_NEW_IMAGES" ]; then
                    PART="$IMG_DIR/$HASH.part"
                    kcurl -sL $IMGMAX --connect-timeout 4 --max-time 10 -A "Mozilla/5.0" -o "$PART" "$IMG_URL" 2>/dev/null
                    E=$(img_ext "$PART")
                    if [ -n "$E" ]; then mv "$PART" "$IMG_DIR/$HASH.$E"; IMG_PATH="img/$HASH.$E"; IMGS_NEW=$((IMGS_NEW+1))
                    else rm -f "$PART"; fi
                fi
            fi
        fi
        [ -n "$IMG_PATH" ] && { IMG_FIELD=",\"img\":\"$IMG_PATH\""; WITH_IMG=$((WITH_IMG+1)); [ -n "$CLOUD_BUNDLE" ] && echo "$IMG_PATH $IMG_URL" >> "$DIR/.img_urls"; }
        [ -n "$ARTS" ] && ARTS="$ARTS,"
        ARTS="$ARTS{\"s\":\"$S_J\",\"t\":\"$T\",\"p\":\"$P\",\"l\":\"$K\",\"b\":\"$B\"$IMG_FIELD}"
        N=$((N+1)); ACOUNT=$((ACOUNT+1))
    done
    IFS="$OLDIFS"
    echo "News from $2: $N items ($WITH_IMG with photos)"
}

feed_into() {   # $1=url $2=tag $3=max -> JSON objects in $FEED_OUT (reuses add_feed without touching the news)
    SAVE_A="$ARTS"; SAVE_N=$ACOUNT; ARTS=""
    add_feed "$1" "$2" "$3" >/dev/null 2>&1
    FEED_OUT="$ARTS"; ARTS="$SAVE_A"; ACOUNT=$SAVE_N
}
# recipe cards (JSON-LD) for every link in $1, at most $2 new downloads; prints the "link":"id" index
fetch_cards() {
    mkdir -p "$MESQ/rcp"; NEWLD=0; IDX=""
    set -f      # 10.5: links contain ? and * - never expand them as file names
    for L in $(printf '%s' "$1" | grep -o '"l":"[^"]*"' | sed 's/^"l":"//; s/"$//'); do
        over && break
        H=$(url_hash "$L")
        if [ ! -f "$MESQ/rcp/$H.js" ] && [ "$NEWLD" -lt "$2" ]; then
            PG_HTML=$(kcurl -sL --connect-timeout 5 --max-time 15 -A "Mozilla/5.0" "$L" | tr '\r\n\t' '   ')
            LD=$(printf '%s' "$PG_HTML" | sed 's#<script#\
<script#g' | grep -i 'application/ld+json' | grep 'recipeIngredient' | head -1 | sed 's#^<script[^>]*>##; s#</script>.*##')
            [ -n "$LD" ] && { printf 'window.RCPLD=window.RCPLD||{};window.RCPLD["%s"]=%s;\n' "$H" "$LD" > "$MESQ/rcp/$H.js"; NEWLD=$((NEWLD + 1)); }
        fi
        [ -f "$MESQ/rcp/$H.js" ] && { [ -n "$IDX" ] && IDX="$IDX,"; IDX="$IDX\"$L\":\"$H\""; }
    done
    set +f
    echo "$IDX"
}
RECIPE_SITES="https://www.recipetineats.com/|RECIPETIN https://www.budgetbytes.com/|BUDGET_BYTES https://cookieandkate.com/|COOKIE+KATE"
# ---- 9.8: recipe search (WordPress sites answer ?s=word&feed=rss2 with matching posts) ----
if [ "$1" = "search" ]; then
    Q=$(printf '%s' "$2" | tr -cd 'A-Za-z0-9 -' | cut -c1-40)
    QU=$(printf '%s' "$Q" | sed 's/ /+/g')
    echo "=== recipe search: $Q ==="
    RF=""
    for SRC in $RECIPE_SITES; do
        feed_into "${SRC%%|*}?s=$QU&feed=rss2" "$(echo "${SRC#*|}" | tr '_' ' ')" 5
        [ -n "$FEED_OUT" ] && { [ -n "$RF" ] && RF="$RF,"; RF="$RF$FEED_OUT"; }
    done
    IDX=$(fetch_cards "$RF" 8)
    QJ=$(printf '%s' "$Q" | jesc)
    echo "window.HUB_RSEARCH={q:\"$QJ\",ts:$(date +%s),items:[$RF],ld:{$IDX}};" > "$MESQ/rsearch.js.tmp" && mv "$MESQ/rsearch.js.tmp" "$MESQ/rsearch.js"
    echo "recipe search: $(printf '%s' "$RF" | grep -o '"t":' | wc -l) results"
    exit 0
fi
# ---- 9.8: smart sync - each source on its own schedule; quiet small hours ----
due() {   # $1=name $2=minutes -> true when that source is due (and stamps it)
    F="$DIR/.due_$1"; NOWD=$(date +%s)
    if [ -f "$F" ] && [ $((NOWD - $(cat "$F" 2>/dev/null || echo 0))) -lt $(( $2 * 60 - 120 )) ]; then return 1; fi
    echo "$NOWD" > "$F"; return 0
}
HOUR=$(date +%H | sed 's/^0//'); [ -z "$HOUR" ] && HOUR=0
DOW=$(date +%u)
NIGHT=0; [ -z "$CLOUD_BUNDLE" ] && [ "$HOUR" -lt 5 ] && NIGHT=1     # the cloud has no battery: no quiet hours there
# news sources from Settings (news.conf: url|tag|max per line)
NEWS_CONF="$DIR/news.conf"
if [ "$NIGHT" = "1" ] && ! due news_night 180; then
    echo "News: quiet hours (kept the last stories)"
else
    if [ -s "$NEWS_CONF" ]; then
        tr -d '\r' < "$NEWS_CONF" > "$DIR/.news_conf.lf"      # 10.5: a news.conf saved on Windows
        while IFS='|' read -r NU NT NM; do NM=$(printf '%s' "$NM" | tr -cd '0-9'); case "$NU" in http*) add_feed "$NU" "$NT" "${NM:-6}" ;; esac; done < "$DIR/.news_conf.lf"
        rm -f "$DIR/.news_conf.lf"
    else
        add_feed "https://ckpgtoday.ca/feed/" "CKPG" 8
        add_feed "https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia" "CBC BC" 6
    fi
fi
echo "New photos downloaded: $IMGS_NEW"
# 10.5: no stories this time (every feed failed) - keep the last ones instead of an empty news tile
if [ "$ACOUNT" -gt 0 ]; then printf '%s' "$ARTS" > "$DIR/.arts_cache"; printf '%s' "$ACOUNT" > "$DIR/.arts_count"
elif [ -s "$DIR/.arts_cache" ]; then ARTS=$(cat "$DIR/.arts_cache"); ACOUNT=$(cat "$DIR/.arts_count" 2>/dev/null | tr -cd '0-9'); ACOUNT=${ACOUNT:-1}; echo "News: kept the last $ACOUNT stories"; fi

# ---------- Markets (Yahoo chart endpoint; symbols in stocks.conf as SYMBOL:LABEL) ----------
STOCKS_JSON="[]"
MKT_OPEN=0; [ "$DOW" -le 5 ] && [ "$HOUR" -ge 6 ] && [ "$HOUR" -le 14 ] && MKT_OPEN=1
SKIP_MKT=0
if [ "$MKT_OPEN" = "0" ] && [ -s "$DIR/.stocks_cache" ] && ! due markets_closed 360; then SKIP_MKT=1; STOCKS_JSON=$(cat "$DIR/.stocks_cache"); echo "Markets: closed (kept the last prices)"; fi
SYMBOLS="^GSPC:S&P ^IXIC:NDX ^GSPTSE:TSX BTC-USD:BTC"
if [ -f "$STOCKS_CONF" ]; then
    LINES=$(grep -v '^[[:space:]]*#' "$STOCKS_CONF" | grep -v '^[[:space:]]*$' | tr -d '\r')
    [ -n "$LINES" ] && SYMBOLS=$(printf '%s' "$LINES" | tr '\n' ' ')
fi
ST=""
[ "$SKIP_MKT" = "1" ] && SYMBOLS=""
over && { SYMBOLS=""; [ -s "$DIR/.stocks_cache" ] && STOCKS_JSON=$(cat "$DIR/.stocks_cache"); echo "Markets: no time left (kept the last prices)"; }
set -f
for PAIR in $SYMBOLS; do
    SYM=${PAIR%%:*}; LBL=${PAIR#*:}
    [ "$LBL" = "$PAIR" ] && LBL="$SYM"
    SYM_ENC=$(echo "$SYM" | sed -e 's/\^/%5E/g' -e 's/=/%3D/g')
    RESP=$(kcurl -s --connect-timeout 4 --max-time 8 -A "Mozilla/5.0" "https://query1.finance.yahoo.com/v8/finance/chart/${SYM_ENC}?range=1d&interval=15m" | tr '\r\n' '  ')
    PRICE=$(printf '%s' "$RESP" | sed -n 's/.*"regularMarketPrice": *\([0-9.eE+-]*\).*/\1/p' | head -1)
    PREV=$(printf '%s' "$RESP" | sed -n 's/.*"chartPreviousClose": *\([0-9.eE+-]*\).*/\1/p' | head -1)
    [ -z "$PRICE" ] && { echo "Markets: no price for $SYM"; continue; }
    [ -z "$PREV" ] && PREV="$PRICE"
    # up to 12 evenly spaced closes for the sparkline
    SPARK=$(printf '%s' "$RESP" | sed -n 's/.*"close": *\[\([^]]*\)\].*/\1/p' | head -1 | tr -d ' ' | tr ',' '\n' | grep -v '^null$' | grep -v '^$' |
            awk '{v[NR]=$1} END {n=NR; if(n<1) exit; k=(n>12)?12:n; for(i=0;i<k;i++){j=1+int(i*(n-1)/((k>1)?k-1:1)); printf "%s%s", (i?",":""), v[j]}}')
    LBL_J=$(printf '%s' "$LBL" | jesc)
    [ -n "$ST" ] && ST="$ST,"
    ST="$ST{\"sym\":\"$LBL_J\",\"price\":$PRICE,\"prev\":$PREV,\"spark\":[$SPARK]}"
done
set +f
[ -n "$ST" ] && STOCKS_JSON="[$ST]" && echo "Markets synced" && printf '%s' "$STOCKS_JSON" > "$DIR/.stocks_cache"

# ---------- On This Day (Wikipedia); one event, different each day ----------
OTD_JSON="null"
M=$(date +%m); D=$(date +%d)
if [ -s "$DIR/.otd_$M$D" ] && grep -q '^{"year":-*[0-9]*,"text":".*"}$' "$DIR/.otd_$M$D"; then OTD_JSON=$(cat "$DIR/.otd_$M$D"); OTD_RAW="cached"; else
OTD_RAW=$(kcurl -s --connect-timeout 4 --max-time 10 -A "KitchenHub/9.2" "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/$M/$D" | tr '\r\n' '  ')
case "$OTD_RAW" in
    *'"events"'*)
        EVENTS=$(printf '%s' "$OTD_RAW" | sed 's#{"text": *"#\
@@EV@@#g' | grep '^@@EV@@' | sed -n 's#^@@EV@@\(\([^"\\]\|\\.\)*\)",.*"year": *\(-\{0,1\}[0-9]*\).*#\3|\1#p')     # 10.5: text with \" in it
        CNT=$(printf '%s\n' "$EVENTS" | grep -c '|')
        if [ "$CNT" -gt 0 ]; then
            DOY=$(date +%j | sed 's/^0*//'); [ -z "$DOY" ] && DOY=1
            PICK=$(( DOY % CNT + 1 ))
            EV=$(printf '%s\n' "$EVENTS" | sed -n "${PICK}p")
            OY=${EV%%|*}; OT=${EV#*|}
            # JSON string escapes are also valid JS, so the text is embedded unchanged
            OTD_JSON="{\"year\":${OY:-0},\"text\":\"$OT\"}"
            echo "On this day: event $PICK of $CNT ($OY)"
        fi
        ;;
    *) echo "On this day: fetch failed" ;;
esac
[ "$OTD_JSON" != "null" ] && { rm -f "$DIR"/.otd_*; printf '%s' "$OTD_JSON" > "$DIR/.otd_$M$D"; }
fi

# ---------- 9.7: "what's on" (PG events, Canada + world headlines, weather + road alerts) ----------
MESQ_DIR="$MESQ"
W_PG=""; W_CA=""; W_WO=""
if [ "$NIGHT" = "0" ] && ! over && due whatson 180; then
    feed_into "https://ckpgtoday.ca/tag/events/feed/" "PG EVENTS" 6;     W_PG="$FEED_OUT"
    feed_into "https://www.cbc.ca/webfeed/rss/rss-canada" "CANADA" 6;     W_CA="$FEED_OUT"
    feed_into "https://www.cbc.ca/webfeed/rss/rss-world" "WORLD" 6;       W_WO="$FEED_OUT"
    printf '%s\n%s\n%s\n' "$W_PG" "$W_CA" "$W_WO" > "$DIR/.whatson_cache"
elif [ -f "$DIR/.whatson_cache" ]; then
    W_PG=$(sed -n 1p "$DIR/.whatson_cache"); W_CA=$(sed -n 2p "$DIR/.whatson_cache"); W_WO=$(sed -n 3p "$DIR/.whatson_cache")
fi
ALERTS=""
# Environment Canada: the Prince George forecast feed carries any active warning as its own entry
set -f
EC=$(kcurl -s --connect-timeout 5 --max-time 12 -A "KitchenHub/10.3" "https://weather.gc.ca/rss/weather/53.912_-122.776_e.xml" | tr '\r\n\t' '   ')
for T in $(printf '%s' "$EC" | sed 's#</entry>#\
#g' | grep -i 'term="Warnings and Watches"' | sed -n 's#.*<title>\([^<]*\)</title>.*#\1#p' | sed 's/ /_SP_/g'); do
    T=$(printf '%s' "$T" | sed 's/_SP_/ /g' | jesc)
    case "$T" in *"No watches or warnings"*|"") continue ;; esac
    [ -n "$ALERTS" ] && ALERTS="$ALERTS,"; ALERTS="$ALERTS{\"s\":\"WEATHER\",\"t\":\"$T\"}"
done
# DriveBC (Open511): active major/moderate events on the roads around Prince George
RD=$(kcurl -s --connect-timeout 5 --max-time 12 -A "KitchenHub/10.3" "https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&bbox=-124.0,53.4,-121.6,54.4&limit=40" | tr '\r\n\t' '   ')
NR=0
for EV in $(printf '%s' "$RD" | sed 's/"jurisdiction_url"/\
@EV@/g' | grep '^@EV@' | sed 's/ /_SP_/g'); do
    [ "$NR" -ge 4 ] && break
    EV=$(printf '%s' "$EV" | sed 's/_SP_/ /g')
    SEV=$(printf '%s' "$EV" | sed -n 's/.*"severity" *: *"\([A-Z]*\)".*/\1/p')
    case "$SEV" in MAJOR|MODERATE) ;; *) continue ;; esac
    D=$(printf '%s' "$EV" | sed -n 's/.*"description" *: *"\(\([^"\\]\|\\.\)*\)".*/\1/p' | cut -c1-220)
    [ -z "$D" ] && continue
    [ -n "$ALERTS" ] && ALERTS="$ALERTS,"; ALERTS="$ALERTS{\"s\":\"ROAD\",\"t\":\"$D\"}"; NR=$((NR + 1))
done
set +f
if [ -n "$W_PG$W_CA$W_WO$ALERTS" ]; then
    echo "window.HUB_WHATSON={ts:$(date +%s),pg:[$W_PG],canada:[$W_CA],world:[$W_WO],alerts:[$ALERTS]};" > "$MESQ_DIR/whatson.js.tmp" && mv "$MESQ_DIR/whatson.js.tmp" "$MESQ_DIR/whatson.js"
    echo "What's on: $(printf '%s' "$W_PG" | grep -o '"t":' | wc -l) PG, $(printf '%s' "$ALERTS" | grep -o '"t":' | wc -l) alerts"
fi

# ---------- 9.7: recipes from a few cooking sites (they arrive like articles) ----------
RF=""
if [ "$NIGHT" = "0" ] && ! over && due recipes 360; then
    for SRC in $RECIPE_SITES; do
        feed_into "${SRC%%|*}feed/" "$(echo "${SRC#*|}" | tr '_' ' ')" 4
        [ -n "$FEED_OUT" ] && { [ -n "$RF" ] && RF="$RF,"; RF="$RF$FEED_OUT"; }
    done
    if [ -n "$RF" ]; then
        IDX=$(fetch_cards "$RF" 6)
        echo "window.HUB_RFEED={ts:$(date +%s),items:[$RF],ld:{$IDX}};" > "$MESQ/rfeed.js.tmp" && mv "$MESQ/rfeed.js.tmp" "$MESQ/rfeed.js"
        echo "Recipes: $(printf '%s' "$RF" | grep -o '"t":' | wc -l) from the feeds"
        ls -1t "$MESQ/rcp" 2>/dev/null | tail -n +61 | while read F; do rm -f "$MESQ/rcp/$F"; done
    fi
else echo "Recipes: not due"; fi

# ---------- 9.6: daily horoscopes (once a day; the hub writes its own reading when this fails) ----------
HORO_JS="$(dirname "$DATA_JS")/horo.js"
TODAY=$(date +%Y-%m-%d)
if ! over && ! grep -q "date:\"$TODAY\"" "$HORO_JS" 2>/dev/null; then
    HS=""; HN=0
    for S in aries taurus gemini cancer leo virgo libra scorpio sagittarius capricorn aquarius pisces; do
        R=$(kcurl -s --connect-timeout 4 --max-time 8 -A "KitchenHub/9.6" "https://ohmanda.com/api/horoscope/$S/" | tr '\r\n' '  ')
        TX=$(printf '%s' "$R" | sed -n 's/.*"horoscope" *: *"\(\([^"\\]\|\\.\)*\)".*/\1/p')
        if [ -n "$TX" ]; then [ -n "$HS" ] && HS="$HS,"; HS="$HS\"$S\":\"$TX\""; HN=$((HN + 1)); fi
    done
    if [ "$HN" -ge 10 ]; then        # 10.5: a partial set is not stamped for the day, so the next sync tries again
        echo "window.HUB_HORO={date:\"$TODAY\",signs:{$HS}};" > "$HORO_JS.tmp" && mv "$HORO_JS.tmp" "$HORO_JS"
        echo "Horoscopes: $HN signs"
    else echo "Horoscopes: only $HN of 12 signs (the hub makes its own; trying again next sync)"; fi
fi

# ---------- write data.js (only if something synced) ----------
if [ "$WX_JSON" != "null" ] || [ "$ACOUNT" -gt 0 ] || [ "$STOCKS_JSON" != "[]" ]; then
    NOW_EPOCH=$(date +%s)
    SYNC_TIME=$(date +"%I:%M %p" | sed 's/^0//')
    cat > "$TMP" <<EOT
window.HUB_DATA = {
    ts: $NOW_EPOCH,
    updated: "$SYNC_TIME",
    wx: $WX_JSON,
    articles: [$ARTS],
    stocks: $STOCKS_JSON,
    onThisDay: $OTD_JSON
};
EOT
    mv "$TMP" "$DATA_JS"
    echo "data.js written ($ACOUNT stories, $(( $(date +%s) - SYNC_T0 ))s)"
fi

# ---------- keep the photo cache small: newest 40 ----------
COUNT=$(ls -1 "$IMG_DIR" 2>/dev/null | wc -l)
if [ "$COUNT" -gt 40 ]; then
    ls -1t "$IMG_DIR" | tail -n +41 | while read F; do rm -f "$IMG_DIR/$F"; done
    echo "Trimmed photo cache from $COUNT"
fi
