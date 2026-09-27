import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import type { PurchaseRecord } from '../core/purchase-record.ts';
import { loadPurchaseSnapshot } from '../core/purchase-snapshot.ts';
import { DhlotteryHistoryProvider } from '../providers/dhlottery/history.ts';
import { fetchLottoResult, fetchPensionResult, isResultNotPublishedError, loadFixtureResults } from '../providers/results/fetcher.ts';
import { TelegramClient } from '../providers/telegram/client.ts';

export interface SummarizeOptions {
  mode: 'dry-run' | 'live';
  purchaseSource?: 'history' | 'local-fixture';
  targetWeek?: string;
}

function countLottoMatches(ticket: number[], winning: number[]): number {
  return ticket.filter((value) => winning.includes(value)).length;
}

function formatSummary(record: PurchaseRecord, input: {
  lotto?: { numbers: number[] };
  pension?: { winningNumbers: Array<{ group: number; number: string }> };
  lottoPending: boolean;
  pensionPending: boolean;
}): string {
  const lottoLines = !record.lotto.tickets.length
    ? ['lotto=no ticket for this draw week']
    : input.lotto
      ? [
          `lotto round=${record.lotto.drawRound} winning=${input.lotto.numbers.join('-')}`,
          ...record.lotto.tickets.map((ticket) => `- ${ticket.join('-')} => ${countLottoMatches(ticket, input.lotto!.numbers)} match(es)`),
        ]
      : [`lotto round=${record.lotto.drawRound} result=${input.lottoPending ? 'not published yet' : 'unavailable'}`];
  const pensionLines = !record.pension.tickets.length
    ? ['pension=no ticket for this draw week']
    : input.pension
      ? [
          `pension round=${record.pension.drawRound}`,
          ...record.pension.tickets.map((ticket) => {
            const matched = input.pension!.winningNumbers.some((winner) => winner.group === ticket.group && winner.number === ticket.number);
            return `- ${ticket.group}조 ${ticket.number} => ${matched ? 'match' : 'no match'}`;
          }),
        ]
      : [`pension round=${record.pension.drawRound} result=${input.pensionPending ? 'not published yet' : 'unavailable'}`];
  return [
    `week=${record.week}`,
    ...lottoLines,
    ...pensionLines,
  ].join('\n');
}

async function loadRecord(options: {
  mode: 'dry-run' | 'live';
  purchaseSource: 'history' | 'local-fixture';
  config: Awaited<ReturnType<typeof loadConfig>>;
  week: ReturnType<typeof getWeekContext>;
}): Promise<{ record: PurchaseRecord; source: 'fixture' | 'history' | 'snapshot' }> {
  if (options.purchaseSource === 'local-fixture') {
    const raw = await readFile('src/testing/fixtures/purchase-record.fixture.json', 'utf8');
    return { record: JSON.parse(raw) as PurchaseRecord, source: 'fixture' };
  }

  const username = process.env.DHLOTTERY_USERNAME;
  const password = process.env.DHLOTTERY_PASSWORD;
  return loadRecordWithFallback(
    () => {
      if (!username || !password) {
        throw new Error('DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD are required to load purchase history from dhlottery.co.kr');
      }
      return new DhlotteryHistoryProvider().loadWeeklyPurchaseRecord({
        username,
        password,
        week: options.week.week,
        weekStartDate: options.week.weekStartDate,
        weekEndDate: options.week.weekEndDate,
        config: options.config,
      });
    },
    () => loadPurchaseSnapshot(options.week.week),
  );
}

export async function loadRecordWithFallback(
  loadHistory: () => Promise<PurchaseRecord>,
  loadSnapshot: () => Promise<PurchaseRecord>,
): Promise<{ record: PurchaseRecord; source: 'history' | 'snapshot' }> {
  try {
    return { record: await loadHistory(), source: 'history' };
  } catch (historyError) {
    try {
      return { record: await loadSnapshot(), source: 'snapshot' };
    } catch (snapshotError) {
      const historyReason = historyError instanceof Error ? historyError.message : String(historyError);
      const snapshotReason = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
      throw new Error(`History unavailable: ${historyReason}; confirmed purchase snapshot unavailable: ${snapshotReason}`);
    }
  }
}

export async function runSummarizeCommand(options: SummarizeOptions): Promise<string> {
  const config = await loadConfig();
  const week = getWeekContext(new Date(), options.targetWeek);
  const purchaseSource = options.purchaseSource ?? (options.mode === 'live' ? 'history' : 'local-fixture');
  let summary: string;
  let record: PurchaseRecord;
  try {
    const loaded = await loadRecord({ mode: options.mode, purchaseSource, config, week });
    record = loaded.record;
    const results = options.mode === 'live'
      ? await loadLiveResults(record)
      : await loadFixtureResults().then(({ lotto, pension }) => ({ lotto, pension, lottoPending: false, pensionPending: false }));
    const sourceNote = loaded.source === 'snapshot' ? '\nsource=confirmed automatic purchase snapshot; manual purchases may be absent' : '';
    summary = `${formatSummary(record, results)}${sourceNote}`;
    await mkdir('artifacts', { recursive: true });
    if (loaded.source === 'history') {
      await writeFile('artifacts/purchase-record.history.json', `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    }
    await writeFile('artifacts/weekly-summary.txt', `${summary}\n`, 'utf8');
  } catch (error) {
    const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
    const reason = error instanceof Error ? error.message : String(error);
    const message = `${prefix} weekly summary failed for ${week.week}\nreason=${reason}`;
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/weekly-summary.txt', `${message}\n`, 'utf8');
    const telegram = new TelegramClient();
    await telegram.send(message).catch((alertError) => {
      console.error(`Could not send weekly summary failure alert: ${alertError}`);
    });
    throw error;
  }

  const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
  const telegram = new TelegramClient();
  await telegram.send(`${prefix} weekly summary for ${record.week}\n${summary}`);
  return summary;
}

async function loadLiveResults(record: PurchaseRecord): Promise<{
  lotto?: Awaited<ReturnType<typeof fetchLottoResult>>;
  pension?: Awaited<ReturnType<typeof fetchPensionResult>>;
  lottoPending: boolean;
  pensionPending: boolean;
}> {
  const [lotto, pension] = await Promise.all([
    loadResult(record.lotto.tickets.length > 0 ? () => fetchLottoResult(record.lotto.drawRound) : undefined),
    loadResult(record.pension.tickets.length > 0 ? () => fetchPensionResult(record.pension.drawRound) : undefined),
  ]);
  return {
    lotto: lotto.result,
    pension: pension.result,
    lottoPending: lotto.pending,
    pensionPending: pension.pending,
  };
}

async function loadResult<T>(fetchResult?: () => Promise<T>): Promise<{ result?: T; pending: boolean }> {
  if (!fetchResult) {
    return { pending: false };
  }
  try {
    return { result: await fetchResult(), pending: false };
  } catch (error) {
    if (isResultNotPublishedError(error)) {
      return { pending: true };
    }
    throw error;
  }
}
