#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Aurum — self-hosted personal finance
#
# One-line install (Debian/Ubuntu, or directly on a Proxmox host):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/ssan9876/aurum-finance/main/install.sh)"
#
# What it does:
#   * on a Proxmox host: offers to create a dedicated LXC container and
#     installs Aurum inside it (re-running updates that container)
#   * installs Node.js 22 (NodeSource) + git if missing
#   * clones/updates the app into /opt/aurum
#   * builds the web app + server, creates the SQLite DB in /var/lib/aurum
#   * optionally sets an access password (stored in /etc/aurum/aurum.env)
#   * installs and starts a systemd service (aurum.service)
#
# Re-running the script updates an existing install in place. Noisy tool
# output goes to /tmp/aurum-install.log. To uninstall:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/ssan9876/aurum-finance/main/uninstall.sh)"
#
# Container-creation knobs (all optional):
#   AURUM_CT_ID, AURUM_CT_HOSTNAME (aurum), AURUM_CT_STORAGE (local-lvm),
#   AURUM_CT_TEMPLATE_STORAGE (local), AURUM_CT_BRIDGE (vmbr0),
#   AURUM_CT_DISK_GB (4), AURUM_CT_MEMORY (1024), AURUM_CT_CORES (2),
#   AURUM_CT_IP (dhcp — or e.g. 192.168.1.50/24), AURUM_CT_GW,
#   AURUM_ON_HOST=1 to skip the container offer and install on the host.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_URL="${AURUM_REPO:-https://github.com/ssan9876/aurum-finance.git}"
BRANCH="${AURUM_BRANCH:-main}"
RAW_BASE="https://raw.githubusercontent.com/ssan9876/aurum-finance/$BRANCH"
INSTALL_DIR="/opt/aurum"
DATA_DIR="/var/lib/aurum"
ENV_DIR="/etc/aurum"
PORT="${AURUM_PORT:-5533}"
SERVICE_USER="aurum"
LOG="/tmp/aurum-install.log"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_OFF='\033[0m'
info()  { echo -e "${C_GREEN}[aurum]${C_OFF} $*"; }
warn()  { echo -e "${C_YELLOW}[aurum]${C_OFF} $*"; }
fail()  { echo -e "${C_RED}[aurum]${C_OFF} $*" >&2; exit 1; }
# Run a noisy command with its output captured to $LOG.
quiet() { "$@" >>"$LOG" 2>&1 || fail "Command failed: $* — details in $LOG"; }

[ "$(id -u)" -eq 0 ] || fail "Run as root (sudo bash install.sh)."
: > "$LOG"

# --------------------------- Proxmox host support ---------------------------
# Running on a Proxmox VE host (not inside a container)? Offer to create a
# dedicated LXC container instead of installing onto the hypervisor.

is_proxmox_host() {
  command -v pct >/dev/null 2>&1 && [ -d /etc/pve ] &&
    ! grep -qa 'container=lxc' /proc/1/environ 2>/dev/null
}

fetch_self() {
  # The script body — works both when run from a file and via curl|bash -c.
  curl -fsSL "$RAW_BASE/install.sh" 2>/dev/null || cat "$0" 2>/dev/null
}

