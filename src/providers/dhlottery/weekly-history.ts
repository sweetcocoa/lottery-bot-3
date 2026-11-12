import { request } from 'playwright';
import type { AppConfig } from '../../config/schema.ts';
import type { PurchaseRecord } from '../../core/purchase-record.ts';
import type { LottoTicket, PensionTicket } from '../../core/random-picks.ts';
import { getHistoryPage, HISTORY_ORIGIN, loginForHistory } from './history-login.ts';
import { collectLedgerPages, parseLedgerPage } from './ledger-response.ts';

interface DrawWeek {
  week: string;
  weekStartDate: string;
  weekEndDate: string;
}

const LEDGER_PATH = '/mypage/mylotteryledger';
const LEDGER_HEADERS = {
  AJAX: 'true',
  requestMenuUri: LEDGER_PATH,
  referer: `${HISTORY_ORIGIN}${LEDGER_PATH}`,
};

type LedgerRead = (path: string, params: Record<string, string>, stage: string) => Promise<unknown>;

export async function loadWeeklyPurchaseRecord(input: DrawWeek & {
  username: string;
  password: string;
  config: AppConfig;
}): Promise<PurchaseRecord> {
  const session = await request.newContext({ extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  let stage = 'authentication';
  try {
    await loginForHistory(session, input.username, input.password);
    stage = 'ledger';
    const record = await readWeeklyPurchaseRecord(input, input.config, async (path, params, description) => {
      const query = new URLSearchParams(params);
      const response = await getHistoryPage(session, `${path}?${query}`, description, {
        headers: LEDGER_HEADERS,
        maxRedirects: 0,
      });
      try {
        if (response.status() !== 200) throw new Error(`${description} returned HTTP ${response.status()}`);
        return await response.json().catch(() => { throw new Error(`${description} returned invalid JSON`); });
      } finally {
        await response.dispose().catch(() => undefined);
      }
    });
    console.log(`Purchase history ${input.week}: lotto=${record.lotto.count}, pension=${record.pension.count}`);
    return record;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Purchase history ${stage} failed for ${input.week}: ${reason}`, { cause: error });
  } finally {
    await session.dispose().catch(() => console.warn('Could not close purchase history session'));
  }
}

export async function readWeeklyPurchaseRecord(week: DrawWeek, config: AppConfig, read: LedgerRead): Promise<PurchaseRecord> {
  const searchStart = new Date(`${week.weekStartDate}T00:00:00Z`);
  searchStart.setUTCDate(searchStart.getUTCDate() - 7);
  const dates = {
    srchStrDt: searchStart.toISOString().slice(0, 10).replaceAll('-', ''),
    srchEndDt: week.weekEndDate.replaceAll('-', ''),
  };
  const readPage = async (pageNumber: number) => parseLedgerPage(await read('/mypage/selectMyLotteryledger.do', {
    ...dates,
    sort: '',
    ltGdsCd: '',
    winResult: '',
    lramSmam: '',
    pageNum: String(pageNumber),
    recordCountPerPage: '10',
  }, `Purchase history page ${pageNumber}`), 200);

  const entries = await collectLedgerPages(await readPage(1), readPage);
  const lottoTickets: LottoTicket[] = [];
  const pensionTickets: PensionTicket[] = [];
  let lottoRound = 0;
  let pensionRound = 0;
  for (const entry of entries) {
    const row = asObject(entry);
    const product = row?.ltGdsCd;
    if (typeof product !== 'string' || !product) throw new Error('Purchase history row is missing its product code');
    if (product !== 'LO40' && product !== 'LP72') continue;
    const drawDate = row?.epsdRflDt;
    if (typeof drawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(drawDate)) {
      throw new Error('Purchase history row has an invalid draw date');
    }
    if (drawDate < week.weekStartDate || drawDate > week.weekEndDate) continue;
    const round = row?.ltEpsd;
    const count = row?.prchsQty;
    if (!isPositiveInteger(round) || !isPositiveInteger(count)) throw new Error('Purchase history row has an invalid round or ticket count');

    if (product === 'LP72') {
      const ticket = typeof row.gmInfo === 'string' ? row.gmInfo.match(/^([1-5]):(\d{6})$/) : null;
      if (!ticket || count !== 1) throw new Error(`Incomplete or invalid pension ticket details for round ${round}`);
      if (pensionRound && pensionRound !== round) throw new Error('Multiple pension rounds found in the selected week');
      pensionRound = round;
      pensionTickets.push({ group: Number(ticket[1]), number: ticket[2] });
      continue;
    }

    if (lottoRound && lottoRound !== round) throw new Error('Multiple lotto rounds found in the selected week');
    lottoRound = round;
    const { ntslOrdrNo, gmInfo } = row;
    if (typeof ntslOrdrNo !== 'string' || !/^\d+$/.test(ntslOrdrNo) || typeof gmInfo !== 'string' || !/^\d+$/.test(gmInfo)) {
      throw new Error(`Missing or invalid lotto ticket reference for round ${round}`);
    }
    const payload = await read('/mypage/lotto645TicketDetail.do', {
      ...dates, ntslOrdrNo, barcd: gmInfo,
    }, `Lotto ticket detail for round ${round}`);
    lottoTickets.push(...parseLottoTickets(payload, round, count, gmInfo));
  }

  return {
    week: week.week,
    mode: 'live',
    executedAt: new Date().toISOString(),
    lotto: {
      mode: config.lotto.mode,
      tickets: lottoTickets,
      count: lottoTickets.length,
      drawRound: lottoRound,
      status: lottoTickets.length ? 'purchased' : 'skipped',
      receiptId: `history-lotto-${week.week}`,
    },
    pension: {
      mode: config.pension.mode,
      tickets: pensionTickets,
      count: pensionTickets.length,
      drawRound: pensionRound,
      status: pensionTickets.length ? 'purchased' : 'skipped',
      receiptId: `history-pension-${week.week}`,
    },
    runContext: { workflow: 'results.yml', runner: process.env.GITHUB_ACTIONS ? 'github' : 'local' },
  };
}

function parseLottoTickets(payload: unknown, round: number, count: number, barcode: string): LottoTicket[] {
  const envelope = asObject(payload);
  const data = asObject(envelope?.data);
  const ticket = asObject(data?.ticket);
  if (!envelope || envelope.resultCode || data?.success !== true || ticket?.game_round !== round || ticket?.barcode !== barcode
    || !Array.isArray(ticket?.game_dtl) || ticket.game_dtl.length !== count) {
    throw new Error(`Incomplete or mismatched lotto ticket details for round ${round}`);
  }
  return ticket.game_dtl.map((line: unknown) => {
    const numbers = asObject(line)?.num;
    if (!Array.isArray(numbers) || numbers.length !== 6 || new Set(numbers).size !== 6
      || numbers.some((number) => !isPositiveInteger(number) || number > 45)) {
      throw new Error(`Invalid lotto ticket numbers for round ${round}`);
    }
    return numbers as LottoTicket;
  });
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
