#!/bin/bash
# runs as user agent
B=/opt/remote-os/bench; OUT=/tmp/rob-results.jsonl; : > $OUT
DUR=15
start_x() { Xvfb $1 -screen 0 ${2}x24 -nolisten tcp -dpi 96 >/dev/null 2>&1 & echo $! > /tmp/rob-xvfb$1.pid; sleep 2; }
start_chr() { # disp WxH mode
  pkill -f "rob-chr" ; sleep 1
  DISPLAY=$1 chromium-browser --user-data-dir=/tmp/rob-chr --no-first-run --no-default-browser-check --disable-gpu --ozone-platform=x11 \
    --kiosk --window-position=0,0 --window-size=${2/x/,} --password-store=basic "file://$B/anim.html#$3" >/dev/null 2>&1 &
  sleep 7; }
run() { python3 $B/bench.py "$@" 2>&1 | grep RESULT | sed 's/^RESULT //' >> $OUT; }
mj()  { python3 $B/mjpeg.py "$@" 2>&1 | grep RESULT | sed 's/^RESULT //' >> $OUT; }
# real desktop :1 (whatever is on it), passive capture only
for pr in ultrafast superfast; do run :1 1280 720 30 2500 $pr $DUR "real:1"; done
mj :1 1600x900 800:450 $DUR "real:1"
# :8 1600x900 (same geometry as :1) for 720p30
start_x :8 1600x900
for mode in idle box full; do start_chr :8 1600x900 $mode
  for pr in ultrafast superfast; do run :8 1280 720 30 2500 $pr $DUR "$mode"; done
  mj :8 1600x900 800:450 $DUR "$mode"
done
pkill -f rob-chr; kill $(cat /tmp/rob-xvfb:8.pid)
# :9 1920x1080 native for 1080p
start_x :9 1920x1080
for mode in idle box full; do start_chr :9 1920x1080 $mode
  for pr in ultrafast superfast; do run :9 1920 1080 30 4500 $pr $DUR "$mode"; run :9 1920 1080 60 7000 $pr $DUR "$mode"; done
done
pkill -f rob-chr; kill $(cat /tmp/rob-xvfb:9.pid); rm -rf /tmp/rob-chr
echo DONE >> $OUT
