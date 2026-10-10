import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "redis";
import { PresenceStore } from "../src/server/presenceStore.js";

const redisUrl = process.env.TEST_REDIS_URL;

test(
  "tracks unique, returning, daily and paid-order analytics idempotently",
  { skip: redisUrl ? false : "Set TEST_REDIS_URL to run the Redis integration test" },
  async () => {
    assert.ok(redisUrl);
    const prefix = `phaseone:test:${randomUUID()}`;
    const store = new PresenceStore(redisUrl, prefix, 45_000, "America/Bogota");
    const cleanup = createClient({ url: redisUrl });
    await cleanup.connect();
    await store.connect(() => undefined);

    const rawVisitorId = randomUUID();
    const analyticsVisitorId = "a".repeat(64);
    const firstConnectionId = randomUUID();
    const secondConnectionId = randomUUID();
    const firstSession = randomUUID();
    const secondSession = randomUUID();

    try {
      await store.touch(
        rawVisitorId,
        analyticsVisitorId,
        firstConnectionId,
        "HOME",
      );
      await store.touch(
        rawVisitorId,
        analyticsVisitorId,
        secondConnectionId,
        "SHOP",
      );
      const multiTabSnapshot = await store.snapshot();
      assert.equal(multiTabSnapshot.total, 1);
      await store.remove(secondConnectionId);
      const remainingTabSnapshot = await store.snapshot();
      assert.equal(remainingTabSnapshot.total, 1);
      assert.equal(remainingTabSnapshot.counts.HOME, 1);
      await store.startSession({
        sessionId: firstSession,
        visitorId: analyticsVisitorId,
        uniqueVisitorId: rawVisitorId,
        source: "Direct",
        device: "Desktop",
        path: "/",
      });
      await store.startSession({
        sessionId: firstSession,
        visitorId: analyticsVisitorId,
        uniqueVisitorId: rawVisitorId,
        source: "Direct",
        device: "Desktop",
        path: "/",
      });
      await store.recordPageView(rawVisitorId, firstSession, "/");
      await store.recordClick(firstSession, "/", "Shop");
      assert.equal(
        await store.recordReconciledOrder("b".repeat(64), new Date()),
        true,
      );
      assert.equal(
        await store.recordOrder(firstSession, "b".repeat(64), "/checkout/thank-you"),
        false,
      );
      assert.equal(
        await store.recordReconciledOrder("b".repeat(64), new Date()),
        false,
      );

      await store.startSession({
        sessionId: secondSession,
        visitorId: analyticsVisitorId,
        uniqueVisitorId: rawVisitorId,
        source: "Direct",
        device: "Desktop",
        path: "/shop",
      });
      await store.recordPageView(rawVisitorId, secondSession, "/shop");

      const snapshot = await store.snapshot();
      assert.equal(snapshot.analytics.uniqueVisitors, 1);
      assert.equal(snapshot.analytics.returningVisitors, 1);
      assert.equal(snapshot.analytics.totalSessions, 2);
      assert.equal(snapshot.analytics.returningSessions, 1);
      assert.equal(snapshot.analytics.totalViews, 2);
      assert.equal(snapshot.analytics.totalClicks, 1);
      assert.equal(snapshot.analytics.totalOrders, 1);
      assert.equal(snapshot.analytics.visitorsLast30Minutes, 1);
      assert.deepEqual(snapshot.analytics.visitorRanges, {
        today: 1,
        last7Days: 1,
        last30Days: 1,
        all: 1,
      });

      const today = snapshot.analytics.dailyActivity.at(-1);
      assert.deepEqual(today, {
        date: today?.date,
        views: 2,
        visitors: 1,
        sessions: 2,
        returningSessions: 1,
        clicks: 1,
        orders: 1,
      });
      const first = snapshot.analytics.recentSessions.find(
        (session) => session.id === firstSession,
      );
      const second = snapshot.analytics.recentSessions.find(
        (session) => session.id === secondSession,
      );
      assert.equal(first?.visitNumber, 1);
      assert.equal(first?.orderCompleted, true);
      assert.equal(first?.events.at(-1)?.type, "order");
      assert.equal(second?.visitNumber, 2);
      assert.equal(second?.returningVisitor, true);
      assert.equal(first?.visitorNumber, second?.visitorNumber);
    } finally {
      await store.disconnect();
      const keys = await cleanup.keys(`${prefix}:*`);
      if (keys.length) await cleanup.unlink(keys);
      await cleanup.quit();
    }
  },
);
