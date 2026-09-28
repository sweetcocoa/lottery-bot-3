import { createBrowserSession } from '../providers/dhlottery/session.ts';
import { loginForHistory } from '../providers/dhlottery/history-login.ts';
import { DhlotteryHistoryProvider } from '../providers/dhlottery/history.ts';

const username = process.env.DHLOTTERY_USERNAME;
const password = process.env.DHLOTTERY_PASSWORD;
if (!username || !password) throw new Error('Dhlottery credentials are required for read-only diagnosis');
if (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID) {
  throw new Error('Buy diagnosis must run with notifications disabled');
}

const { browser, page } = await createBrowserSession();
try {
  await loginForHistory(page.context().request, username, password);
  await page.goto('https://www.dhlottery.co.kr/mypage/mylotteryledger', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => typeof (window as any).MyLotteryledgerM?.fn_selectMyLotteryledger === 'function', null, { timeout: 15000 });
  console.log(await page.evaluate(() => (window as any).MyLotteryledgerM.fn_selectMyLotteryledger.toString()));
} finally {
  await browser.close();
}

const result = await new DhlotteryHistoryProvider().loadUnsettledPurchasePresence({ username, password });
console.log(`Read-only buy preflight completed: lottoUnsettled=${result.lottoUnsettled}, pensionUnsettled=${result.pensionUnsettled}`);
