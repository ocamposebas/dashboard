import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { summarizeFinance, type FinanceOrder } from "../src/shared/financeAnalytics.js";
import { buildFinanceReportPdf } from "../src/server/financeReportPdf.js";

function orderFixture(input: Partial<FinanceOrder> = {}): FinanceOrder {
  return {
    id: 100,
    number: "3100",
    status: "processing",
    currency: "USD",
    total: 130,
    refundedTotal: 10,
    paymentMethod: "Zelle",
    paymentMethodId: "phaseone_zelle",
    paidAt: "2026-10-20T18:00:00.000Z",
    createdAt: "2026-10-20T17:58:00.000Z",
    lineItems: [
      { id: 1, productId: 10, variationId: 11, name: "KPV - 30MG", sku: "KPV-30", quantity: 2, total: 80, totalTax: 0, imageUrl: null },
      { id: 2, productId: 20, variationId: 21, name: "PL-TZ - 20MG", sku: "PL-TZ-20", quantity: 1, total: 40, totalTax: 0, imageUrl: null },
    ],
    profitability: {
      costOfGoods: 35,
      operatingCost: 6,
      feeCost: 3,
      affiliateCost: 8,
      testingCost: 5,
      completeCostCoverage: true,
      estimatedProfit: 73,
      lines: [
        { orderItemId: 1, productId: 10, variationId: 11, name: "KPV - 30MG", sku: "KPV-30", quantity: 2, productRevenue: 80, allocatedRevenue: 86.6666666667, allocatedRefund: 6.6666666667, costOfGoods: 20, operatingCost: 4, feeCost: 2, affiliateCost: 6, testingCost: 4, completeCostCoverage: true, estimatedProfit: 44 },
        { orderItemId: 2, productId: 20, variationId: 21, name: "PL-TZ - 20MG", sku: "PL-TZ-20", quantity: 1, productRevenue: 40, allocatedRevenue: 43.3333333333, allocatedRefund: 3.3333333333, costOfGoods: 15, operatingCost: 2, feeCost: 1, affiliateCost: 2, testingCost: 1, completeCostCoverage: true, estimatedProfit: 19 },
      ],
    },
    ...input,
  };
}

test("finance center reconciles revenue, costs and exact variation profit", () => {
  const summary = summarizeFinance([orderFixture()]);
  assert.equal(summary.orders, 1);
  assert.equal(summary.units, 3);
  assert.equal(summary.revenue, 120);
  assert.equal(summary.costs.total, 67);
  assert.equal(summary.profit, 63);
  assert.equal(summary.skus.length, 2);
  assert.equal(summary.skus[0]?.sku, "KPV-30");
  assert.equal(summary.skus[0]?.units, 2);
  assert.equal(summary.skus[0]?.profit, 44);
  assert.equal(summary.payments[0]?.kind, "zelle");
  assert.equal(summary.payments[0]?.revenue, 120);
});

test("finance center withholds profit when a sold SKU has no complete cost", () => {
  const order = orderFixture();
  order.profitability.completeCostCoverage = false;
  order.profitability.estimatedProfit = null;
  order.profitability.lines![1]!.completeCostCoverage = false;
  order.profitability.lines![1]!.estimatedProfit = null;
  const summary = summarizeFinance([order]);
  assert.equal(summary.profit, null);
  assert.equal(summary.margin, null);
  assert.equal(summary.missingCostSkus, 1);
  assert.equal(summary.skus.find((sku) => sku.sku === "PL-TZ-20")?.profit, null);
});

test("finance center excludes operational repeats and unpaid orders", () => {
  const repeated = orderFixture({ id: 101, repeatOperations: { operationalRepeat: true } });
  const pending = orderFixture({ id: 102, status: "pending" });
  const summary = summarizeFinance([orderFixture(), repeated, pending]);
  assert.equal(summary.orders, 1);
  assert.equal(summary.revenue, 120);
});

test("finance report produces a branded two-page executive PDF", async () => {
  const bytes = await buildFinanceReportPdf([orderFixture()], {
    periodLabel: "October 2026",
    generatedAt: new Date("2026-10-26T18:00:00.000Z"),
  });
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 2);
  assert.equal(document.getPage(0).getSize().width, 792);
  assert.match(document.getTitle() || "", /Phase One Labz Finance - October 2026/);
});
