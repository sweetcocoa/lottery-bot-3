import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadConfig } from '../config/schema.ts';
import { getWeekContext } from '../core/draw-calendar.ts';
import { loadPurchaseRecord, type PurchaseRecord } from '../core/purchase-record.ts';
import { fetchLottoResult, fetchPensionResult, loadFixtureResults } from '../providers/results/fetcher.ts';
import { TelegramClient } from '../providers/telegram/client.ts';

export interface SummarizeOptions {
  mode: 'dry-run' | 'live';
  artifactSource?: 'github' | 'local-fixture';
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

async function loadRecord(artifactSource: 'github' | 'local-fixture'): Promise<PurchaseRecord> {
  if (artifactSource === 'local-fixture') {
    const raw = await readFile('src/testing/fixtures/purchase-record.fixture.json', 'utf8');
    return JSON.parse(raw) as PurchaseRecord;
  }
  if (existsSync('artifacts/downloaded/purchase-record/purchase-record.json')) {
    return loadPurchaseRecord('artifacts/downloaded/purchase-record/purchase-record.json');
  }
  return loadPurchaseRecord();
}

export async function runSummarizeCommand(options: SummarizeOptions): Promise<string> {
  const config = await loadConfig();
  const artifactSource = options.artifactSource ?? (options.mode === 'live' ? 'github' : 'local-fixture');
  const week = getWeekContext(new Date(), options.targetWeek);
  let record: PurchaseRecord;
  try {
    record = await loadRecord(artifactSource);
  } catch {
    const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
    const message = `${prefix} weekly summary for ${week.week}\nno purchase record found for this run.`;
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/weekly-summary.txt', `${message}\n`, 'utf8');
    const telegram = new TelegramClient();
    await telegram.send(message);
    return message;
  }

  const results = options.mode === 'live'
    ? {
        lotto: await fetchLottoResult(record.lotto.drawRound),
        pension: await fetchPensionResult(record.pension.drawRound),
      }
    : await loadFixtureResults();

  const summary = formatSummary(record, results.lotto.numbers, results.pension.winningNumbers);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/weekly-summary.txt', `${summary}\n`, 'utf8');

  const prefix = options.mode === 'live' ? config.notifications.live_prefix : config.notifications.dry_run_prefix;
  const telegram = new TelegramClient();
  await telegram.send(`${prefix} weekly summary for ${record.week}\n${summary}`);
  return summary;
}
