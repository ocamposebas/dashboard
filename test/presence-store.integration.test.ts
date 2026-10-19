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
      await store.recordSearch(firstSession, "/shop", {
        query: "bpc 157",
        resultCount: 3,
      });
      await store.recordSearch(firstSession, "/shop", {
        query: "missing compound",
        resultCount: 0,
      });
      await store.recordCart(firstSession, "/shop", {
        customerName: "Research Customer",
        customerEmail: "customer@example.com",
        expiresAt: Date.now() + 48 * 60 * 60_000,
        items: [{
          productId: 101,
          variationId: 0,
          name: "BPC-157",
          sku: "BPC-157",
          quantity: 2,
          price: 39.5,
          imageUrl: "https://example.com/bpc-157.webp",
        }],
      });
      assert.equal(
        await store.recordReconciledOrder("b".repeat(64), new Date()),
        true,
      );
      assert.equal(
        await store.recordOrder(firstSession, "b".repeat(64), "/checkout/thank-you"),
        false,
      );
      await store.markCartConverted(firstSession, "/checkout/thank-you");
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
      await store.recordCart(secondSession, "/shop", {
        customerName: "",
        customerEmail: "",
        expiresAt: Date.now() + 48 * 60 * 60_000,
        items: [{
          productId: 202,
          variationId: 204,
          name: "Research Blend",
          sku: "BLEND-204",
          quantity: 1,
          price: 62,
          imageUrl: "",
        }],
      });

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
      assert.equal(snapshot.analytics.marketing?.activeCarts, 1);
      assert.equal(snapshot.analytics.marketing?.abandonedCarts, 0);
      assert.equal(snapshot.analytics.marketing?.capturedValue, 62);
      assert.equal(snapshot.analytics.marketing?.zeroResultSearches, 1);
      assert.equal(snapshot.analytics.marketing?.topSearches.length, 2);
      assert.equal(snapshot.analytics.marketing?.carts.find(
        (cart) => cart.sessionId === firstSession,
      )?.status, "converted");
      assert.equal(snapshot.analytics.marketing?.recentSearches[0]?.visitorNumber, first?.visitorNumber);
    } finally {
      await store.disconnect();
      const keys = await cleanup.keys(`${prefix}:*`);
      if (keys.length) await cleanup.unlink(keys);
      await cleanup.quit();
    }
  },
);

test(
  "persists one actionable notification for repeated order discovery",
  { skip: redisUrl ? false : "Set TEST_REDIS_URL to run the Redis integration test" },
  async () => {
    assert.ok(redisUrl);
    const prefix = `phaseone:test:${randomUUID()}`;
    const store = new PresenceStore(redisUrl, prefix, 45_000, "America/Bogota");
    const cleanup = createClient({ url: redisUrl });
    await cleanup.connect();
    await store.connect(() => undefined);
    try {
      const input = {
        type: "order" as const,
        severity: "success" as const,
        title: "New order #P1-903",
        message: "Research Customer · USD 149.50",
        actionView: "orders",
        actionEntityId: 903,
      };
      const created = await store.addNotificationOnce("commerce-order:903", input);
      const repeated = await store.addNotificationOnce("commerce-order:903", input);
      assert.ok(created);
      assert.equal(repeated, null);
      const notifications = await store.listNotifications("operator-1");
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0]?.actionEntityId, 903);
      assert.equal(await store.markNotificationRead(created.id, "operator-1"), true);
      assert.deepEqual((await store.listNotifications("operator-1"))[0]?.readBy, ["operator-1"]);
    } finally {
      await store.disconnect();
      const keys = await cleanup.keys(`${prefix}:*`);
      if (keys.length) await cleanup.unlink(keys);
      await cleanup.quit();
    }
  },
);
