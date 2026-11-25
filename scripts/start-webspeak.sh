#!/usr/bin/env sh
# WebSpeak official release launcher.
#
# This file is the single source of truth for the launcher shipped in release
# packages: .github/workflows/build-release.yml copies it verbatim, and the
# self-update pre-swap installer copies the same file from the staged package.
# Keep it a plain POSIX shell script: it must be able to repair an interrupted
# code swap before Node (dist/index.js) is available at all.
set -eu

cd -- "$(dirname -- "$0")"

# Mirrors src/index.ts: a custom data directory is the only supported override.
data_dir="${WEBSPEAK_DATA_DIR:-$PWD/data}"
backups="$data_dir/updates/backups"

# Only executable code is swapped by the updater. data/, config.json, certs/,
# identities, skins and plugins are deliberately never listed here.
code_entries="dist web/dist node_modules runtime package.json package-lock.json README.md LICENSE config.example.json start-webspeak.cmd"
required_entries="dist/index.js web/dist/index.html node_modules package.json runtime/node"

code_missing() {
  for entry in $required_entries; do
    if [ ! -e "$entry" ]; then
      return 0
    fi
  done
  return 1
}

# A backup can only repair an install if it recorded a swap and still holds
# every entry needed to boot. Partial/legacy backups must be skipped.
backup_is_complete() {
  [ -f "$1/.webspeak-swap.json" ] || return 1
  for entry in $required_entries; do
    [ -e "$1/$entry" ] || return 1
  done
  return 0
}

# During the first phase of a swap, only some old entries have been moved.
# The rest still live at the install root. The current task can be recovered
# from that union, including a kill between rename and manifest persistence.
# Never combine a stale task's partial backup with this install.
task_backup_can_repair() {
  [ -f "$1/.webspeak-swap.json" ] || return 1
  for entry in $required_entries; do
    if [ ! -e "$1/$entry" ] && [ ! -e "$entry" ]; then
      return 1
    fi
  done
  return 0
}

restore_from_backup() {
  backup="$1"
  # Move whatever partial new code the interrupted swap left in the install
  # root aside, so a later restore never mistakes it for the old tree.
  for entry in $code_entries; do
    if [ -e "$entry" ] && [ -e "$backup/$entry" ]; then
      rejected="$backup/rejected/$entry"
      rejected_parent="${rejected%/*}"
      mkdir -p "$rejected_parent"
      if [ -e "$rejected" ]; then
        rm -rf -- "$entry"
      else
        mv -- "$entry" "$rejected"
      fi
    fi
  done
  # Put back every complete entry recorded by the swap manifest.
  for entry in $code_entries; do
    if [ ! -e "$entry" ] && [ -e "$backup/$entry" ]; then
      parent="${entry%/*}"
      if [ "$parent" != "$entry" ]; then
        mkdir -p "$parent"
      fi
      mv -- "$backup/$entry" "$entry"
    fi
  done
}

if code_missing; then
  restore_backup=""

  # The interrupted task is the source of truth: backups/<task.id> holds the
  # exact version that was running before the swap. A successful earlier
  # update leaves its backup behind (M1 does not clean it up), so picking the
  # first or alphabetically smallest backup can resurrect a much older build.
  state_file="$data_dir/updates/state.json"
  task_id=""
  if [ -f "$state_file" ]; then
    task_id=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$state_file" | head -n 1)
  fi
  # Task ids are generated as upd_<base36>_<hex>. Reject anything else so a
  # tampered state.json cannot become a path traversal or a glob pattern.
  case "$task_id" in
    ""|*[!A-Za-z0-9_-]*) task_id="" ;;
  esac
  if [ -n "$task_id" ]; then
    candidate="$backups/$task_id"
    if task_backup_can_repair "$candidate"; then
      restore_backup="$candidate"
    fi
  fi

  # No usable task backup (e.g. state.json was lost): use the most recently
  # modified complete backup rather than whichever name happens to sort first.
  if [ -z "$restore_backup" ]; then
    for manifest in "$backups"/*/.webspeak-swap.json; do
      [ -f "$manifest" ] || continue
      backup="${manifest%/.webspeak-swap.json}"
      backup_is_complete "$backup" || continue
      if [ -z "$restore_backup" ] || [ "$backup" -nt "$restore_backup" ]; then
        restore_backup="$backup"
      fi
    done
  fi

  if [ -z "$restore_backup" ]; then
    echo "WebSpeak update was interrupted and automatic recovery from $backups failed." >&2
    exit 1
  fi

  restore_from_backup "$restore_backup"
  if code_missing; then
    echo "WebSpeak update was interrupted and automatic recovery from $restore_backup failed." >&2
    exit 1
  fi
fi

exec "$PWD/runtime/node" "$PWD/dist/index.js"
