import assert from "node:assert/strict";
import test from "node:test";
import { analyticsFingerprint } from "../src/server/analyticsIdentity.js";
import { WooOrderSync } from "../src/server/wooOrderSync.js";

test("reconciles paid Woo orders and switches to an overlapping modified cursor", async () => {
  const secret = "s".repeat(32);
  const now = new Date("2026-10-09T18:00:00.000Z");
  const seen = new Set<string>();
  const recordedDates = new Map<string, string>();
  const requestedUrls: URL[] = [];
  let cursor: Date | null = null;
  let requestCount = 0;
  const newOrderNotifications: Array<{ id: number; customer: string; total: number }> = [];

  const store = {
    async recordReconciledOrder(fingerprint: string, paidAt: Date) {
      recordedDates.set(fingerprint, paidAt.toISOString());
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    },
    async getOrderSyncCursor() {
      return cursor;
    },
    async setOrderSyncCursor(value: Date) {
      cursor = value;
    },
  };

  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    requestCount += 1;

    const payload = requestCount === 1
      ? [
          {
            id: 101,
            status: "completed",
            date_completed_gmt: "2026-10-08T14:30:00",
          },
          {
            id: 102,
            status: "pending",
            date_modified_gmt: "2026-10-08T15:00:00",
          },
        ]
      : [
          {
            id: 101,
            status: "completed",
            date_completed_gmt: "2026-10-08T14:30:00",
          },
          {
            id: 103,
            number: "103",
            status: "processing",
            currency: "USD",
            total: "149.50",
            payment_method: "phaseone_zelle",
            billing: { first_name: "Research", last_name: "Customer" },
            date_paid_gmt: "2026-10-09T17:45:00",
          },
        ];

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "x-wp-totalpages": "1" },
    });
  };

  const sync = new WooOrderSync(
    {
      baseUrl: "https://woo.example",
      consumerKey: "ck_test",
      consumerSecret: "cs_test",
      analyticsHmacSecret: secret,
      syncIntervalMs: 60_000,
      backfillDays: 400,
    },
    store,
    {
      fetchImpl,
      now: () => new Date(now),
      onNewPaidOrder: async (order) => {
        newOrderNotifications.push({ id: order.id, customer: order.customer, total: order.total });
      },
    },
  );

  assert.deepEqual(await sync.syncOnce(), {
    mode: "backfill",
    scanned: 2,
    paid: 1,
    recorded: 1,
  });
  assert.equal(requestedUrls[0]?.searchParams.has("after"), true);
  assert.equal(requestedUrls[0]?.searchParams.has("modified_after"), false);
  assert.equal(cursor?.toISOString(), now.toISOString());

  assert.deepEqual(await sync.syncOnce(), {
    mode: "incremental",
    scanned: 2,
    paid: 2,
    recorded: 1,
  });
  assert.equal(requestedUrls[1]?.searchParams.has("after"), false);
  assert.equal(
    requestedUrls[1]?.searchParams.get("modified_after"),
    "2026-10-09T17:55:00.000Z",
  );

  const firstFingerprint = analyticsFingerprint(secret, "order", "101");
  const secondFingerprint = analyticsFingerprint(secret, "order", "103");
  assert.equal(recordedDates.get(firstFingerprint), "2026-10-08T14:30:00.000Z");
  assert.equal(recordedDates.get(secondFingerprint), "2026-10-09T17:45:00.000Z");
  assert.equal(seen.size, 2);
  assert.deepEqual(newOrderNotifications, [{ id: 103, customer: "Research Customer", total: 149.5 }]);
});
