#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

script="scripts/local-pilot.sh"
# shellcheck disable=SC2016 # These are intentional literal source-code assertions.
container_declaration='CONTAINER_FILE="$HOST_MOUNT/challanse-local.luks"'
# shellcheck disable=SC2016
container_allocation='sudo fallocate -l "$CONTAINER_SIZE_BYTES" "$CONTAINER_FILE"'
# shellcheck disable=SC2016
container_encryption='sudo cryptsetup luksFormat --type luks2 "$CONTAINER_FILE"'
# shellcheck disable=SC2016
host_partition_format_pattern='cryptsetup luksFormat.*\$HOST_DEVICE|mkfs\..*\$HOST_DEVICE|ERASE-/dev/sda2'
# shellcheck disable=SC2016
bind_mount_command='sudo mount --bind "$current_mount" "$HOST_MOUNT"'
# shellcheck disable=SC2016
mount_uuid_guard='[[ "$mounted_uuid" == "$expected_uuid" ]]'
# shellcheck disable=SC2016
host_uuid_read='expected_uuid="$(lsblk -dn -o UUID "$HOST_DEVICE" | tr -d '\'' '\'')"'
# shellcheck disable=SC2016
free_space_read='df -B1 --output=avail "$HOST_MOUNT"'
# shellcheck disable=SC2016
container_validation='sudo cryptsetup isLuks "$CONTAINER_FILE"'
# shellcheck disable=SC2016
container_removal='sudo rm -- "$CONTAINER_FILE"'

bash -n "$script"
grep -Fq "$container_declaration" "$script"
grep -Fq 'CONTAINER_SIZE="20G"' "$script"
grep -Fq 'CONTAINER_SIZE_BYTES="21474836480"' "$script"
grep -Fq 'ufw cryptsetup mkfs.ext4 fallocate' "$script"
grep -Fq "$bind_mount_command" "$script"
grep -Fq "$mount_uuid_guard" "$script"
grep -Fq "$host_uuid_read" "$script"
grep -Fq "$free_space_read" "$script"
grep -Fq 'RECOVER-INCOMPLETE-CHALLANSE-CONTAINER' "$script"
grep -Fq "$container_validation" "$script"
grep -Fq "$container_removal" "$script"
grep -Fq 'root:root:600:1' "$script"
if grep -Fq 'df -PB1 --output' "$script"; then
  echo "Local pilot storage check must not combine mutually exclusive df options." >&2
  exit 1
fi
grep -Fq 'CREATE-20GB-ENCRYPTED-CHALLANSE-CONTAINER' "$script"
grep -Fq "$container_allocation" "$script"
grep -Fq "$container_encryption" "$script"
grep -Fq 'storage-open       Open the encrypted container after reboot' "$script"
grep -Fq 'storage-close      Close the encrypted container after stopping services' "$script"

if grep -Eq "$host_partition_format_pattern" "$script"; then
  echo "Local pilot storage workflow must never format or erase the host partition." >&2
  exit 1
fi

echo "Local pilot file-backed LUKS storage safety checks passed."
