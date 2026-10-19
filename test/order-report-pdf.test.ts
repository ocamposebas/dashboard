import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { buildOrderReportPdf, orderFinancialBreakdown } from "../src/server/orderReportPdf.js";
import type { CommerceOrder } from "../src/server/wooCommerceGateway.js";

function orderFixture(): CommerceOrder {
  return {
    id: 41, customerId: 7, number: "4101", status: "processing", currency: "USD", total: 132.5,
    totalTax: 7.5, cartTax: 6, shippingTotal: 15, shippingTax: 1.5, discountTotal: 10, discountTax: 0,
    paymentMethod: "Zelle", paymentMethodId: "phaseone_zelle", transactionId: "TX-41", customer: "Ada Lovelace",
    location: "Miami, US", customerNote: "", createdAt: "2026-10-17T12:00:00.000Z", modifiedAt: null, paidAt: null, completedAt: null,
    billing: { firstName: "Ada", lastName: "Lovelace", company: "", address1: "1 Test Ave", address2: "", city: "Miami", state: "FL", postcode: "33101", country: "US", email: "ada@example.com", phone: "" },
    shipping: { firstName: "Ada", lastName: "Lovelace", company: "", address1: "1 Test Ave", address2: "", city: "Miami", state: "FL", postcode: "33101", country: "US", email: "", phone: "" },
    lineItems: [{ id: 1, productId: 11, variationId: 12, name: "Research Product 10 mg", sku: "RP-10", quantity: 2, price: 55, subtotal: 110, subtotalTax: 6, total: 100, totalTax: 6, imageUrl: null }],
    feeLines: [{ id: 2, name: "Protection", taxStatus: "none", total: 10, totalTax: 0 }],
    couponLines: [{ id: 3, code: "TEN", discount: 10, discountTax: 0 }], refunds: [], refundedTotal: 0, refundableTotal: 132.5,
    pointsEarned: 0, pointsAwarded: false, storeCreditApplied: false, storeCreditAmount: 0,
    paymentOperations: { kind: "manual", reference: "TX-41", verification: "", expiresAt: null, processingFee: 2.5, processingFeeRate: 2, approvalState: "pending" },
    agreement: { status: "missing", acceptedAt: null, sealedAt: null, signer: "", version: "", emailStatus: "", emailSentAt: null, fileName: "", downloadAvailable: false },
    shippingOperations: { carrier: "", service: "", exported: false, shippedItemCount: 0, shipmentIds: [], protectionSelected: true, protectionFee: 10, protectionValue: 0, protectionProvider: "", trackingNumber: "" },
  };
}

test("financial breakdown separates product net, shipping, tax, fees and costs", () => {
  assert.deepEqual(orderFinancialBreakdown(orderFixture()), {
    productNet: 100,
    itemSubtotal: 110,
    discounts: 10,
    shipping: 15,
    taxes: 7.5,
    fees: 10,
    processingCost: 2.5,
    refunds: 0,
    orderTotal: 132.5,
    netRetained: 130,
  });
});

test("order report produces a valid, readable multi-section PDF", async () => {
  const bytes = await buildOrderReportPdf([orderFixture()], { periodLabel: "October 17, 2026", generatedAt: new Date("2026-10-17T18:00:00.000Z") });
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 1);
  const firstPage = document.getPage(0).getSize();
  assert.equal(firstPage.width, 792);
  assert.equal(firstPage.height, 612);
  assert.match(document.getTitle() || "", /Phase One Labz - Order Report/);
});

test("order report safely normalizes invisible and unsupported customer text", async () => {
  const order = orderFixture();
  order.customer = "Ada\u2060 Lovelace 🚀";
  order.paymentMethod = "Zelle\u2060 – verified";
  order.lineItems[0]!.name = "Research\u2060 Product – Café 🧪";
  order.lineItems[0]!.sku = "RP\u2060-10";
  order.refunds = [{ id: 9, reason: "Customer\u2060 request 🧪", total: 5 }];
  order.refundedTotal = 5;

  const bytes = await buildOrderReportPdf([order], {
    periodLabel: "Oct 17 – Oct 18\u2060",
    generatedAt: new Date("2026-10-17T18:00:00.000Z"),
  });
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
});

test("order report lays out every order as a paginated table ledger", async () => {
  const orders = Array.from({ length: 24 }, (_, index) => {
    const order = orderFixture();
    order.id = index + 1;
    order.number = String(5000 + index);
    order.customer = `Customer ${index + 1}`;
    order.lineItems = [
      ...order.lineItems,
      { ...order.lineItems[0]!, id: index + 100, name: `Additional Product ${index + 1}`, sku: `ADD-${index + 1}`, quantity: 1 },
    ];
    return order;
  });
  const bytes = await buildOrderReportPdf(orders, {
    periodLabel: "Annual report 2026",
    generatedAt: new Date("2026-10-17T18:00:00.000Z"),
  });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() > 1);
  assert.match(document.getTitle() || "", /Annual report 2026/);
});
