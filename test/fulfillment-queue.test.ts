import assert from "node:assert/strict";
import test from "node:test";

import type { ProductLocation } from "../src/shared/barcodeFulfillment.js";
import type { FulfillmentSession } from "../src/shared/fulfillment.js";
import {
  buildFulfillmentQueueEntry,
  compareFulfillmentQueueEntries,
  shouldIncludeFulfillmentOrder,
} from "../src/server/fulfillmentQueue.js";
import type { CommerceCoa, CommerceOrder, CommerceProduct } from "../src/server/wooCommerceGateway.js";

function order(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    id: 1201,
    number: "1201",
    status: "processing",
    paymentMethod: "PRISM",
    paymentMethodId: "prism_simple_checkout",
    customer: "Warehouse Test",
    createdAt: "2026-10-15T10:00:00.000Z",
    modifiedAt: "2026-10-15T10:05:00.000Z",
    paidAt: "2026-10-15T10:04:00.000Z",
    refundedTotal: 0,
    lineItems: [{
      id: 501,
      productId: 101,
      variationId: 0,
      name: "Semax 10mg",
      sku: "SEMAX-10",
      quantity: 2,
      imageUrl: "https://example.com/product.webp",
    }],
    paymentOperations: {
      kind: "card",
      approvalState: "not_required",
    },
    ...overrides,
  } as CommerceOrder;
}

const product = {
  id: 101,
  name: "Semax 10mg",
  sku: "SEMAX-10",
  variationIds: [],
} as CommerceProduct;

const coa = {
  id: "coa-101",
  matchedProductId: 101,
  matchedVariationId: 0,
  coaNumber: "COA-101",
  skus: ["SEMAX-10"],
  batch: "BATCH-101",
  lot: "LOT-101",
  currentShippingLot: true,
} as CommerceCoa;

const location: ProductLocation = {
  productId: 101,
  variationId: 0,
  locationCode: "A-01",
  updatedBy: "admin",
  updatedAt: "2026-10-15T10:00:00.000Z",
};

function build(
  sourceOrder = order(),
  overrides: {
    products?: CommerceProduct[];
    coas?: CommerceCoa[];
    locations?: ProductLocation[];
    session?: FulfillmentSession | null;
  } = {},
) {
  return buildFulfillmentQueueEntry({
    order: sourceOrder,
    products: overrides.products ?? [product],
    coas: overrides.coas ?? [coa],
    locations: overrides.locations ?? [location],
    session: overrides.session ?? null,
  });
}

test("a freshly paid PRISM order with mappings, location and COA waits safely", () => {
  const entry = build();
  assert.equal(entry.queueStatus, "waiting");
  assert.equal(entry.primaryAction, "start");
  assert.equal(entry.reasons.length, 0);
  assert.equal(entry.lines[0]?.locationCode, "A-01");
  assert.equal(entry.lines[0]?.coa?.lot, "LOT-101");
});

test("approved Zelle/Venmo orders enter fulfillment while unapproved manual and eDebit orders remain blocked", () => {
  const zelle = build(order({
    paymentMethod: "Zelle",
    paymentMethodId: "phaseone_zelle",
    paymentOperations: { kind: "manual", approvalState: "approved" } as CommerceOrder["paymentOperations"],
  }));
  assert.equal(zelle.queueStatus, "waiting");
  assert.deepEqual(zelle.reasons, []);

  const pendingZelle = build(order({
    paymentMethod: "Zelle",
    paymentMethodId: "phaseone_zelle",
    paymentOperations: { kind: "manual", approvalState: "pending" } as CommerceOrder["paymentOperations"],
  }));
  assert.equal(pendingZelle.queueStatus, "blocked");
  assert.ok(pendingZelle.reasons.some((reason) => reason.code === "payment_not_approved"));
  assert.ok(pendingZelle.reasons.some((reason) => reason.code === "payment_gateway_verification_required"));

  const edebit = build(order({
    paymentMethod: "eDebit",
    paymentMethodId: "phaseone_edebit",
    paymentOperations: { kind: "bank", approvalState: "not_required" } as CommerceOrder["paymentOperations"],
  }));
  assert.equal(edebit.queueStatus, "blocked");
  assert.ok(edebit.reasons.some((reason) => reason.code === "payment_gateway_verification_required"));
});

test("missing location and preassigned COA remain optional while catalog mapping fails closed", () => {
  const entry = build(order(), { products: [], coas: [], locations: [] });
  assert.equal(entry.queueStatus, "blocked");
  assert.deepEqual(entry.reasons.map((reason) => reason.code), ["missing_product_mapping"]);
  assert.equal(entry.lines[0]?.locationCode, null);
  assert.equal(entry.lines[0]?.coa, null);
});

test("an eligible order can start without a shelf or preassigned COA", () => {
  const entry = build(order(), { coas: [], locations: [] });
  assert.equal(entry.queueStatus, "waiting");
  assert.equal(entry.primaryAction, "start");
  assert.deepEqual(entry.reasons, []);
  assert.equal(entry.lines[0]?.locationCode, null);
  assert.equal(entry.lines[0]?.coa, null);
});

test("paused sessions retain progress and changed source orders are blocked", () => {
  const session = {
    id: "43fb47a8-2884-45d9-bbab-89a76b967e11",
    orderId: 1201,
    orderNumber: "1201",
    state: "paused",
    sourceModifiedAt: "2026-10-15T10:05:00.000Z",
    progress: {
      lines: [{ orderItemId: 501, requiredQuantity: 2, verifiedQuantity: 1 }],
    },
  } as FulfillmentSession;
  const paused = build(order(), { session });
  assert.equal(paused.queueStatus, "paused");
  assert.equal(paused.verifiedUnits, 1);
  assert.equal(paused.primaryAction, "resume");

  const changed = build(order({ modifiedAt: "2026-10-15T11:00:00.000Z" }), { session });
  assert.equal(changed.queueStatus, "blocked");
  assert.ok(changed.reasons.some((reason) => reason.code === "source_order_changed"));
});

test("packed sessions are read-only even after the commerce status changes", () => {
  const session = {
    id: "ab90bb2e-a145-4df2-a4e1-795f1129f55e",
    orderId: 1201,
    orderNumber: "1201",
    state: "packed",
    sourceModifiedAt: "2026-10-15T10:05:00.000Z",
    progress: {},
  } as FulfillmentSession;
  const entry = build(order(), { session });
  assert.equal(entry.queueStatus, "packed");
  assert.equal(entry.primaryAction, "open");
});

test("the queue admits new processing orders only and preserves in-progress exceptions", () => {
  assert.equal(shouldIncludeFulfillmentOrder(order({ status: "processing" }), null), true);
  assert.equal(shouldIncludeFulfillmentOrder(order({ status: "pending" }), null), false);
  assert.equal(shouldIncludeFulfillmentOrder(order({ status: "on-hold" }), null), false);
  assert.equal(shouldIncludeFulfillmentOrder(order({ status: "completed" }), null), false);
  assert.equal(shouldIncludeFulfillmentOrder(
    order({ status: "cancelled" }),
    { state: "open" } as FulfillmentSession,
  ), true);
});

test("orders with the same queue status are processed oldest first", () => {
  const older = build(order({
    id: 1200,
    number: "1200",
    createdAt: "2026-10-14T09:00:00.000Z",
  }));
  const newer = build(order({
    id: 1202,
    number: "1202",
    createdAt: "2026-10-16T09:00:00.000Z",
  }));
  const entries = [newer, older].sort(compareFulfillmentQueueEntries);
  assert.deepEqual(entries.map((entry) => entry.orderId), [1200, 1202]);
});
