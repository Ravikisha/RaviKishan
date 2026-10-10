#!/bin/bash
B=/opt/remote-os/bench; OUT=/tmp/rob-extra.jsonl; : > $OUT; DUR=15
start_x() { Xvfb $1 -screen 0 ${2}x24 -nolisten tcp -dpi 96 >/dev/null 2>&1 & echo $! > /tmp/rob-xvfb$1.pid; sleep 2; }
start_chr() { pkill -f "rob-chr"; sleep 1
  DISPLAY=$1 chromium-browser --user-data-dir=/tmp/rob-chr --no-first-run --no-default-browser-check --disable-gpu --ozone-platform=x11 \
    --kiosk --window-position=0,0 --window-size=${2/x/,} --password-store=basic "file://$B/anim.html#$3" >/dev/null 2>&1 &
  sleep 7; }
run() { python3 $B/bench.py "$@" 2>&1 | grep -E "RESULT|ERROR" | sed 's/^RESULT //' >> $OUT; }
QUAL='x264enc name=enc tune=zerolatency speed-preset={preset} key-int-max=60 bframes=0 pass=qual quantizer=23 option-string=vbv-maxrate={B}:vbv-bufsize={B}'
CBRQ='x264enc name=enc tune=zerolatency speed-preset={preset} key-int-max=60 bframes=0 bitrate={B} option-string=qpmin=20'
start_x :8 1600x900
for mode in idle full; do start_chr :8 1600x900 $mode
  ENC='identity name=enc' CONV='identity' run :8 1280 720 30 0 x $DUR "$mode:capture-only-raw"
  ENC='identity name=enc' run :8 1280 720 30 0 x $DUR "$mode:capture+scale+convert"
  ENC='identity name=enc' CONV='videoconvertscale n-threads=4 ! video/x-raw,width={W},height={H},format=I420' run :8 1280 720 30 0 x $DUR "$mode:capture+videoconvertscale(4thr)"
  CONV='videoconvertscale n-threads=4 ! video/x-raw,width={W},height={H},format=I420' run :8 1280 720 30 2500 ultrafast $DUR "$mode:convertscale4+x264"
  ENC="$CBRQ" run :8 1280 720 30 2500 ultrafast $DUR "$mode:cbr+qpmin20"
  ENC="$QUAL" run :8 1280 720 30 2500 ultrafast $DUR "$mode:crf23+vbvcap"
done
pkill -f rob-chr; kill $(cat /tmp/rob-xvfb:8.pid)
start_x :9 1920x1080
for mode in idle full; do start_chr :9 1920x1080 $mode
  ENC='identity name=enc' CONV='videoconvert ! video/x-raw,format=I420' run :9 1920 1080 60 0 x $DUR "$mode:capture+convert@60"
  CONV='videoconvert n-threads=4 ! video/x-raw,format=I420' run :9 1920 1080 60 7000 ultrafast $DUR "$mode:convert4thr+x264@60"
  ENC="$QUAL" CONV='videoconvert n-threads=4 ! video/x-raw,format=I420' run :9 1920 1080 30 4500 ultrafast $DUR "$mode:convert4thr+crf23vbv@30"
done
pkill -f rob-chr; kill $(cat /tmp/rob-xvfb:9.pid); sleep 1; rm -rf /tmp/rob-chr
echo DONE >> $OUT
