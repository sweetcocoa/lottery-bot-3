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
  assert.equal(week.weekStartDate, '2026-03-02');
  assert.equal(week.weekEndDate, '2026-03-08');
  assert.equal(week.lottoRound, 1214);
  assert.equal(week.pensionRound, 305);
});

test('week context keeps Sunday result checks in the completed week', () => {
  const week = getWeekContext(new Date('2026-06-28T00:00:00Z'));
  assert.equal(week.week, '2026-W26');
  assert.equal(week.weekStartDate, '2026-06-22');
  assert.equal(week.weekEndDate, '2026-06-28');
  assert.equal(week.lottoDrawDate.toISOString(), '2026-06-27T03:00:00.000Z');
  assert.equal(week.pensionDrawDate.toISOString(), '2026-06-25T10:00:00.000Z');
  assert.equal(week.lottoRound, 1230);
  assert.equal(week.pensionRound, 321);
});

test('week context advances Monday buys to the new draw week', () => {
  const week = getWeekContext(new Date('2026-06-29T00:00:00Z'));
  assert.equal(week.week, '2026-W27');
  assert.equal(week.weekStartDate, '2026-06-29');
  assert.equal(week.weekEndDate, '2026-07-05');
  assert.equal(week.lottoDrawDate.toISOString(), '2026-07-04T03:00:00.000Z');
  assert.equal(week.pensionDrawDate.toISOString(), '2026-07-02T10:00:00.000Z');
  assert.equal(week.lottoRound, 1231);
  assert.equal(week.pensionRound, 322);
});

test('week context uses KST calendar dates around midnight', () => {
  const week = getWeekContext(new Date('2026-06-28T15:30:00Z'));
  assert.equal(week.week, '2026-W27');
  assert.equal(week.weekStartDate, '2026-06-29');
  assert.equal(week.lottoRound, 1231);
  assert.equal(week.pensionRound, 322);
  assert.equal(week.runDateKst, '2026-06-29T00:00:00.000Z');
});
