import assert from "node:assert/strict";
import test from "node:test";

import type { FulfillmentShippingRepository } from "../src/server/fulfillmentShippingRepository.js";
import {
  FulfillmentShippingWorkflow,
  FulfillmentShippingWorkflowError,
  sourceShippingBlocksPurchase,
} from "../src/server/fulfillmentShippingWorkflow.js";

test("existing WooCommerce and ShipStation shipment signals block duplicate creation", () => {
  assert.match(sourceShippingBlocksPurchase({
    exported: false,
    shippedItemCount: 0,
    shipmentIds: [],
    trackingNumber: "1ZEXISTING",
  }) || "", /tracking number/);
  assert.match(sourceShippingBlocksPurchase({
    exported: false,
    shippedItemCount: 0,
    shipmentIds: ["se-shipment-existing"],
    trackingNumber: "",
  }) || "", /ShipStation shipment/);
  assert.match(sourceShippingBlocksPurchase({
    exported: false,
    shippedItemCount: 2,
    shipmentIds: [],
    trackingNumber: "",
  }) || "", /shipped items/);
  assert.match(sourceShippingBlocksPurchase({
    exported: true,
    shippedItemCount: 0,
    shipmentIds: [],
    trackingNumber: "",
  }) || "", /already synchronized/);
});

test("a clean source order can enter the protected label workflow", () => {
  assert.equal(sourceShippingBlocksPurchase({
    exported: false,
    shippedItemCount: 0,
    shipmentIds: [],
    trackingNumber: "",
  }), null);
});

test("the disabled live-purchase flag rejects before persistence or provider access", async () => {
  let repositoryCalled = false;
  let providerCalled = false;
  const repository = {
    async beginPurchase() {
      repositoryCalled = true;
      throw new Error("must not run");
    },
  } as unknown as FulfillmentShippingRepository;
  const workflow = new FulfillmentShippingWorkflow(repository, {
    async purchaseLabelFromRate() {
      providerCalled = true;
      throw new Error("must not run");
    },
    async findLabelsByRateId() {
      providerCalled = true;
      return [];
    },
    async getLabelById() {
      providerCalled = true;
      throw new Error("must not run");
    },
    async voidLabel() {
      providerCalled = true;
      throw new Error("must not run");
    },
  }, false);
  await assert.rejects(workflow.create({
    fulfillmentId: "11111111-1111-4111-8111-111111111111",
    clientEventId: "22222222-2222-4222-8222-222222222222",
    actorId: "operator-test",
    providerMode: "live",
    destination: {
      name: "Ana Lopez", company: "", address1: "100 Test Street", address2: "",
      city: "Miami", state: "FL", postalCode: "33101", countryCode: "US", phone: "",
    },
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    rate: {
      rateId: "se-rate-disabled", carrierId: "se-ups", carrierCode: "ups",
      shipmentId: "se-shipment-disabled",
      carrierName: "UPS", serviceCode: "ups_ground", serviceName: "UPS Ground",
      amount: 10.5, currency: "USD", deliveryDays: 4,
      estimatedDeliveryDate: null, guaranteed: false, isEstimate: true,
    },
    sourceShipping: { exported: false, shippedItemCount: 0, shipmentIds: [], trackingNumber: "" },
  }), (error: unknown) => error instanceof FulfillmentShippingWorkflowError &&
    error.code === "label_purchase_disabled");
  assert.equal(repositoryCalled, false);
  assert.equal(providerCalled, false);
});

test("voiding performs a read-before-write check and persists one terminal state", async () => {
  const label = {
    id: "33333333-3333-4333-8333-333333333333",
    fulfillmentId: "11111111-1111-4111-8111-111111111111",
    orderId: 3112, orderNumber: "3112", state: "label_ready" as const,
    provider: "shipstation" as const, providerMode: "live" as const,
    carrierId: "se-ups", carrierCode: "ups", carrierName: "UPS",
    serviceCode: "ups_ground", serviceName: "UPS Ground", amount: 11.5, currency: "USD",
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    externalShipmentKey: "p1-11111111-1111-4111-8111-111111111111",
    shipmentId: "se-shipment-1", labelId: "se-label-1", trackingNumber: "1ZSAFE",
    labelDownloadUrl: "https://api.shipstation.com/v2/downloads/test/label.pdf", labelFormat: "4x6" as const,
    wordpressSyncState: "synced" as const, wordpressSyncedAt: "2026-10-19T15:00:00.000Z",
    wordpressSyncMessage: "Saved", voidedAt: null, failureCode: null, failureMessage: null,
    printCount: 0, lastPrintedAt: null, createdBy: "operator-test",
    createdAt: "2026-10-19T15:00:00.000Z", updatedAt: "2026-10-19T15:00:00.000Z",
  };
  let statusChecks = 0;
  let voidCalls = 0;
  let persisted = 0;
  const repository = {
    async getAttemptContext() {
      return { label, clientEventId: "22222222-2222-4222-8222-222222222222", rateId: "se-rate-1" };
    },
    async markVoided(input: { message: string }) {
      persisted += 1;
      return { ...label, state: "voided" as const, failureMessage: input.message };
    },
  } as unknown as FulfillmentShippingRepository;
  const workflow = new FulfillmentShippingWorkflow(repository, {
    async purchaseLabelFromRate() { throw new Error("not used"); },
    async findLabelsByRateId() { return []; },
    async getLabelById() {
      statusChecks += 1;
      return {
        labelId: "se-label-1", shipmentId: "se-shipment-1", status: "completed" as const,
        trackingNumber: "1ZSAFE", carrierId: "se-ups", carrierCode: "ups",
        serviceCode: "ups_ground", amount: 11.5, currency: "USD", labelDownloadUrl: label.labelDownloadUrl,
      };
    },
    async voidLabel() {
      voidCalls += 1;
      return { approved: true, message: "Refund requested" };
    },
  }, true);
  const result = await workflow.void({ fulfillmentId: label.fulfillmentId, actorId: "operator-test" });
  assert.equal(result.state, "voided");
  assert.equal(statusChecks, 1);
  assert.equal(voidCalls, 1);
  assert.equal(persisted, 1);
});
