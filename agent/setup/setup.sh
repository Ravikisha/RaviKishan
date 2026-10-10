#!/usr/bin/env bash
# Provision a fresh Ubuntu or Oracle Linux box (Oracle Always Free ARM, or anything else) to run
# agentd. Idempotent: safe to run again after a failure or an upgrade.
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/agent/setup/setup.sh | bash
#   — or, saner, clone the repo and run it, so you can read it first.
#
# It deliberately does NOT open a port. agentd binds to 127.0.0.1 and
# Cloudflare Tunnel connects outward, so this box is never reachable by IP.
set -euo pipefail

AGENT_USER="${AGENT_USER:-agent}"
AGENT_HOME="/home/${AGENT_USER}/.agentd"
REPO_DIR="${REPO_DIR:-/opt/agentd}"

say() { printf '\n\033[1;33m==>\033[0m %s\n' "$1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

say "Checking the architecture"
ARCH="$(uname -m)"
echo "    $ARCH"
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "x86_64" ]; then
  echo "    Unsupported architecture. Claude Code ships linux-arm64 and linux-x64 builds." >&2
  exit 1
fi

# Debian/Ubuntu use apt; Oracle Linux / RHEL / Fedora use dnf. Oracle's
# own console defaults to Oracle Linux, so both are first-class here.
if command -v apt-get >/dev/null; then PKG=apt; elif command -v dnf >/dev/null; then PKG=dnf; else
  echo "    Neither apt-get nor dnf found." >&2; exit 1; fi
echo "    package manager: $PKG"

