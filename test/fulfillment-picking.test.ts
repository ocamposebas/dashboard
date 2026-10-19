import assert from "node:assert/strict";
import test from "node:test";

import type { BarcodeRegistryRecord } from "../src/shared/barcodeFulfillment.js";
import type { FulfillmentScanFeedback, FulfillmentSession } from "../src/shared/fulfillment.js";
import { decideFulfillmentScan } from "../src/server/fulfillmentPicking.js";
import type { CommerceCoa, CommerceOrder } from "../src/server/wooCommerceGateway.js";

function order(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    id: 1401,
    number: "1401",
    status: "processing",
    paymentMethod: "PRISM",
    paymentMethodId: "prism_simple_checkout",
    customer: "Picking Test",
    createdAt: "2026-10-15T14:00:00.000Z",
    modifiedAt: "2026-10-15T14:05:00.000Z",
    paidAt: "2026-10-15T14:04:00.000Z",
    refundedTotal: 0,
    lineItems: [{
      id: 601,
      productId: 201,
      variationId: 301,
      name: "BPC-157 10mg",
      sku: "BPC-10-BLUE",
      quantity: 2,
      imageUrl: "https://example.com/bpc.webp",
    }],
    paymentOperations: { kind: "card", approvalState: "not_required" },
    ...overrides,
  } as CommerceOrder;
}

