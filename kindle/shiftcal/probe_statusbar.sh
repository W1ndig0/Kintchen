#!/bin/sh
# Collects what is needed to remove the Kindle status bar on this firmware, and tries the 9.3 method
# while you watch. Run it from KUAL with the hub on screen, then send back statusbar_probe.txt.
OUT="/mnt/us/extensions/shiftcal/statusbar_probe.txt"
{
echo "=== status bar probe $(date) ==="
echo "--- firmware"; cat /etc/prettyversion.txt 2>/dev/null; cat /etc/version.txt 2>/dev/null | head -3
echo "--- pillow / window manager processes"; ps | grep -i -E 'pillow|awesome|mesquite|blanket' | grep -v grep
echo "--- lipc properties: pillow"; lipc-probe -a com.lab126.pillow 2>&1 | head -40
echo "--- lipc properties: winmgr"; lipc-probe -a com.lab126.winmgr 2>&1 | head -40
echo "--- lipc properties: appmgrd"; lipc-probe -a com.lab126.appmgrd 2>&1 | head -30
echo "--- tools present"; for t in xwininfo xprop xdotool wmctrl awesome-client xrandr; do printf '%s: ' "$t"; command -v "$t" || echo no; done
echo "--- X window tree"; (xwininfo -root -tree 2>&1 || echo "xwininfo not available") | head -60
echo "--- awesome clients"; (echo 'local s="" for _,c in ipairs(client.get()) do s=s..tostring(c.name).." | "..c:geometry().x..","..c:geometry().y.." "..c:geometry().width.."x"..c:geometry().height.."\n" end return s' | awesome-client 2>&1 || echo "awesome-client not available") | head -30
echo "--- appreg entry"; sqlite3 /var/local/appreg.db "select name,value from properties where handlerId='com.custom.kitchenhub';" 2>&1
echo "--- pillow files"; ls /usr/share/webkit-1.0/pillow 2>/dev/null | head -30
echo "--- trying hideMe now (watch the top of the screen for 8 s)"
lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.hideMe();"}' 2>&1; echo "rc=$?"
sleep 8
echo "--- restoring with showMe"
lipc-set-prop com.lab126.pillow interrogatePillow '{"pillowId": "default_status_bar", "function": "nativeBridge.showMe();"}' 2>&1; echo "rc=$?"
echo "=== done ==="
} > "$OUT" 2>&1
{
echo "--- 9.4: upstart"; ls /etc/upstart 2>/dev/null | grep -i -E 'pillow|x\.conf|awesome|framework|lab126_gui'; status pillow 2>&1
echo "--- 9.4: window titles"; (xwininfo -root -tree 2>&1 || wmctrl -l 2>&1) | head -40
} >> /mnt/us/extensions/shiftcal/statusbar_probe.txt 2>&1
