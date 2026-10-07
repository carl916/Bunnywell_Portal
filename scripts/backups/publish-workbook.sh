#!/usr/bin/env bash
set -Eeuo pipefail

: "${BACKUP_STAMP:?Database backup must complete first}"
: "${DATA_SNAPSHOT:?Missing database snapshot timestamp}"
: "${BACKUP_DATA_FILE:?Missing database dump}"
: "${RUNNER_TEMP:?Missing temporary directory}"
: "${DROPBOX_REMOTE:?Missing Dropbox remote}"
: "${DROPBOX_ROOT:?Missing backup root}"
: "${PROJECT_NAME:?Missing project name}"
[[ "$BACKUP_STAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z$ ]] || exit 1

BASE="${DROPBOX_REMOTE}:${DROPBOX_ROOT}/${PROJECT_NAME}"
PACKAGE="$RUNNER_TEMP/workbook-${BACKUP_STAMP}"
MEDIA="$RUNNER_TEMP/workbook-media-${BACKUP_STAMP}"
ARCHIVE="$RUNNER_TEMP/Bunnywell-${BACKUP_STAMP}.zip"
REMOTE="$BASE/workbooks/$BACKUP_STAMP"
RUN_URL="https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
mkdir -p "$MEDIA"

# Copy the verified Storage mirror. The exporter selects original, non-redacted
# business documents and verifies every referenced file before publishing.
rclone copy "$BASE/storage/current" "$MEDIA" --transfers 4 --checkers 8 --retries 3
node scripts/backups/generate-workbook.mjs \
  "--dump=$BACKUP_DATA_FILE" "--media=$MEDIA" "--output=$PACKAGE" \
  "--snapshot=$DATA_SNAPSHOT" "--runUrl=$RUN_URL"

# Never upload operational records to public GitHub workflow artifacts or logs.
# Folder access inherits the existing restricted Dropbox backup destination.
(cd "$PACKAGE" && zip -q -r "$ARCHIVE" .)
unzip -tq "$ARCHIVE" >/dev/null
rclone copy "$PACKAGE" "$REMOTE/package" --transfers 4 --checkers 8 --retries 3
rclone check "$PACKAGE" "$REMOTE/package" --one-way --download
rclone copyto "$ARCHIVE" "$REMOTE/Bunnywell.zip"
# Verify the exact archive object before replacing Latest. A download compares
# bytes even when the local and remote backends use different hash algorithms.
rclone copyto "$REMOTE/Bunnywell.zip" "$RUNNER_TEMP/workbook-verify-${BACKUP_STAMP}.zip"
cmp --silent "$ARCHIVE" "$RUNNER_TEMP/workbook-verify-${BACKUP_STAMP}.zip"

# One Dropbox file commit replaces the complete package; no partially synced
# Latest folder and no nightly writes to users' editable working logs.
rclone copyto "$ARCHIVE" "$BASE/workbooks/Latest.zip"
rclone copyto "$BASE/workbooks/Latest.zip" "$RUNNER_TEMP/workbook-latest-verify-${BACKUP_STAMP}.zip"
cmp --silent "$ARCHIVE" "$RUNNER_TEMP/workbook-latest-verify-${BACKUP_STAMP}.zip"
printf 'Latest successful workbook backup: %s\nSnapshot: %s\nRun: %s\nDownload and extract Latest.zip, then open Bunnywell.xlsx.\n' "$BACKUP_STAMP" "$DATA_SNAPSHOT" "$RUN_URL" > "$RUNNER_TEMP/workbook-latest.txt"
rclone copyto "$RUNNER_TEMP/workbook-latest.txt" "$BASE/workbooks/Latest.txt"
echo "Workbook package published and verified."
