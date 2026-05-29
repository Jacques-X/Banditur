#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/banditur-updater.key}"
PASS_PATH="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD_PATH:-$HOME/.tauri/banditur-updater.key.password}"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Missing updater private key: $KEY_PATH" >&2
  exit 1
fi

if [[ -f "$PASS_PATH" && -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(<"$PASS_PATH")"
fi

export TAURI_SIGNING_PRIVATE_KEY="$KEY_PATH"

cd "$ROOT"
npm run tauri build
