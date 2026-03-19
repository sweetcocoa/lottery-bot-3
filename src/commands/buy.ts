import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createReceiptId, loadPurchaseRecord, savePurchaseRecord, type PurchaseRecord } from '../core/purchase-record.ts';
import { resolveLottoTickets, resolvePensionTickets } from '../core/random-picks.ts';
import { BrowserDhlotteryProvider } from '../providers/dhlottery/browser.ts';
import { DhlotteryHistoryProvider } from '../providers/dhlottery/history.ts';
import { MockDhlotteryProvider } from '../providers/dhlottery/mock.ts';
import { TelegramClient } from '../providers/telegram/client.ts';

export interface BuyOptions {
  mode: 'dry-run' | 'smoke' | 'live';
  provider?: 'mock' | 'browser';
  force?: boolean;
  seed?: string;
  targetWeek?: string;
}

export async function runBuyCommand(options: BuyOptions): Promise<PurchaseRecord | void> {
  const config = await loadConfig();
  const week = getWeekContext(new Date(), options.targetWeek);
  const seed = options.seed ?? `${week.week}:${options.mode}`;
  const lottoTickets = resolveLottoTickets(config.lotto, seed);
  const pensionTickets = resolvePensionTickets(config.pension, seed);
  let recordLottoTickets = lottoTickets;
  let recordPensionTickets = pensionTickets;
  let lottoStatus: 'purchased' | 'simulated' | 'skipped' = options.mode === 'live' ? 'purchased' : 'simulated';
  let pensionStatus: 'purchased' | 'simulated' | 'skipped' = options.mode === 'live' ? 'purchased' : 'simulated';
  const provider = options.provider ?? (options.mode === 'dry-run' ? 'mock' : 'browser');
  const telegram = new TelegramClient();

  if (options.mode === 'live' && !options.force && await hasCurrentWeekPurchase(week.week)) {
    const existing = await loadPurchaseRecord();
    await telegram.send(`${config.notifications.live_prefix} buy skipped for ${week.week}\nexisting purchase record already present.`);
    return existing;
  }

  let receiptId = createReceiptId(provider, week.week);
  if (provider === 'mock') {
    const mock = new MockDhlotteryProvider();
    const result = await mock.purchase({ mode: options.mode, week: week.week, lottoTickets, pensionTickets });
    receiptId = result.receiptId;
    if (options.mode === 'smoke') {
      await telegram.send(`${config.notifications.live_prefix} [SMOKE] buy readiness check completed for ${week.week}\n${result.diagnosticsPath}`);
      return;
    }
  } else {
    const username = process.env.DHLOTTERY_USERNAME;
    const password = process.env.DHLOTTERY_PASSWORD;
    if (!username || !password) {
      throw new Error('DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD are required for browser provider');
    }
    let lottoTicketsToBuy = lottoTickets;
    let pensionTicketsToBuy = pensionTickets;
    if (options.mode === 'live' && !options.force) {
      const history = new DhlotteryHistoryProvider();
      const presence = await history.loadWeeklyPurchasePresence({
        username,
        password,
        week: week.week,
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
      });
      if (presence.lottoCount > 0) {
        lottoTicketsToBuy = [];
        lottoStatus = 'skipped';
      }
      if (presence.pensionCount > 0) {
        pensionTicketsToBuy = [];
        pensionStatus = 'skipped';
      }
      if (lottoTicketsToBuy.length === 0 && pensionTicketsToBuy.length === 0) {
        await telegram.send(`${config.notifications.live_prefix} buy skipped for ${week.week}\nlotto and pension purchases already exist in purchase history.`);
        return;
      }
    }
    recordLottoTickets = lottoTicketsToBuy;
    recordPensionTickets = pensionTicketsToBuy;
    const browser = new BrowserDhlotteryProvider();
    if (options.mode === 'smoke') {
      const result = await browser.smoke({ username, password, week: week.week, lottoTickets, pensionTickets });
      await telegram.send(`${config.notifications.live_prefix} [SMOKE] buy readiness check completed for ${week.week}\n${result.diagnosticsPath}`);
      return;
    }
    const result = await browser.purchase({
      username,
      password,
      week: week.week,
      lottoTickets: lottoTicketsToBuy,
      pensionTickets: pensionTicketsToBuy,
    });
    receiptId = result.receiptId ?? receiptId;
  }

  const record: PurchaseRecord = {
    week: week.week,
    mode: options.mode === 'smoke' ? 'dry-run' : options.mode,
    executedAt: new Date().toISOString(),
    lotto: {
      mode: config.lotto.mode,
      tickets: recordLottoTickets,
      count: recordLottoTickets.length,
      drawRound: week.lottoRound,
      status: lottoStatus,
      receiptId,
    },
    pension: {
      mode: config.pension.mode,
      tickets: recordPensionTickets,
      count: recordPensionTickets.length,
      drawRound: week.pensionRound,
      status: pensionStatus,
      receiptId,
    },
    runContext: {
      workflow: 'buy.yml',
      runner: process.env.GITHUB_ACTIONS ? 'github' : 'local',
    },
  };

  await savePurchaseRecord(record);
  const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
  await telegram.send(`${prefix} buy completed for ${week.week}\nlotto=${recordLottoTickets.map((ticket) => ticket.join('-')).join(' | ') || 'skipped'}\npension=${recordPensionTickets.map((ticket) => `${ticket.group}조 ${ticket.number}`).join(' | ') || 'skipped'}`);
  return record;
}

async function hasCurrentWeekPurchase(week: string): Promise<boolean> {
  try {
    await access('artifacts/purchase-record.json', constants.F_OK);
    const existing = await loadPurchaseRecord();
    return existing.week === week && existing.mode === 'live';
  } catch {
    return false;
  }
}
