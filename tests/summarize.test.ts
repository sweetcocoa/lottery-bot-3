import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadResult, runSummarizeCommand } from '../src/commands/summarize.ts';
import { ResultNotPublishedError } from '../src/providers/results/fetcher.ts';

test('missing results stay pending only through the scheduled draw date in KST', async () => {
  const drawDate = new Date('2026-11-12T19:00:00+09:00');
  const unpublished = async () => { throw new ResultNotPublishedError('Pension', 341); };
  assert.deepEqual(await loadResult(unpublished, drawDate, new Date('2026-11-12T14:59:00Z')), { pending: true });
  await assert.rejects(loadResult(unpublished, drawDate, new Date('2026-11-12T15:00:00Z')), /missing after the draw date/);
});

test('summarize rejects mixing authenticated and fixture modes', async () => {
  await assert.rejects(runSummarizeCommand({ mode: 'dry-run', purchaseSource: 'history' }), /requires purchase source local-fixture/);
  await assert.rejects(runSummarizeCommand({ mode: 'live', purchaseSource: 'local-fixture' }), /requires purchase source history/);
});

test('summarize dry-run creates a readable summary', async () => {
  const summary = await runSummarizeCommand({ mode: 'dry-run', purchaseSource: 'local-fixture' });
  assert.match(summary, /lotto round=/);
  assert.match(summary, /pension round=/);
});

test('summarize live fails visibly when authenticated history is unavailable', async () => {
  const previousUsername = process.env.DHLOTTERY_USERNAME;
  const previousPassword = process.env.DHLOTTERY_PASSWORD;
  try {
    delete process.env.DHLOTTERY_USERNAME;
    delete process.env.DHLOTTERY_PASSWORD;

    await assert.rejects(runSummarizeCommand({ mode: 'live', targetWeek: '2026-W10' }), /DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD/);
    const failureArtifact = await readFile('artifacts/weekly-summary.txt', 'utf8');
    assert.match(failureArtifact, /weekly summary failed/);
    assert.match(failureArtifact, /DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD/);
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
