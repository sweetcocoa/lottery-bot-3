#!/bin/sh
set -eu

NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  latest_node_dir="$(find "$HOME/.nvm/versions/node" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
  if [ -n "$latest_node_dir" ] && [ -x "$latest_node_dir/bin/node" ]; then
    NODE_BIN="$latest_node_dir/bin/node"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

set -a
. ./config/local.env
set +a
"$NODE_BIN" --experimental-strip-types src/cli.ts buy --mode=live-check "$@"
