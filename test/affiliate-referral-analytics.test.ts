import assert from "node:assert/strict";
import test from "node:test";

import { AffiliateRepository } from "../src/server/affiliateRepository.js";
import type { Database } from "../src/server/database.js";

test("affiliate referral clicks attach to the active coupon without storing the visitor id", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const database = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM affiliate_coupons c")) {
        return { rows: [{ id: "coupon-id", affiliate_id: "affiliate-id" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO affiliate_referral_clicks")) {
        return { rows: [{ id: "click-id" }], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Database;
  const repository = new AffiliateRepository(database);

  const result = await repository.recordReferralClick({
    couponCode: "SAMMYC",
    visitorHash: "a".repeat(64),
    eventKey: "b".repeat(64),
    landingPath: "/research-peptides/",
    referrerHost: "instagram.com",
    deviceType: "mobile",
    occurredAt: new Date("2026-11-08T12:00:00.000Z"),
  });

  assert.deepEqual(result, { recorded: true, affiliateId: "affiliate-id", couponId: "coupon-id" });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.values, ["SAMMYC"]);
  assert.equal(calls[1]?.values.includes("a".repeat(64)), true);
  assert.equal(calls[1]?.values.includes("SAMMYC"), false);
  assert.equal(calls[1]?.values.includes("phaseone_affiliate_visitor_id"), false);
});

test("affiliate referral retries are idempotent", async () => {
  const database = {
    async query(sql: string) {
      if (sql.includes("FROM affiliate_coupons c")) {
        return { rows: [{ id: "coupon-id", affiliate_id: "affiliate-id" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Database;
  const repository = new AffiliateRepository(database);

  const result = await repository.recordReferralClick({
    couponCode: "SAMMYC",
    visitorHash: "a".repeat(64),
    eventKey: "b".repeat(64),
    landingPath: "/",
    referrerHost: "",
    deviceType: "desktop",
    occurredAt: new Date("2026-11-08T12:00:00.000Z"),
  });

  assert.deepEqual(result, { recorded: false, affiliateId: "affiliate-id", couponId: "coupon-id" });
});

test("unknown or inactive coupons do not create referral rows", async () => {
  let queryCount = 0;
  const database = {
    async query() {
      queryCount += 1;
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Database;
  const repository = new AffiliateRepository(database);

  const result = await repository.recordReferralClick({
    couponCode: "MISSING",
    visitorHash: "a".repeat(64),
    eventKey: "b".repeat(64),
    landingPath: "/",
    referrerHost: "",
    deviceType: "unknown",
    occurredAt: new Date("2026-11-08T12:00:00.000Z"),
  });

  assert.equal(result, null);
  assert.equal(queryCount, 1);
});
