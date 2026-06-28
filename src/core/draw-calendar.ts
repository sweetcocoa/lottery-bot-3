const DAY_MS = 24 * 60 * 60 * 1000;
const LOTTO_BASE_DRAW = new Date('2002-12-07T12:00:00+09:00');
const PENSION_BASE_DRAW = new Date('2020-05-07T19:00:00+09:00');
const LOTTO_DRAW_TIME_KST = 'T12:00:00+09:00';
const PENSION_DRAW_TIME_KST = 'T19:00:00+09:00';

function kstDateParts(input: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(input);
  const value = (type: 'year' | 'month' | 'day') => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
}

function startOfKstDay(input: Date): Date {
  const { year, month, day } = kstDateParts(input);
  return new Date(Date.UTC(year, month - 1, day));
}

export function getIsoWeek(date = new Date()): string {
  const { year, month, day: dateOfMonth } = kstDateParts(date);
  const target = new Date(Date.UTC(year, month - 1, dateOfMonth));
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

function weeklyRound(anchor: Date, base: Date): number {
  const diff = anchor.getTime() - base.getTime();
  return Math.floor(diff / (7 * DAY_MS)) + 1;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function drawDateFromWeekStart(weekStartDate: Date, dayOffset: number, drawTimeKst: string): Date {
  const drawDay = new Date(weekStartDate.getTime() + dayOffset * DAY_MS);
  return new Date(`${formatIsoDate(drawDay)}${drawTimeKst}`);
}

export function getWeekContext(date = new Date(), targetWeek?: string) {
  const week = targetWeek ?? getIsoWeek(date);
  const weekStartDate = mondayFromIsoWeek(week);
  const weekEndDate = new Date(weekStartDate.getTime() + 6 * DAY_MS);
  const lottoDrawDate = drawDateFromWeekStart(weekStartDate, 5, LOTTO_DRAW_TIME_KST);
  const pensionDrawDate = drawDateFromWeekStart(weekStartDate, 3, PENSION_DRAW_TIME_KST);
  const runDate = targetWeek ? weekStartDate : date;
  return {
    week,
    lottoDrawDate,
    pensionDrawDate,
    weekStartDate: formatIsoDate(weekStartDate),
    weekEndDate: formatIsoDate(weekEndDate),
    lottoRound: weeklyRound(lottoDrawDate, LOTTO_BASE_DRAW),
    pensionRound: weeklyRound(pensionDrawDate, PENSION_BASE_DRAW),
    runDateKst: startOfKstDay(runDate).toISOString(),
  };
}
