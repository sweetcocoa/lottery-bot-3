import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLottoTickets, resolvePensionTickets } from '../src/core/random-picks.ts';
import { getWeekContext } from '../src/core/draw-calendar.ts';

test('random_same duplicates the generated ticket', () => {
  const tickets = resolveLottoTickets({ mode: 'random_same', count: 2 }, 'seed-a');
  assert.deepEqual(tickets[0], tickets[1]);
});

test('random_distinct produces unique tickets', () => {
  const tickets = resolveLottoTickets({ mode: 'random_distinct', count: 3 }, 'seed-b');
  const unique = new Set(tickets.map((ticket) => ticket.join(',')));
  assert.equal(unique.size, 3);
});

test('random pension produces a single group and 6-digit number', () => {
  const [ticket] = resolvePensionTickets({ mode: 'random', count: 1 }, 'seed-c');
  assert.match(ticket.number, /^\d{6}$/);
  assert.ok(ticket.group >= 1 && ticket.group <= 5);
});

test('week context can be computed from target week', () => {
  const week = getWeekContext(new Date('2026-03-07T00:00:00Z'), '2026-W10');
  assert.equal(week.week, '2026-W10');
  assert.ok(week.lottoRound > 0);
  assert.ok(week.pensionRound > 0);
});