say "Base packages"
if [ "$PKG" = apt ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git jq ripgrep build-essential ca-certificates unzip
else
  # ripgrep lives in EPEL; Oracle ships its own EPEL mirror package.
  dnf install -y -q oracle-epel-release-el9 2>/dev/null || dnf install -y -q epel-release 2>/dev/null || true
  # Oracle installs its EPEL repo disabled; without enabling it ripgrep is
  # "Unable to find a match" and set -e stops the whole setup.
  dnf config-manager --set-enabled ol9_developer_EPEL 2>/dev/null || true
  dnf install -y -q curl git jq gcc gcc-c++ make ca-certificates unzip tar
  dnf install -y -q ripgrep || echo "    ripgrep: unavailable (Claude Code bundles its own)"
fi

say "Node 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  if [ "$PKG" = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  else
    dnf module reset -y -q nodejs >/dev/null 2>&1 || true
    dnf module install -y -q nodejs:22/common
  fi
fi
node -v

say "GitHub CLI (used to open pull requests)"
if ! command -v gh >/dev/null; then
  if [ "$PKG" = apt ]; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg       | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg >/dev/null 2>&1
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main"       > /etc/apt/sources.list.d/github-cli.list
    apt-get update -qq
    apt-get install -y -qq gh
  else
    dnf install -y -q 'dnf-command(config-manager)'
    dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
    dnf install -y -q gh
  fi
fi

say "Service user: ${AGENT_USER}"
# A user of its own, with no sudo. Everything the agent runs, runs as this.
if ! id -u "$AGENT_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$AGENT_USER"
fi
install -d -o "$AGENT_USER" -g "$AGENT_USER" -m 700 \
  "$AGENT_HOME" "$AGENT_HOME/profiles" "$AGENT_HOME/work" "$AGENT_HOME/logs"

say "Claude Code and Codex"
# Installed AS the service user, into its own home, so the credentials and the
# config live where the profiles expect them.
sudo -u "$AGENT_USER" -H bash -lc '
  set -e
  if ! command -v claude >/dev/null; then
    curl -fsSL https://claude.ai/install.sh | bash
  fi
  echo "    claude: $(claude --version 2>/dev/null || echo "installed, run claude auth login")"
  if ! command -v codex >/dev/null; then
    # The service user has no sudo, so a global install needs a prefix it
    # owns; without one npm fails and Codex was silently skipped.
    npm config set prefix "$HOME/.npm-global"
    grep -q npm-global "$HOME/.bashrc" 2>/dev/null || echo "export PATH=\"\$HOME/.npm-global/bin:\$HOME/.local/bin:\$PATH\"" >> "$HOME/.bashrc"
    export PATH="$HOME/.npm-global/bin:$PATH"
    npm install -g @openai/codex || echo "    codex: install failed (retry: npm install -g @openai/codex)"
  fi
'

say "agentd"
# AGENTD_LOCAL=1 means the code was copied here already (scp/rsync from a
# working tree that is ahead of GitHub); cloning would replace it with an
# older copy.
if [ "${AGENTD_LOCAL:-0}" = 1 ]; then
  echo "    using the copy already in $REPO_DIR"
elif [ ! -d "$REPO_DIR/.git" ]; then
  git clone "${AGENTD_REPO:-https://github.com/Ravikisha/RaviKishan.git}" "$REPO_DIR"
fi
[ "${AGENTD_LOCAL:-0}" = 1 ] || { cd "$REPO_DIR" && git pull --ff-only || true; }
cd "$REPO_DIR/agent" && { [ -f package-lock.json ] && npm ci --omit=dev || npm install --omit=dev; }
chown -R "$AGENT_USER:$AGENT_USER" "$REPO_DIR"

say "Environment"
ENV_FILE="/etc/agentd.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# Who may drive this server. Comma-separated, must match the site's allow-list.
AGENT_ADMIN_EMAILS=ravikishan63392@gmail.com
FIREBASE_PROJECT_ID=myportifilio-3ab5f

AGENT_HOME=${AGENT_HOME}
AGENT_PORT=7777
AGENT_HOST=127.0.0.1

# The limits. Each one is a cap on a different failure; see src/sessions.js.
AGENT_MAX_CONCURRENT=4
AGENT_MAX_PER_PROFILE=2
AGENT_MAX_PER_DAY=50
AGENT_APPROVAL_TIMEOUT_MS=600000

AGENT_DEFAULT_PROFILE=personal
AGENT_GIT_NAME=agentd
AGENT_GIT_EMAIL=agent@localhost
EOF
  chmod 600 "$ENV_FILE"
  echo "    wrote $ENV_FILE — read it before you trust it"
else
  echo "    $ENV_FILE exists, left alone"
fi

# Settings added after the first release. Appended, commented or defaulted,
# ONLY when absent — an existing value is the operator's and is never touched.
ensure_env() {
  grep -q "^#\?\s*$1=" "$ENV_FILE" || printf '%s\n' "$2" >> "$ENV_FILE"
}
ensure_env AGENT_STALL_MS "# A running job silent this long is reported stalled (waiting on an approval never is).
AGENT_STALL_MS=300000"
ensure_env AGENT_LOGIN_TIMEOUT_MS "# A relayed sign-in from the panel is cancelled after this long.
AGENT_LOGIN_TIMEOUT_MS=600000"
ensure_env AGENT_MCP_URL "# The site's MCP server. Every job gets it (in the job's org), and memory goes through it.
AGENT_MCP_URL=https://www.ravikishan.me/api/mcp"
ensure_env AGENT_MCP_TOKEN "# Mint in the admin's MCP tab with read + write (NOT secrets, NOT agent — a job holding agent could approve itself). Unset = no site tools in jobs, no memory.
# AGENT_MCP_TOKEN=rkmcp_..."
chmod 600 "$ENV_FILE"

say "systemd"
cat > /etc/systemd/system/agentd.service <<EOF
[Unit]
Description=agentd — Claude Code and Codex, driven from the admin PWA
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${AGENT_USER}
WorkingDirectory=${REPO_DIR}/agent
# claude installs to ~/.local/bin and npm globals (codex, language servers) to
# ~/.npm-global/bin. systemd's default PATH has neither, so every chat and job
# failed to spawn even though the doctor, run from a login shell, said fine.
Environment=PATH=/home/${AGENT_USER}/.local/bin:/home/${AGENT_USER}/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
# The shared desktop's X cookie (see agentd-desktop below). Screenshots,
# xdotool, the ffmpeg stream and every job/chat/terminal that gets DISPLAY=:1
# need it, because Xvfb :1 refuses any client without it.
Environment=XAUTHORITY=/run/agentd-desktop/Xauthority
EnvironmentFile=/etc/agentd.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

# It already runs arbitrary code by design, so the hardening that matters is
# keeping it out of the REST of the box.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${AGENT_HOME}
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now agentd
sleep 2
systemctl --no-pager --lines=5 status agentd || true

# --- desktop ---
say "Desktop (Xvfb :1 + XFCE, x11vnc on loopback, the agents' browser)"
# One shared graphical desktop, watched and driven from the admin through
# agentd. NOTHING here listens beyond loopback: x11vnc is -localhost on 5901
# and the browser's debugger is 127.0.0.1:9222. Both are reachable solely
# through agentd's authenticated /desktop socket and its own API.
# Every install is non-fatal: jobs work without a desktop.
if [ "${AGENTD_NO_DESKTOP:-0}" = 1 ]; then
  echo "    AGENTD_NO_DESKTOP=1 — skipped"
else
  if [ "$PKG" = apt ]; then
    apt-get install -y -qq xvfb x11vnc xdotool imagemagick dbus-x11 xfce4 xfce4-terminal xterm fonts-dejavu-core fonts-noto-core iproute2 util-linux \
      || echo "    some desktop packages failed to install"
    apt-get install -y -qq chromium 2>/dev/null || apt-get install -y -qq chromium-browser 2>/dev/null || apt-get install -y -qq firefox 2>/dev/null \
      || echo "    no browser package could be installed"
    # ffmpeg's x11grab is the desktop STREAM: one long-lived capture per viewer
    # instead of an ImageMagick process per frame. Without it agentd falls back
    # to import, which works and is slower.
    apt-get install -y -qq ffmpeg || echo "    ffmpeg: unavailable (the desktop stream falls back to ImageMagick)"
  else
    # EPEL (enabled above) carries x11vnc, xdotool, XFCE and chromium.
    dnf install -y -q xorg-x11-server-Xvfb x11vnc xdotool ImageMagick dbus-x11 \
      xfce4-session xfwm4 xfce4-panel xfdesktop xfce4-terminal xterm \
      dejavu-sans-fonts google-noto-sans-fonts iproute util-linux \
      || echo "    some desktop packages failed to install"
    dnf install -y -q chromium 2>/dev/null || dnf install -y -q firefox 2>/dev/null \
      || echo "    no browser package could be installed"
    command -v xfce4-session >/dev/null || dnf install -y -q openbox tint2 2>/dev/null || true
    # ffmpeg-free (EPEL) carries x11grab and the mjpeg encoder — all the
    # desktop stream needs. Without it agentd falls back to ImageMagick import.
    # It depends on ladspa, which lives in CodeReady Builder: Oracle Linux
    # calls that repo ol9_codeready_builder, other EL9s call it crb. Without
    # it enabled the install fails on a missing ladspa (verified on the box).
    dnf config-manager --set-enabled ol9_codeready_builder 2>/dev/null \
      || dnf config-manager --set-enabled crb 2>/dev/null || true
    dnf install -y -q ffmpeg-free 2>/dev/null || dnf install -y -q ffmpeg 2>/dev/null \
      || echo "    ffmpeg: unavailable (the desktop stream falls back to ImageMagick)"
  fi

  # The session: XFCE when present (it needs a D-Bus session under Xvfb),
  # otherwise openbox with a tint2 panel.
  if command -v xfce4-session >/dev/null; then
    WM_CMD="exec dbus-launch --exit-with-session xfce4-session"
  elif command -v openbox-session >/dev/null; then
    WM_CMD="(command -v tint2 >/dev/null && tint2 &) ; exec openbox-session"
  else
    WM_CMD="exec sleep infinity"
    echo "    no window manager found — the desktop will be a bare X screen"
  fi
  # OL9 names it chromium-browser; Debian names it chromium.
  BROWSER_BIN="$(command -v chromium-browser || command -v chromium || command -v google-chrome || command -v firefox || true)"
  echo "    session: ${WM_CMD#exec }"
  echo "    browser: ${BROWSER_BIN:-none}"

  install -d -o "$AGENT_USER" -g "$AGENT_USER" -m 700 "/home/${AGENT_USER}/browser-profile"

  # X authorization. Without -auth, Xvfb accepts ANY local uid — the
  # remote-os session users, the supervisor, anything — and a client on :1
  # can watch and drive the agent's screen and its signed-in browser. So a
  # fresh MIT-MAGIC-COOKIE is written at every start into a runtime dir only
  # ${AGENT_USER} can read (0700 dir, 0600 file), and every legitimate client
  # (agentd, the browser, the session, x11vnc) is pointed at it.
  command -v xauth >/dev/null || { [ "$PKG" = apt ] && apt-get install -y -qq xauth || dnf install -y -q xorg-x11-xauth; } || true
  cat > /usr/local/bin/agentd-desktop-session <<EOF
#!/usr/bin/env bash
# Started by agentd-desktop.service as ${AGENT_USER}. Xvfb on :1, then the
# session on top; when the session exits the unit (and Xvfb) goes with it.
set -u
AUTH="\${XAUTHORITY:-/run/agentd-desktop/Xauthority}"
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
# A new cookie per start, written 0600 before Xvfb reads it.
umask 077
rm -f "\$AUTH"; : > "\$AUTH"
xauth -q -f "\$AUTH" add :1 MIT-MAGIC-COOKIE-1 "\$(mcookie)" || { echo "xauth failed — refusing to start an open display" >&2; exit 1; }
umask 022
Xvfb :1 -screen 0 1600x900x24 -auth "\$AUTH" -nolisten tcp -dpi 96 &
for _ in \$(seq 1 100); do [ -e /tmp/.X11-unix/X1 ] && break; sleep 0.1; done
export DISPLAY=:1 XAUTHORITY="\$AUTH"
# No screen lock and no blanking: nobody is sitting at this screen.
xset s off -dpms 2>/dev/null || true
${WM_CMD}
EOF
  chmod 755 /usr/local/bin/agentd-desktop-session

  cat > /etc/systemd/system/agentd-desktop.service <<EOF
[Unit]
Description=agentd shared desktop (Xvfb :1 + session)
After=network.target

[Service]
Type=simple
User=${AGENT_USER}
Environment=HOME=/home/${AGENT_USER}
# /run/agentd-desktop, 0700 ${AGENT_USER}: holds the X cookie. Preserved across
# a restart so the path agentd and the browser read never disappears.
RuntimeDirectory=agentd-desktop
RuntimeDirectoryMode=0700
RuntimeDirectoryPreserve=yes
Environment=XAUTHORITY=/run/agentd-desktop/Xauthority
ExecStart=/usr/local/bin/agentd-desktop-session
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/agentd-vnc.service <<EOF
[Unit]
Description=agentd desktop VNC (127.0.0.1:5901 only, reached through agentd)
After=agentd-desktop.service
Requires=agentd-desktop.service

[Service]
Type=simple
User=${AGENT_USER}
Environment=HOME=/home/${AGENT_USER}
# -localhost binds loopback ONLY. -nopw is safe solely because of that:
# the one way in is agentd's ticketed /desktop socket.
ExecStartPre=/bin/bash -c 'for i in \$(seq 1 100); do [ -e /tmp/.X11-unix/X1 ] && exit 0; sleep 0.1; done; exit 1'
Environment=XAUTHORITY=/run/agentd-desktop/Xauthority
ExecStart=/usr/bin/x11vnc -display :1 -auth /run/agentd-desktop/Xauthority -localhost -rfbport 5901 -nopw -forever -shared -noxdamage -quiet
Restart=always
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  if [ -n "$BROWSER_BIN" ]; then
    if [ "$(basename "$BROWSER_BIN")" = firefox ]; then
      # Firefox no longer speaks CDP; it is shown, but open_url needs chromium.
      BROWSER_EXEC="$BROWSER_BIN --profile /home/${AGENT_USER}/browser-profile --no-remote about:blank"
    else
      # The debugger on 127.0.0.1 only. A custom --user-data-dir is required:
      # Chrome ignores --remote-debugging-port on its default profile.
      # AGENT_BROWSER_FLAGS in /etc/agentd.env adds flags (e.g. --no-sandbox
      # if this kernel refuses the sandbox) without editing the unit.
      BROWSER_EXEC="$BROWSER_BIN --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/home/${AGENT_USER}/browser-profile --no-first-run --no-default-browser-check --disable-dev-shm-usage --password-store=basic --window-position=0,0 --window-size=1600,900 \$AGENT_BROWSER_FLAGS about:blank"
    fi
    cat > /etc/systemd/system/agentd-browser.service <<EOF
[Unit]
Description=agentd desktop browser (CDP on 127.0.0.1:9222)
After=agentd-desktop.service
Requires=agentd-desktop.service

[Service]
Type=simple
User=${AGENT_USER}
Environment=HOME=/home/${AGENT_USER}
Environment=DISPLAY=:1
Environment=XAUTHORITY=/run/agentd-desktop/Xauthority
EnvironmentFile=-/etc/agentd.env
ExecStartPre=/bin/bash -c 'for i in \$(seq 1 100); do [ -e /tmp/.X11-unix/X1 ] && exit 0; sleep 0.1; done; exit 1'
ExecStart=${BROWSER_EXEC}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  fi

  ensure_env AGENT_DISPLAY "# The shared desktop. Jobs, chats and terminals get DISPLAY set to it.
AGENT_DISPLAY=:1"
  ensure_env AGENT_XAUTHORITY "# The shared desktop's X cookie (Xvfb :1 runs with -auth). Set alongside DISPLAY everywhere agentd spawns.
AGENT_XAUTHORITY=/run/agentd-desktop/Xauthority"
  ensure_env AGENT_PUBLIC_URL "# Where the admin reaches this box (preview links are built on it).
AGENT_PUBLIC_URL=https://agent.ravikishan.me"
  ensure_env AGENT_DESKTOP_API_POLICY "# Desktop actions from the SITE's MCP (desktop_action): allowlist asks the owner for every click/type/key/open_url
# and waits AGENT_DESKTOP_API_WAIT_MS (max 18s) before refusing; yolo acts unasked; manual asks even for looks.
AGENT_DESKTOP_API_POLICY=allowlist"
  ensure_env AGENT_BROWSER_FLAGS "# Extra flags for the desktop browser, e.g. --no-sandbox if chromium refuses to start.
# AGENT_BROWSER_FLAGS="
  chmod 600 "$ENV_FILE"

  systemctl daemon-reload
  # restart, not just start: an Xvfb started by an older unit has no -auth.
  systemctl enable agentd-desktop || true
  # VNC is optional: under SELinux enforcing (Oracle Linux) x11vnc, labelled
  # xserver_exec_t, cannot exec from systemd and the unit restart-loops. The
  # desktop is served by the ffmpeg push stream and the remote-os WebRTC
  # supervisor instead, so VNC is enabled only where SELinux is not enforcing.
  if [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
    systemctl disable --now agentd-vnc 2>/dev/null || true
  else
    systemctl enable agentd-vnc || true
  fi
  systemctl restart agentd-desktop || true
  [ -f /etc/systemd/system/agentd-browser.service ] && { systemctl enable agentd-browser; systemctl restart agentd-browser; } || true
  # agentd learns the new routes and DISPLAY on restart.
  systemctl restart agentd || true
  sleep 2
  ss -tlnH 2>/dev/null | grep -E ':(5901|9222)\b' | sed 's/^/    /' || true
fi
# --- /desktop ---

say "Loopback guard (who may connect to 9222 / 5901 / 7777 / 7780)"
# Binding to 127.0.0.1 keeps the internet out, NOT the box's other local users.
# The browser's debugger (9222) has no auth at all — CDP is full control of a
# signed-in browser — and x11vnc (5901) runs -nopw. agentd (7777) and the
# remote-os supervisor (7780) authenticate, but trust a few loopback-only
# shapes (job tokens on /internal/*, cloudflared's headers). So connections to
# them over lo are filtered by the CONNECTING socket's uid (meta skuid on
# OUTPUT):
#   9222, 5901  only ${AGENT_USER}
#   7777        ${AGENT_USER} (jobs' approval bridge, the doctor) + root (cloudflared)
#   7780        root (cloudflared) + remoteos
# The rule set is a table of its own (inet agentd_loopback), so firewalld's
# reloads leave it alone, and it is rebuilt at every boot by a oneshot unit that
# resolves the uids then — a user created later (remote-os) is picked up on the
# next start: systemctl restart agentd-loopback-guard.
cat > /usr/local/sbin/agentd-loopback-guard <<'GUARD'
#!/usr/bin/env bash
# Loads the inet agentd_loopback nftables table. Idempotent: replaces the table.
set -euo pipefail
AGENT_USER="${AGENT_USER:-agent}"
uid() { id -u "$1" 2>/dev/null || true; }
A="$(uid "$AGENT_USER")"; R="$(uid remoteos)"
[ -n "$A" ] || { echo "no user $AGENT_USER" >&2; exit 1; }
ALLOW_7780="0"; [ -n "$R" ] && ALLOW_7780="0, $R"
nft -f - <<NFT
table inet agentd_loopback
delete table inet agentd_loopback
table inet agentd_loopback {
  chain output {
    type filter hook output priority filter - 5; policy accept;
    oif "lo" tcp dport 9222 meta skuid != $A counter reject with tcp reset comment "CDP: agent only"
    oif "lo" tcp dport 5901 meta skuid != $A counter reject with tcp reset comment "x11vnc: agent only"
    oif "lo" tcp dport 7777 meta skuid != { 0, $A } counter reject with tcp reset comment "agentd: agent + root (cloudflared)"
    oif "lo" tcp dport 7780 meta skuid != { $ALLOW_7780 } counter reject with tcp reset comment "remote-os: root (cloudflared) + remoteos"
  }
}
NFT
GUARD
chmod 755 /usr/local/sbin/agentd-loopback-guard

cat > /etc/systemd/system/agentd-loopback-guard.service <<EOF
[Unit]
Description=agentd loopback guard (uid-filtered 127.0.0.1:9222/5901/7777/7780)
After=firewalld.service nftables.service
Before=agentd.service agentd-browser.service agentd-vnc.service remote-os.service cloudflared.service

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=AGENT_USER=${AGENT_USER}
ExecStart=/usr/local/sbin/agentd-loopback-guard
ExecStop=/usr/sbin/nft delete table inet agentd_loopback

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable agentd-loopback-guard
systemctl restart agentd-loopback-guard
nft list table inet agentd_loopback | sed 's/^/    /'

say "Cloudflare Tunnel"
if ! command -v cloudflared >/dev/null; then
  ARCH_DEB="arm64"; [ "$ARCH" = "x86_64" ] && ARCH_DEB="amd64"
  if [ "$PKG" = apt ]; then
    curl -fsSL -o /tmp/cloudflared.deb \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH_DEB}.deb"
    dpkg -i /tmp/cloudflared.deb
  else
    ARCH_RPM="aarch64"; [ "$ARCH" = "x86_64" ] && ARCH_RPM="x86_64"
    curl -fsSL -o /tmp/cloudflared.rpm \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH_RPM}.rpm"
    dnf install -y -q /tmp/cloudflared.rpm
  fi
