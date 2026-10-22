import assert from "node:assert/strict";
import test from "node:test";

import type { FulfillmentSession } from "../src/shared/fulfillment.js";
import {
  buildPackingSnapshot,
  FulfillmentPackingError,
} from "../src/server/fulfillmentPacking.js";
import type { CommerceCoa, CommerceOrder } from "../src/server/wooCommerceGateway.js";

const clientEventId = "9d1acf84-ddd6-48c9-a87d-2a8196af9e18";

function order(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    id: 1501,
    number: "1501",
    status: "processing",
    paymentMethod: "PRISM",
    paymentMethodId: "prism_simple_checkout",
    customer: "Packing Test",
    modifiedAt: "2026-10-16T14:05:00.000Z",
    paidAt: "2026-10-16T14:04:00.000Z",
    refundedTotal: 0,
    lineItems: [{
      id: 701,
      productId: 201,
      variationId: 301,
      name: "BPC-157 10mg",
      sku: "BPC-10-BLUE",
      quantity: 2,
      imageUrl: null,
    }],
    paymentOperations: { kind: "card", approvalState: "not_required" },
    ...overrides,
  } as CommerceOrder;
}

function session(overrides: Partial<FulfillmentSession> = {}): FulfillmentSession {
  return {
    id: "72ddb3e2-c1d4-49c9-b5f3-237c57e8cead",
    orderId: 1501,
    orderNumber: "1501",
    state: "open",
    sourceModifiedAt: "2026-10-16T14:05:00.000Z",
    sourceSnapshot: {
      orderId: 1501,
      lines: [{
        orderItemId: 701,
        productId: 201,
        variationId: 301,
        sku: "BPC-10-BLUE",
        quantity: 2,
        locationCode: "A-01",
        coaId: "coa-201",
        lot: "LOT-201",
      }],
    },
    progress: {
      verifiedUnits: 2,
      totalUnits: 2,
      lines: [{ orderItemId: 701, requiredQuantity: 2, verifiedQuantity: 2 }],
    },
    completionSnapshot: null,
    startedBy: "operator-test",
    cancelledBy: null,
    cancelReason: null,
    startedAt: "2026-10-16T14:06:00.000Z",
    updatedAt: "2026-10-16T14:07:00.000Z",
    packedAt: null,
    version: 3,
    wordpressSyncState: "not_needed",
    wordpressSyncAttempts: 0,
    wordpressNextRetryAt: null,
    wordpressLastError: null,
    ...overrides,
  };
}

function coa(overrides: Partial<CommerceCoa> = {}): CommerceCoa {
  return {
    id: "coa-201",
    matchedProductId: 201,
    matchedVariationId: 301,
    coaNumber: "P1-201",
    skus: ["BPC-10-BLUE"],
    batch: "BATCH-201",
    lot: "LOT-201",
    status: "Available",
    currentShippingLot: true,
    ...overrides,
  } as CommerceCoa;
}

function pack(overrides: {
  session?: FulfillmentSession;
  order?: CommerceOrder;
  coas?: CommerceCoa[];
} = {}) {
  return buildPackingSnapshot({
    session: overrides.session || session(),
    order: overrides.order || order(),
    coas: overrides.coas || [coa()],
    clientEventId,
    actorId: "operator-test",
    confirmedAt: "2026-10-16T14:08:00.000Z",
  });
}

test("packing creates an immutable product, quantity and COA snapshot", () => {
  const snapshot = pack();
  assert.equal(snapshot.clientEventId, clientEventId);
  assert.equal(snapshot.verifiedUnits, 2);
  assert.equal(snapshot.totalUnits, 2);
  assert.deepEqual(snapshot.lines[0], {
    orderItemId: 701,
    productId: 201,
    variationId: 301,
    name: "BPC-157 10mg",
    sku: "BPC-10-BLUE",
    requiredQuantity: 2,
    verifiedQuantity: 2,
    locationCode: "A-01",
    coaId: "coa-201",
    coaNumber: "P1-201",
    lot: "LOT-201",
    batch: "BATCH-201",
    allocations: [{
      orderItemId: 701,
      coaId: "coa-201",
      coaNumber: "P1-201",
      lot: "LOT-201",
      batch: "BATCH-201",
      quantity: 2,
    }],
  });
});

test("packing preserves the exact per-lot quantities captured from vial QR scans", () => {
  const snapshot = pack({
    session: session({
      progress: {
        verifiedUnits: 2,
        totalUnits: 2,
        lines: [{ orderItemId: 701, requiredQuantity: 2, verifiedQuantity: 2 }],
        allocations: [
          { orderItemId: 701, coaId: "coa-201", lot: "LOT-201", quantity: 1 },
          { orderItemId: 701, coaId: "coa-202", lot: "LOT-202", quantity: 1 },
        ],
      },
    }),
    coas: [
      coa(),
      coa({ id: "coa-202", coaNumber: "P1-202", lot: "LOT-202", batch: "BATCH-202" }),
    ],
  });
  assert.deepEqual(snapshot.lines[0]?.allocations.map((allocation) => ({
    coaId: allocation.coaId,
    lot: allocation.lot,
    quantity: allocation.quantity,
  })), [
    { coaId: "coa-201", lot: "LOT-201", quantity: 1 },
    { coaId: "coa-202", lot: "LOT-202", quantity: 1 },
  ]);
});

