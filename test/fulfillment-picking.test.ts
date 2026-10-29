import assert from "node:assert/strict";
import test from "node:test";

import type { BarcodeRegistryRecord } from "../src/shared/barcodeFulfillment.js";
import type { FulfillmentScanFeedback, FulfillmentSession } from "../src/shared/fulfillment.js";
import { decideFulfillmentManualOverride, decideFulfillmentScan } from "../src/server/fulfillmentPicking.js";
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

test("a legacy PLTZ vial QR matches the current PL-TZ variation by exact canonical SKU", () => {
  const pltzOrder = order({
    id: 3177,
    number: "3177",
    lineItems: [{
      id: 9901,
      productId: 533,
      variationId: 3169,
      name: "PL-TZ - 20 MG",
      sku: "PL-TZ-20-MG",
      quantity: 2,
      imageUrl: null,
    }] as CommerceOrder["lineItems"],
  });
  const pltzSession = session(0, {
    orderId: 3177,
    orderNumber: "3177",
    sourceSnapshot: {
      orderId: 3177,
      lines: [{
        orderItemId: 9901,
        productId: 533,
        variationId: 3169,
        sku: "PL-TZ-20-MG",
        quantity: 2,
        locationCode: null,
        coaId: "coa-pltz-20",
        lot: "PLTZ20",
      }],
    },
  });
  const legacyCoa = coa({
    id: "coa-pltz-20",
    productName: "Tirzepatide 20mg",
    matchedProductId: 533,
    matchedVariationId: 652,
    skus: ["PLTZ-20-MG", "PL-TZ"],
    batch: "PLTZ20",
    lot: "PLTZ20",
  });
  const decision = decideFulfillmentScan({
    session: pltzSession,
    barcode: barcode({
      productId: 533,
      variationId: 652,
      coaId: "coa-pltz-20",
      lot: "PLTZ20",
    }),
    order: pltzOrder,
    coas: [legacyCoa],
  });

  assert.equal(decision.result, "accepted");
  assert.equal(decision.quantityDelta, 1);
  assert.equal(decision.orderItemId, 9901);
  assert.equal(feedbackOf(decision).verifiedQuantity, 1);
});

