import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import { DhlotteryHistoryProvider } from '../providers/dhlottery/history.ts';

const username = process.env.DHLOTTERY_USERNAME;
const password = process.env.DHLOTTERY_PASSWORD;
if (!username || !password) {
  throw new Error('DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD are required');
}

const week = getWeekContext();
const record = await new DhlotteryHistoryProvider().loadWeeklyPurchaseRecord({
  username,
  password,
  week: week.week,
  weekStartDate: week.weekStartDate,
  weekEndDate: week.weekEndDate,
  config: await loadConfig(),
});
console.log(`Authenticated history loaded for ${week.week}: lotto=${record.lotto.count}, pension=${record.pension.count}`);
