import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import { createReceiptId, savePurchaseRecord, type PurchaseRecord } from '../core/purchase-record.ts';
import { resolveLottoTickets, resolvePensionTickets } from '../core/random-picks.ts';
import { BrowserDhlotteryProvider } from '../providers/dhlottery/browser.ts';
import { DhlotteryHistoryProvider } from '../providers/dhlottery/history.ts';
import { MockDhlotteryProvider } from '../providers/dhlottery/mock.ts';
import { TelegramClient } from '../providers/telegram/client.ts';

export interface BuyOptions {
  mode: 'dry-run' | 'smoke' | 'live';
  product?: 'all' | 'lotto' | 'pension';
  provider?: 'mock' | 'browser';
  force?: boolean;
  seed?: string;
  targetWeek?: string;
}

export async function runBuyCommand(options: BuyOptions): Promise<PurchaseRecord | void> {
  const config = await loadConfig();
  const week = getWeekContext(new Date(), options.targetWeek);
  const seed = options.seed ?? `${week.week}:${options.mode}`;
  const product = options.product ?? 'all';
  const lottoTickets = product === 'pension' ? [] : resolveLottoTickets(config.lotto, seed);
  const pensionTickets = product === 'lotto' ? [] : resolvePensionTickets(config.pension, seed);
  let recordLottoTickets = lottoTickets;
  let recordPensionTickets = pensionTickets;
  let lottoStatus: 'purchased' | 'simulated' | 'skipped' = lottoTickets.length > 0 ? (options.mode === 'live' ? 'purchased' : 'simulated') : 'skipped';
  let pensionStatus: 'purchased' | 'simulated' | 'skipped' = pensionTickets.length > 0 ? (options.mode === 'live' ? 'purchased' : 'simulated') : 'skipped';
  const provider = options.provider ?? (options.mode === 'dry-run' ? 'mock' : 'browser');
  const telegram = new TelegramClient();
  const skipReasons: string[] = [];

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
      const unsettled = await history.loadUnsettledPurchasePresence({
        username,
        password,
        checkLotto: lottoTicketsToBuy.length > 0,
        checkPension: pensionTicketsToBuy.length > 0,
      });
      if (lottoTicketsToBuy.length > 0 && unsettled.lottoUnsettled) {
        lottoTicketsToBuy = [];
        lottoStatus = 'skipped';
        skipReasons.push(`lotto=skipped(unsettled round ${unsettled.lottoRound})`);
      }
      if (pensionTicketsToBuy.length > 0 && unsettled.pensionUnsettled) {
        pensionTicketsToBuy = [];
        pensionStatus = 'skipped';
        skipReasons.push(`pension=skipped(unsettled round ${unsettled.pensionRound})`);
      }
      if (lottoTicketsToBuy.length === 0 && pensionTicketsToBuy.length === 0) {
        await telegram.send([
          `${config.notifications.live_prefix} buy skipped for ${week.week}`,
          `product=${product}`,
          ...skipReasons,
        ].join('\n'));
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
    recordPensionTickets = result.actualPensionTickets ?? recordPensionTickets;
    if (recordPensionTickets.length === 0) {
      pensionStatus = 'skipped';
    }
  }

  const record = buildPurchaseRecord({
    config,
    week: week.week,
    mode: options.mode,
    receiptId,
    lottoTickets: recordLottoTickets,
    pensionTickets: recordPensionTickets,
    lottoStatus,
    pensionStatus,
    lottoRound: week.lottoRound,
    pensionRound: week.pensionRound,
  });

  if (options.mode !== 'live') {
    await savePurchaseRecord(record);
  }
  const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
  await telegram.send([
    `${prefix} buy completed for ${week.week}`,
    `product=${product}`,
    `lotto=${formatLottoSummary(recordLottoTickets, lottoStatus)}`,
    `pension=${formatPensionSummary(recordPensionTickets, pensionStatus)}`,
  ].join('\n'));
  return record;
}

function buildPurchaseRecord(input: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  week: string;
  mode: BuyOptions['mode'];
  receiptId: string;
  lottoTickets: PurchaseRecord['lotto']['tickets'];
  pensionTickets: PurchaseRecord['pension']['tickets'];
  lottoStatus: PurchaseRecord['lotto']['status'];
  pensionStatus: PurchaseRecord['pension']['status'];
  lottoRound: number;
  pensionRound: number;
}): PurchaseRecord {
  return {
    week: input.week,
    mode: input.mode === 'smoke' ? 'dry-run' : input.mode,
    executedAt: new Date().toISOString(),
    lotto: {
      mode: input.config.lotto.mode,
      tickets: input.lottoTickets,
      count: input.lottoTickets.length,
      drawRound: input.lottoRound,
      status: input.lottoStatus,
      receiptId: input.receiptId,
    },
    pension: {
      mode: input.config.pension.mode,
      tickets: input.pensionTickets,
      count: input.pensionTickets.length,
      drawRound: input.pensionRound,
      status: input.pensionStatus,
      receiptId: input.receiptId,
    },
    runContext: {
      workflow: 'buy.yml',
      runner: process.env.GITHUB_ACTIONS ? 'github' : 'local',
    },
  };
}

function formatLottoSummary(
  tickets: PurchaseRecord['lotto']['tickets'],
  status: PurchaseRecord['lotto']['status'],
): string {
  if (status === 'skipped') {
    return 'skipped';
  }
  return tickets.map((ticket) => ticket.join('-')).join(' | ') || 'skipped';
}

function formatPensionSummary(
  tickets: PurchaseRecord['pension']['tickets'],
  status: PurchaseRecord['pension']['status'],
): string {
  if (status === 'skipped') {
    return 'skipped';
  }
  return tickets.map((ticket) => `${ticket.group}조 ${ticket.number}`).join(' | ') || 'skipped';
}
