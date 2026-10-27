import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBrowserPushSubscription } from "../src/server/orderPushRepository.js";
import { newOrderPushPayload } from "../src/server/orderPushService.js";

test("accepts a standards-based browser push subscription and rejects unsafe endpoints", () => {
  const subscription = normalizeBrowserPushSubscription({
    endpoint: "https://web.push.apple.com/QP1_example-token",
    keys: {
      p256dh: "BNIu3-example_public_key",
      auth: "example_auth_key",
    },
  });
  assert.equal(subscription.endpoint, "https://web.push.apple.com/QP1_example-token");
  assert.throws(() => normalizeBrowserPushSubscription({
    endpoint: "http://push.example.test/token",
    keys: { p256dh: "key", auth: "auth" },
  }), /HTTPS/);
});

test("builds a compact, order-specific phone notification", () => {
  assert.deepEqual(newOrderPushPayload({
    id: 3180,
    number: "3180",
    customer: "Candyce Murphy",
    currency: "USD",
    total: 144.43,
    paymentMethodId: "phaseone_zelle",
  }), {
    title: "New order #3180",
    body: "Zelle · Candyce Murphy · USD 144.43",
    tag: "phaseone-order-3180",
    url: "/#orders",
  });
});
