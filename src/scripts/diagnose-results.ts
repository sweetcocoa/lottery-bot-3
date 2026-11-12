import { runSummarizeCommand } from '../commands/summarize.ts';
import { getWeekContext } from '../core/draw-calendar.ts';

if (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID) {
  throw new Error('Result diagnosis must run with Telegram notifications disabled');
}

const { week } = getWeekContext(new Date(), process.env.RESULT_TARGET_WEEK || undefined);
await runSummarizeCommand({ mode: 'live', targetWeek: week });
console.log(`Authenticated result summary generated for ${week}`);
