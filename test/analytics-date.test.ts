import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ANALYTICS_TIME_ZONE,
  analyticsDateKey,
  analyticsDateRange,
  validateTimeZone,
} from "../src/server/analyticsDate.js";

test("analytics date keys use the Bogota calendar day at the UTC boundary", () => {
  assert.equal(DEFAULT_ANALYTICS_TIME_ZONE, "America/Bogota");
  assert.equal(
    analyticsDateKey(new Date("2026-01-02T04:59:59.999Z")),
    "2026-01-01",
  );
  assert.equal(
    analyticsDateKey(new Date("2026-01-02T05:00:00.000Z")),
    "2026-01-02",
  );
});

test("analytics date ranges cross leap-day and month boundaries", () => {
  assert.deepEqual(
    analyticsDateRange(
      new Date("2024-03-01T12:00:00.000Z"),
      3,
      "America/Bogota",
    ),
    ["2024-02-28", "2024-02-29", "2024-03-01"],
  );
});

test("analytics time-zone validation rejects invalid IANA identifiers", () => {
  assert.equal(validateTimeZone("America/Bogota"), "America/Bogota");
  assert.throws(
    () => validateTimeZone("Mars/Olympus_Mons"),
    /Invalid analytics time zone: Mars\/Olympus_Mons/,
  );
});

test("analytics date ranges reject nonpositive day counts", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  assert.deepEqual(analyticsDateRange(now, 0), []);
  assert.deepEqual(analyticsDateRange(now, -3), []);
});
