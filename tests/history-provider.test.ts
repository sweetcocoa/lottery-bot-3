import test from 'node:test';
import assert from 'node:assert/strict';
import { ResultNotPublishedError } from '../src/providers/results/fetcher.ts';
import {
  getBuyHistoryRange,
  readRecentProductRounds,
  resolveLatestProductRounds,
  resolveUnsettledPurchasePresence,
} from '../src/providers/dhlottery/history.ts';

test('preflight reads every HTTP ledger page and fails on malformed target-product rounds', async () => {
  const range = { startDate: '2026-10-17', endDate: '2026-11-16' };
  const seen: string[] = [];
  const rounds = await readRecentProductRounds(async (path, params) => {
    assert.equal(path, '/mypage/selectMyLotteryledger.do');
    assert.equal(params.srchStrDt, '20261017');
    assert.equal(params.srchEndDt, '20261116');
    seen.push(params.pageNum);
    return { data: { total: 11, list: params.pageNum === '1'
      ? Array.from({ length: 10 }, () => ({ ltGdsCd: 'LO40', ltEpsd: 1250 }))
      : [{ ltGdsCd: 'LP72', ltEpsd: 341 }] } };
  }, range);
  assert.deepEqual(seen, ['1', '2']);
  assert.deepEqual(rounds, { lottoRound: 1250, pensionRound: 341 });
  await assert.rejects(readRecentProductRounds(async () => ({
    data: { total: 1, list: [{ ltGdsCd: 'LO40', ltEpsd: null }] },
  }), range), /invalid draw round/);
});

test('buy preflight searches only the recent 30 days in KST', () => {
  assert.deepEqual(getBuyHistoryRange(new Date('2026-09-28T04:00:00Z')), { startDate: '2026-08-29', endDate: '2026-09-28' });
  assert.deepEqual(getBuyHistoryRange(new Date('2026-09-27T15:00:00Z')), { startDate: '2026-08-29', endDate: '2026-09-28' });
});

test('resolveLatestProductRounds keeps the newest round per product', () => {
  const rounds = resolveLatestProductRounds([
    { productCode: 'LO40', round: 1212 },
    { productCode: 'LP72', round: 305 },
    { productCode: 'LO40', round: 1214 },
    { productCode: 'LP72', round: 306 },
    { productCode: 'LO40', round: 1213 },
  ]);

  assert.deepEqual(rounds, {
    lottoRound: 1214,
    pensionRound: 306,
  });
});

test('resolveUnsettledPurchasePresence applies unsettled status per product', async () => {
  const presence = await resolveUnsettledPurchasePresence({
    lottoRound: 1214,
    pensionRound: 306,
    fetchLottoResultFn: async () => {
      throw new ResultNotPublishedError('Lotto', 1214);
    },
    fetchPensionResultFn: async () => ({ drawRound: 306, winningNumbers: [] }),
  });

  assert.equal(presence.lottoUnsettled, true);
  assert.equal(presence.pensionUnsettled, false);
  assert.equal(presence.lottoRound, 1214);
  assert.equal(presence.pensionRound, 306);
});

test('resolveUnsettledPurchasePresence only checks requested products', async () => {
  const presence = await resolveUnsettledPurchasePresence({
    lottoRound: 1214,
    pensionRound: 306,
    checkLotto: false,
    checkPension: true,
    fetchLottoResultFn: async () => {
      throw new Error('should not be called');
    },
    fetchPensionResultFn: async () => {
      throw new ResultNotPublishedError('Pension', 306);
    },
  });

  assert.equal(presence.lottoUnsettled, false);
  assert.equal(presence.pensionUnsettled, true);
});
