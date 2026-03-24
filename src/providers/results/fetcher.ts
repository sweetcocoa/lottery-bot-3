import { createBrowserSession } from '../dhlottery/session.ts';

export interface LottoResult {
  drawRound: number;
  numbers: number[];
  bonus: number;
}

export interface PensionResult {
  drawRound: number;
  winningNumbers: Array<{ group: number; number: string }>;
}

const LOTTO_RESULT_URL = 'https://www.dhlottery.co.kr/lt645/result';
const PENSION_RESULT_URL = 'https://www.dhlottery.co.kr/pt720/result';

export async function fetchLottoResult(round: number): Promise<LottoResult> {
  const { browser, page } = await createBrowserSession();
  try {
    await page.goto(LOTTO_RESULT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = await page.evaluate(async (requestedRound: number) => {
      const response = await fetch(`/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=${requestedRound}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error(`Lotto result request failed with status ${response.status}`);
      }
      const payload = await response.json() as { data?: { list?: Array<Record<string, unknown>> } };
      const item = payload.data?.list?.find((candidate) => Number(candidate.ltEpsd) === requestedRound);
      if (!item) {
        throw new Error(`Lotto result for round ${requestedRound} is not published yet`);
      }
      return {
        drawRound: requestedRound,
        numbers: [
          Number(item.tm1WnNo),
          Number(item.tm2WnNo),
          Number(item.tm3WnNo),
          Number(item.tm4WnNo),
          Number(item.tm5WnNo),
          Number(item.tm6WnNo),
        ],
        bonus: Number(item.bnsWnNo),
      };
    }, round);
    return result;
  } finally {
    await browser.close();
  }
}

export async function fetchPensionResult(round: number): Promise<PensionResult> {
  const { browser, page } = await createBrowserSession();
  try {
    await page.goto(PENSION_RESULT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = await page.evaluate((requestedRound: number) => {
      return fetch(`/pt720/selectPstPt720Info.do?srchPsltEpsd=${requestedRound}`, {
        credentials: 'same-origin',
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Pension result request failed with status ${response.status}`);
          }
          const payload = await response.json() as { data?: { result?: Array<Record<string, unknown>> } };
          const rows = payload.data?.result ?? [];
          if (!rows.length) {
            throw new Error(`Pension result for round ${requestedRound} is not published yet`);
          }
          const firstPrize = rows.find((candidate) => Number(candidate.wnSqNo) === 1);
          if (!firstPrize) {
            throw new Error(`Pension result payload is incomplete for round ${requestedRound}`);
          }
          const secondPrizeNumber = String(rows.find((candidate) => Number(candidate.wnSqNo) === 2)?.wnRnkVl ?? '');
          const bonusNumber = String(rows.find((candidate) => Number(candidate.wnSqNo) === 21)?.wnRnkVl ?? '');
          const winningNumbers = [
            { group: Number(firstPrize.wnBndNo), number: String(firstPrize.wnRnkVl) },
          ];
          if (secondPrizeNumber) {
            for (const group of [1, 2, 3, 4, 5]) {
              winningNumbers.push({ group, number: secondPrizeNumber });
            }
          }
          if (bonusNumber) {
            for (const group of [1, 2, 3, 4, 5]) {
              winningNumbers.push({ group, number: bonusNumber });
            }
          }
          return {
            drawRound: requestedRound,
            winningNumbers,
          };
        });
    }, round);
    return {
      drawRound: result.drawRound,
      winningNumbers: dedupeWinningNumbers(result.winningNumbers),
    };
  } finally {
    await browser.close();
  }
}

export function isResultNotPublishedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('is not published yet');
}

function dedupeWinningNumbers(items: Array<{ group: number; number: string }>): Array<{ group: number; number: string }> {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.group}:${item.number}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function loadFixtureResults(): Promise<{ lotto: LottoResult; pension: PensionResult }> {
  const [lotto, pension] = await Promise.all([
    import('../../testing/fixtures/lotto-result.fixture.ts').then((module) => module.lottoFixture),
    import('../../testing/fixtures/pension-result.fixture.ts').then((module) => module.pensionFixture),
  ]);
  return { lotto, pension };
}
