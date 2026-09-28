import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerRowCount } from '../src/providers/dhlottery/ledger-response.ts';

test('ledger search accepts an explicit empty list and normal rows', () => {
  assert.equal(ledgerRowCount({ resultCode: null, data: { list: [] } }, 200), 0);
  assert.equal(ledgerRowCount({ resultCode: null, data: { list: [{}, {}] } }, 200), 2);
});

test('ledger search preserves server rejection instead of waiting for UI data', () => {
  assert.throws(() => ledgerRowCount({ resultCode: 'DATE_RANGE', resultMessage: 'Invalid search interval' }, 200), /DATE_RANGE.*Invalid search interval/);
});

test('ledger search fails closed on HTTP errors and missing data', () => {
  assert.throws(() => ledgerRowCount({}, 401), /HTTP 401/);
  assert.throws(() => ledgerRowCount({ data: { list: null } }, 200), /does not contain a ticket list/);
});
