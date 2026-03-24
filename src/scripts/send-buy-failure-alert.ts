import { TelegramClient } from '../providers/telegram/client.ts';

async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const mode = process.env.BUY_MODE ?? 'live';
  const product = process.env.BUY_PRODUCT ?? 'all';
  const telegram = new TelegramClient();

  const lines = [
    '[LIVE] buy failed',
    `mode=${mode}`,
    `product=${product}`,
  ];

  if (repository && runId) {
    lines.push(`run=https://github.com/${repository}/actions/runs/${runId}`);
    lines.push(`artifact=buy-diagnostics-${runId}`);
  }

  await telegram.send(lines.join('\n'));
}

await main();
