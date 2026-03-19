import { mkdir, writeFile } from 'node:fs/promises';
import type { AppConfig } from '../../config/schema.ts';
import type { PurchaseRecord } from '../../core/purchase-record.ts';
import type { LottoTicket, PensionTicket } from '../../core/random-picks.ts';
import { createBrowserSession, login } from './session.ts';

const LEDGER_URL = 'https://www.dhlottery.co.kr/mypage/mylotteryledger';

interface HistoryInput {
  username: string;
  password: string;
  week: string;
  weekStartDate: string;
  weekEndDate: string;
  config: AppConfig;
}

export interface WeeklyPurchasePresence {
  lottoCount: number;
  pensionCount: number;
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

export function parsePensionTicketText(numberText: string): PensionTicket | null {
  const match = numberText.replace(/\s+/g, ' ').trim().match(/^(\d)\s*조\s*(\d{6})$/);
  if (!match) {
    return null;
  }
  return {
    group: Number(match[1]),
    number: match[2],
  };
}

export function buildHistoryPurchaseRecord(
  config: AppConfig,
  input: {
    week: string;
    lottoRound: number;
    pensionRound: number;
    lottoTickets: LottoTicket[];
    pensionTickets: PensionTicket[];
  },
): PurchaseRecord {
  return {
    week: input.week,
    mode: 'live',
    executedAt: new Date().toISOString(),
    lotto: {
      mode: config.lotto.mode,
      tickets: input.lottoTickets,
      count: input.lottoTickets.length,
      drawRound: input.lottoRound,
      status: input.lottoTickets.length > 0 ? 'purchased' : 'skipped',
      receiptId: `history-lotto-${input.week}`,
    },
    pension: {
      mode: config.pension.mode,
      tickets: input.pensionTickets,
      count: input.pensionTickets.length,
      drawRound: input.pensionRound,
      status: input.pensionTickets.length > 0 ? 'purchased' : 'skipped',
      receiptId: `history-pension-${input.week}`,
    },
    runContext: {
      workflow: 'results.yml',
      runner: process.env.GITHUB_ACTIONS ? 'github' : 'local',
    },
  };
}

export class DhlotteryHistoryProvider {
  async loadWeeklyPurchasePresence(input: Omit<HistoryInput, 'config'>): Promise<WeeklyPurchasePresence> {
    const { browser, page } = await createBrowserSession();
    try {
      await login(page, input.username, input.password);
      await openLedgerPage(page, input.weekStartDate, input.weekEndDate);
      const entries = await loadLedgerEntries(page);
      const weekEntries = entries.filter((entry) => isWithinDateRange(entry.purchaseDate, input.weekStartDate, input.weekEndDate));
      return {
        lottoCount: weekEntries
          .filter((entry) => entry.productCode === 'LO40')
          .reduce((sum, entry) => sum + Math.max(entry.purchaseCount, 1), 0),
        pensionCount: weekEntries
          .filter((entry) => entry.productCode === 'LP72')
          .reduce((sum, entry) => sum + Math.max(entry.purchaseCount, 1), 0),
      };
    } finally {
      await browser.close();
    }
  }

  async loadWeeklyPurchaseRecord(input: HistoryInput): Promise<PurchaseRecord> {
    const { browser, page } = await createBrowserSession();
    await mkdir('artifacts/diagnostics', { recursive: true });
    const diagnosticsPath = `artifacts/diagnostics/history-${input.week}.txt`;
    const screenshotPath = `artifacts/diagnostics/history-${input.week}.png`;

    try {
      await login(page, input.username, input.password);
      await openLedgerPage(page, input.weekStartDate, input.weekEndDate);
      const entries = await loadLedgerEntries(page);
      const weekEntries = entries.filter((entry) => isWithinDateRange(entry.purchaseDate, input.weekStartDate, input.weekEndDate));
      const lottoRound = resolveSingleRound(weekEntries, 'LO40', 'lotto');
      const pensionRound = resolveSingleRound(weekEntries, 'LP72', 'pension');
      const lottoEntries = weekEntries.filter((entry) => entry.productCode === 'LO40' && entry.round === lottoRound);
      const pensionEntries = weekEntries.filter((entry) => entry.productCode === 'LP72' && entry.round === pensionRound);

      const lottoTickets = await extractLottoTickets(page, lottoEntries);
      const pensionTickets = pensionEntries
        .map((entry) => parsePensionTicketText(entry.numberText))
        .filter((ticket): ticket is PensionTicket => ticket !== null);

      if (lottoTickets.length === 0 || pensionTickets.length === 0) {
        throw new Error(`Incomplete purchase history found for ${input.week} (lottoCount=${lottoTickets.length}, pensionCount=${pensionTickets.length})`);
      }

      const record = buildHistoryPurchaseRecord(input.config, {
        week: input.week,
        lottoRound,
        pensionRound,
        lottoTickets,
        pensionTickets,
      });

      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
      await writeDiagnostics(diagnosticsPath, [
        `week=${input.week}`,
        `searchStart=${input.weekStartDate}`,
        `searchEnd=${input.weekEndDate}`,
        `lottoRound=${lottoRound}`,
        `pensionRound=${pensionRound}`,
        `lottoCount=${lottoTickets.length}`,
        `pensionCount=${pensionTickets.length}`,
      ]);
      return record;
    } catch (error) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
      const title = await page.title().catch(() => '');
      await writeDiagnostics(diagnosticsPath, [
        `week=${input.week}`,
        `searchStart=${input.weekStartDate}`,
        `searchEnd=${input.weekEndDate}`,
        `currentUrl=${page.url()}`,
        `title=${title}`,
        `error=${error instanceof Error ? error.message : String(error)}`,
      ]);
      throw error;
    } finally {
      await browser.close();
    }
  }
}

