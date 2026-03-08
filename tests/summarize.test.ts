import test from 'node:test';
import assert from 'node:assert/strict';
import { runSummarizeCommand } from '../src/commands/summarize.ts';

test('summarize dry-run creates a readable summary', async () => {
  const summary = await runSummarizeCommand({ mode: 'dry-run', purchaseSource: 'local-fixture' });
  assert.match(summary, /lotto round=/);
  assert.match(summary, /pension round=/);
});

test('summarize live reports why history loading failed when credentials are missing', async () => {
  const previousUsername = process.env.DHLOTTERY_USERNAME;
  const previousPassword = process.env.DHLOTTERY_PASSWORD;
  try {
    delete process.env.DHLOTTERY_USERNAME;
    delete process.env.DHLOTTERY_PASSWORD;

    const summary = await runSummarizeCommand({ mode: 'live', targetWeek: '2026-W10' });

    assert.match(summary, /no purchase record found/i);
    assert.match(summary, /DHLOTTERY_USERNAME and DHLOTTERY_PASSWORD are required/i);
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
