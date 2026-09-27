import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLottoResult, fetchPensionResult } from '../src/providers/results/fetcher.ts';

test('result fetchers parse the public JSON endpoints without browser navigation', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const data = url.includes('lt645')
      ? { data: { list: [{ ltEpsd: 1243, tm1WnNo: 9, tm2WnNo: 18, tm3WnNo: 24, tm4WnNo: 38, tm5WnNo: 43, tm6WnNo: 44, bnsWnNo: 35 }] } }
      : { data: { result: [{ psltEpsd: 334, wnSqNo: 1, wnBndNo: '2', wnRnkVl: '956029' }, { psltEpsd: 334, wnSqNo: 2, wnRnkVl: '956029' }] } };
    return new Response(JSON.stringify(data), { status: 200 });
  }) as typeof fetch;

  assert.deepEqual(await fetchLottoResult(1243, fetchImpl), {
    drawRound: 1243, numbers: [9, 18, 24, 38, 43, 44], bonus: 35,
  });
  assert.deepEqual(await fetchPensionResult(334, fetchImpl), {
    drawRound: 334,
    winningNumbers: [
      { group: 2, number: '956029' },
      { group: 1, number: '956029' },
      { group: 3, number: '956029' },
      { group: 4, number: '956029' },
      { group: 5, number: '956029' },
    ],
  });
  assert.equal(calls.length, 2);
});

test('result fetchers reject incomplete winning numbers', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    data: { list: [{ ltEpsd: 1243, tm1WnNo: 9, tm2WnNo: 9 }] },
  }), { status: 200 })) as typeof fetch;

  await assert.rejects(fetchLottoResult(1243, fetchImpl), /payload is invalid/);
});

test('result fetchers fail fast on permanent HTTP errors', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  await assert.rejects(fetchLottoResult(1243, fetchImpl), /status 404/);
  assert.equal(calls, 1);
});

test('result fetchers retry a transient server failure', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return new Response('temporary failure', { status: 503 });
    return new Response(JSON.stringify({
      data: { list: [{ ltEpsd: 1243, tm1WnNo: 9, tm2WnNo: 18, tm3WnNo: 24, tm4WnNo: 38, tm5WnNo: 43, tm6WnNo: 44, bnsWnNo: 35 }] },
    }), { status: 200 });
  }) as typeof fetch;

  assert.equal((await fetchLottoResult(1243, fetchImpl)).drawRound, 1243);
  assert.equal(calls, 2);
});
