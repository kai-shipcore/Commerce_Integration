const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function offsetContainerDate(value: string, days: number): string {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The calendar date a local-time Date falls on, as YYYY-MM-DD.
 *
 * Not `toISOString().slice(0, 10)`: that is the UTC date, which is the day
 * before for a local midnight anywhere east of UTC.
 */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A local-midnight Date `days` calendar days from `date`.
 *
 * Not `getTime() + days * 86_400_000`: a day is 23 or 25 hours when daylight
 * saving changes, so that lands on the wrong date (or the same date twice).
 */
export function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The days a Monday-first month grid shows: whole weeks covering the month,
 * each as a local-midnight Date. `month` is 0-based.
 */
export function monthGridDates(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingDays = (firstDay.getDay() + 6) % 7; // Mon = 0
  const cellCount = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) =>
    new Date(year, month, 1 - leadingDays + index),
  );
}

