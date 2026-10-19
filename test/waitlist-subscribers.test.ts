import assert from "node:assert/strict";
import test from "node:test";

import { mapWaitlistSubscribers } from "../src/server/wooCommerceGateway.js";

test("waitlist subscribers normalize common notifier plugin response fields", () => {
  assert.deepEqual(mapWaitlistSubscribers({ data: [{
    subscriber_id: 91,
    product_id: 44,
    variation_id: 45,
    subscriber_name: "Grace Hopper",
    subscriber_email: "grace@example.com",
    subscriber_status: "subscribed",
    date_created: "2026-10-17T10:00:00Z",
  }] }), [{
    id: "91",
    productId: 44,
    variationId: 45,
    name: "Grace Hopper",
    email: "grace@example.com",
    phone: "",
    status: "subscribed",
    subscribedAt: "2026-10-17T10:00:00.000Z",
    notifiedAt: null,
  }]);
});

test("waitlist mapping accepts direct arrays and preserves anonymous email identities", () => {
  const subscribers = mapWaitlistSubscribers([{ email: "buyer@example.com", productId: 7 }]);
  assert.equal(subscribers.length, 1);
  assert.equal(subscribers[0].name, "buyer");
  assert.equal(subscribers[0].productId, 7);
});
