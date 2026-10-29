import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultTikTokPixelSettings,
  normalizeTikTokPixelEvents,
  normalizeTikTokPixelId,
  publicTikTokPixelSettings,
} from "../src/shared/tiktokPixel.js";

test("TikTok Pixel settings preserve the existing production pixel during migration", () => {
  const settings = defaultTikTokPixelSettings(new Date("2026-10-29T12:00:00.000Z"));
  assert.equal(settings.enabled, true);
  assert.equal(settings.pixelId, "D9UBLSRC77UDKVSV1D90");
  assert.equal(settings.events.purchase, true);
  assert.equal(settings.updatedAt, "2026-10-29T12:00:00.000Z");
});

test("TikTok Pixel accepts an ID but rejects scripts and arbitrary code", () => {
  assert.equal(normalizeTikTokPixelId(" D9UBLSRC77UDKVSV1D90 "), "D9UBLSRC77UDKVSV1D90");
  assert.throws(() => normalizeTikTokPixelId("<script>alert(1)</script>"), /valid TikTok Pixel ID/);
});

test("TikTok Pixel event switches default safely and public settings omit the actor", () => {
  const events = normalizeTikTokPixelEvents({ search: false, purchase: true });
  assert.equal(events.search, false);
  assert.equal(events.addToCart, true);
  const publicSettings = publicTikTokPixelSettings(defaultTikTokPixelSettings());
  assert.equal("updatedBy" in publicSettings, false);
});
