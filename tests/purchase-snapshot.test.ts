import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/schema.ts';
import { getWeekContext } from '../src/core/draw-calendar.ts';
import { validatePurchaseSnapshot } from '../src/core/purchase-snapshot.ts';
import { buildHistoryPurchaseRecord } from '../src/providers/dhlottery/history.ts';

test('purchase snapshot accepts only complete live purchases from the requested week', async () => {
  const week = getWeekContext(new Date(), '2026-W39');
  const historyRecord = buildHistoryPurchaseRecord(await loadConfig(), {
    week: week.week,
    lottoRound: week.lottoRound,
    pensionRound: week.pensionRound,
    lottoTickets: [[3, 11, 19, 23, 37, 42]],
    pensionTickets: [{ group: 4, number: '123456' }],
  });
  const record = {
    ...historyRecord,
    runContext: { workflow: 'buy.yml' as const, runner: 'github' as const },
    lotto: { ...historyRecord.lotto, receiptId: `browser-${week.week}-123` },
    pension: { ...historyRecord.pension, receiptId: `browser-${week.week}-123` },
  };

  assert.equal(validatePurchaseSnapshot(record, week.week), record);
  assert.throws(() => validatePurchaseSnapshot(record, '2026-W38'), /does not match/);
  assert.throws(() => validatePurchaseSnapshot({ ...record, pension: { ...record.pension, status: 'skipped' } }, week.week), /incomplete/);
  assert.throws(() => validatePurchaseSnapshot(historyRecord, week.week), /browser purchase receipt/);
  assert.throws(() => validatePurchaseSnapshot({ ...record, lotto: { ...record.lotto, tickets: [[3, 3, 19, 23, 37, 42]] } }, week.week), /invalid lotto/);
});
