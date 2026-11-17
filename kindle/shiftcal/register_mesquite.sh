#!/bin/sh
# Registers the hub as a WAF app. v9.2: when PILLOW_DISABLE=1 in eco.conf the app is registered
# without the default status bar, so the hub window can use the whole screen.
DB="/var/local/appreg.db"
APP_ID="com.custom.kitchenhub"
DIR="/mnt/us/extensions/shiftcal"
LOG="$DIR/hub.log"
PILLOW_DISABLE=2
[ -f "$DIR/eco.conf" ] && . "$DIR/eco.conf"

command -v sqlite3 >/dev/null 2>&1 || exit 0
[ -f "$DB" ] || exit 0

if [ "$PILLOW_DISABLE" != "0" ]; then
    PILLOW_SQL="DELETE FROM properties WHERE handlerId='$APP_ID' AND name='pillowId';"
else
    PILLOW_SQL="INSERT OR REPLACE INTO properties (handlerId, name, value) VALUES('$APP_ID', 'pillowId', 'default_status_bar');"
fi
SQL="
PRAGMA busy_timeout=3000;
INSERT OR REPLACE INTO handlerIds VALUES('$APP_ID');
INSERT OR REPLACE INTO properties (handlerId, name, value) VALUES('$APP_ID', 'lipcId', '$APP_ID');
INSERT OR REPLACE INTO properties (handlerId, name, value) VALUES('$APP_ID', 'appType', 'waf');
INSERT OR REPLACE INTO properties (handlerId, name, value) VALUES('$APP_ID', 'url', 'file:///mnt/us/extensions/shiftcal/mesquite/index.html');
INSERT OR REPLACE INTO properties (handlerId, name, value) VALUES('$APP_ID', 'command', '/usr/bin/mesquite -l $APP_ID -c file:///mnt/us/extensions/shiftcal/mesquite/ -j');
INSERT OR REPLACE INTO properties (handlerId, name, value) VALUES('$APP_ID', 'supportedOrientation', 'U');
INSERT OR REPLACE INTO properties (handlerId, name, value) VALUES('$APP_ID', 'unloadPolicy', 'unloadOnPause');
$PILLOW_SQL
"
TRIES=0
while [ "$TRIES" -lt 4 ]; do
    ERR=$(sqlite3 "$DB" "$SQL" 2>&1)
    RC=$?
    [ "$RC" -eq 0 ] && exit 0
    TRIES=$((TRIES + 1))
    echo "$(date '+%m-%d %H:%M:%S') register_mesquite: sqlite3 rc=$RC try=$TRIES err=$ERR" >> "$LOG"
    sleep 1
done
exit 1
