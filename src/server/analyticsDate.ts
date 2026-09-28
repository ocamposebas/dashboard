export const DEFAULT_ANALYTICS_TIME_ZONE = "America/Bogota";

export function validateTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error(`Invalid analytics time zone: ${value}`);
  }
}

export function analyticsDateKey(
  value: Date,
  timeZone = DEFAULT_ANALYTICS_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function analyticsDateRange(
  value: Date,
  days: number,
  timeZone = DEFAULT_ANALYTICS_TIME_ZONE,
): string[] {
  if (!Number.isSafeInteger(days) || days <= 0) return [];
  const dateParts = analyticsDateKey(value, timeZone).split("-").map(Number);
  const year = dateParts[0] ?? 1970;
  const month = dateParts[1] ?? 1;
  const day = dateParts[2] ?? 1;
  const cursor = new Date(Date.UTC(year, month - 1, day, 12));
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(cursor.getTime() - offset * 24 * 60 * 60_000);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
