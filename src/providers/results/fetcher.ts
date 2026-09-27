export interface LottoResult {
  drawRound: number;
  numbers: number[];
  bonus: number;
}

export interface PensionResult {
  drawRound: number;
  winningNumbers: Array<{ group: number; number: string }>;
}

const BASE_URL = 'https://www.dhlottery.co.kr';
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10000;

export async function fetchLottoResult(round: number, fetchImpl: typeof fetch = fetch): Promise<LottoResult> {
  const payload = await fetchResultPayload(
    `${BASE_URL}/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd=${round}`,
    fetchImpl,
  );
  const rows = asArray(payload?.data?.list);
  const item = rows.find((candidate) => Number(candidate?.ltEpsd) === round);
  if (!item) {
    throw new Error(`Lotto result for round ${round} is not published yet`);
  }

  const numbers = [1, 2, 3, 4, 5, 6].map((index) => Number(item[`tm${index}WnNo`]));
  const bonus = Number(item.bnsWnNo);
  if (numbers.some((value) => !Number.isInteger(value) || value < 1 || value > 45)
    || new Set(numbers).size !== 6
    || !Number.isInteger(bonus) || bonus < 1 || bonus > 45 || numbers.includes(bonus)) {
    throw new Error(`Lotto result payload is invalid for round ${round}`);
  }
  return { drawRound: round, numbers, bonus };
}

export async function fetchPensionResult(round: number, fetchImpl: typeof fetch = fetch): Promise<PensionResult> {
  const payload = await fetchResultPayload(
    `${BASE_URL}/pt720/selectPstPt720Info.do?srchPsltEpsd=${round}`,
    fetchImpl,
  );
  const rows = asArray(payload?.data?.result)
    .filter((candidate) => Number(candidate?.psltEpsd) === round);
  if (!rows.length) {
    throw new Error(`Pension result for round ${round} is not published yet`);
  }

  const firstPrize = rows.find((candidate) => Number(candidate.wnSqNo) === 1);
  if (!firstPrize) {
    throw new Error(`Pension result payload is incomplete for round ${round}`);
  }
  const firstGroup = Number(firstPrize.wnBndNo);
  const firstNumber = String(firstPrize.wnRnkVl ?? '');
  if (!Number.isInteger(firstGroup) || firstGroup < 1 || firstGroup > 5 || !/^\d{6}$/.test(firstNumber)) {
    throw new Error(`Pension result payload is invalid for round ${round}`);
  }

  const winningNumbers = [{ group: firstGroup, number: firstNumber }];
  for (const rank of [2, 21]) {
    const row = rows.find((candidate) => Number(candidate.wnSqNo) === rank);
    if (!row) continue;
    const number = String(row.wnRnkVl ?? '');
    if (!/^\d{6}$/.test(number)) {
      throw new Error(`Pension result payload is invalid for round ${round}`);
    }
    for (const group of [1, 2, 3, 4, 5]) {
      winningNumbers.push({ group, number });
    }
  }
  return { drawRound: round, winningNumbers: dedupeWinningNumbers(winningNumbers) };
}

async function fetchResultPayload(url: string, fetchImpl: typeof fetch): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) {
          throw new PermanentResultRequestError(response.status);
        }
        lastError = new Error(`Dhlottery result request failed with status ${response.status}`);
      } else {
        return await response.json();
      }
    } catch (error) {
      if (error instanceof PermanentResultRequestError) throw error;
      lastError = error;
    }
    if (attempt < REQUEST_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Dhlottery result request failed after ${REQUEST_ATTEMPTS} attempts: ${reason}`);
}

class PermanentResultRequestError extends Error {
  constructor(status: number) {
    super(`Dhlottery result request failed with status ${status}`);
  }
}

function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

export function isResultNotPublishedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('is not published yet');
}

function dedupeWinningNumbers(items: Array<{ group: number; number: string }>): Array<{ group: number; number: string }> {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.group}:${item.number}`;
    if (seen.has(key)) return false;
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
