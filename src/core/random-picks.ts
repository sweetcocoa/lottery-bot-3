import type { AppConfig } from '../config/schema.ts';

export type LottoTicket = [number, number, number, number, number, number];
export interface PensionTicket {
  group: number;
  number: string;
}

function lcg(seedInput: string): () => number {
  let seed = 0;
  for (const char of seedInput) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }
  if (seed === 0) seed = 0x12345678;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function pickUniqueNumbers(count: number, max: number, rand: () => number): number[] {
  const values = new Set<number>();
  while (values.size < count) {
    values.add(Math.floor(rand() * max) + 1);
  }
  return [...values].sort((a, b) => a - b);
}

function createLottoTicket(rand: () => number): LottoTicket {
  return pickUniqueNumbers(6, 45, rand) as LottoTicket;
}

export function resolveLottoTickets(config: AppConfig['lotto'], seed = `${Date.now()}`): LottoTicket[] {
  const rand = lcg(seed);
  if (config.mode === 'fixed') {
    return Array.from({ length: config.count }, () => [...(config.fixed_numbers as number[])] as LottoTicket);
  }
  if (config.mode === 'random_same') {
    const ticket = createLottoTicket(rand);
    return Array.from({ length: config.count }, () => [...ticket] as LottoTicket);
  }

  const seen = new Set<string>();
  const tickets: LottoTicket[] = [];
  while (tickets.length < config.count) {
    const ticket = createLottoTicket(rand);
    const key = ticket.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    tickets.push(ticket);
  }
  return tickets;
}

export function resolvePensionTickets(config: AppConfig['pension'], seed = `${Date.now()}`): PensionTicket[] {
  if (config.mode === 'fixed') {
    return [{
      group: config.fixed!.group,
      number: config.fixed!.number,
    }];
  }
  const rand = lcg(`pension:${seed}`);
  const number = `${Math.floor(rand() * 1000000)}`.padStart(6, '0');
  const group = Math.floor(rand() * 5) + 1;
  return [{ group, number }];
}
