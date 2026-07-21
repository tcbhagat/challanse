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
# shellcheck disable=SC2016
exact_data_mount_source='findmnt -n -o SOURCE --mountpoint "$DATA_ROOT"'
# shellcheck disable=SC2016
mount_data_root_when_absent='if ! mountpoint -q "$DATA_ROOT"; then'
# shellcheck disable=SC2016
mounted_data_root_guard='if mountpoint -q "$DATA_ROOT"; then'
# shellcheck disable=SC2016
covering_mount_pattern='findmnt .*--target "\$DATA_ROOT"|findmnt .* -T "\$DATA_ROOT"'
# shellcheck disable=SC2016
server_certificate_refresh='generate_server_certificate "$lan_ip"'
# shellcheck disable=SC2016
container_data_root_env='LOCAL_DATA_ROOT=$CONTAINER_DATA_ROOT'

bash -n "$script"
grep -Fq "$container_declaration" "$script"
grep -Fq 'CONTAINER_SIZE="20G"' "$script"
grep -Fq 'CONTAINER_SIZE_BYTES="21474836480"' "$script"
grep -Fq 'DATA_ROOT="/mnt/challanse-data"' "$script"
grep -Fq 'LEGACY_DATA_ROOT="/srv/challanse"' "$script"
grep -Fq 'CONTAINER_DATA_ROOT="/srv/challanse"' "$script"
grep -Fq "$container_data_root_env" "$script"
grep -Fq 'require_docker_storage_visibility' "$script"
grep -Fq 'ufw cryptsetup mkfs.ext4 fallocate' "$script"
grep -Fq "$bind_mount_command" "$script"
grep -Fq "$mount_uuid_guard" "$script"
grep -Fq "$host_uuid_read" "$script"
grep -Fq "$free_space_read" "$script"
grep -Fq 'RECOVER-INCOMPLETE-CHALLANSE-CONTAINER' "$script"
grep -Fq "$container_validation" "$script"
grep -Fq "$container_removal" "$script"
grep -Fq "$exact_data_mount_source" "$script"
grep -Fq "$mount_data_root_when_absent" "$script"
grep -Fq "$mounted_data_root_guard" "$script"
grep -Fq 'root:root:600:1' "$script"
if grep -Eq "$covering_mount_pattern" "$script"; then
  echo "Encrypted storage checks must test the exact mountpoint, not the covering root filesystem." >&2
  exit 1
fi
if grep -Fq 'df -PB1 --output' "$script"; then
  echo "Local pilot storage check must not combine mutually exclusive df options." >&2
  exit 1
fi
grep -Fq 'CREATE-20GB-ENCRYPTED-CHALLANSE-CONTAINER' "$script"
grep -Fq "$container_allocation" "$script"
grep -Fq "$container_encryption" "$script"
grep -Fq 'storage-open       Open the encrypted container after reboot' "$script"
grep -Fq 'storage-close      Close the encrypted container after stopping services' "$script"
grep -Fq 'refresh-lan        Preserve secrets and CA while updating the local IP certificate' "$script"
grep -Fq 'refresh-lan) refresh_lan_configuration ;;' "$script"
grep -Fq "$server_certificate_refresh" "$script"
grep -Fq 'REFRESH-LOCAL-PILOT-LAN' "$script"
if sed -n '/refresh_lan_configuration()/,/^}/p' "$script" | grep -Fq 'generate_ca'; then
  echo "LAN refresh must preserve the existing pilot CA." >&2
  exit 1
fi

for guarded_function in reviewer_enroll enroll status_cmd config_check acceptance evidence reset_stack destroy_stack; do
  awk -v function_name="$guarded_function" '
    $0 == function_name "() {" { inside=1; remaining=4; next }
    inside && remaining-- > 0 && $0 ~ /^[[:space:]]+require_encrypted_storage$/ { found=1 }
    inside && $0 == "}" { inside=0 }
    END { exit(found ? 0 : 1) }
  ' "$script" || {
    echo "$guarded_function must fail before prompting or touching data when encrypted storage is closed." >&2
    exit 1
  }
done

if grep -Eq "$host_partition_format_pattern" "$script"; then
  echo "Local pilot storage workflow must never format or erase the host partition." >&2
  exit 1
fi

echo "Local pilot file-backed LUKS storage safety checks passed."
