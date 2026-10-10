#!/bin/bash
B=/opt/remote-os/bench; OUT=/tmp/rob-extra2.jsonl; : > $OUT; DUR=15
Xvfb :7 -screen 0 1280x720x24 -nolisten tcp -dpi 96 >/dev/null 2>&1 & XP=$!; sleep 2
run() { python3 $B/bench.py "$@" 2>&1 | grep -E "RESULT|ERROR" | sed 's/^RESULT //' >> $OUT; }
for mode in idle full; do pkill -f rob-chr; sleep 1
  DISPLAY=:7 chromium-browser --user-data-dir=/tmp/rob-chr --no-first-run --no-default-browser-check --disable-gpu --ozone-platform=x11 \
    --kiosk --window-position=0,0 --window-size=1280,720 --password-store=basic "file://$B/anim.html#$mode" >/dev/null 2>&1 & sleep 7
  CONV='videoconvert ! video/x-raw,format=I420' run :7 1280 720 30 2500 ultrafast $DUR "$mode:native720-convert-only"
  CONV='videoconvert ! video/x-raw,format=I420' run :7 1280 720 30 2500 superfast $DUR "$mode:native720-convert-only"
  ENC='identity name=enc' CONV='videoconvert ! video/x-raw,format=I420' run :7 1280 720 30 0 x $DUR "$mode:native720-convert-noenc"
done
pkill -f rob-chr; kill $XP; sleep 1; rm -rf /tmp/rob-chr; echo DONE >> $OUT
