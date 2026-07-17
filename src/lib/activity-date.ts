const DEFAULT_ACTIVITY_TIME_ZONE = "America/Los_Angeles";

export function getActivityDate(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.APP_TIME_ZONE ?? DEFAULT_ACTIVITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const shifted = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + offsetDays,
  ));
  return shifted.toISOString().slice(0, 10);
}

export function activityDateToUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