async function writeDiagnostics(path: string, lines: string[]): Promise<void> {
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}

function isWithinDateRange(value: string, startDate: string, endDate: string): boolean {
  return value >= startDate && value <= endDate;
}

function resolveSingleRound(entries: LedgerEntry[], productCode: string, label: string): number {
  const rounds = [...new Set(entries
    .filter((entry) => entry.productCode === productCode)
    .map((entry) => entry.round)
    .filter((round) => Number.isInteger(round) && round > 0))];
  if (rounds.length === 0) {
    throw new Error(`No ${label} purchase history found in the selected week`);
  }
  if (rounds.length > 1) {
    throw new Error(`Multiple ${label} rounds found in the selected week: ${rounds.join(', ')}`);
  }
  return rounds[0];
}

async function openLedgerPage(page: any, startDate: string, endDate: string): Promise<void> {
  await page.goto(LEDGER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => typeof (window as any).MyLotteryledgerM?.fn_selectMyLotteryledger === 'function',
    { timeout: 15000 },
  );
  await page.evaluate(({ startDate, endDate }) => {
    const startInput = document.querySelector('#srchStrDt') as HTMLInputElement | null;
    const endInput = document.querySelector('#srchEndDt') as HTMLInputElement | null;
    const goodsSelect = document.querySelector('#ltGdsSelect') as HTMLSelectElement | null;
    if (!startInput || !endInput || !goodsSelect) {
      throw new Error('Purchase history search controls are missing');
    }
    startInput.value = startDate;
    endInput.value = endDate;
    goodsSelect.value = '';
    // @ts-ignore
    MyLotteryledgerM.fn_selectMyLotteryledger(1);
  }, { startDate, endDate });
  await page.waitForTimeout(2000);
  await page.waitForFunction(
    () => Array.isArray((window as any).MyLotteryledgerM?.list),
    { timeout: 15000 },
  );
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

async function extractLottoTickets(page: any, entries: LedgerEntry[]): Promise<LottoTicket[]> {
  const allTickets: LottoTicket[] = [];
  for (const entry of entries) {
    if (entry.index < 0) {
      continue;
    }
    const trigger = page.locator(`.whl-body .barcd[data-index="${entry.index}"]`).first();
    await trigger.waitFor({ state: 'visible', timeout: 10000 });
    await trigger.click();
    const popup = page.locator('#Lotto645TicketP');
    await popup.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelectorAll('#Lotto645TicketP .ticket-num-line .ticket-num-wrap').length > 0,
      { timeout: 15000 },
    );
    const tickets = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#Lotto645TicketP .ticket-num-line .ticket-num-wrap'))
        .map((line) => Array.from(line.querySelectorAll('.ticket-num-in'))
          .map((node) => Number((node.textContent || '').trim()))
          .filter((value) => Number.isInteger(value) && value > 0))
        .filter((ticket) => ticket.length === 6);
    });
    allTickets.push(...tickets);
    const closeButton = page.locator('#Lotto645TicketP .btn-pop-close').first();
    if (await closeButton.count()) {
      await closeButton.click();
      await popup.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    }
  }
  return allTickets;
}
