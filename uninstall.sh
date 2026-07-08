#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Aurum — uninstaller
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/ssan9876/aurum-finance/main/uninstall.sh)"
#
# Removes the service, the app (/opt/aurum), the config (/etc/aurum) and the
# `update` console command. Your DATA (/var/lib/aurum — database + backups)
# is KEPT unless you explicitly confirm, or you run with AURUM_PURGE=1.
#
# If Aurum lives in its own LXC container, destroying the container from the
# Proxmox host is the cleaner uninstall:  pct stop <id> && pct destroy <id>
# ---------------------------------------------------------------------------
set -euo pipefail

INSTALL_DIR="/opt/aurum"
DATA_DIR="/var/lib/aurum"
ENV_DIR="/etc/aurum"
SERVICE_USER="aurum"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_OFF='\033[0m'
info()  { echo -e "${C_GREEN}[aurum]${C_OFF} $*"; }
warn()  { echo -e "${C_YELLOW}[aurum]${C_OFF} $*"; }
fail()  { echo -e "${C_RED}[aurum]${C_OFF} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run as root (sudo bash uninstall.sh)."

if [ ! -d "$INSTALL_DIR" ] && [ ! -f /etc/systemd/system/aurum.service ]; then
  fail "No Aurum install found on this machine."
fi

info "Stopping and removing the service…"
systemctl disable --now aurum.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/aurum.service
systemctl daemon-reload

# Only remove the update command if it's ours.
for cmd in /usr/bin/update /usr/bin/aurum-update; do
  if [ -f "$cmd" ] && grep -q "Update Aurum" "$cmd" 2>/dev/null; then
    rm -f "$cmd"
  fi
done

info "Removing app ($INSTALL_DIR) and config ($ENV_DIR)…"
rm -rf "$INSTALL_DIR" "$ENV_DIR"
userdel "$SERVICE_USER" >/dev/null 2>&1 || true

# --- data: keep by default ---------------------------------------------------
PURGE="${AURUM_PURGE:-0}"
if [ -d "$DATA_DIR" ]; then
  if [ "$PURGE" != "1" ] && [ -t 0 ]; then
    read -rp "$(echo -e "${C_YELLOW}[aurum]${C_OFF} Also delete your data ($DATA_DIR — database + backups)? Type ${C_RED}delete${C_OFF} to confirm, anything else keeps it: ")" ANSWER
    [ "$ANSWER" = "delete" ] && PURGE=1
  fi
  if [ "$PURGE" = "1" ]; then
    rm -rf "$DATA_DIR"
    info "Data deleted."
  else
    info "Data kept at $DATA_DIR — delete it manually, or rerun with AURUM_PURGE=1."
  fi
fi

info "Aurum uninstalled."
if grep -qa 'container=lxc' /proc/1/environ 2>/dev/null; then
  info "Tip: if this LXC container exists only for Aurum, destroy it from the"
  info "Proxmox host instead:  pct stop <ctid> && pct destroy <ctid>"
fi
