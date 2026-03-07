import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { runBuyCommand } from '../src/commands/buy.ts';

test('buy dry-run writes a simulated purchase record', async () => {
  await rm('artifacts/purchase-record.json', { force: true });
  await runBuyCommand({
    mode: 'dry-run',
    provider: 'mock',
    targetWeek: '2026-W10',
    seed: 'buy-test-dry-run',
  });

  const raw = await readFile('artifacts/purchase-record.json', 'utf8');
  const record = JSON.parse(raw);
  assert.equal(record.mode, 'dry-run');
  assert.equal(record.lotto.status, 'simulated');
  assert.equal(record.pension.status, 'simulated');
});

test('buy smoke does not persist a purchase record', async () => {
  await rm('artifacts/purchase-record.json', { force: true });
  await rm('artifacts/diagnostics/mock-purchase-2026-W11.txt', { force: true });

  await runBuyCommand({
    mode: 'smoke',
    provider: 'mock',
    targetWeek: '2026-W11',
    seed: 'buy-test-smoke',
  });

  await assert.rejects(access('artifacts/purchase-record.json', constants.F_OK));
  const diagnostics = await readFile('artifacts/diagnostics/mock-purchase-2026-W11.txt', 'utf8');
  assert.match(diagnostics, /mode=smoke/);
});
