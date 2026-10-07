#!/usr/bin/env bash
# Exercise the real publication script with local transport faults. No network,
# real credentials or application records are used.
set -Eeuo pipefail
mkdir -p test-results
TEST_ROOT="$(mktemp -d "$PWD/test-results/workbook-publication.XXXXXX")"

node() { mkdir -p "$PACKAGE"; printf 'test workbook' > "$PACKAGE/Bunnywell.xlsx"; }
zip() { printf 'verified test archive' > "$3"; }
unzip() { return 0; }
rclone() {
  local action="$1" source="${2:-}" target="${3:-}"
  source="${source/dropbox:/$ROOT/remote/}"
  target="${target/dropbox:/$ROOT/remote/}"
  case "$action" in
    copy)
      mkdir -p "$target"
      # The mirror is empty in this transport-only fixture.
      if [[ "$source" != */storage/current ]]; then cp -R "$source/." "$target/"; fi
      ;;
    check) [[ "$SCENARIO" != failed-file-check ]] ;;
    copyto)
      mkdir -p "$(dirname "$target")"
      if [[ "$SCENARIO" == corrupt-archive && "$target" == *workbook-verify-*.zip ]]; then
        printf 'corrupt download' > "$target"
      else
        cp "$source" "$target"
      fi
      ;;
    *) return 99 ;;
  esac
}
export -f node zip unzip rclone

for SCENARIO in success failed-file-check corrupt-archive; do
  ROOT="$TEST_ROOT/$SCENARIO"
  export ROOT SCENARIO
  export RUNNER_TEMP="$ROOT/temp" DROPBOX_REMOTE=dropbox DROPBOX_ROOT=backups PROJECT_NAME=test
  export BACKUP_STAMP=2026-10-07T02-17-00Z DATA_SNAPSHOT=2026-10-07T02:17:00Z BACKUP_DATA_FILE=unused.sql
  export GITHUB_REPOSITORY=example/test GITHUB_RUN_ID=1
  mkdir -p "$RUNNER_TEMP" "$ROOT/remote/backups/test/workbooks"
  printf 'last good package' > "$ROOT/remote/backups/test/workbooks/Latest.zip"
  set +e
  # Normalise a Windows working copy for this local check; GitHub checks out LF.
  bash -c 'source <(tr -d "\r" < scripts/backups/publish-workbook.sh)' > "$ROOT/result.txt" 2>&1
  result=$?
  set -e
  actual="$(cat "$ROOT/remote/backups/test/workbooks/Latest.zip")"
  if [[ "$SCENARIO" == success ]]; then
    [[ "$result" == 0 && "$actual" == 'verified test archive' ]]
    test -s "$ROOT/remote/backups/test/workbooks/Latest.txt"
  else
    [[ "$result" != 0 && "$actual" == 'last good package' ]]
  fi
  printf 'Publication scenario passed: %s\n' "$SCENARIO"
done
