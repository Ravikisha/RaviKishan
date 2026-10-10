#!/usr/bin/env bash
# Isolation checks for remote-os, run ON THE BOX by an admin (sudo) while
# sessions in slots 1 and 2 are running:
#
#   sudo bash /opt/remote-os/src/tests/isolation.sh
#
# It stops the slot-3 session at the end (the positive polkit stop). Every
# NEGATIVE polkit check uses `start` on a unit that is already running, so a
# wrong answer would be a no-op rather than a stopped agentd.
set -u
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ✓ $1"; }
bad() { fail=$((fail+1)); echo "  ✗ $1"; }
expect_fail() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then bad "$name"; else ok "$name"; fi; }
expect_ok()   { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }

as() { local u="$1"; shift; sudo -u "$u" -- "$@"; }

echo "== session users =="
for u in rdesk1 rdesk2 rdesk3; do
  m=$(stat -c %a "/home/$u"); [ "$m" = 700 ] && ok "/home/$u is 0700" || bad "/home/$u is $m"
  expect_fail "$u has no sudo" sudo -l -U "$u" -n true
  sudo -l -U "$u" 2>&1 | grep -q "not allowed" && ok "$u: sudo says not allowed" || bad "$u: sudo listing unexpected"
done
expect_fail "rdesk2 cannot list rdesk1's home" as rdesk2 ls /home/rdesk1
expect_fail "rdesk1 cannot list rdesk2's home" as rdesk1 ls /home/rdesk2
expect_fail "rdesk2 cannot read rdesk1's X cookie" as rdesk2 cat /run/remote-os-session-1/Xauthority
expect_fail "rdesk1 cannot read rdesk2's X cookie" as rdesk1 cat /run/remote-os-session-2/Xauthority
expect_fail "rdesk2 cannot open display :21 without the cookie" as rdesk2 env DISPLAY=:21 XAUTHORITY=/dev/null xset q
expect_ok   "rdesk1 CAN open its own display :21" as rdesk1 env DISPLAY=:21 XAUTHORITY=/run/remote-os-session-1/Xauthority xset q
expect_fail "rdesk1 cannot read the TURN secret" as rdesk1 cat /etc/remote-os/turn.secret
expect_fail "rdesk1 cannot read agentd's env" as rdesk1 cat /etc/agentd.env
expect_fail "rdesk1 cannot read the supervisor's state" as rdesk1 ls /var/lib/remote-os

echo "== agentd's shared desktop :1 (Xvfb -auth, cookie 0600 agent) =="
# Was KNOWN until 11 Oct 2026: Xvfb :1 ran with no -auth, so any local uid could
# drive the agent's desktop and its signed-in browser. agentd-desktop now writes
# a fresh MIT cookie to /run/agentd-desktop/Xauthority (dir 0700, file 0600,
# owner agent) at every start and passes -auth.
AX=/run/agentd-desktop/Xauthority
ps -o args= -C Xvfb | grep -q "^Xvfb :1 .*-auth $AX" && ok "Xvfb :1 runs with -auth $AX" || bad "Xvfb :1 has no -auth"
[ "$(stat -c '%U %a' "$AX" 2>/dev/null)" = "agent 600" ] && ok "agentd's X cookie is agent 0600" || bad "agentd's X cookie is $(stat -c '%U %a' "$AX" 2>/dev/null)"
expect_fail "rdesk1 cannot open agentd's display :1" as rdesk1 env DISPLAY=:1 XAUTHORITY=/dev/null xset q
expect_fail "rdesk1 cannot open :1 with its OWN session cookie" as rdesk1 env DISPLAY=:1 XAUTHORITY=/run/remote-os-session-1/Xauthority xset q
expect_fail "rdesk2 cannot open agentd's display :1" as rdesk2 env DISPLAY=:1 XAUTHORITY=/dev/null xset q
expect_fail "remoteos cannot open agentd's display :1" as remoteos env DISPLAY=:1 XAUTHORITY=/dev/null xset q
expect_fail "rdesk1 cannot read agentd's X cookie" as rdesk1 cat "$AX"
expect_fail "remoteos cannot read agentd's X cookie" as remoteos cat "$AX"
expect_ok   "agent opens :1 with the cookie" as agent env DISPLAY=:1 XAUTHORITY="$AX" xset q
expect_fail "agent WITHOUT the cookie is refused too (auth is really on)" as agent env DISPLAY=:1 XAUTHORITY=/dev/null xset q

