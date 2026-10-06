#!/usr/bin/env bash
# Provision a fresh Ubuntu box (Oracle Always Free ARM, or anything else) to run
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

say "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git jq ripgrep build-essential ca-certificates unzip

say "Node 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

say "GitHub CLI (used to open pull requests)"
if ! command -v gh >/dev/null; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg >/dev/null 2>&1
  chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq
  apt-get install -y -qq gh
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
    npm install -g @openai/codex 2>/dev/null || echo "    codex: skipped (install it later if you want it)"
  fi
'

say "agentd"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "${AGENTD_REPO:-https://github.com/Ravikisha/RaviKishan.git}" "$REPO_DIR"
fi
cd "$REPO_DIR" && git pull --ff-only || true
cd "$REPO_DIR/agent" && npm ci --omit=dev
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

say "Cloudflare Tunnel"
if ! command -v cloudflared >/dev/null; then
  ARCH_DEB="arm64"; [ "$ARCH" = "x86_64" ] && ARCH_DEB="amd64"
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH_DEB}.deb"
  dpkg -i /tmp/cloudflared.deb
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

    It prints a URL — open it in any browser and approve. The admin panel can
    do the same thing without SSH once the tunnel is up.

    Check it:  curl -s localhost:7777/health | jq
NEXT

say "Done"
