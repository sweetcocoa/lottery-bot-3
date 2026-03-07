const DAY_MS = 24 * 60 * 60 * 1000;
const LOTTO_BASE_DRAW = new Date('2002-12-07T12:00:00+09:00');
const PENSION_BASE_DRAW = new Date('2020-05-07T19:00:00+09:00');

function startOfKstDay(input: Date): Date {
  return new Date(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input));
}

export function getIsoWeek(date = new Date()): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function mondayFromIsoWeek(isoWeek: string): Date {
  const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid target week: ${isoWeek}`);
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) {
    throw new Error(`Invalid ISO week number: ${isoWeek}`);
  }
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return monday;
}

function kstWeekAnchor(date = new Date(), targetDay: number): Date {
  const kst = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  const diff = targetDay - day;
  kst.setDate(kst.getDate() + diff);
  return kst;
}

function weeklyRound(anchor: Date, base: Date): number {
  const diff = anchor.getTime() - base.getTime();
  return Math.floor(diff / (7 * DAY_MS)) + 1;
}

export function getWeekContext(date = new Date(), targetWeek?: string) {
  const baseDate = targetWeek ? mondayFromIsoWeek(targetWeek) : date;
  const week = targetWeek ?? getIsoWeek(date);
  const lottoDrawDate = targetWeek
    ? new Date(baseDate.getTime() + 5 * DAY_MS)
    : kstWeekAnchor(baseDate, 6);
  const pensionDrawDate = targetWeek
    ? new Date(baseDate.getTime() + 3 * DAY_MS)
    : kstWeekAnchor(baseDate, 4);
  return {
    week,
    lottoDrawDate,
    pensionDrawDate,
    lottoRound: weeklyRound(lottoDrawDate, LOTTO_BASE_DRAW),
    pensionRound: weeklyRound(pensionDrawDate, PENSION_BASE_DRAW),
    runDateKst: startOfKstDay(baseDate).toISOString(),
  };
}
