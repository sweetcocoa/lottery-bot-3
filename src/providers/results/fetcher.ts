export interface LottoResult {
  drawRound: number;
  numbers: number[];
  bonus: number;
}

export interface PensionResult {
  drawRound: number;
  winningNumbers: Array<{ group: number; number: string }>;
}

export async function fetchLottoResult(round: number): Promise<LottoResult> {
  const response = await fetch(`https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch lotto result for round ${round}: ${response.status}`);
  }
  const payload = await response.json() as Record<string, unknown>;
  return {
    drawRound: round,
    numbers: [1, 2, 3, 4, 5, 6].map((index) => Number(payload[`drwtNo${index}`])),
    bonus: Number(payload.bnusNo),
  };
}

export async function fetchPensionResult(round: number): Promise<PensionResult> {
  const response = await fetch(`https://www.dhlottery.co.kr/gameResult.do?method=win720&Round=${round}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch pension result for round ${round}: ${response.status}`);
  }
  const html = await response.text();
  const winningNumbers: Array<{ group: number; number: string }> = [];
  const regex = /(\d)조\s*([0-9]{6})/g;
  for (const match of html.matchAll(regex)) {
    winningNumbers.push({ group: Number(match[1]), number: match[2] });
  }
  return {
    drawRound: round,
    winningNumbers,
  };
}

export async function loadFixtureResults(): Promise<{ lotto: LottoResult; pension: PensionResult }> {
  const [lotto, pension] = await Promise.all([
    import('../../testing/fixtures/lotto-result.fixture.ts').then((module) => module.lottoFixture),
    import('../../testing/fixtures/pension-result.fixture.ts').then((module) => module.pensionFixture),
  ]);
  return { lotto, pension };
}
