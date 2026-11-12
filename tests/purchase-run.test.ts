import test from 'node:test';
import assert from 'node:assert/strict';
import { PurchaseRejectedError, runPurchaseBatch } from '../src/providers/dhlottery/purchase-run.ts';

test('a later window closing keeps the earlier product confirmed', async () => {
  await assert.rejects(runPurchaseBatch(['lotto', 'pension'], async (product, stage) => {
    if (product === 'lotto') {
      stage('submission');
      stage('receipt');
      return 'verified-receipt';
    }
    stage('selection');
    throw new Error('Target page has been closed');
  }), /product=pension stage=selection lotto=confirmed pension=not-submitted/);
});

test('an ambiguous outcome never invokes another submission or the next product', async () => {
  const calls: string[] = [];
  await assert.rejects(runPurchaseBatch(['lotto', 'pension'], async (product, stage) => {
    calls.push(product);
    stage('submission');
    stage('receipt');
    throw new Error('Receipt wait timed out');
  }), /lotto=unconfirmed pension=not-started.*Check account purchase history/);
  assert.deepEqual(calls, ['lotto']);
});

test('a second submission is blocked and a blank receipt is not a success', async () => {
  await assert.rejects(runPurchaseBatch(['pension'], async (_, stage) => {
    stage('submission');
    stage('submission');
    return 'not-reachable';
  }), /pension=unconfirmed.*Duplicate purchase submission blocked/);
  await assert.rejects(runPurchaseBatch(['pension'], async (_, stage) => {
    stage('submission');
    stage('receipt');
    return '  ';
  }), /pension=unconfirmed.*Missing verified purchase receipt/);
});

test('a definitive zero-sale rejection is distinguished from a missing result', async () => {
  await assert.rejects(runPurchaseBatch(['pension'], async (_, stage) => {
    stage('submission');
    stage('receipt');
    throw new PurchaseRejectedError('No ticket was sold');
  }), /pension=rejected.*No ticket was sold/);
});
