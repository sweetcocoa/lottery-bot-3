import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createReceiptId, loadPurchaseRecord, savePurchaseRecord, type PurchaseRecord } from '../core/purchase-record.ts';
import { resolveLottoTickets, resolvePensionTickets } from '../core/random-picks.ts';
import { BrowserDhlotteryProvider } from '../providers/dhlottery/browser.ts';
import { MockDhlotteryProvider } from '../providers/dhlottery/mock.ts';
import { TelegramClient } from '../providers/telegram/client.ts';

export interface BuyOptions {
  mode: 'dry-run' | 'live';
  provider?: 'mock' | 'browser';
  force?: boolean;
  seed?: string;
  targetWeek?: string;
}

export async function runBuyCommand(options: BuyOptions): Promise<PurchaseRecord> {
  const config = await loadConfig();
  const week = getWeekContext(new Date(), options.targetWeek);
  const seed = options.seed ?? `${week.week}:${options.mode}`;
  const lottoTickets = resolveLottoTickets(config.lotto, seed);
  const pensionTickets = resolvePensionTickets(config.pension, seed);
  const provider = options.provider ?? (options.mode === 'live' ? 'browser' : 'mock');
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
  } else {
    const username = process.env.DHLOTTERY_USERNAME;
    const password = process.env.DHLOTTERY_PASSWORD;
    if (!username || !password) {
      throw new Error('DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD are required for browser provider');
    }
    const browser = new BrowserDhlotteryProvider();
    const result = await browser.purchase({ username, password, week: week.week, lottoTickets, pensionTickets });
    receiptId = result.receiptId;
  }

  const record: PurchaseRecord = {
    week: week.week,
    mode: options.mode,
    executedAt: new Date().toISOString(),
    lotto: {
      mode: config.lotto.mode,
      tickets: lottoTickets,
      count: config.lotto.count,
      drawRound: week.lottoRound,
      status: options.mode === 'live' ? 'purchased' : 'simulated',
      receiptId,
    },
    pension: {
      mode: config.pension.mode,
      tickets: pensionTickets,
      count: config.pension.count,
      drawRound: week.pensionRound,
      status: options.mode === 'live' ? 'purchased' : 'simulated',
      receiptId,
    },
    runContext: {
      workflow: 'buy.yml',
      runner: process.env.GITHUB_ACTIONS ? 'github' : 'local',
    },
  };

  await savePurchaseRecord(record);
  const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
  await telegram.send(`${prefix} buy completed for ${week.week}\nlotto=${lottoTickets.map((ticket) => ticket.join('-')).join(' | ')}\npension=${pensionTickets.map((ticket) => `${ticket.group}조 ${ticket.number}`).join(' | ')}`);
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
