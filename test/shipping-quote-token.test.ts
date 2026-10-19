import assert from "node:assert/strict";
import test from "node:test";

import {
  createShippingQuoteToken,
  ShippingQuoteTokenError,
  verifyShippingQuoteToken,
} from "../src/server/shippingQuoteToken.js";

const secret = "quote-signing-secret-that-is-long-enough-for-tests";
const claims = {
  fulfillmentId: "72ddb3e2-c1d4-49c9-b5f3-237c57e8cead",
  destinationHash: "destination-hash",
  dataMode: "mock" as const,
  package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
  rate: {
    rateId: "mock-rate-1",
    shipmentId: null,
    carrierId: "mock-ups",
    carrierCode: "ups",
    carrierName: "UPS",
    serviceCode: "ups_ground",
    serviceName: "UPS Ground",
    amount: 10.25,
    currency: "USD",
    deliveryDays: 4,
    estimatedDeliveryDate: null,
    guaranteed: false,
    isEstimate: true,
  },
};

test("shipping quote tokens preserve server-approved rates and expire", () => {
  const token = createShippingQuoteToken(secret, claims, 1_000, 5_000);
  const verified = verifyShippingQuoteToken(secret, token, 5_999);
  assert.equal(verified.fulfillmentId, claims.fulfillmentId);
  assert.equal(verified.rate.amount, 10.25);
  assert.throws(
    () => verifyShippingQuoteToken(secret, token, 6_001),
    (error: unknown) => error instanceof ShippingQuoteTokenError && error.code === "expired",
  );
});

test("shipping quote tokens reject browser-side tampering", () => {
  const token = createShippingQuoteToken(secret, claims, 1_000, 5_000);
  const [payload, signature] = token.split(".");
  assert.throws(
    () => verifyShippingQuoteToken(secret, `${payload}x.${signature}`, 2_000),
    (error: unknown) => error instanceof ShippingQuoteTokenError && error.code === "invalid",
  );
});
