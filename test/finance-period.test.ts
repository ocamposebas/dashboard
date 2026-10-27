import assert from "node:assert/strict";
import test from "node:test";

import { financePeriod } from "../src/shared/financePeriod.js";

const now = new Date(2026, 9, 27, 15, 30, 0);

test("finance periods describe year-to-date with exact dates", () => {
  const period = financePeriod("year", now);
  assert.equal(period.title, "Year to date");
  assert.equal(period.dateLabel, "Jan 1 – Oct 27, 2026");
  assert.equal(period.start.getFullYear(), 2026);
  assert.equal(period.start.getMonth(), 0);
  assert.equal(period.start.getDate(), 1);
});

test("finance periods describe month-to-date without ambiguous labels", () => {
  const period = financePeriod("month", now);
  assert.equal(period.title, "Month to date");
  assert.equal(period.dateLabel, "Oct 1–27, 2026");
  assert.equal(period.reportLabel, "Month to date · Oct 1–27, 2026");
});

test("rolling finance periods include the requested number of calendar days", () => {
  const period = financePeriod("30", now);
  assert.equal(period.title, "Last 30 days");
  assert.equal(period.dateLabel, "Sep 28 – Oct 27, 2026");
  assert.equal(Math.round((period.end.getTime() - period.start.getTime() + 1) / 86_400_000), 30);
});
