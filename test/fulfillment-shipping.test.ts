import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMockShippingLabelDocument,
  FulfillmentShippingError,
  packedOrderStatusBlocker,
  shippingDestination,
  shippingExternalShipmentKey,
  shippingDestinationHash,
  shippingPackageInput,
} from "../src/server/fulfillmentShipping.js";
import type { CommerceAddress } from "../src/server/wooCommerceGateway.js";
import {
  matchesPhaseOneShippingPolicy,
  PHASE_ONE_SHIPPING_POLICY,
  PHASE_ONE_USPS_POLICY,
  shippingPolicyForDestination,
} from "../src/shared/shipping.js";

function address(overrides: Partial<CommerceAddress> = {}): CommerceAddress {
  return {
    firstName: "Ana",
    lastName: "Lopez",
    company: "",
    address1: "100 Test Street",
    address2: "Suite 2",
    city: "Miami",
    state: "FL",
    postcode: "33101",
    country: "US",
    email: "ana@example.test",
    phone: "+1 555 0100",
    ...overrides,
  };
}

test("shipping validates standard package limits and complete order addresses", () => {
  assert.deepEqual(shippingPackageInput({
    weightOz: "16", lengthIn: 8, widthIn: 6, heightIn: 4,
  }), {
    weightOz: 16,
    lengthIn: 8,
    widthIn: 6,
    heightIn: 4,
    packageCode: "package",
    packageName: "Your own box",
  });
  assert.deepEqual(shippingPackageInput({
    weightOz: 16,
    lengthIn: 8,
    widthIn: 6,
    heightIn: 4,
    packageCode: "FEDEX_SMALL_BOX_ONERATE",
  }), {
    weightOz: 16,
    lengthIn: 8,
    widthIn: 6,
    heightIn: 4,
    packageCode: "fedex_small_box_onerate",
    packageName: "fedex small box onerate",
  });
  const destination = shippingDestination(address());
  assert.equal(destination.name, "Ana Lopez");
  assert.equal(destination.countryCode, "US");
  assert.equal(shippingDestinationHash(destination), shippingDestinationHash(destination));
  const externalKey = shippingExternalShipmentKey("11111111-1111-4111-8111-111111111111");
  assert.equal(externalKey, "p1-11111111-1111-4111-8111-111111111111");
  assert.ok(externalKey.length <= 50);
});

test("carrier payload removes a duplicated city, state and postal suffix without changing the source order", () => {
  const source = address({
    address1: "2740 daybreak dr. Orlando Florida 32825",
    city: "Orlando",
    state: "FL",
    postcode: "32825",
  });
  const destination = shippingDestination(source);
  assert.equal(destination.address1, "2740 daybreak dr");
  assert.equal(source.address1, "2740 daybreak dr. Orlando Florida 32825");
});

test("the warehouse shipping policy accepts only FedEx 2Day One Rate Pak", () => {
  assert.equal(matchesPhaseOneShippingPolicy({
    carrierCode: "fedex",
    serviceCode: "fedex_2day",
    packageCode: PHASE_ONE_SHIPPING_POLICY.packageCode,
  }), true);
  assert.equal(matchesPhaseOneShippingPolicy({
    carrierCode: "fedex",
    serviceCode: "fedex_ground",
    packageCode: PHASE_ONE_SHIPPING_POLICY.packageCode,
  }), false);
  assert.equal(matchesPhaseOneShippingPolicy({
    carrierCode: "fedex",
    serviceCode: "fedex_2day",
    packageCode: "fedex_small_box_onerate",
  }), false);
});

test("Puerto Rico and PO Boxes automatically use USPS Priority Mail", () => {
  assert.equal(shippingPolicyForDestination({ state: "PR", address1: "100 Calle A" }), PHASE_ONE_USPS_POLICY);
  assert.equal(shippingPolicyForDestination({ state: "CO", address1: "P.O. Box 415" }), PHASE_ONE_USPS_POLICY);
  assert.equal(shippingPolicyForDestination({ state: "FL", address1: "100 Test Street" }), PHASE_ONE_SHIPPING_POLICY);
  assert.equal(matchesPhaseOneShippingPolicy({
    carrierCode: "stamps_com",
    serviceCode: "usps_priority_mail",
    packageCode: "package",
  }, PHASE_ONE_USPS_POLICY), true);
});

test("shipping blocks invalid package values and incomplete source addresses", () => {
  assert.throws(
    () => shippingPackageInput({ weightOz: 0, lengthIn: 8, widthIn: 6, heightIn: 4 }),
    (error: unknown) => error instanceof FulfillmentShippingError && error.code === "invalid_input",
  );
  assert.throws(
    () => shippingPackageInput({
      weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4, packageCode: "../../bad",
    }),
    (error: unknown) => error instanceof FulfillmentShippingError && error.code === "invalid_input",
  );
  assert.throws(
    () => shippingDestination(address({ address1: "" })),
    (error: unknown) => error instanceof FulfillmentShippingError && error.code === "invalid_address",
  );
});

test("shipping explains the exact live-order status blocker before postage", () => {
  assert.equal(packedOrderStatusBlocker({ status: "processing", refundedTotal: 0 }), null);
  assert.equal(packedOrderStatusBlocker({ status: "completed", refundedTotal: 0 }), null);
  assert.match(
    packedOrderStatusBlocker({ status: "on-hold", refundedTotal: 0 }) || "",
    /on hold, not Processing/,
  );
  assert.match(
    packedOrderStatusBlocker({ status: "processing", refundedTotal: 5 }) || "",
    /contains a refund/,
  );
});

test("the printable 4x6 document is unmistakably a non-postage test label", () => {
  const destination = shippingDestination(address());
  const html = buildMockShippingLabelDocument({
    nonce: "test-nonce",
    orderNumber: "1501",
    carrierName: "UPS",
    serviceName: "UPS Ground",
    trackingNumber: "TEST-1501-ABC",
    destination,
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
  });
  assert.match(html, /@page\{size:4in 6in/);
  assert.match(html, /NOT VALID POSTAGE/);
  assert.match(html, /TEST ONLY/);
  assert.match(html, /nonce="test-nonce"/);
});
