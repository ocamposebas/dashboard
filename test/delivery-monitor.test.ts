import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryStatusFromCode,
  evaluateDeliveryTracking,
  summarizeDeliveries,
  type DeliveryMonitorItem,
} from "../src/shared/deliveryMonitor.js";
import { DeliveryMonitorService } from "../src/server/deliveryMonitorService.js";
import type { DeliveryMonitorRepository } from "../src/server/deliveryMonitorRepository.js";
import type { PresenceStore } from "../src/server/presenceStore.js";
import type { ShipStationGateway } from "../src/server/shipStationGateway.js";
import type { WooCommerceGateway } from "../src/server/wooCommerceGateway.js";

test("delivery tracking turns an undelivered five-day shipment into one delayed alert", () => {
  const result = evaluateDeliveryTracking({
    tracking: {
      statusCode: "IT",
      statusDescription: "In Transit",
      shippedAt: "2026-11-01T12:00:00.000Z",
      estimatedDeliveryAt: null,
      deliveredAt: null,
      exceptionDescription: null,
      lastEventAt: "2026-11-03T12:00:00.000Z",
      lastEventDescription: "Departed facility",
    },
    labelCreatedAt: "2026-11-01T12:00:00.000Z",
    delayDays: 5,
    now: new Date("2026-11-06T12:05:00.000Z"),
  });

  assert.equal(result.status, "in_transit");
  assert.equal(result.daysInTransit, 5);
  assert.equal(result.delayed, true);
  assert.equal(result.alertKind, "delayed");
});

test("delivered packages never remain delayed and service-point delivery counts as delivered", () => {
  assert.equal(deliveryStatusFromCode("SP"), "delivered");
  const result = evaluateDeliveryTracking({
    tracking: {
      statusCode: "DE",
      statusDescription: "Delivered",
      shippedAt: "2026-10-01T12:00:00.000Z",
      estimatedDeliveryAt: null,
      deliveredAt: "2026-10-10T12:00:00.000Z",
      exceptionDescription: null,
      lastEventAt: "2026-10-10T12:00:00.000Z",
      lastEventDescription: "Delivered",
    },
    labelCreatedAt: "2026-10-01T12:00:00.000Z",
    delayDays: 5,
    now: new Date("2026-11-06T12:05:00.000Z"),
  });
  assert.equal(result.status, "delivered");
  assert.equal(result.delayed, false);
  assert.equal(result.alertKind, null);
});

test("delivery summary keeps exception, delayed and delivery counts separate", () => {
  const base: DeliveryMonitorItem = {
    labelId: "label", fulfillmentId: "11111111-1111-4111-8111-111111111111",
    orderId: 1, orderNumber: "1", customerName: "Customer", trackingNumber: "TRACK",
    carrierCode: "fedex", serviceCode: "fedex_2day", shippedAt: "2026-11-01T00:00:00.000Z",
    estimatedDeliveryAt: null, deliveredAt: null, lastEventAt: null, lastEventDescription: null,
    status: "in_transit", statusDescription: "In transit", exceptionDescription: null,
    daysInTransit: 2, delayed: false, alertKind: null, alertSentAt: null, alertError: null,
    acknowledgedAt: null, acknowledgedBy: null, lastCheckedAt: null, lastCheckError: null,
  };
  const summary = summarizeDeliveries([
    base,
    { ...base, labelId: "late", delayed: true, alertKind: "delayed", daysInTransit: 6 },
    { ...base, labelId: "exception", status: "exception", alertKind: "exception" },
    { ...base, labelId: "delivered", status: "delivered", deliveredAt: "2026-11-03T00:00:00.000Z" },
  ]);
  assert.deepEqual(summary, {
    total: 4, delayed: 1, exceptions: 1, inTransit: 2, delivered: 1,
    awaitingScan: 0, acknowledged: 0,
  });
});

test("a delayed incident emails only the selected owner and never duplicates on refresh", async () => {
  let stored: DeliveryMonitorItem | null = null;
  let emailCount = 0;
  let recipient = "";
  const settings = {
    delayDays: 5, recipientUserId: "owner-2", emailEnabled: true,
    initializedAt: "2026-11-01T00:00:00.000Z", lastRunAt: null, lastRunError: null,
  };
  const repository = {
    getSettings: async () => settings,
    listTrackableLabels: async () => [{
      labelId: "se-label-1", fulfillmentId: "11111111-1111-4111-8111-111111111111",
      orderId: 900, orderNumber: "900", customerName: "Customer", trackingNumber: "TRACK900",
      carrierCode: "fedex", serviceCode: "fedex_2day", createdAt: "2026-10-01T00:00:00.000Z",
    }],
    getByLabelId: async () => stored,
    upsertTracking: async (input: Omit<DeliveryMonitorItem, "alertSentAt" | "alertError" | "acknowledgedAt" | "acknowledgedBy" | "lastCheckedAt" | "lastCheckError">) => {
      stored = {
        ...input,
        alertSentAt: stored?.alertSentAt || null,
        alertError: stored?.alertError || null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        lastCheckedAt: "2026-11-16T00:00:00.000Z",
        lastCheckError: null,
      };
      return stored;
    },
    recordAlert: async (input: { sent: boolean; error: string | null }) => {
      if (stored) stored = { ...stored, alertSentAt: input.sent ? "2026-11-16T00:00:00.000Z" : null, alertError: input.error };
    },
    recordCheckFailure: async () => undefined,
    completeRun: async () => settings,
    list: async () => stored ? [stored] : [],
  } as unknown as DeliveryMonitorRepository;
  const shipStation = {
    trackLabelById: async () => ({
      trackingNumber: "TRACK900", statusCode: "IT", statusDescription: "In Transit",
      carrierStatusCode: "IT", carrierStatusDescription: "In Transit",
      shippedDate: "2026-10-01T00:00:00.000Z", estimatedDeliveryDate: null,
      actualDeliveryDate: null, exceptionDescription: null, events: [],
    }),
  } as unknown as ShipStationGateway;
  const mailer = {
    sendMarketingEmail: async (input: { recipient: string }) => {
      emailCount += 1;
      recipient = input.recipient;
      return { state: "sent" as const, sentAt: "2026-11-16T00:00:00.000Z", replayed: false, message: "sent" };
    },
  } as unknown as WooCommerceGateway;
  const store = {
    listUsers: async () => [{
      id: "owner-1", username: "owner1", displayName: "First Owner", email: "first@example.com",
      role: "owner" as const, status: "active" as const, passwordHash: "", authVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", lastLoginAt: null,
    }, {
      id: "owner-2", username: "owner2", displayName: "Selected Owner", email: "selected@example.com",
      role: "owner" as const, status: "active" as const, passwordHash: "", authVersion: 1,
      createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", lastLoginAt: null,
    }, {
      id: "admin", username: "admin", displayName: "Administrator", email: "admin@example.com",
      role: "administrator" as const, status: "active" as const, passwordHash: "", authVersion: 1,
      createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", lastLoginAt: null,
    }],
    addNotificationOnce: async () => true,
  } as unknown as PresenceStore;
  const service = new DeliveryMonitorService(
    repository, shipStation, mailer, store, "https://phaseonelabz.is",
  );

  await service.refresh();
  await service.refresh();

  assert.equal(emailCount, 1);
  assert.equal(recipient, "selected@example.com");
  assert.equal(stored?.alertSentAt, "2026-11-16T00:00:00.000Z");
});
