import type { APIRequestContext } from 'playwright';
import { getHistoryPage, HISTORY_ORIGIN } from './history-login.ts';
import { collectLedgerPages, parseLedgerPage } from './ledger-response.ts';

const LEDGER_PATH = '/mypage/mylotteryledger';
const LEDGER_HEADERS = {
  AJAX: 'true',
  requestMenuUri: LEDGER_PATH,
  referer: `${HISTORY_ORIGIN}${LEDGER_PATH}`,
};

export type LedgerRead = (path: string, params: Record<string, string>, stage: string) => Promise<unknown>;

export function createLedgerReader(session: APIRequestContext): LedgerRead {
  return async (path, params, description) => {
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
  };
}

export function ledgerDates(startDate: string, endDate: string) {
  return { srchStrDt: startDate.replaceAll('-', ''), srchEndDt: endDate.replaceAll('-', '') };
}

export async function readLedgerEntries(read: LedgerRead, dates: ReturnType<typeof ledgerDates>): Promise<unknown[]> {
  const readPage = async (pageNumber: number) => parseLedgerPage(await read('/mypage/selectMyLotteryledger.do', {
    ...dates,
    sort: '',
    ltGdsCd: '',
    winResult: '',
    lramSmam: '',
    pageNum: String(pageNumber),
    recordCountPerPage: '10',
  }, `Purchase history page ${pageNumber}`), 200);
  return collectLedgerPages(await readPage(1), readPage);
}
