import assert from "node:assert/strict";
import test from "node:test";

import {
  orderNotificationPayload,
  ordersEnteringAttentionStatus,
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

test("notifies only when an existing order enters pending or failed", () => {
  const previous = [{ id: 1, status: "processing" }, { id: 2, status: "pending" }];
  assert.deepEqual(ordersEnteringAttentionStatus([
    { id: 1, status: "failed" },
    { id: 2, status: "pending" },
    { id: 3, status: "pending" },
  ], previous), [{ id: 1, status: "failed" }]);
  const payload = orderNotificationPayload({
    id: 1, number: "1", customer: "Customer", currency: "USD", total: 25,
    paymentMethodId: "card", status: "failed",
  });
  assert.equal(payload.dedupeKey, "commerce-order:1:failed");
  assert.equal(payload.notification.severity, "warning");
  assert.match(payload.notification.title, /failed/);
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
