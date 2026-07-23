#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPLICATIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$APPLICATIONS_DIR/challanse-local-pilot.desktop"

mkdir -p "$APPLICATIONS_DIR"
cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=ChallanSe Local Pilot
Comment=Open encrypted storage and start the supervised synthetic pilot
Exec=bash -lc '"$ROOT/scripts/challanse-local-launcher.sh"'
Terminal=true
Categories=Development;Utility;
StartupNotify=true
EOF
chmod 644 "$DESKTOP_FILE"
printf 'Desktop launcher installed: %s\n' "$DESKTOP_FILE"
printf 'Open your Applications menu and search for: ChallanSe Local Pilot\n'
