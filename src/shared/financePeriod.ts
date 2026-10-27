export type FinanceRange = "month" | "30" | "90" | "year";

export interface FinancePeriod {
  range: FinanceRange;
  start: Date;
  end: Date;
  title: string;
  dateLabel: string;
  reportLabel: string;
}

function formatDateRange(start: Date, end: Date): string {
  const startMonth = new Intl.DateTimeFormat("en-US", { month: "short" }).format(start);
  const endMonth = new Intl.DateTimeFormat("en-US", { month: "short" }).format(end);
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear !== endYear) return `${startMonth} ${start.getDate()}, ${startYear} – ${endMonth} ${end.getDate()}, ${endYear}`;
  if (start.getMonth() === end.getMonth()) return `${startMonth} ${start.getDate()}–${end.getDate()}, ${endYear}`;
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${endYear}`;
}

export function financePeriod(range: FinanceRange, now = new Date()): FinancePeriod {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let start: Date;
  let title: string;
  if (range === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    title = "Month to date";
  } else if (range === "year") {
    start = new Date(now.getFullYear(), 0, 1);
    title = "Year to date";
  } else {
    const days = range === "90" ? 89 : 29;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    title = range === "90" ? "Last 90 days" : "Last 30 days";
  }
  const dateLabel = formatDateRange(start, end);
  return { range, start, end, title, dateLabel, reportLabel: `${title} · ${dateLabel}` };
}