test("packing works without a preassigned location or COA after vial QR scans", () => {
  const snapshot = pack({
    session: session({
      sourceSnapshot: {
        orderId: 1501,
        lines: [{
          orderItemId: 701,
          productId: 201,
          variationId: 301,
          sku: "BPC-10-BLUE",
          quantity: 2,
          locationCode: null,
          coaId: null,
          lot: null,
        }],
      },
      progress: {
        verifiedUnits: 2,
        totalUnits: 2,
        lines: [{ orderItemId: 701, requiredQuantity: 2, verifiedQuantity: 2 }],
        allocations: [{ orderItemId: 701, coaId: "coa-201", lot: "LOT-201", quantity: 2 }],
      },
    }),
  });
  assert.equal(snapshot.lines[0]?.locationCode, "");
  assert.equal(snapshot.lines[0]?.coaId, "coa-201");
  assert.equal(snapshot.lines[0]?.lot, "LOT-201");
});

test("packing still requires a scanned vial lot when no COA was preassigned", () => {
  assert.throws(
    () => pack({
      session: session({
        sourceSnapshot: {
          orderId: 1501,
          lines: [{
            orderItemId: 701,
            productId: 201,
            variationId: 301,
            sku: "BPC-10-BLUE",
            quantity: 2,
            locationCode: null,
            coaId: null,
            lot: null,
          }],
        },
      }),
    }),
    (error: unknown) => error instanceof FulfillmentPackingError &&
      error.message.includes("Scan the vial QR"),
  );
});

test("packing preserves a completed non-COA product barcode verification without a fake lot", () => {
  const snapshot = pack({
    session: session({
      sourceSnapshot: {
        orderId: 1501,
        lines: [{
          orderItemId: 701,
          productId: 201,
          variationId: 301,
          sku: "BPC-10-BLUE",
          quantity: 2,
          locationCode: null,
          coaId: null,
          lot: null,
        }],
      },
    }),
    coas: [],
  });
  assert.equal(snapshot.lines[0]?.coaId, "");
  assert.equal(snapshot.lines[0]?.lot, "");
  assert.deepEqual(snapshot.lines[0]?.allocations, []);
  assert.equal(snapshot.lines[0]?.verifiedQuantity, 2);
});

test("packing is blocked until every required unit is verified", () => {
  const incomplete = session({
    progress: {
      verifiedUnits: 1,
      totalUnits: 2,
      lines: [{ orderItemId: 701, requiredQuantity: 2, verifiedQuantity: 1 }],
    },
  });
  assert.throws(
    () => pack({ session: incomplete }),
    (error: unknown) => error instanceof FulfillmentPackingError &&
      error.code === "invalid_state" && error.message.includes("not fully verified"),
  );
});

test("packing fails closed when the live order changes or becomes ineligible", () => {
  assert.throws(
    () => pack({ order: order({ modifiedAt: "2026-10-16T15:00:00.000Z" }) }),
    (error: unknown) => error instanceof FulfillmentPackingError && error.message.includes("changed"),
  );
  assert.throws(
    () => pack({ order: order({ status: "cancelled" }) }),
    (error: unknown) => error instanceof FulfillmentPackingError && error.code === "invalid_state",
  );
});

test("packing rejects changed order lines and manipulated progress", () => {
  assert.throws(() => pack({
    order: order({
      lineItems: [{
        id: 701, productId: 201, variationId: 301, name: "BPC-157 10mg",
        sku: "CHANGED-SKU", quantity: 2, imageUrl: null,
      }] as CommerceOrder["lineItems"],
    }),
  }), FulfillmentPackingError);
  assert.throws(() => pack({
    session: session({
      progress: {
        verifiedUnits: 3,
        totalUnits: 2,
        lines: [{ orderItemId: 701, requiredQuantity: 2, verifiedQuantity: 3 }],
      },
    }),
  }), FulfillmentPackingError);
});

test("packing accepts an exact Available scanned COA without the current-shipping preference", () => {
  const snapshot = pack({ coas: [coa({ currentShippingLot: false })] });
  assert.equal(snapshot.lines[0]?.coaId, "coa-201");
  assert.equal(snapshot.lines[0]?.lot, "LOT-201");
});

test("packing requires the exact Available COA and lot", () => {
  for (const invalid of [
    coa({ status: "Archived" }),
    coa({ status: "Review" }),
    coa({ lot: "LOT-OTHER", batch: "LOT-OTHER" }),
  ]) {
    assert.throws(
      () => pack({ coas: [invalid] }),
      (error: unknown) => error instanceof FulfillmentPackingError && error.message.includes("COA"),
    );
  }
});
