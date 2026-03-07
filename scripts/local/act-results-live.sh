#!/bin/sh
set -eu
if [ ! -f config/local.env ]; then
  echo "config/local.env not found" >&2
  exit 1
fi
set -a
. ./config/local.env
set +a
ACT_ARCH="${ACT_ARCH:-linux/amd64}"
ACT_PLATFORM="${ACT_PLATFORM:-ubuntu-latest=catthehacker/ubuntu:act-latest}"
ACT_CACHE_DIR="${ACT_CACHE_DIR:-/tmp/lottery-bot-act-cache}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-/tmp/lottery-bot-xdg-cache}"
export ACT_CACHE_DIR XDG_CACHE_HOME
act workflow_dispatch \
  --bind \
  --container-architecture "$ACT_ARCH" \
  -P "$ACT_PLATFORM" \
  -W .github/workflows/results.yml \
  -e .github/events/results-live.json \
  "$@"