test("the legacy SKU fallback never accepts a different PL-TZ strength", () => {
  const pltzOrder = order({
    lineItems: [{
      id: 9901,
      productId: 533,
      variationId: 3169,
      name: "PL-TZ - 20 MG",
      sku: "PL-TZ-20-MG",
      quantity: 2,
      imageUrl: null,
    }] as CommerceOrder["lineItems"],
  });
  const pltzSession = session(0, {
    sourceSnapshot: {
      orderId: 1401,
      lines: [{
        orderItemId: 9901,
        productId: 533,
        variationId: 3169,
        sku: "PL-TZ-20-MG",
        quantity: 2,
        locationCode: null,
        coaId: null,
        lot: null,
      }],
    },
  });
  const decision = decideFulfillmentScan({
    session: pltzSession,
    barcode: barcode({ productId: 533, variationId: 651, coaId: "coa-pltz-10", lot: "PLTZ10" }),
    order: pltzOrder,
    coas: [coa({
      id: "coa-pltz-10",
      productName: "Tirzepatide 10mg",
      matchedProductId: 533,
      matchedVariationId: 651,
      skus: ["PLTZ-10-MG"],
      batch: "PLTZ10",
      lot: "PLTZ10",
    })],
  });

  assert.equal(decision.result, "rejected");
  assert.equal(decision.reasonCode, "wrong_variation");
  assert.equal(decision.quantityDelta, 0);
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

test("a registered internal variation label verifies a product that has no physical lab QR", () => {
  const baseProduct = decideFulfillmentScan({
    session: session(),
    barcode: barcode({ type: "product", variationId: 0, coaId: undefined, lot: undefined }),
    order: order(),
    coas: [coa()],
  });
  assert.equal(baseProduct.reasonCode, "wrong_variation");
  assert.equal(baseProduct.quantityDelta, 0);

  const internalLabel = decideFulfillmentScan({
    session: session(),
    barcode: barcode({ type: "variation", coaId: undefined, lot: undefined }),
    order: order(),
    coas: [coa()],
  });
  assert.equal(internalLabel.result, "accepted");
  assert.equal(internalLabel.quantityDelta, 1);
  assert.match(feedbackOf(internalLabel).message, /registered Phase One item code/i);
  const progress = internalLabel.nextProgress as unknown as {
    productBarcodeOrderItemIds: number[];
    allocations: unknown[];
  };
  assert.deepEqual(progress.productBarcodeOrderItemIds, [601]);
  assert.deepEqual(progress.allocations, []);
});

test("one order line cannot mix internal item codes and physical vial QR lots", () => {
  const first = decideFulfillmentScan({
    session: session(),
    barcode: barcode({ type: "variation", coaId: undefined, lot: undefined }),
    order: order(),
    coas: [coa()],
  });
  const second = decideFulfillmentScan({
    session: session(1, { progress: first.nextProgress! }),
    barcode: barcode(),
    order: order(),
    coas: [coa()],
  });
  assert.equal(second.result, "rejected");
  assert.equal(second.reasonCode, "verification_method_changed");
  assert.equal(second.quantityDelta, 0);
});

test("registered product barcodes verify non-COA products without inventing a lot", () => {
  const simpleOrder = order({
    lineItems: [{
      id: 601,
      productId: 201,
      variationId: 0,
      name: "Bacteriostatic Water 30ml",
      sku: "BAC-WATER-30",
      quantity: 2,
      imageUrl: null,
    }] as CommerceOrder["lineItems"],
  });
  const simpleSession = session(0, {
    sourceSnapshot: {
      orderId: 1401,
      lines: [{
        orderItemId: 601,
        productId: 201,
        variationId: 0,
        sku: "BAC-WATER-30",
        quantity: 2,
        locationCode: null,
        coaId: null,
        lot: null,
      }],
    },
  });
  const decision = decideFulfillmentScan({
    session: simpleSession,
    barcode: barcode({
      barcodeValue: "11123456789012345678",
      type: "product",
      variationId: 0,
      coaId: undefined,
      lot: undefined,
    }),
    order: simpleOrder,
    coas: [],
  });
  assert.equal(decision.result, "accepted");
  assert.equal(decision.quantityDelta, 1);
  assert.equal(decision.coaId, undefined);
  assert.equal(feedbackOf(decision).lot, null);
  assert.match(feedbackOf(decision).message, /Phase One item code/i);
  const progress = decision.nextProgress as unknown as { allocations: unknown[] };
  assert.deepEqual(progress.allocations, []);
});

test("registered variation barcodes verify the exact non-COA variation", () => {
  const decision = decideFulfillmentScan({
    session: session(0, {
      sourceSnapshot: {
        orderId: 1401,
        lines: [{
          orderItemId: 601,
          productId: 201,
          variationId: 301,
          sku: "CREAM-30",
          quantity: 2,
          locationCode: null,
          coaId: null,
          lot: null,
        }],
      },
    }),
    barcode: barcode({
      barcodeValue: "12123456789012345678",
      type: "variation",
      coaId: undefined,
      lot: undefined,
    }),
    order: order({
      lineItems: [{
        id: 601,
        productId: 201,
        variationId: 301,
        name: "Research Cream 30ml",
        sku: "CREAM-30",
        quantity: 2,
        imageUrl: null,
      }] as CommerceOrder["lineItems"],
    }),
    coas: [],
  });
  assert.equal(decision.result, "accepted");
  assert.equal(decision.variationId, 301);
  assert.equal(feedbackOf(decision).verifiedQuantity, 1);
});

test("an Available scanned COA is accepted even when it is not the designated current shipping lot", () => {
  const decision = decideFulfillmentScan({
    session: session(),
    barcode: barcode(),
    order: order(),
    coas: [coa({ currentShippingLot: false })],
  });
  assert.equal(decision.result, "accepted");
  assert.equal(decision.quantityDelta, 1);
});

test("archived, review and inactive COAs are rejected", () => {
  for (const status of ["Archived", "Review", "Inactive"]) {
    const invalid = coa({ currentShippingLot: false, status });
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

test("one unstarted product can be completed with an audited manual exception", () => {
  const decision = decideFulfillmentManualOverride({
    session: session(), order: order(), orderItemId: 601, reason: "Damaged item code",
  });
  assert.equal(decision.result, "accepted");
  assert.equal(decision.reasonCode, "manual_override");
  assert.equal(decision.quantityDelta, 2);
  const progress = decision.nextProgress as unknown as {
    verifiedUnits: number; manualOverrideOrderItemIds: number[];
  };
  assert.equal(progress.verifiedUnits, 2);
  assert.deepEqual(progress.manualOverrideOrderItemIds, [601]);
});

test("a second manual product exception in the same order stays blocked", () => {
  const decision = decideFulfillmentManualOverride({
    session: session(0, {
      progress: {
        verifiedUnits: 1, totalUnits: 3,
        lines: [
          { orderItemId: 601, requiredQuantity: 2, verifiedQuantity: 0 },
          { orderItemId: 602, requiredQuantity: 1, verifiedQuantity: 1 },
        ],
        manualOverrideOrderItemIds: [602],
      },
      sourceSnapshot: {
        orderId: 1401,
        lines: [
          { orderItemId: 601, productId: 201, variationId: 301, sku: "BPC-10-BLUE", quantity: 2, locationCode: null, coaId: null, lot: null },
          { orderItemId: 602, productId: 202, variationId: 0, sku: "CREAM", quantity: 1, locationCode: null, coaId: null, lot: null },
        ],
      },
    }),
    order: order({
      lineItems: [
        { id: 601, productId: 201, variationId: 301, name: "BPC", sku: "BPC-10-BLUE", quantity: 2, imageUrl: null },
        { id: 602, productId: 202, variationId: 0, name: "Cream", sku: "CREAM", quantity: 1, imageUrl: null },
      ] as CommerceOrder["lineItems"],
    }),
    orderItemId: 601, reason: "Unreadable code",
  });
  assert.equal(decision.reasonCode, "verification_method_changed");
});
