import { DhlotteryHistoryProvider } from '../providers/dhlottery/history.ts';

const username = process.env.DHLOTTERY_USERNAME;
const password = process.env.DHLOTTERY_PASSWORD;
if (!username || !password) throw new Error('Dhlottery credentials are required for read-only diagnosis');
if (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID) {
  throw new Error('Buy diagnosis must run with notifications disabled');
}

const result = await new DhlotteryHistoryProvider().loadUnsettledPurchasePresence({ username, password });
console.log(`Read-only buy preflight completed: lottoRound=${result.lottoRound}, pensionRound=${result.pensionRound}, lottoUnsettled=${result.lottoUnsettled}, pensionUnsettled=${result.pensionUnsettled}`);
