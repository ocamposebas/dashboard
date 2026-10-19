import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMockShippingLabelDocument,
  FulfillmentShippingError,
  shippingDestination,
  shippingExternalShipmentKey,
  shippingDestinationHash,
  shippingPackageInput,
} from "../src/server/fulfillmentShipping.js";
import type { CommerceAddress } from "../src/server/wooCommerceGateway.js";

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
  }), { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 });
  const destination = shippingDestination(address());
  assert.equal(destination.name, "Ana Lopez");
  assert.equal(destination.countryCode, "US");
  assert.equal(shippingDestinationHash(destination), shippingDestinationHash(destination));
  const externalKey = shippingExternalShipmentKey("11111111-1111-4111-8111-111111111111");
  assert.equal(externalKey, "p1-11111111-1111-4111-8111-111111111111");
  assert.ok(externalKey.length <= 50);
});

test("shipping blocks invalid package values and incomplete source addresses", () => {
  assert.throws(
    () => shippingPackageInput({ weightOz: 0, lengthIn: 8, widthIn: 6, heightIn: 4 }),
    (error: unknown) => error instanceof FulfillmentShippingError && error.code === "invalid_input",
  );
  assert.throws(
    () => shippingDestination(address({ address1: "" })),
    (error: unknown) => error instanceof FulfillmentShippingError && error.code === "invalid_address",
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
