#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Aurum — self-hosted personal finance
#
# One-line install (Debian/Ubuntu, ideal for a Proxmox LXC container):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/ssan9876/aurum-finance/main/install.sh)"
#
# What it does:
#   * installs Node.js 22 (NodeSource) + git if missing
#   * clones/updates the app into /opt/aurum
#   * builds the web app + server, creates the SQLite DB in /var/lib/aurum
#   * optionally sets an access password (stored in /etc/aurum/aurum.env)
#   * installs and starts a systemd service (aurum.service)
#
# Re-running the script updates an existing install in place.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_URL="${AURUM_REPO:-https://github.com/ssan9876/aurum-finance.git}"
BRANCH="${AURUM_BRANCH:-main}"
INSTALL_DIR="/opt/aurum"
DATA_DIR="/var/lib/aurum"
ENV_DIR="/etc/aurum"
PORT="${AURUM_PORT:-5533}"
SERVICE_USER="aurum"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_OFF='\033[0m'
info()  { echo -e "${C_GREEN}[aurum]${C_OFF} $*"; }
warn()  { echo -e "${C_YELLOW}[aurum]${C_OFF} $*"; }
fail()  { echo -e "${C_RED}[aurum]${C_OFF} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run as root (sudo bash install.sh)."
command -v apt-get >/dev/null 2>&1 || fail "This installer targets Debian/Ubuntu (apt)."

UPDATE=false
[ -d "$INSTALL_DIR/.git" ] && UPDATE=true

info "Installing prerequisites…"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates >/dev/null

# --- Node.js 20+ -----------------------------------------------------------
NEED_NODE=true
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  [ "$NODE_MAJOR" -ge 20 ] && NEED_NODE=false
fi
if $NEED_NODE; then
  info "Installing Node.js 22 (NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
info "Node $(node -v), npm $(npm -v)"

# --- fetch source ----------------------------------------------------------
if $UPDATE; then
  info "Updating existing install in $INSTALL_DIR…"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  info "Cloning $REPO_URL…"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# --- build -----------------------------------------------------------------
info "Installing dependencies (this skips the Electron binary)…"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund >/dev/null
else
  npm install --no-audit --no-fund >/dev/null
fi

info "Building web app and server…"
npm run build:web >/dev/null
npm run build:server >/dev/null

# --- database --------------------------------------------------------------
mkdir -p "$DATA_DIR" "$ENV_DIR"
info "Syncing database schema at $DATA_DIR/aurum.db…"
DATABASE_URL="file:$DATA_DIR/aurum.db" npx prisma db push --skip-generate >/dev/null

# --- service user + env ----------------------------------------------------
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

if [ ! -f "$ENV_DIR/aurum.env" ]; then
  PASSWORD=""
  if [ -t 0 ]; then
    read -rsp "$(echo -e "${C_YELLOW}[aurum]${C_OFF} Set an access password (leave empty for none): ")" PASSWORD
    echo
  fi
  {
    echo "PORT=$PORT"
    echo "AURUM_DB=$DATA_DIR/aurum.db"
    [ -n "$PASSWORD" ] && echo "AURUM_PASSWORD=$PASSWORD"
  } > "$ENV_DIR/aurum.env"
  chmod 600 "$ENV_DIR/aurum.env"
  chown root:root "$ENV_DIR/aurum.env"
else
  info "Keeping existing $ENV_DIR/aurum.env"
fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"

# --- systemd ---------------------------------------------------------------
NODE_BIN="$(command -v node)"
info "Installing systemd service…"
cat > /etc/systemd/system/aurum.service <<EOF
[Unit]
Description=Aurum personal finance (self-hosted)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_DIR/aurum.env
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $INSTALL_DIR/dist-server/index.cjs
Restart=on-failure
RestartSec=3

# Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now aurum.service

sleep 1
if systemctl is-active --quiet aurum.service; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  info "──────────────────────────────────────────────"
  info "Aurum is running!  →  http://${IP:-<container-ip>}:$PORT"
  info "Data:     $DATA_DIR/aurum.db"
  info "Config:   $ENV_DIR/aurum.env  (password, port)"
  info "Logs:     journalctl -u aurum -f"
  info "Update:   re-run this installer"
  info "──────────────────────────────────────────────"
else
  fail "Service failed to start — check: journalctl -u aurum -e"
fi