function session(progressVerified = 0, overrides: Partial<FulfillmentSession> = {}): FulfillmentSession {
  return {
    id: "0d0698ec-9a34-4be0-a04f-43db771ccdd8",
    orderId: 1401,
    orderNumber: "1401",
    state: "open",
    sourceModifiedAt: "2026-10-15T14:05:00.000Z",
    sourceSnapshot: {
      orderId: 1401,
      lines: [{
        orderItemId: 601,
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
      verifiedUnits: progressVerified,
      totalUnits: 2,
      lines: [{ orderItemId: 601, requiredQuantity: 2, verifiedQuantity: progressVerified }],
    },
    completionSnapshot: null,
    startedBy: "operator-test",
    cancelledBy: null,
    cancelReason: null,
    startedAt: "2026-10-15T14:06:00.000Z",
    updatedAt: "2026-10-15T14:06:00.000Z",
    packedAt: null,
    version: progressVerified + 1,
    wordpressSyncState: "not_needed",
    wordpressSyncAttempts: 0,
    wordpressNextRetryAt: null,
    wordpressLastError: null,
    ...overrides,
  };
}

function barcode(overrides: Partial<BarcodeRegistryRecord> = {}): BarcodeRegistryRecord {
  return {
    version: 1,
    barcodeValue: "13123456789012345678",
    type: "batch",
    productId: 201,
    variationId: 301,
    coaId: "coa-201",
    lot: "LOT-201",
    active: true,
    createdBy: "administrator-test",
    createdAt: "2026-10-15T13:00:00.000Z",
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

function feedbackOf(decision: ReturnType<typeof decideFulfillmentScan>): FulfillmentScanFeedback {
  return decision.responseSnapshot as unknown as FulfillmentScanFeedback;
}

test("a valid batch scan verifies one unit and returns immediate picking feedback", () => {
  const decision = decideFulfillmentScan({ session: session(), barcode: barcode(), order: order(), coas: [coa()] });
  const feedback = feedbackOf(decision);
  assert.equal(decision.result, "accepted");
  assert.equal(decision.quantityDelta, 1);
  assert.equal(feedback.productName, "BPC-157 10mg");
  assert.equal(feedback.locationCode, "A-01");
  assert.equal(feedback.verifiedQuantity, 1);
  assert.equal(feedback.requiredQuantity, 2);
  assert.equal(feedback.complete, false);
});

test("wrong product, wrong variation and an unknown COA never change quantity", () => {
  const cases = [
    [barcode({ productId: 999 }), "wrong_product"],
    [barcode({ variationId: 999 }), "wrong_variation"],
    [barcode({ coaId: "coa-other", lot: "LOT-OTHER" }), "invalid_coa"],
  ] as const;
  for (const [scanned, reason] of cases) {
    const decision = decideFulfillmentScan({ session: session(), barcode: scanned, order: order(), coas: [coa()] });
    assert.equal(decision.result, "rejected");
    assert.equal(decision.reasonCode, reason);
    assert.equal(decision.quantityDelta, 0);
    assert.equal(feedbackOf(decision).verifiedUnits, 0);
  }
  const mismatch = decideFulfillmentScan({
    session: session(),
    barcode: barcode({ productId: 999, coaId: "coa-other" }),
    order: order(),
    coas: [coa({ id: "coa-other", productName: "Retatrutide 10mg", skus: ["RT-10"] })],
  });
  assert.equal(feedbackOf(mismatch).scannedProductName, "Retatrutide 10mg");
  assert.equal(feedbackOf(mismatch).expectedProductName, "BPC-157 10mg");
  assert.equal(feedbackOf(mismatch).expectedSku, "BPC-10-BLUE");
  assert.match(feedbackOf(mismatch).message, /No quantity was added/i);
});

test("the scanned approved vial lot becomes the customer allocation even when it differs from the suggested lot", () => {
  const scanned = barcode({ coaId: "coa-202", lot: "LOT-202" });
  const decision = decideFulfillmentScan({
    session: session(),
    barcode: scanned,
    order: order(),
    coas: [coa(), coa({ id: "coa-202", coaNumber: "P1-202", lot: "LOT-202", batch: "BATCH-202" })],
  });
  assert.equal(decision.result, "accepted");
  const progress = decision.nextProgress as unknown as {
    allocations: Array<{ orderItemId: number; coaId: string; lot: string; quantity: number }>;
  };
  assert.deepEqual(progress.allocations, [{
    orderItemId: 601,
    coaId: "coa-202",
    lot: "LOT-202",
    quantity: 1,
  }]);
  assert.equal(feedbackOf(decision).lot, "LOT-202");
  assert.match(feedbackOf(decision).message, /captured for this customer order/i);
});

test("two accepted vial QRs preserve separate lot quantities for one customer line", () => {
  const available = [
    coa(),
    coa({ id: "coa-202", coaNumber: "P1-202", lot: "LOT-202", batch: "BATCH-202" }),
  ];
  const first = decideFulfillmentScan({
    session: session(), barcode: barcode(), order: order(), coas: available,
  });
  assert.equal(first.result, "accepted");
  const second = decideFulfillmentScan({
    session: session(1, { progress: first.nextProgress! }),
    barcode: barcode({ coaId: "coa-202", lot: "LOT-202" }),
    order: order(),
    coas: available,
  });
  const progress = second.nextProgress as unknown as {
    allocations: Array<{ coaId: string; lot: string; quantity: number }>;
  };
  assert.deepEqual(progress.allocations.map((allocation) => ({
    coaId: allocation.coaId,
    lot: allocation.lot,
    quantity: allocation.quantity,
  })), [
    { coaId: "coa-201", lot: "LOT-201", quantity: 1 },
    { coaId: "coa-202", lot: "LOT-202", quantity: 1 },
  ]);
  assert.equal(feedbackOf(second).complete, true);
});

test("unknown and inactive barcodes fail closed", () => {
  const unknown = decideFulfillmentScan({ session: session(), barcode: null, order: order(), coas: [coa()] });
  assert.equal(unknown.reasonCode, "unknown_barcode");
  const inactive = decideFulfillmentScan({
    session: session(), barcode: barcode({ active: false }), order: order(), coas: [coa()],
  });
  assert.equal(inactive.reasonCode, "inactive_barcode");
});

test("product-only and variation-only labels cannot stand in for a physical batch", () => {
  for (const scanned of [
    barcode({ type: "product", variationId: 0, coaId: undefined, lot: undefined }),
    barcode({ type: "variation", coaId: undefined, lot: undefined }),
  ]) {
    const decision = decideFulfillmentScan({ session: session(), barcode: scanned, order: order(), coas: [coa()] });
    assert.equal(decision.reasonCode, scanned.type === "product" ? "wrong_variation" : "batch_required");
    assert.equal(decision.quantityDelta, 0);
  }
});

test("an unapproved, archived or non-current COA is rejected", () => {
  for (const invalid of [coa({ currentShippingLot: false }), coa({ status: "Archived" })]) {
    const decision = decideFulfillmentScan({ session: session(), barcode: barcode(), order: order(), coas: [invalid] });
    assert.equal(decision.reasonCode, "invalid_coa");
    assert.equal(decision.quantityDelta, 0);
  }
});

test("scans cannot exceed the order requirement", () => {
  const decision = decideFulfillmentScan({ session: session(2), barcode: barcode(), order: order(), coas: [coa()] });
  assert.equal(decision.reasonCode, "quantity_complete");
  assert.equal(feedbackOf(decision).verifiedUnits, 2);
});

test("changed and ineligible orders block picking before barcode acceptance", () => {
  const ineligible = decideFulfillmentScan({
    session: session(), barcode: barcode(), order: order({ status: "cancelled" }), coas: [coa()],
  });
  assert.equal(ineligible.reasonCode, "order_ineligible");
  const changed = decideFulfillmentScan({
    session: session(), barcode: barcode(),
    order: order({ modifiedAt: "2026-10-15T15:00:00.000Z" }), coas: [coa()],
  });
  assert.equal(changed.reasonCode, "order_changed");
});

test("a live SKU or quantity change cannot be scanned into the secured session", () => {
  const changedLine = order({
    lineItems: [{
      id: 601, productId: 201, variationId: 301, name: "BPC-157 10mg",
      sku: "CHANGED-SKU", quantity: 3, imageUrl: null,
    }] as CommerceOrder["lineItems"],
  });
  const decision = decideFulfillmentScan({ session: session(), barcode: barcode(), order: changedLine, coas: [coa()] });
  assert.equal(decision.reasonCode, "line_changed");
});
