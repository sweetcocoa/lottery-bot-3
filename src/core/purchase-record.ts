import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LottoMode, PensionMode } from '../config/schema.ts';
import type { LottoTicket, PensionTicket } from './random-picks.ts';

export interface PurchaseRecord {
  week: string;
  mode: 'dry-run' | 'live';
  executedAt: string;
  lotto: {
    mode: LottoMode;
    tickets: LottoTicket[];
    count: number;
    drawRound: number;
    status: 'purchased' | 'simulated' | 'skipped';
    receiptId: string;
  };
  pension: {
    mode: PensionMode;
    tickets: PensionTicket[];
    count: number;
    drawRound: number;
    status: 'purchased' | 'simulated' | 'skipped';
    receiptId: string;
  };
  runContext: {
    workflow: string;
    runner: 'local' | 'github';
  };
}

export async function savePurchaseRecord(record: PurchaseRecord, path = 'artifacts/purchase-record.json'): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export async function loadPurchaseRecord(path = 'artifacts/purchase-record.json'): Promise<PurchaseRecord> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as PurchaseRecord;
}

export function createReceiptId(prefix: string, week: string): string {
  return `${prefix}-${week}-${Math.random().toString(36).slice(2, 10)}`;
}
