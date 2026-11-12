import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import type { PurchaseRecord } from '../core/purchase-record.ts';
import { loadWeeklyPurchaseRecord } from '../providers/dhlottery/weekly-history.ts';
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
  purchaseSource: 'history' | 'local-fixture';
  config: Awaited<ReturnType<typeof loadConfig>>;
  week: ReturnType<typeof getWeekContext>;
}): Promise<PurchaseRecord> {
  if (options.purchaseSource === 'local-fixture') {
    const raw = await readFile('src/testing/fixtures/purchase-record.fixture.json', 'utf8');
    return JSON.parse(raw) as PurchaseRecord;
  }

  const username = process.env.DHLOTTERY_USERNAME;
  const password = process.env.DHLOTTERY_PASSWORD;
  if (!username || !password) {
    throw new Error('DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD are required to load purchase history from dhlottery.co.kr');
  }
  return loadWeeklyPurchaseRecord({
    username,
    password,
    week: options.week.week,
    weekStartDate: options.week.weekStartDate,
    weekEndDate: options.week.weekEndDate,
    config: options.config,
  });
}

export async function runSummarizeCommand(options: SummarizeOptions): Promise<string> {
  const purchaseSource = options.mode === 'live' ? 'history' : 'local-fixture';
  if (options.purchaseSource && options.purchaseSource !== purchaseSource) {
    throw new Error(`Result summary mode ${options.mode} requires purchase source ${purchaseSource}`);
  }
  const config = await loadConfig();
  const now = new Date();
  const week = getWeekContext(now, options.targetWeek);
  const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
  const telegram = new TelegramClient();
  let summary: string;
  let record: PurchaseRecord;
  try {
    record = await loadRecord({ purchaseSource, config, week });
    const results = options.mode === 'live'
      ? await loadLiveResults(record, week, now)
      : await loadFixtureResults().then(({ lotto, pension }) => ({ lotto, pension, lottoPending: false, pensionPending: false }));
    summary = formatSummary(record, results);
    await mkdir('artifacts', { recursive: true });
    if (purchaseSource === 'history') {
      await writeFile('artifacts/purchase-record.history.json', `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    }
    await writeFile('artifacts/weekly-summary.txt', `${summary}\n`, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `${prefix} weekly summary failed for ${week.week}\nreason=${reason}`;
    await mkdir('artifacts', { recursive: true })
      .then(() => writeFile('artifacts/weekly-summary.txt', `${message}\n`, 'utf8'))
      .catch(() => console.error('Could not save weekly summary failure artifact'));
    await telegram.send(message).catch((alertError) => {
      console.error(`Could not send weekly summary failure alert: ${alertError}`);
    });
    throw error;
  }

  try {
    await telegram.send(`${prefix} weekly summary for ${record.week}\n${summary}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Weekly summary for ${record.week} was saved, but notification failed: ${reason}`, { cause: error });
  }
  return summary;
}

async function loadLiveResults(record: PurchaseRecord, week: ReturnType<typeof getWeekContext>, now: Date): Promise<{
  lotto?: Awaited<ReturnType<typeof fetchLottoResult>>;
  pension?: Awaited<ReturnType<typeof fetchPensionResult>>;
  lottoPending: boolean;
  pensionPending: boolean;
}> {
  const [lotto, pension] = await Promise.all([
    loadResult(record.lotto.tickets.length > 0 ? () => fetchLottoResult(record.lotto.drawRound) : undefined, week.lottoDrawDate, now),
    loadResult(record.pension.tickets.length > 0 ? () => fetchPensionResult(record.pension.drawRound) : undefined, week.pensionDrawDate, now),
  ]);
  return {
    lotto: lotto.result,
    pension: pension.result,
    lottoPending: lotto.pending,
    pensionPending: pension.pending,
  };
}

const KST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

export async function loadResult<T>(fetchResult: (() => Promise<T>) | undefined, drawDate: Date, now: Date): Promise<{ result?: T; pending: boolean }> {
  if (!fetchResult) {
    return { pending: false };
  }
  try {
    return { result: await fetchResult(), pending: false };
  } catch (error) {
    if (isResultNotPublishedError(error)) {
      if (KST_DAY.format(now) <= KST_DAY.format(drawDate)) return { pending: true };
      throw new Error(`Expected result is missing after the draw date: ${error.message}`, { cause: error });
    }
    throw error;
  }
}
