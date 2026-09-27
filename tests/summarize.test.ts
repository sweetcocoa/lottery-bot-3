import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRecordWithFallback, runSummarizeCommand } from '../src/commands/summarize.ts';
import { loadConfig } from '../src/config/schema.ts';
import { buildHistoryPurchaseRecord } from '../src/providers/dhlottery/history.ts';
import { getWeekContext } from '../src/core/draw-calendar.ts';

test('summarize dry-run creates a readable summary', async () => {
  const summary = await runSummarizeCommand({ mode: 'dry-run', purchaseSource: 'local-fixture' });
  assert.match(summary, /lotto round=/);
  assert.match(summary, /pension round=/);
});

test('summarize live fails visibly when history and snapshot are unavailable', async () => {
  const previousUsername = process.env.DHLOTTERY_USERNAME;
  const previousPassword = process.env.DHLOTTERY_PASSWORD;
  try {
    delete process.env.DHLOTTERY_USERNAME;
    delete process.env.DHLOTTERY_PASSWORD;

    await assert.rejects(runSummarizeCommand({ mode: 'live', targetWeek: '2026-W10' }), /History unavailable/);
    const failureArtifact = await readFile('artifacts/weekly-summary.txt', 'utf8');
    assert.match(failureArtifact, /weekly summary failed/);
    assert.match(failureArtifact, /confirmed purchase snapshot unavailable/);
  } finally {
    if (previousUsername === undefined) {
      delete process.env.DHLOTTERY_USERNAME;
    } else {
      process.env.DHLOTTERY_USERNAME = previousUsername;
    }
    if (previousPassword === undefined) {
      delete process.env.DHLOTTERY_PASSWORD;
    } else {
      process.env.DHLOTTERY_PASSWORD = previousPassword;
    }
  }
});

test('summarize falls back to a confirmed snapshot after history timeout', async () => {
  const config = await loadConfig();
  const week = getWeekContext(new Date(), '2026-W10');
  const record = buildHistoryPurchaseRecord(config, {
    week: week.week,
    lottoRound: week.lottoRound,
    pensionRound: week.pensionRound,
    lottoTickets: [[3, 11, 19, 23, 37, 42]],
    pensionTickets: [{ group: 4, number: '123456' }],
  });

  const loaded = await loadRecordWithFallback(
    async () => { throw new Error('page.goto: Timeout 30000ms exceeded'); },
    async () => record,
  );
  assert.equal(loaded.source, 'snapshot');
  assert.deepEqual(loaded.record, record);
});