fi

cat <<'NEXT'

    cloudflared is installed but not configured — it needs your Cloudflare
    account, so it cannot be scripted blind. Three commands:

      cloudflared tunnel login
      cloudflared tunnel create agentd
      cloudflared tunnel route dns agentd agent.ravikishan.me

    then put this in /etc/cloudflared/config.yml:

      tunnel: agentd
      credentials-file: /root/.cloudflared/<tunnel-id>.json
      ingress:
        - hostname: agent.ravikishan.me
          service: http://127.0.0.1:7777
        - service: http_status:404

    and:  cloudflared service install && systemctl start cloudflared

NEXT

say "Sign in an account"
cat <<NEXT
    Each account is a profile with its own config directory, so several can be
    signed in at once:

      sudo -u ${AGENT_USER} -H env CLAUDE_CONFIG_DIR=${AGENT_HOME}/profiles/personal/claude claude auth login
      sudo -u ${AGENT_USER} -H env CLAUDE_CONFIG_DIR=${AGENT_HOME}/profiles/work/claude     claude auth login

    It prints a URL — open it in any browser and approve. Once the tunnel is
    up the admin's Agent tab does the same without SSH: paste a token from
    \`claude setup-token\` (or an OpenAI key for Codex), or press Sign in and
    paste back the code the provider shows you.

    Check it:  curl -s localhost:7777/health | jq
NEXT

say "Done"
