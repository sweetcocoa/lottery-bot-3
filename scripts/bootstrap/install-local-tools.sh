#!/bin/sh
set -eu

missing=0
for cmd in docker node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing required command: $cmd" >&2
    missing=1
  fi
done

if ! command -v act >/dev/null 2>&1; then
  echo "missing optional command: act" >&2
  echo "install with: brew install act" >&2
fi

if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo "local prerequisites look OK"
