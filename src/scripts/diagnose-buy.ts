import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import { resolveLottoTickets, resolvePensionTickets } from '../core/random-picks.ts';
import { BrowserDhlotteryProvider } from '../providers/dhlottery/browser.ts';
import { DhlotteryHistoryProvider, readUnsettledPurchasePresence, type UnsettledPurchasePresence } from '../providers/dhlottery/history.ts';

const username = process.env.DHLOTTERY_USERNAME;
const password = process.env.DHLOTTERY_PASSWORD;
if (!username || !password) throw new Error('Dhlottery credentials are required for read-only diagnosis');
if (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID) {
  throw new Error('Buy diagnosis must run with notifications disabled');
}

function report(result: UnsettledPurchasePresence): void {
  console.log(`Read-only buy preflight completed: lottoRound=${result.lottoRound}, pensionRound=${result.pensionRound}, lottoUnsettled=${result.lottoUnsettled}, pensionUnsettled=${result.pensionUnsettled}`);
}

if (process.env.BUY_CHECK_SCREENS === 'true') {
  const config = await loadConfig();
  const { week } = getWeekContext();
  await new BrowserDhlotteryProvider().smoke({
    username, password, week,
    lottoTickets: resolveLottoTickets(config.lotto, week),
    pensionTickets: resolvePensionTickets(config.pension, week),
  }, async (session) => report(await readUnsettledPurchasePresence(session, {})));
  console.log('Both purchase screens opened in the same authenticated session as preflight');
} else {
  report(await new DhlotteryHistoryProvider().loadUnsettledPurchasePresence({ username, password }));
}
