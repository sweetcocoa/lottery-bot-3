import { runSummarizeCommand } from '../commands/summarize.ts';

if (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID) {
  throw new Error('Result diagnosis must run with Telegram notifications disabled');
}

const summary = await runSummarizeCommand({ mode: 'live' });
if (!summary.includes('lotto round=') || !summary.includes('winning=')
  || !summary.includes('pension round=') || summary.includes('result=')) {
  throw new Error('Result diagnosis did not resolve both published product results');
}
console.log(`Authenticated result summary generated for ${summary.match(/^week=(\S+)/)?.[1] ?? 'unknown week'}`);
