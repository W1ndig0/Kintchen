#!/bin/sh
# Puts back all 20 original Kindle screensaver images saved by the "E-Ink + Covers" standby mode.
SS_DIR="/usr/share/blanket/screensaver"
BACKUP_DIR="/mnt/us/hub/backup/screensaver"
LOG="/mnt/us/extensions/shiftcal/power.log"
log() { echo "$(date '+%m-%d %H:%M:%S') [restore] $*" >> "$LOG"; }
[ -d "$BACKUP_DIR" ] || { log "no backups in $BACKUP_DIR - nothing to restore"; exit 1; }
mntroot rw || { log "mntroot rw failed"; exit 1; }
N=0
for F in "$BACKUP_DIR"/bg_ss*.png; do [ -f "$F" ] && cp "$F" "$SS_DIR/" && N=$((N+1)); done
mntroot ro
# stop the loop from overwriting them again
CONF="/mnt/us/extensions/shiftcal/eco.conf"
[ -f "$CONF" ] && sed -i 's/^SCREENSAVER_MODE=eips_slots/SCREENSAVER_MODE=eips/' "$CONF"
log "restored $N original screensavers; standby picture set back to E-Ink only"
