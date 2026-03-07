import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { runSummarizeCommand } from '../src/commands/summarize.ts';

test('summarize dry-run creates a readable summary', async () => {
  const summary = await runSummarizeCommand({ mode: 'dry-run', artifactSource: 'local-fixture' });
  assert.match(summary, /lotto round=/);
  assert.match(summary, /pension round=/);
});

test('summarize dry-run respects target week when record is missing', async () => {
  await rm('artifacts/purchase-record.json', { force: true });
  const summary = await runSummarizeCommand({ mode: 'dry-run', artifactSource: 'github', targetWeek: '2026-W10' });
  assert.match(summary, /no purchase record found/i);
});
