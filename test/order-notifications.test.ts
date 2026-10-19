import assert from "node:assert/strict";
import test from "node:test";

import {
  orderNotificationPayload,
  ordersMissingFromSnapshot,
} from "../src/server/orderNotifications.js";

test("detects orders received after the persisted snapshot without flooding a first run", () => {
  const orders = [{ id: 103 }, { id: 102 }, { id: 101 }];
  assert.deepEqual(ordersMissingFromSnapshot(orders, undefined), []);
  assert.deepEqual(
    ordersMissingFromSnapshot(orders, [{ id: 101 }, { id: 102 }]),
    [{ id: 103 }],
  );
});

test("builds a direct order action and highlights manual payment review", () => {
  const payload = orderNotificationPayload({
    id: 903,
    number: "P1-903",
    customer: "Research Customer",
    currency: "USD",
    total: 149.5,
    paymentMethodId: "phaseone_zelle",
  });
  assert.equal(payload.dedupeKey, "commerce-order:903");
  assert.equal(payload.notification.actionEntityId, 903);
  assert.equal(payload.notification.severity, "warning");
  assert.match(payload.notification.message, /Payment review required/);
});
