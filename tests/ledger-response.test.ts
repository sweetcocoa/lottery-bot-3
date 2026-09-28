import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLedgerPages, ledgerPageInfo } from '../src/providers/dhlottery/ledger-response.ts';

test('ledger search accepts an explicit empty list and normal rows', () => {
  assert.deepEqual(ledgerPageInfo({ resultCode: null, data: { list: [], total: 0 } }, 200), { rowCount: 0, total: 0 });
  assert.deepEqual(ledgerPageInfo({ resultCode: null, data: { list: [{}, {}], total: 12 } }, 200), { rowCount: 2, total: 12 });
});

test('buy preflight collects all pages rather than just the first ten purchases', async () => {
  const first = Array.from({ length: 10 }, (_, index) => index);
  const rows = await collectLedgerPages({ rows: first, total: 12 }, async (page) => {
    assert.equal(page, 2);
    return { rows: [10, 11], total: 12 };
  });
  assert.equal(rows.length, 12);
  assert.deepEqual(rows.slice(-2), [10, 11]);
});

test('buy preflight fails closed if pages are incomplete or change during the read', async () => {
  const first = { rows: Array.from({ length: 10 }, (_, index) => index), total: 12 };
  await assert.rejects(collectLedgerPages(first, async () => ({ rows: [], total: 12 })), /did not return every row/);
  await assert.rejects(collectLedgerPages(first, async () => ({ rows: [10], total: 11 })), /changed during buy preflight/);
});

test('ledger search preserves server rejection instead of waiting for UI data', () => {
  assert.throws(() => ledgerPageInfo({ resultCode: 'DATE_RANGE', resultMessage: 'Invalid search interval' }, 200), /DATE_RANGE.*Invalid search interval/);
});

test('ledger search fails closed on HTTP errors and missing data', () => {
  assert.throws(() => ledgerPageInfo({}, 401), /HTTP 401/);
  assert.throws(() => ledgerPageInfo({ data: { list: null } }, 200), /does not contain a ticket list/);
  assert.throws(() => ledgerPageInfo({ data: { list: [{}], total: 0 } }, 200), /invalid total count/);
});
