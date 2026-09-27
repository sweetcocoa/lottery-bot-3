import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSummarizeCommand } from '../src/commands/summarize.ts';

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
