import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBuyFailureReason } from '../src/scripts/buy-failure-reason.ts';

test('extractBuyFailureReason keeps the lottery site payment failure message', () => {
  const reason = extractBuyFailureReason(`
Lotto order failed: 구매시 오류가 발생하였습니다.
오류메시지:[예치금] 초과되었습니다. 초과구매액: 2000
`);

  assert.equal(reason, 'Lotto order failed: 구매시 오류가 발생하였습니다. 오류메시지:[예치금] 초과되었습니다. 초과구매액: 2000');
});

test('extractBuyFailureReason falls back to the final command error', () => {
  const reason = extractBuyFailureReason(`
starting purchase
frame.waitForSelector: Timeout 30000ms exceeded.
`);

  assert.equal(reason, 'frame.waitForSelector: Timeout 30000ms exceeded.');
});
