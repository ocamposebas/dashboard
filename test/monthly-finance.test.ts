import assert from "node:assert/strict";
import test from "node:test";
import { paymentMethodKind, summarizeCompleteMonthToDate, summarizeMonthToDate, type MonthlyFinanceOrder } from "../src/shared/monthlyFinance";

function order(input: Partial<MonthlyFinanceOrder> = {}): MonthlyFinanceOrder {
  return {
    status: "processing",
    currency: "USD",
    total: 100,
    refundedTotal: 0,
    paymentMethod: "Secure card checkout",
    paymentMethodId: "card_gateway",
    paidAt: "2026-10-10T18:00:00.000Z",
    createdAt: "2026-10-10T17:59:00.000Z",
    profitability: {
      costOfGoods: 30,
      operatingCost: 5,
      feeCost: 3,
      affiliateCost: 10,
      completeCostCoverage: true,
      estimatedProfit: 52,
    },
    ...input,
  };
}

test("month-to-date finance includes every paid method and subtracts refunds", () => {
  const summary = summarizeMonthToDate([
    order({ paymentMethod: "Zelle", paymentMethodId: "phaseone_zelle", total: 120 }),
    order({ paymentMethod: "eDebit", paymentMethodId: "edebit", total: 80, refundedTotal: 10, profitability: { ...order().profitability, estimatedProfit: 32 } }),
    order({ status: "pending", total: 500 }),
    order({ paidAt: "2026-09-30T18:00:00.000Z", createdAt: "2026-09-30T18:00:00.000Z" }),
  ], new Date("2026-10-22T20:00:00.000Z"));

  assert.equal(summary.orders, 2);
  assert.equal(summary.revenue, 190);
  assert.equal(summary.refunds, 10);
  assert.equal(summary.profit, 74);
  assert.deepEqual(summary.paymentMethods.map(({ kind, revenue }) => [kind, revenue]), [
    ["zelle", 120],
    ["debit", 70],
  ]);
});

test("month-to-date finance does not invent profit when product costs are incomplete", () => {
  const summary = summarizeMonthToDate([
    order(),
    order({ profitability: { ...order().profitability, completeCostCoverage: false, estimatedProfit: null } }),
  ], new Date("2026-10-22T20:00:00.000Z"));

  assert.equal(summary.coverage, 50);
  assert.equal(summary.margin, null);
  assert.equal(summary.profit, 52);
});

test("month-to-date finance includes allocated laboratory testing in total costs", () => {
  const summary = summarizeMonthToDate([
    order({ profitability: { ...order().profitability, testingCost: 4 } }),
  ], new Date("2026-10-22T20:00:00.000Z"));

  assert.equal(summary.costs, 52);
});

test("operational repeat orders never inflate revenue or profit", () => {
  const summary = summarizeMonthToDate([
    order({ total: 100 }),
    order({
      total: 0,
      repeatOperations: { operationalRepeat: true },
      paymentMethod: "Operational repeat · no new charge",
      paymentMethodId: "phaseone_operational_repeat",
    }),
  ], new Date("2026-10-22T20:00:00.000Z"));

  assert.equal(summary.orders, 1);
  assert.equal(summary.revenue, 100);
  assert.equal(summary.profit, 52);
});

test("payment methods receive stable visual groups", () => {
  assert.equal(paymentMethodKind(order({ paymentMethod: "Zelle", paymentMethodId: "phaseone_zelle" })), "zelle");
  assert.equal(paymentMethodKind(order({ paymentMethod: "eDebit", paymentMethodId: "custom_edebit" })), "debit");
  assert.equal(paymentMethodKind(order({ paymentMethod: "Credit card", paymentMethodId: "stripe" })), "card");
  assert.equal(paymentMethodKind(order({ paymentMethod: "ACH", paymentMethodId: "bank" })), "bank");
});

test("overview finance waits for the complete monthly report instead of flashing recent-order totals", () => {
  assert.equal(summarizeCompleteMonthToDate(undefined, new Date("2026-10-22T20:00:00.000Z")), null);

  const complete = summarizeCompleteMonthToDate([
    order({ total: 120 }),
    order({ total: 80 }),
  ], new Date("2026-10-22T20:00:00.000Z"));

  assert.equal(complete?.revenue, 200);
  assert.equal(complete?.orders, 2);
});
