#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/challanse-local"
ENV_FILE="$CONFIG_ROOT/local.env"

printf '\nChallanSe Local Pilot\n'
printf 'Synthetic data only. AWS remains frozen.\n\n'

cd "$ROOT"
sudo -v
./scripts/local-pilot.sh storage-open
./scripts/local-pilot.sh start --lan
./scripts/local-pilot.sh status

[[ -f "$ENV_FILE" ]] || {
  printf 'ERROR: Local pilot configuration is missing.\n' >&2
  exit 1
}
lan_ip="$(sed -n 's/^CHALLANSE_LAN_IP=//p' "$ENV_FILE" | head -n 1)"
[[ "$lan_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  printf 'ERROR: The configured LAN address is invalid.\n' >&2
  exit 1
}

operator_url="https://$lan_ip:8444/operator"
printf '\nOpening operator console: %s\n' "$operator_url"
xdg-open "$operator_url" >/dev/null 2>&1 || true
printf 'Keep this terminal open while starting or diagnosing the pilot.\n'
printf 'Safe stop command:\n  cd %q && ./scripts/local-pilot.sh stop && ./scripts/local-pilot.sh storage-close\n' "$ROOT"
read -r -p 'Press Enter to close this terminal. '
