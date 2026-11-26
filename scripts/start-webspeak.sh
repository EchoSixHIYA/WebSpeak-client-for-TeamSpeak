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

# A backup can only repair a missing-code install if it is complete. Partial
# backups are still resumable when they belong to the active task.
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

state_file="$data_dir/updates/state.json"
lock_file="$data_dir/updates/update.lock"
read_update_task() {
  task_id=""
  task_status=""
  if [ -f "$state_file" ]; then
    task_id=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$state_file" | head -n 1)
    task_status=$(sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$state_file" | head -n 1)
  fi
  case "$task_id" in
    ""|*[!A-Za-z0-9_-]*) task_id="" ;;
  esac
}
read_update_task

process_start() {
  # After the last ')' field 3 is first; starttime (field 22) is twentieth.
  if [ -r "/proc/$1/stat" ]; then
    sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print $20}'
  fi
}

release_recovery_lock() {
  if [ "${lock_owned:-0}" = 1 ] && [ "$(cat "$lock_file" 2>/dev/null)" = "$lock_payload" ]; then
    rm -f -- "$lock_file"
  fi
  lock_owned=0
}

acquire_recovery_lock() {
  # Share the updater's exclusive-create JSON lock. A distinct task id stops
  # a delayed restart runner from taking this recovery lock over. Keep it for
  # the entire restore, and only reclaim a proven-dead, unchanged owner.
  mkdir -p "$data_dir/updates"
  lock_owned=0
  start=$(process_start "$$")
  lock_payload="{\"pid\":$$,\"taskId\":\"recovery_$$\",\"createdAt\":\"\",\"processStart\":\"$start\"}"
  for attempt in 1 2 3 4; do
    if (umask 077; set -C; printf '%s\n' "$lock_payload" > "$lock_file") 2>/dev/null; then
      lock_owned=1
      trap 'release_recovery_lock' 0
      trap 'exit 1' HUP INT TERM
      return 0
    fi
    observed=$(cat "$lock_file" 2>/dev/null) || return 1
    owner=$(printf '%s\n' "$observed" | sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\)[[:space:]]*[,}].*/\1/p' | head -n 1)
    owner_task=$(printf '%s\n' "$observed" | sed -n 's/.*"taskId"[[:space:]]*:[[:space:]]*"\([^"]\{1,\}\)".*/\1/p' | head -n 1)
    case "$owner" in ""|*[!0-9]*) return 1 ;; esac
    [ -n "$owner_task" ] || return 1
    if [ "$owner" != 0 ]; then
      if kill -0 "$owner" 2>/dev/null || [ -d "/proc/$owner" ]; then
        saved_start=$(printf '%s\n' "$observed" | sed -n 's/.*"processStart"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
        current_start=$(process_start "$owner")
        # Unknown markers and inaccessible processes are conservatively live.
        if [ -z "$saved_start" ] || [ -z "$current_start" ] || [ "$saved_start" = "$current_start" ]; then
          return 1
        fi
      elif [ ! -d /proc ]; then
        return 1
      fi
    fi
    [ "$(cat "$lock_file" 2>/dev/null)" = "$observed" ] || continue
    rm -f -- "$lock_file" || return 1
  done
  return 1
}

recovery_needed() {
  if code_missing; then
    return 0
  fi
  case "$task_status" in
    downloading|verifying|extracting|staging|restarting)
      [ -n "$task_id" ] && [ -d "$backups/$task_id" ] && [ -f "$backups/$task_id/.webspeak-swap.json" ]
      return $?
      ;;
  esac
  return 1
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

if recovery_needed; then
  if ! acquire_recovery_lock; then
    echo "WebSpeak update or recovery is already running, or its lock cannot be verified; refusing to change application files." >&2
    exit 75
  fi
  # The runner may have completed between the first state read and the lock.
  read_update_task
fi

if [ "${lock_owned:-0}" = 1 ] && recovery_needed; then
  restore_backup=""

  # The interrupted task is the source of truth. Its backup may be partial
  # while the old tree is being saved or while a previous recovery is still
  # consuming it, but it must never be replaced by an older complete backup.
  if [ -n "$task_id" ] && [ -d "$backups/$task_id" ]; then
    candidate="$backups/$task_id"
    if task_backup_can_repair "$candidate"; then
      restore_backup="$candidate"
    fi
  else
    # No current task backup (e.g. state.json was lost): use the most recently
    # modified complete backup rather than whichever name happens to sort first.
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

release_recovery_lock
exec "$PWD/runtime/node" "$PWD/dist/index.js"
