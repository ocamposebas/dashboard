import assert from "node:assert/strict";
import test from "node:test";

import { calculateAffiliateCommission } from "../src/server/affiliateCommission.js";
import type { CommerceOrder } from "../src/server/wooCommerceGateway.js";

function order(overrides: Partial<CommerceOrder> = {}): CommerceOrder {
  return {
    id: 3082,
    number: "3082",
    status: "completed",
    total: 137.18,
    refundedTotal: 0,
    paidAt: "2026-10-01T12:00:00.000Z",
    lineItems: [{ total: 117 }] as CommerceOrder["lineItems"],
    ...overrides,
  } as CommerceOrder;
}

test("affiliate commission uses net merchandise and excludes shipping, taxes and fees", () => {
  const result = calculateAffiliateCommission(order(), { type: "percent", value: 10 }, 14, new Date("2026-10-20T12:00:00.000Z"));
  assert.equal(result.eligibleAmount, 117);
  assert.equal(result.commissionAmount, 11.7);
  assert.equal(result.status, "approved");
});

test("checkout discounts reduce the commission base while positive fees stay excluded", () => {
  const result = calculateAffiliateCommission(order({
    status: "on-hold",
    paidAt: null,
    lineItems: [{ total: 101.25 }, { total: 48.6 }] as CommerceOrder["lineItems"],
    feeLines: [
      { id: 1, name: "Zelle 5% discount", taxStatus: "none", total: -7.49, totalTax: 0 },
      { id: 2, name: "Shipping Protection", taxStatus: "none", total: 2.18, totalTax: 0 },
    ],
  }), { type: "percent", value: 10 }, 14);
  assert.equal(result.eligibleAmount, 142.36);
  assert.equal(result.commissionAmount, 14.24);
  assert.equal(result.status, "reserved");
});

test("unpaid orders reserve commission without approving it", () => {
  const result = calculateAffiliateCommission(order({ status: "pending", paidAt: null }), { type: "percent", value: 10 }, 14);
  assert.equal(result.status, "reserved");
  assert.equal(result.commissionAmount, 11.7);
});

test("approval hold keeps recent paid orders pending", () => {
  const result = calculateAffiliateCommission(order({ paidAt: "2026-10-17T12:00:00.000Z" }), { type: "percent", value: 10 }, 14, new Date("2026-10-18T12:00:00.000Z"));
  assert.equal(result.status, "pending");
  assert.equal(result.heldUntil?.toISOString(), "2026-10-31T12:00:00.000Z");
});

test("refunds reduce eligible merchandise and fully refunded orders reverse commission", () => {
  const partial = calculateAffiliateCommission(order({ refundedTotal: 68.59 }), { type: "percent", value: 10 }, 0);
  assert.equal(partial.eligibleAmount, 58.5);
  assert.equal(partial.commissionAmount, 5.85);
  const full = calculateAffiliateCommission(order({ status: "refunded", refundedTotal: 137.18 }), { type: "percent", value: 10 }, 0);
  assert.equal(full.status, "reversed");
});

test("fixed commissions are prorated when an order is partially refunded", () => {
  const result = calculateAffiliateCommission(order({ refundedTotal: 68.59 }), { type: "fixed", value: 20 }, 0);
  assert.equal(result.commissionAmount, 10);
});
