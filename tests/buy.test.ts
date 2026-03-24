import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { evaluateLiveBuyDecision, runBuyCommand } from '../src/commands/buy.ts';

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

test('buy dry-run can target only lotto', async () => {
  await rm('artifacts/purchase-record.json', { force: true });
  await runBuyCommand({
    mode: 'dry-run',
    product: 'lotto',
    provider: 'mock',
    targetWeek: '2026-W12',
    seed: 'buy-test-lotto-only',
  });

  const raw = await readFile('artifacts/purchase-record.json', 'utf8');
  const record = JSON.parse(raw);
  assert.equal(record.lotto.status, 'simulated');
  assert.ok(record.lotto.count >= 1);
  assert.equal(record.pension.status, 'skipped');
  assert.equal(record.pension.count, 0);
});

test('live-check decision skips only unsettled requested products', () => {
  const decision = evaluateLiveBuyDecision({
    product: 'all',
    requestedLotto: true,
    requestedPension: true,
    unsettled: {
      lottoUnsettled: true,
      pensionUnsettled: false,
      lottoRound: 1214,
      pensionRound: 306,
    },
  });

  assert.equal(decision.lottoShouldBuy, false);
  assert.equal(decision.pensionShouldBuy, true);
  assert.match(decision.lottoReason, /skipped\(unsettled round 1214\)/);
  assert.equal(decision.pensionReason, 'pension=would-buy');
});

test('live-check decision respects product targeting', () => {
  const decision = evaluateLiveBuyDecision({
    product: 'pension',
    requestedLotto: false,
    requestedPension: true,
    unsettled: {
      lottoUnsettled: true,
      pensionUnsettled: true,
      lottoRound: 1214,
      pensionRound: 306,
    },
  });

  assert.equal(decision.lottoShouldBuy, false);
  assert.equal(decision.pensionShouldBuy, false);
  assert.equal(decision.lottoReason, 'lotto=not-requested');
  assert.match(decision.pensionReason, /skipped\(unsettled round 306\)/);
});
