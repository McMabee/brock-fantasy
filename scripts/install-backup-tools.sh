#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This verified installer supports Linux x86_64 only.' >&2
  exit 1
fi
destination="${1:?Provide an ephemeral tool directory.}"
mkdir -p -- "$destination"
installer_tmp="$(mktemp -d)"
trap 'rm -rf -- "$installer_tmp"' EXIT

curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  'https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_linux_amd64.bz2' \
  --output "$installer_tmp/restic.bz2"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  'https://github.com/rclone/rclone/releases/download/v1.75.1/rclone-v1.75.1-linux-amd64.zip' \
  --output "$installer_tmp/rclone.zip"
printf '%s  %s\n' \
  'f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c' "$installer_tmp/restic.bz2" \
  '982b5aa772841168f8e380f139e9e787b2a105403e32b94da8676a0e1c0a13ab' "$installer_tmp/rclone.zip" \
  | sha256sum --check --status
bzip2 --decompress "$installer_tmp/restic.bz2"
unzip -q "$installer_tmp/rclone.zip" -d "$installer_tmp"
install -m 0755 "$installer_tmp/restic" "$destination/restic"
install -m 0755 "$installer_tmp/rclone-v1.75.1-linux-amd64/rclone" "$destination/rclone"
echo 'Verified restic 0.19.1 and rclone 1.75.1 installed.'
