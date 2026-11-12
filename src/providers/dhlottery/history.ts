import { mkdir, writeFile } from 'node:fs/promises';
import { createBrowserSession } from './session.ts';
import { loginForHistory } from './history-login.ts';
import { collectLedgerPages, ledgerPageInfo } from './ledger-response.ts';
import { fetchLottoResult, fetchPensionResult, isResultNotPublishedError } from '../results/fetcher.ts';

const LEDGER_URL = 'https://www.dhlottery.co.kr/mypage/mylotteryledger';
const LEDGER_READY_TIMEOUT = 15000;
export interface UnsettledPurchasePresence {
  lottoUnsettled: boolean;
  pensionUnsettled: boolean;
  lottoRound: number | null;
  pensionRound: number | null;
}

interface LedgerEntry {
  index: number;
  productCode: string;
  productName: string;
  round: number;
  numberText: string;
  purchaseCount: number;
  purchaseDate: string;
  drawDate: string;
}

export class DhlotteryHistoryProvider {
  async loadUnsettledPurchasePresence(input: {
    username: string;
    password: string;
    checkLotto?: boolean;
    checkPension?: boolean;
  }): Promise<UnsettledPurchasePresence> {
    const { browser, page } = await createBrowserSession();
    let latestRounds;
    const range = getBuyHistoryRange();
    try {
      await loginForHistory(page.context().request, input.username, input.password);
      const firstPage = await openLedgerPage(page, range.startDate, range.endDate);
      const entries = await collectLedgerPages({ rows: await loadLedgerEntries(page), total: firstPage.total }, async (pageNumber) => {
        const nextPage = await searchLedgerPage(page, range.startDate, range.endDate, pageNumber);
        return { rows: await loadLedgerEntries(page), total: nextPage.total };
      });
      latestRounds = resolveLatestProductRounds(entries);
    } catch (error) {
      await mkdir('artifacts/diagnostics', { recursive: true });
      const reason = error instanceof Error ? error.message : String(error);
      await writeDiagnostics('artifacts/diagnostics/buy-preflight.txt', [
        `currentUrl=${page.url()}`,
        `searchStart=${range.startDate}`,
        `searchEnd=${range.endDate}`,
        `error=${reason}`,
      ]);
      throw error;
    } finally {
      await browser.close();
    }

    return resolveUnsettledPurchasePresence({
      lottoRound: latestRounds.lottoRound,
      pensionRound: latestRounds.pensionRound,
      checkLotto: input.checkLotto,
      checkPension: input.checkPension,
    });
  }

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

async function writeDiagnostics(path: string, lines: string[]): Promise<void> {
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
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

async function openLedgerPage(page: any, startDate: string, endDate: string): Promise<{ rowCount: number; total: number }> {
  let stage = 'page navigation';
  try {
    await page.goto(LEDGER_URL, { waitUntil: 'domcontentloaded', timeout: LEDGER_READY_TIMEOUT });
    stage = 'search controls';
    await page.waitForFunction(
      () => typeof (window as any).MyLotteryledgerM?.fn_selectMyLotteryledger === 'function',
      null,
      { timeout: LEDGER_READY_TIMEOUT },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Purchase history ${stage} failed for ${startDate}..${endDate}: ${reason}`, { cause: error });
  }
  return searchLedgerPage(page, startDate, endDate, 1);
}

async function searchLedgerPage(page: any, startDate: string, endDate: string, pageNumber: number): Promise<{ rowCount: number; total: number }> {
  let stage = 'search response';
  try {
    const responsePromise = page.waitForResponse((response: any) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/selectMyLotteryledger.do')
        && url.searchParams.get('srchStrDt') === startDate.replaceAll('-', '')
        && url.searchParams.get('srchEndDt') === endDate.replaceAll('-', '')
        && url.searchParams.get('pageNum') === String(pageNumber);
    }, { timeout: LEDGER_READY_TIMEOUT });
    const [response] = await Promise.all([responsePromise, page.evaluate(({ startDate, endDate, pageNumber }) => {
      const startInput = document.querySelector('#srchStrDt') as HTMLInputElement | null;
      const endInput = document.querySelector('#srchEndDt') as HTMLInputElement | null;
      const goodsSelect = document.querySelector('#ltGdsSelect') as HTMLSelectElement | null;
      if (!startInput || !endInput || !goodsSelect) {
        throw new Error('Purchase history search controls are missing');
      }
      startInput.value = startDate;
      endInput.value = endDate;
      goodsSelect.value = '';
      // Clear the initial list so the wait observes this search's callback.
      // @ts-ignore
      MyLotteryledgerM.list = null;
      // @ts-ignore
      MyLotteryledgerM.fn_selectMyLotteryledger(pageNumber);
    }, { startDate, endDate, pageNumber })]);
    const info = ledgerPageInfo(await response.json(), response.status());
    stage = 'search rendering';
    await page.waitForFunction(
      (expected: number) => Array.isArray((window as any).MyLotteryledgerM?.list)
        && (window as any).MyLotteryledgerM.list.length === expected
        && document.querySelectorAll('.whl-body .whl-row').length === expected,
      info.rowCount,
      { timeout: LEDGER_READY_TIMEOUT },
    );
    return info;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Purchase history ${stage} failed for ${startDate}..${endDate}: ${reason}`, { cause: error });
  }
}

async function loadLedgerEntries(page: any): Promise<LedgerEntry[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.whl-body .whl-row'));
    return rows.map((row) => {
      const getField = (selector: string) => {
        return (row.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
      };
      const barcode = row.querySelector('.barcd') as HTMLElement | null;
      return {
        index: Number(barcode?.dataset.index || '-1'),
        productCode: getProductCode(getField('.col-name .whl-txt')),
        productName: getField('.col-name .whl-txt'),
        round: Number(getField('.col-th .whl-txt')),
        numberText: getField('.col-num .whl-txt'),
        purchaseCount: Number(getField('.col-ea .whl-txt') || '0'),
        purchaseDate: getField('.col-date1 .whl-txt'),
        drawDate: getField('.col-date2 .whl-txt'),
      };
    });

    function getProductCode(name: string): string {
      if (name === '로또6/45') return 'LO40';
      if (name === '연금복권720+') return 'LP72';
      return '';
    }
  });
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
