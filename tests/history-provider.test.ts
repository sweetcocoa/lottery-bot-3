import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/schema.ts';
import { buildHistoryPurchaseRecord, parsePensionTicketText } from '../src/providers/dhlottery/history.ts';

test('parsePensionTicketText parses group and number from ledger text', () => {
  assert.deepEqual(parsePensionTicketText('4조 123456'), { group: 4, number: '123456' });
  assert.deepEqual(parsePensionTicketText(' 4 조   123456 '), { group: 4, number: '123456' });
  assert.equal(parsePensionTicketText('잘못된 형식'), null);
});

test('buildHistoryPurchaseRecord keeps actual ticket counts from purchase history', async () => {
  const config = await loadConfig();
  const record = buildHistoryPurchaseRecord(config, {
    week: '2026-W10',
    lottoRound: 1214,
    pensionRound: 306,
    lottoTickets: [
      [3, 6, 15, 24, 33, 38],
      [3, 6, 15, 24, 33, 38],
    ],
    pensionTickets: [
      { group: 4, number: '123456' },
    ],
  });

  assert.equal(record.mode, 'live');
  assert.equal(record.lotto.count, 2);
  assert.equal(record.pension.count, 1);
  assert.equal(record.lotto.status, 'purchased');
  assert.equal(record.pension.status, 'purchased');
  assert.deepEqual(record.lotto.tickets[0], [3, 6, 15, 24, 33, 38]);
  assert.deepEqual(record.pension.tickets[0], { group: 4, number: '123456' });
});