create_container() {
  local ctid hostname storage tstorage bridge disk mem cores net template password ip
  ctid="${AURUM_CT_ID:-$(pvesh get /cluster/nextid)}"
  hostname="${AURUM_CT_HOSTNAME:-aurum}"
  storage="${AURUM_CT_STORAGE:-local-lvm}"
  tstorage="${AURUM_CT_TEMPLATE_STORAGE:-local}"
  bridge="${AURUM_CT_BRIDGE:-vmbr0}"
  disk="${AURUM_CT_DISK_GB:-4}"
  mem="${AURUM_CT_MEMORY:-1024}"
  cores="${AURUM_CT_CORES:-2}"
  net="name=eth0,bridge=$bridge,ip=${AURUM_CT_IP:-dhcp}"
  [ -n "${AURUM_CT_GW:-}" ] && net="$net,gw=$AURUM_CT_GW"

  # Ask for the app password up front so the in-container install runs unattended.
  password=""
  if [ -t 0 ]; then
    read -rsp "$(echo -e "${C_YELLOW}[aurum]${C_OFF} Set an access password for Aurum (leave empty for none): ")" password
    echo
  fi

  info "Finding the newest Debian 12 LXC template…"
  quiet pveam update
  template="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep '^debian-12-standard' | sort -V | tail -1)"
  [ -n "$template" ] || fail "No debian-12-standard template offered by pveam — check host internet access."
  if ! pveam list "$tstorage" 2>/dev/null | grep -q "$template"; then
    info "Downloading $template to '$tstorage'…"
    quiet pveam download "$tstorage" "$template"
  fi

  info "Creating LXC container $ctid ('$hostname': ${cores} cores, ${mem}MB RAM, ${disk}GB on $storage)…"
  quiet pct create "$ctid" "$tstorage:vztmpl/$template" \
    --hostname "$hostname" --memory "$mem" --cores "$cores" \
    --rootfs "$storage:$disk" --net0 "$net" \
    --unprivileged 1 --features nesting=1 --onboot 1 --start 1 --tags aurum

  info "Waiting for the container network…"
  local i ok=false
  for i in $(seq 1 45); do
    if pct exec "$ctid" -- sh -c 'ip -4 -o addr show dev eth0 2>/dev/null | grep -q "inet "'; then
      ok=true; break
    fi
    sleep 1
  done
  $ok || warn "Container network is slow to come up — continuing anyway."

  info "Bootstrapping Aurum inside container $ctid (a few minutes)…"
  quiet pct exec "$ctid" -- bash -c 'apt-get update -qq && apt-get install -y -qq curl ca-certificates'
  local script
  script="$(fetch_self)"
  [ -n "$script" ] || fail "Could not fetch the installer to run inside the container."
  pct exec "$ctid" -- env AURUM_PASSWORD_PRESET="$password" \
    AURUM_REPO="$REPO_URL" AURUM_BRANCH="$BRANCH" AURUM_PORT="$PORT" \
    bash -c "$script"

  ip="$(pct exec "$ctid" -- hostname -I 2>/dev/null | awk '{print $1}')"
  info "──────────────────────────────────────────────"
  info "Aurum is running in LXC container $ctid  →  http://${ip:-<container-ip>}:$PORT"
  info "Console:  pct enter $ctid   (then type  update  to update Aurum)"
  info "Remove:   pct stop $ctid && pct destroy $ctid"
  info "──────────────────────────────────────────────"
}

if is_proxmox_host && [ "${AURUM_ON_HOST:-0}" != "1" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  EXISTING_CT="$(pct list 2>/dev/null | awk 'NR>1 && $NF=="aurum" {print $1; exit}')"
  if [ -n "$EXISTING_CT" ]; then
    info "Found existing 'aurum' container (CT $EXISTING_CT) — updating Aurum inside it."
    SCRIPT="$(fetch_self)"
    pct exec "$EXISTING_CT" -- bash -c "$SCRIPT"
    exit 0
  fi
  MAKE_CT="y"
  if [ -t 0 ]; then
    read -rp "$(echo -e "${C_YELLOW}[aurum]${C_OFF} You're on a Proxmox host — create a dedicated LXC container for Aurum? [Y/n] ")" MAKE_CT
    MAKE_CT="${MAKE_CT:-y}"
  fi
  case "$MAKE_CT" in
    [Yy]*) create_container; exit 0 ;;
    *) warn "Installing directly on the Proxmox host (set AURUM_ON_HOST=1 to skip this question next time)." ;;
  esac
fi

# ------------------------------ regular install ------------------------------
command -v apt-get >/dev/null 2>&1 || fail "This installer targets Debian/Ubuntu (apt)."

UPDATE=false
[ -d "$INSTALL_DIR/.git" ] && UPDATE=true

