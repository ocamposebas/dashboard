import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFulfillmentEligibility } from "../src/server/fulfillmentEligibility.js";
import type { CommerceOrder } from "../src/server/wooCommerceGateway.js";

function eligibleOrder(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    id: 1042,
    customerId: 10,
    number: "1042",
    status: "processing",
    currency: "USD",
    total: 120,
    totalTax: 0,
    cartTax: 0,
    shippingTotal: 14,
    shippingTax: 0,
    discountTotal: 0,
    discountTax: 0,
    paymentMethod: "PRISM",
    paymentMethodId: "prism_simple_checkout",
    transactionId: "txn-test",
    customer: "Test Customer",
    location: "Miami, US",
    customerNote: "",
    createdAt: "2026-10-15T10:00:00.000Z",
    modifiedAt: "2026-10-15T10:05:00.000Z",
    paidAt: "2026-10-15T10:04:00.000Z",
    completedAt: null,
    billing: {
      firstName: "Test",
      lastName: "Customer",
      company: "",
      address1: "1 Test Way",
      address2: "",
      city: "Miami",
      state: "FL",
      postcode: "33101",
      country: "US",
      email: "test@example.com",
      phone: "",
    },
    shipping: {
      firstName: "Test",
      lastName: "Customer",
      company: "",
      address1: "1 Test Way",
      address2: "",
      city: "Miami",
      state: "FL",
      postcode: "33101",
      country: "US",
      email: "",
      phone: "",
    },
    lineItems: [{
      id: 5001,
      productId: 101,
      variationId: 0,
      name: "Test Product",
      sku: "TEST-101",
      quantity: 2,
      price: 50,
      subtotal: 100,
      subtotalTax: 0,
      total: 100,
      totalTax: 0,
      imageUrl: null,
    }],
    feeLines: [],
    couponLines: [],
    refunds: [],
    refundedTotal: 0,
    refundableTotal: 120,
    pointsEarned: 0,
    pointsAwarded: false,
    storeCreditApplied: false,
    storeCreditAmount: 0,
    paymentOperations: {
      kind: "card",
      reference: "txn-test",
      verification: "passed",
      expiresAt: null,
      processingFee: 3,
      processingFeeRate: 0.03,
      approvalState: "not_required",
    },
    agreement: {
      status: "missing",
      acceptedAt: null,
      sealedAt: null,
      signer: "",
      version: "",
      emailStatus: "",
      emailSentAt: null,
      fileName: "",
      downloadAvailable: false,
    },
    shippingOperations: {
      carrier: "",
      service: "",
      exported: false,
      shippedItemCount: 0,
      shipmentIds: [],
      protectionSelected: false,
      protectionFee: 0,
      protectionValue: 0,
      protectionProvider: "",
      trackingNumber: "",
    },
    ...overrides,
  };
}

test("processing paid orders with valid SKU lines are eligible", () => {
  assert.deepEqual(evaluateFulfillmentEligibility(eligibleOrder()), {
    eligible: true,
    reasons: [],
  });
});

test("manual payments require the existing payment workflow to approve them", () => {
  const order = eligibleOrder({
    paymentOperations: {
      ...eligibleOrder().paymentOperations,
      kind: "manual",
      approvalState: "pending",
    },
  });
  const result = evaluateFulfillmentEligibility(order);
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.code === "payment_not_approved"));
});

test("an approved manual payment can enter fulfillment even when WooCommerce omitted date_paid", () => {
  const order = eligibleOrder({
    paidAt: null,
    paymentOperations: {
      ...eligibleOrder().paymentOperations,
      kind: "manual",
      approvalState: "approved",
    },
  });
  assert.deepEqual(evaluateFulfillmentEligibility(order), {
    eligible: true,
    reasons: [],
  });
});

test("a non-manual payment without date_paid still fails closed", () => {
  const result = evaluateFulfillmentEligibility(eligibleOrder({ paidAt: null }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.code === "payment_date_missing"));
});

test("completed, unpaid, refunded, empty and missing-SKU orders fail closed", () => {
  const order = eligibleOrder({
    status: "completed",
    paidAt: null,
    refundedTotal: 20,
    lineItems: [{ ...eligibleOrder().lineItems[0]!, sku: "" }],
  });
  const codes = evaluateFulfillmentEligibility(order).reasons.map((reason) => reason.code);
  assert.deepEqual(codes, [
    "order_not_processing",
    "payment_date_missing",
    "order_refunded",
    "missing_sku",
  ]);

  assert.deepEqual(
    evaluateFulfillmentEligibility(eligibleOrder({ lineItems: [] })).reasons.map((reason) => reason.code),
    ["order_has_no_items"],
  );
});

test("unsafe order-line identifiers and quantities are rejected", () => {
  const source = eligibleOrder().lineItems[0]!;
  const result = evaluateFulfillmentEligibility(eligibleOrder({
    lineItems: [{ ...source, variationId: -1, quantity: 0 }],
  }));
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((reason) => reason.code === "invalid_order_line"));
});
