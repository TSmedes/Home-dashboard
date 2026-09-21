#!/bin/sh
set -e

# First run: seed a working config so `docker compose up` produces a live
# dashboard (clock and weather need no credentials) instead of an error.
CONFIG="${CONFIG_PATH:-/app/config/config.yaml}"
if [ ! -f "$CONFIG" ]; then
  echo "No config.yaml found - copying the example to $CONFIG"
  echo "Edit it to set your location, then the dashboard reloads by itself."
  cp /app/config/config.example.yaml "$CONFIG"
fi

exec "$@"
