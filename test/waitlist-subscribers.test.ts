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

test("waitlist mapping repairs the notifier plugin fragmented REST response", () => {
  const subscribers = mapWaitlistSubscribers([
    { id: 401 },
    { last_modified_date: "2026-10-21T15:00:00" },
    { status: "cwg_subscribed" },
    {
      meta_data: {
        cwginstock_product_id: ["528"],
        cwginstock_variation_id: ["0"],
        cwginstock_subscriber_email: ["waiting@example.com"],
        cwginstock_subscriber_name: ["Waiting Customer"],
      },
    },
  ]);

  assert.equal(subscribers.length, 1);
  assert.equal(subscribers[0]?.id, "401");
  assert.equal(subscribers[0]?.productId, 528);
  assert.equal(subscribers[0]?.email, "waiting@example.com");
  assert.equal(subscribers[0]?.name, "Waiting Customer");
  assert.equal(subscribers[0]?.status, "cwg_subscribed");
});
