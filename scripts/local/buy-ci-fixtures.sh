#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
unset DHLOTTERY_USERNAME DHLOTTERY_PASSWORD TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
export RUN_PURCHASE_FIXTURES=1
export TZ=Asia/Seoul

node -p '"Node " + process.version + " (" + process.platform + "/" + process.arch + ")"'
npm --version
if [ -n "${PURCHASE_FIXTURE_CHROME:-}" ]; then
  "$PURCHASE_FIXTURE_CHROME" --version
fi
npm ci --no-fund --no-audit
npm test
node --experimental-strip-types src/cli.ts buy --mode=dry-run
