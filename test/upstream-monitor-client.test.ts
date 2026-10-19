import assert from "node:assert/strict";
import test from "node:test";
import { emptyPresenceCounts } from "../src/shared/protocol.js";
import { isUpstreamPresenceSnapshot } from "../src/server/upstreamMonitorClient.js";

function snapshot(): Record<string, unknown> {
  return {
    type: "presence:snapshot",
    counts: emptyPresenceCounts(),
    total: 0,
    serverTime: new Date().toISOString(),
    analytics: {
      timeZone: "America/Bogota",
      totalViews: 32199,
      uniqueVisitors: 7487,
      returningVisitors: 1280,
      totalSessions: 9625,
      returningSessions: 2138,
      totalClicks: 15320,
      totalOrders: 220,
      visitorsLast30Minutes: 9,
      topPages: [],
      topSources: [],
      topDevices: [],
      topClicks: [],
      dailyViews: [],
      dailyVisitors: [],
      dailyActivity: [],
      recentSessions: [],
    },
  };
}

test("accepts the authoritative upstream visitor snapshot", () => {
  assert.equal(isUpstreamPresenceSnapshot(snapshot()), true);
});

test("rejects incomplete upstream analytics before relaying them", () => {
  const value = snapshot();
  const analytics = value.analytics as Record<string, unknown>;
  delete analytics.recentSessions;
  assert.equal(isUpstreamPresenceSnapshot(value), false);
});
