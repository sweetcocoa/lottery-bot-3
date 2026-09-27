import { readFile } from 'node:fs/promises';
import type { PurchaseRecord } from './purchase-record.ts';
import { getWeekContext } from './draw-calendar.ts';

export function validatePurchaseSnapshot(value: unknown, week: string): PurchaseRecord {
  if (!value || typeof value !== 'object') throw new Error('Purchase snapshot is not an object');
  const record = value as PurchaseRecord;
  const expected = getWeekContext(new Date(), week);
  if (record.week !== week || record.mode !== 'live') {
    throw new Error(`Purchase snapshot does not match live draw week ${week}`);
  }
  if (record.lotto?.drawRound !== expected.lottoRound || record.pension?.drawRound !== expected.pensionRound) {
    throw new Error(`Purchase snapshot draw rounds do not match ${week}`);
  }
  if (record.lotto.status !== 'purchased' || record.pension.status !== 'purchased') {
    throw new Error('Purchase snapshot is incomplete; both products must be confirmed purchased');
  }
  if (record.runContext?.workflow !== 'buy.yml'
    || !record.lotto.receiptId?.startsWith(`browser-${week}-`)
    || !record.pension.receiptId?.startsWith(`browser-${week}-`)) {
    throw new Error('Purchase snapshot does not contain a confirmed browser purchase receipt');
  }
  if (!Array.isArray(record.lotto.tickets) || record.lotto.tickets.length !== record.lotto.count
    || !record.lotto.tickets.length || record.lotto.tickets.some((ticket) =>
      !Array.isArray(ticket) || ticket.length !== 6 || new Set(ticket).size !== 6
      || ticket.some((number) => !Number.isInteger(number) || number < 1 || number > 45))) {
    throw new Error('Purchase snapshot has invalid lotto tickets');
  }
  if (!Array.isArray(record.pension.tickets) || record.pension.tickets.length !== record.pension.count
    || !record.pension.tickets.length || record.pension.tickets.some((ticket) =>
      !ticket || !Number.isInteger(ticket.group) || ticket.group < 1 || ticket.group > 5 || !/^\d{6}$/.test(ticket.number))) {
    throw new Error('Purchase snapshot has invalid pension tickets');
  }
  return record;
}

export async function loadPurchaseSnapshot(week: string, path = 'artifacts/snapshot/purchase-record.json'): Promise<PurchaseRecord> {
  const raw = await readFile(path, 'utf8');
  return validatePurchaseSnapshot(JSON.parse(raw), week);
}
