import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/schema.ts';
import { getWeekContext } from '../src/core/draw-calendar.ts';
import { readWeeklyPurchaseRecord } from '../src/providers/dhlottery/weekly-history.ts';

const week = getWeekContext(new Date(), '2026-W45');
const lotto = { ltGdsCd: 'LO40', ltEpsd: 1249, epsdRflDt: '2026-11-07', prchsQty: 2, gmInfo: '12345', ntslOrdrNo: '67890' };
const pension = { ltGdsCd: 'LP72', ltEpsd: 340, epsdRflDt: '2026-11-05', prchsQty: 1, gmInfo: '4:012345' };
const numbers = [3, 6, 15, 24, 33, 38];

test('weekly history reads later pages and verifies the matching lotto detail', async () => {
  const calls: string[] = [];
  const record = await readWeeklyPurchaseRecord(week, await loadConfig(), async (path, params) => {
    assert.equal(params.srchStrDt, '20261026');
    assert.equal(params.srchEndDt, '20261108');
    if (path.endsWith('selectMyLotteryledger.do')) {
      calls.push(`page ${params.pageNum}`);
      return params.pageNum === '1'
        ? { data: { list: [pension, ...Array.from({ length: 9 }, () => ({ ...lotto, epsdRflDt: '2026-10-31' }))], total: 11 } }
        : { data: { list: [lotto], total: 11 } };
    }
    assert.equal(path, '/mypage/lotto645TicketDetail.do');
    assert.equal(params.barcd, lotto.gmInfo);
    assert.equal(params.ntslOrdrNo, lotto.ntslOrdrNo);
    calls.push('lotto detail');
    return { data: { success: true, ticket: { game_round: 1249, barcode: lotto.gmInfo, game_dtl: [{ num: numbers }, { num: numbers }] } } };
  });
  assert.deepEqual(calls, ['page 1', 'page 2', 'lotto detail']);
  assert.equal(record.lotto.count, 2);
  assert.deepEqual(record.lotto.tickets, [numbers, numbers]);
  assert.deepEqual(record.pension.tickets, [{ group: 4, number: '012345' }]);
});

test('weekly history treats a verified empty ledger as no tickets', async () => {
  const record = await readWeeklyPurchaseRecord(week, await loadConfig(), async () => ({ data: { list: [], total: 0 } }));
  assert.equal(record.lotto.status, 'skipped');
  assert.equal(record.pension.status, 'skipped');
});

test('weekly history rejects partial ticket details and failed ledger responses', async () => {
  const config = await loadConfig();
  await assert.rejects(readWeeklyPurchaseRecord(week, config, async (path) => path.endsWith('selectMyLotteryledger.do')
    ? { data: { list: [lotto], total: 1 } }
    : { data: { success: true, ticket: { game_round: 1249, barcode: lotto.gmInfo, game_dtl: [{ num: numbers }] } } }), /incomplete or mismatched/i);
  await assert.rejects(readWeeklyPurchaseRecord(week, config, async () => ({ resultCode: 'DENIED', data: { list: [], total: 0 } })), /search rejected/);
});
