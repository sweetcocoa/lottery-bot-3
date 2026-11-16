import { mkdir, writeFile } from 'node:fs/promises';
import { request, type APIRequestContext } from 'playwright';
import { loginForHistory } from './history-login.ts';
import { createLedgerReader, ledgerDates, readLedgerEntries, type LedgerRead } from './ledger-client.ts';
import { fetchLottoResult, fetchPensionResult, isResultNotPublishedError } from '../results/fetcher.ts';

export interface UnsettledPurchasePresence {
  lottoUnsettled: boolean;
  pensionUnsettled: boolean;
  lottoRound: number | null;
  pensionRound: number | null;
}

interface ProductChecks {
  checkLotto?: boolean;
  checkPension?: boolean;
}

export class DhlotteryHistoryProvider {
  async loadUnsettledPurchasePresence(input: ProductChecks & {
    username: string;
    password: string;
  }): Promise<UnsettledPurchasePresence> {
    const session = await request.newContext({ extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
    try {
      await loginForHistory(session, input.username, input.password);
      return await readUnsettledPurchasePresence(session, input);
    } finally {
      await session.dispose().catch(() => console.warn('Could not close purchase history session'));
    }
  }
}

export async function readUnsettledPurchasePresence(
  session: APIRequestContext,
  checks: ProductChecks,
): Promise<UnsettledPurchasePresence> {
  const range = getBuyHistoryRange();
  try {
    const rounds = await readRecentProductRounds(createLedgerReader(session), range);
    return await resolveUnsettledPurchasePresence({ ...rounds, ...checks });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await mkdir('artifacts/diagnostics', { recursive: true })
      .then(() => writeFile('artifacts/diagnostics/buy-preflight.txt',
        `searchStart=${range.startDate}\nsearchEnd=${range.endDate}\nerror=${reason}\n`, 'utf8'))
      .catch(() => console.warn('Could not write purchase preflight diagnostics'));
    throw new Error(`Purchase preflight failed: ${reason}`, { cause: error });
  }
}

export async function readRecentProductRounds(read: LedgerRead, range: ReturnType<typeof getBuyHistoryRange>) {
  const rows = await readLedgerEntries(read, ledgerDates(range.startDate, range.endDate));
  return resolveLatestProductRounds(rows.flatMap((entry) => {
    const row = entry as { ltGdsCd?: unknown; ltEpsd?: unknown } | null;
    const productCode = row?.ltGdsCd;
    if (typeof productCode !== 'string' || !productCode) throw new Error('Purchase history row is missing its product code');
    if (productCode !== 'LO40' && productCode !== 'LP72') return [];
    const round = row?.ltEpsd;
    if (typeof round !== 'number' || !Number.isSafeInteger(round) || round < 1) {
      throw new Error(`Purchase history row for ${productCode} has an invalid draw round`);
    }
    return [{ productCode, round }];
  }));
}

export function resolveLatestProductRounds(entries: Array<{ productCode: string; round: number }>): { lottoRound: number | null; pensionRound: number | null } {
  let lottoRound: number | null = null;
  let pensionRound: number | null = null;

  for (const entry of entries) {
    if (!Number.isInteger(entry.round) || entry.round <= 0) {
      continue;
    }
    if (entry.productCode === 'LO40') {
      lottoRound = lottoRound === null ? entry.round : Math.max(lottoRound, entry.round);
    }
    if (entry.productCode === 'LP72') {
      pensionRound = pensionRound === null ? entry.round : Math.max(pensionRound, entry.round);
    }
  }

  return { lottoRound, pensionRound };
}

export async function resolveUnsettledPurchasePresence(input: {
  lottoRound: number | null;
  pensionRound: number | null;
  checkLotto?: boolean;
  checkPension?: boolean;
  fetchLottoResultFn?: typeof fetchLottoResult;
  fetchPensionResultFn?: typeof fetchPensionResult;
}): Promise<UnsettledPurchasePresence> {
  const fetchLottoResultFn = input.fetchLottoResultFn ?? fetchLottoResult;
  const fetchPensionResultFn = input.fetchPensionResultFn ?? fetchPensionResult;
  const shouldCheckLotto = input.checkLotto ?? true;
  const shouldCheckPension = input.checkPension ?? true;

  const [lottoUnsettled, pensionUnsettled] = await Promise.all([
    shouldCheckLotto ? isRoundUnsettled(input.lottoRound, fetchLottoResultFn) : Promise.resolve(false),
    shouldCheckPension ? isRoundUnsettled(input.pensionRound, fetchPensionResultFn) : Promise.resolve(false),
  ]);

  return {
    lottoUnsettled,
    pensionUnsettled,
    lottoRound: input.lottoRound,
    pensionRound: input.pensionRound,
  };
}

function currentKstDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getBuyHistoryRange(date = new Date()): { startDate: string; endDate: string } {
  const endDate = currentKstDate(date);
  return { startDate: shiftIsoDate(endDate, -30), endDate };
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function isRoundUnsettled(
  round: number | null,
  fetchResult: (round: number) => Promise<unknown>,
): Promise<boolean> {
  if (!round) {
    return false;
  }
  try {
    await fetchResult(round);
    return false;
  } catch (error) {
    if (isResultNotPublishedError(error)) {
      return true;
    }
    throw error;
  }
}
