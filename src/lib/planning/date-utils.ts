export const PLANNING_TIME_ZONE = "America/Los_Angeles";

export function planningLocalDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PLANNING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

export function addSheetDays(dateStr: string, days: number): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isFinite(days)) return dateStr;

  const startUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const serial = startUtc / 86400000 + 25569;
  const resultSerial = Math.floor(serial + days);
  return new Date((resultSerial - 25569) * 86400000).toISOString().slice(0, 10);
}