info "Installing prerequisites…"
quiet apt-get update -qq
quiet apt-get install -y -qq curl git ca-certificates

# --- Node.js 20+ -----------------------------------------------------------
NEED_NODE=true
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  [ "$NODE_MAJOR" -ge 20 ] && NEED_NODE=false
fi
if $NEED_NODE; then
  info "Installing Node.js 22 (NodeSource)…"
  quiet bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -'
  quiet apt-get install -y -qq nodejs
fi
info "Node $(node -v), npm $(npm -v)"

# --- fetch source ----------------------------------------------------------
if $UPDATE; then
  info "Updating existing install in $INSTALL_DIR…"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH" 2>>"$LOG"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH" >>"$LOG" 2>&1
else
  info "Cloning $REPO_URL…"
  quiet git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# --- build -----------------------------------------------------------------
info "Installing dependencies (this skips the Electron binary)…"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
if [ -f package-lock.json ]; then
  quiet npm ci --no-audit --no-fund --loglevel=error
else
  quiet npm install --no-audit --no-fund --loglevel=error
fi

info "Building web app and server…"
quiet npm run build:web
quiet npm run build:server

# --- database --------------------------------------------------------------
# User data lives in $DATA_DIR and $ENV_DIR — never recreated on update.
mkdir -p "$DATA_DIR" "$ENV_DIR"
if systemctl is-active --quiet aurum.service 2>/dev/null; then
  info "Stopping service for database sync…"
  systemctl stop aurum.service
fi
info "Syncing database schema at $DATA_DIR/aurum.db (existing data is kept)…"
quiet env DATABASE_URL="file:$DATA_DIR/aurum.db" PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma db push --skip-generate

# --- service user + env ----------------------------------------------------
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"

if [ ! -f "$ENV_DIR/aurum.env" ]; then
  PASSWORD=""
  if [ "${AURUM_PASSWORD_PRESET+x}" = "x" ]; then
    # Provided by the Proxmox container bootstrap — don't prompt again.
    PASSWORD="$AURUM_PASSWORD_PRESET"
  elif [ -t 0 ]; then
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
systemctl enable aurum.service >/dev/null 2>&1
systemctl restart aurum.service

# --- 'update' console command -----------------------------------------------
UPDATE_CMD=/usr/bin/update
if [ -e "$UPDATE_CMD" ] && ! grep -q "Update Aurum" "$UPDATE_CMD" 2>/dev/null; then
  warn "/usr/bin/update exists and isn't ours — installing as /usr/bin/aurum-update instead."
  UPDATE_CMD=/usr/bin/aurum-update
fi
cat > "$UPDATE_CMD" <<UPD
#!/usr/bin/env bash
# Update Aurum: pull the latest version and redeploy.
# User data is kept — the installer never touches $DATA_DIR or $ENV_DIR.
set -euo pipefail
echo "[aurum] fetching latest installer…"
if script="\$(curl -fsSL ${REPO_URL%.git}/raw/$BRANCH/install.sh || curl -fsSL https://raw.githubusercontent.com/ssan9876/aurum-finance/$BRANCH/install.sh)"; then
  exec bash -c "\$script"
else
  echo "[aurum] couldn't fetch the installer — falling back to the local copy"
  exec bash $INSTALL_DIR/install.sh
fi
UPD
chmod +x "$UPDATE_CMD"

sleep 1
if systemctl is-active --quiet aurum.service; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  info "──────────────────────────────────────────────"
  info "Aurum is running!  →  http://${IP:-<container-ip>}:$PORT"
  info "Data:     $DATA_DIR/aurum.db"
  info "Config:   $ENV_DIR/aurum.env  (password, port)"
  info "Logs:     journalctl -u aurum -f"
  info "Update:   just type  ${UPDATE_CMD##*/}  in this console"
  info "──────────────────────────────────────────────"
else
  fail "Service failed to start — check: journalctl -u aurum -e"
fi