echo "== loopback services, filtered by connecting uid (inet agentd_loopback) =="
# Binding to 127.0.0.1 kept the internet out, not the box's other users: CDP on
# 9222 has no auth at all. meta skuid on OUTPUT/lo now decides who may connect.
systemctl is-enabled --quiet agentd-loopback-guard && ok "agentd-loopback-guard is enabled (rebuilt at boot)" || bad "agentd-loopback-guard not enabled"
nft list table inet agentd_loopback >/dev/null 2>&1 && ok "nft table inet agentd_loopback is loaded" || bad "nft table inet agentd_loopback missing"
get() { local u="$1" url="$2"; if [ "$u" = root ]; then curl -s -o /dev/null -m 3 "$url"; else as "$u" curl -s -o /dev/null -m 3 "$url"; fi; }
CDP=http://127.0.0.1:9222/json/version; AGD=http://127.0.0.1:7777/health; SUP=http://127.0.0.1:7780/api/v1/health
expect_ok   "agent reaches CDP 9222" get agent "$CDP"
expect_fail "rdesk1 cannot reach CDP 9222" get rdesk1 "$CDP"
expect_fail "rdesk2 cannot reach CDP 9222" get rdesk2 "$CDP"
expect_fail "remoteos cannot reach CDP 9222" get remoteos "$CDP"
expect_fail "root cannot reach CDP 9222 (agent only)" get root "$CDP"
expect_ok   "agent reaches agentd 7777" get agent "$AGD"
expect_ok   "root (cloudflared) reaches agentd 7777" get root "$AGD"
expect_fail "rdesk1 cannot reach agentd 7777" get rdesk1 "$AGD"
expect_fail "remoteos cannot reach agentd 7777" get remoteos "$AGD"
expect_ok   "remoteos reaches the supervisor 7780" get remoteos "$SUP"
expect_ok   "root (cloudflared) reaches the supervisor 7780" get root "$SUP"
expect_fail "rdesk1 cannot reach the supervisor 7780" get rdesk1 "$SUP"
expect_fail "agent cannot reach the supervisor 7780" get agent "$SUP"
[ "$(ps -o user= -p "$(pgrep -o -x cloudflared)")" = root ] && ok "cloudflared runs as root (the uid the 7777/7780 rules allow)" || bad "cloudflared is not root — update the guard"

echo "== supervisor user =="
expect_ok   "remoteos reads the TURN secret (group coturn)" as remoteos head -c1 /etc/remote-os/turn.secret
expect_ok   "remoteos reads session 1's X cookie (group rdesk1)" as remoteos head -c1 /run/remote-os-session-1/Xauthority
expect_fail "remoteos cannot read agentd's env" as remoteos cat /etc/agentd.env
expect_fail "remoteos cannot list a session home" as remoteos ls /home/rdesk1
# Real systemctl calls, chosen so that a WRONG answer is still harmless:
# `start` on a unit that is already running is a no-op if allowed, but polkit
# is consulted before systemd notices that. Never `stop`/`restart` agentd.
sc() { sudo -u "$1" systemctl --no-ask-password "$2" "$3"; }
expect_ok   "polkit: remoteos may start remote-os-session@3 (already running)" sc remoteos start remote-os-session@3.service
expect_fail "polkit: remoteos may NOT start agentd (running)" sc remoteos start agentd.service
expect_fail "polkit: remoteos may NOT start cloudflared (running)" sc remoteos start cloudflared.service
expect_fail "polkit: remoteos may NOT start coturn (running)" sc remoteos start coturn.service
expect_fail "polkit: remoteos may NOT start agentd-desktop (running)" sc remoteos start agentd-desktop.service
expect_fail "polkit: remoteos may NOT start remote-os-session@4" sc remoteos start remote-os-session@4.service
expect_fail "polkit: remoteos may NOT reload remote-os-session@1" sc remoteos reload remote-os-session@1.service
expect_fail "polkit: rdesk1 may NOT start remote-os-session@2 (running)" sc rdesk1 start remote-os-session@2.service
expect_fail "polkit: rdesk1 may NOT stop its own unit" sc rdesk1 stop remote-os-session@1.service
systemctl is-active --quiet remote-os-session@1 && ok "session 1 still running" || bad "session 1 was stopped"
# The positive stop, for real, on slot 3 (a test session):
expect_ok   "polkit: remoteos may STOP remote-os-session@3" sc remoteos stop remote-os-session@3.service
systemctl is-active --quiet agentd && ok "agentd still active" || bad "agentd not active"

echo "== processes and limits =="
pu=$(ps -o user= -p "$(systemctl show -p MainPID --value remote-os)")
[ "$pu" = remoteos ] && ok "supervisor runs as remoteos" || bad "supervisor runs as $pu"
for i in 1 2; do
  [ "$(systemctl show -p MemoryMax --value remote-os-session@$i)" != infinity ] && ok "session $i has MemoryMax" || bad "session $i has no MemoryMax"
  [ "$(systemctl show -p CPUQuotaPerSecUSec --value remote-os-session@$i)" != infinity ] && ok "session $i has CPUQuota" || bad "session $i has no CPUQuota"
  [ "$(systemctl show -p NoNewPrivileges --value remote-os-session@$i)" = yes ] && ok "session $i NoNewPrivileges" || bad "session $i NoNewPrivileges"
done
ps -o user=,args= -C Xvfb | grep -q "^rdesk1 .*Xvfb :21" && ok "Xvfb :21 runs as rdesk1" || bad "Xvfb :21 owner"
ps -o user=,args= -C Xvfb | grep -q "^rdesk2 .*Xvfb :22" && ok "Xvfb :22 runs as rdesk2" || bad "Xvfb :22 owner"
ss -ltn | grep -q ":60[0-9][0-9] " && bad "an X server listens on TCP" || ok "no X server listens on TCP"
ss -ltnp | grep -q "127.0.0.1:7780" && ok "supervisor bound to 127.0.0.1:7780 only" || bad "supervisor bind"

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
