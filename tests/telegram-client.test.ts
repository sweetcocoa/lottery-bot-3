import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient } from '../src/providers/telegram/client.ts';

test('TelegramClient retries transient gateway failures', async () => {
  let calls = 0;
  const delays: number[] = [];
  const client = new TelegramClient(
    'token',
    'chat-id',
    async () => {
      calls += 1;
      return calls < 3
        ? new Response('gateway timeout', { status: 504 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async (milliseconds) => { delays.push(milliseconds); },
  );

  await client.send('weekly summary');

  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test('TelegramClient does not retry a permanent API error', async () => {
  let calls = 0;
  const client = new TelegramClient(
    'token',
    'chat-id',
    async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 });
    },
    async () => { throw new Error('must not sleep'); },
  );

  await assert.rejects(client.send('weekly summary'), /status 400/);
  assert.equal(calls, 1);
});
