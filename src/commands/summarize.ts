import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import type { PurchaseRecord } from '../core/purchase-record.ts';
import { DhlotteryHistoryProvider } from '../providers/dhlottery/history.ts';
import { fetchLottoResult, fetchPensionResult, loadFixtureResults } from '../providers/results/fetcher.ts';
import { TelegramClient } from '../providers/telegram/client.ts';

export interface SummarizeOptions {
  mode: 'dry-run' | 'live';
  purchaseSource?: 'history' | 'local-fixture';
  targetWeek?: string;
}

function countLottoMatches(ticket: number[], winning: number[]): number {
  return ticket.filter((value) => winning.includes(value)).length;
}

function formatSummary(record: PurchaseRecord, lottoWinning: number[], pensionWinning: Array<{ group: number; number: string }>): string {
  const lottoLines = record.lotto.tickets.map((ticket) => {
    const matches = countLottoMatches(ticket, lottoWinning);
    return `- ${ticket.join('-')} => ${matches} match(es)`;
  });
  const pensionLines = record.pension.tickets.map((ticket) => {
    const matched = pensionWinning.some((winner) => winner.group === ticket.group && winner.number === ticket.number);
    return `- ${ticket.group}조 ${ticket.number} => ${matched ? 'match' : 'no match'}`;
  });
  return [
    `week=${record.week}`,
    `lotto round=${record.lotto.drawRound} winning=${lottoWinning.join('-')}`,
    ...lottoLines,
    `pension round=${record.pension.drawRound}`,
    ...pensionLines,
  ].join('\n');
}

async function loadRecord(options: {
  mode: 'dry-run' | 'live';
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

  const provider = new DhlotteryHistoryProvider();
  return provider.loadWeeklyPurchaseRecord({
    username,
    password,
    week: options.week.week,
    weekStartDate: options.week.weekStartDate,
    weekEndDate: options.week.weekEndDate,
    config: options.config,
  });
}

export async function runSummarizeCommand(options: SummarizeOptions): Promise<string> {
  const config = await loadConfig();
  const week = getWeekContext(new Date(), options.targetWeek);
  const purchaseSource = options.purchaseSource ?? (options.mode === 'live' ? 'history' : 'local-fixture');
  let record: PurchaseRecord;
  try {
    record = await loadRecord({ mode: options.mode, purchaseSource, config, week });
  } catch (error) {
    const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
    const reason = error instanceof Error ? error.message : 'purchase history could not be loaded';
    const message = `${prefix} weekly summary for ${week.week}\nno purchase record found for this run.\nreason=${reason}`;
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/weekly-summary.txt', `${message}\n`, 'utf8');
    const telegram = new TelegramClient();
    await telegram.send(message);
    return message;
  }

  let results;
  try {
    results = options.mode === 'live'
      ? {
          lotto: await fetchLottoResult(record.lotto.drawRound),
          pension: await fetchPensionResult(record.pension.drawRound),
        }
      : await loadFixtureResults();
  } catch (error) {
    const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
    const reason = error instanceof Error ? error.message : 'result fetch failed';
    const message = `${prefix} weekly summary for ${record.week}\nfailed to load winning results.\nreason=${reason}`;
    await mkdir('artifacts', { recursive: true });
    if (purchaseSource === 'history') {
      await writeFile('artifacts/purchase-record.history.json', `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    }
    await writeFile('artifacts/weekly-summary.txt', `${message}\n`, 'utf8');
    const telegram = new TelegramClient();
    await telegram.send(message);
    return message;
  }

  const summary = formatSummary(record, results.lotto.numbers, results.pension.winningNumbers);
  await mkdir('artifacts', { recursive: true });
  if (purchaseSource === 'history') {
    await writeFile('artifacts/purchase-record.history.json', `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }
  await writeFile('artifacts/weekly-summary.txt', `${summary}\n`, 'utf8');

  const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
  const telegram = new TelegramClient();
  await telegram.send(`${prefix} weekly summary for ${record.week}\n${summary}`);
  return summary;
}
