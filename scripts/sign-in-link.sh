#!/usr/bin/env bash
# Prints a one-time sign-in link (valid 15 min). Run where the server's secret is readable:
#   scripts/sign-in-link.sh you@example.com            (this machine)
#   docker compose exec openkrishbot scripts/sign-in-link.sh you@example.com
set -euo pipefail
email="${1:?usage: sign-in-link.sh you@example.com}"
secret="${SESSION_SECRET:-$(cat "$HOME/.openkrishbot/session-secret")}"
key=$(printf 'owner-login' | openssl dgst -sha256 -hmac "$secret" -r | cut -d' ' -f1)
curl -fsS -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"link\":true}" "http://127.0.0.1:${PORT:-8787}/api/auth/owner" | sed -E 's/.*"url":"([^"]+)".*/\1/'
