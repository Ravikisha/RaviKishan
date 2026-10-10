#!/usr/bin/env bash
# Installs the remote-os supervisor on the box. Run as root from the source
# tree after `cargo build --release`. Idempotent.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$SRC/target/release/remote-os-supervisor"
[ -x "$BIN" ] || { echo "build first: cargo build --release" >&2; exit 1; }

# Session users: unprivileged, own group, private 0700 homes.
for i in 1 2 3; do
  u="rdesk$i"
  id "$u" >/dev/null 2>&1 || useradd --create-home --user-group --shell /bin/bash --comment "remote-os session $i" "$u"
  chmod 0700 "/home/$u"
done
# Supervisor user: system account, no login, groups coturn + rdesk1..3.
id remoteos >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /var/lib/remote-os --shell /sbin/nologin --comment "remote-os supervisor" remoteos
usermod -a -G coturn,rdesk1,rdesk2,rdesk3 remoteos

install -d -m 0755 /opt/remote-os/bin /opt/remote-os/share
install -m 0755 "$BIN" /opt/remote-os/bin/remote-os-supervisor
install -m 0755 "$SRC/deploy/bin/remote-os-session-run" /opt/remote-os/bin/remote-os-session-run
install -m 0644 "$SRC/deploy/systemd/remote-os.service" /etc/systemd/system/remote-os.service
install -m 0644 "$SRC/deploy/systemd/remote-os-session@.service" /etc/systemd/system/remote-os-session@.service
install -m 0644 "$SRC/deploy/polkit/50-remote-os.rules" /etc/polkit-1/rules.d/50-remote-os.rules
# Test pages for the benchmark (world-readable, no secrets).
install -m 0644 "$SRC/tests/pages/"*.html /opt/remote-os/share/ 2>/dev/null || true
restorecon -R /opt/remote-os /etc/systemd/system/remote-os*.service /etc/polkit-1/rules.d/50-remote-os.rules 2>/dev/null || true
systemctl daemon-reload
systemctl enable remote-os.service >/dev/null
# 127.0.0.1:7780 only from root (cloudflared) and remoteos. That is enforced
# by agentd's loopback guard (agent/setup/setup.sh: nft table inet
# agentd_loopback, uid-matched on OUTPUT/lo), which resolves the remoteos uid
# when it loads — so reload it now that the user exists. Without the guard,
# every local uid (rdeskN included) can connect to 7780, and to agentd's
# unauthenticated CDP on 9222.
if systemctl is-enabled --quiet agentd-loopback-guard 2>/dev/null; then
  systemctl restart agentd-loopback-guard
else
  echo "WARNING: agentd-loopback-guard is not installed — run agent/setup/setup.sh (loopback ports are open to every local uid)" >&2
fi
systemctl restart remote-os.service
echo "installed; status:"; systemctl --no-pager --lines=0 status remote-os.service | head -5
