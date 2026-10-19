import assert from "node:assert/strict";
import test from "node:test";

import type { FulfillmentPackingSnapshot } from "../src/shared/fulfillment.js";
import {
  FulfillmentCoaSyncError,
  syncPackedCoaAssignments,
} from "../src/server/fulfillmentCoaSync.js";
import type { CommerceOrderCoaWorkspace } from "../src/server/wooCommerceGateway.js";

function snapshot(): FulfillmentPackingSnapshot {
  return {
    version: 1,
    clientEventId: "9d1acf84-ddd6-48c9-a87d-2a8196af9e18",
    orderId: 1501,
    orderNumber: "1501",
    sourceModifiedAt: "2026-10-16T14:05:00.000Z",
    confirmedAt: "2026-10-16T14:08:00.000Z",
    packedBy: "operator-test",
    verifiedUnits: 2,
    totalUnits: 2,
    lines: [{
      orderItemId: 701,
      productId: 201,
      variationId: 301,
      name: "BPC-157 10mg",
      sku: "BPC-10-BLUE",
      requiredQuantity: 2,
      verifiedQuantity: 2,
      locationCode: "A-01",
      coaId: "coa-201",
      coaNumber: "P1-201",
      lot: "LOT-201",
      batch: "BATCH-201",
      allocations: [{
        orderItemId: 701,
        coaId: "coa-201",
        coaNumber: "P1-201",
        lot: "LOT-201",
        batch: "BATCH-201",
        quantity: 2,
      }],
    }],
  };
}

function workspace(assignments: CommerceOrderCoaWorkspace["items"][number]["assignments"] = []): CommerceOrderCoaWorkspace {
  const assigned = assignments.reduce((sum, item) => sum + item.quantity, 0);
  return {
    orderId: 1501,
    items: [{
      itemId: 701,
      name: "BPC-157 10mg",
      sku: "BPC-10-BLUE",
      quantity: 2,
      remainingQuantity: Math.max(0, 2 - assigned),
      assignments,
      candidates: [{
        id: "coa-201",
        number: "P1-201",
        productName: "BPC-157 10mg",
        strength: "10mg",
        lot: "LOT-201",
        testingDate: null,
        laboratory: "Freedom Diagnostics",
        currentShippingLot: true,
      }],
    }],
  };
}

test("packed vial allocations are assigned once with a stable protected event id", async () => {
  let current = workspace();
  const calls: Array<{ quantity: number; eventId: string }> = [];
  const gateway = {
    getOrderCoas: async () => current,
    assignOrderCoa: async (_orderId: number, _itemId: number, coaId: string, quantity: number, eventId?: string) => {
      calls.push({ quantity, eventId: eventId || "" });
      current = workspace([{
        assignmentId: "assignment-1",
        coaId,
        lot: "LOT-201",
        quantity,
        assignedAt: "2026-10-16T14:09:00.000Z",
        source: "fulfillment",
        hasSnapshot: true,
      }]);
      return current;
    },
  };
  const first = await syncPackedCoaAssignments({ snapshot: snapshot(), gateway });
  assert.equal(first.assignedUnits, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.eventId, /^[a-f0-9]{64}$/);

  const replay = await syncPackedCoaAssignments({ snapshot: snapshot(), gateway });
  assert.equal(replay.assignedUnits, 0);
  assert.equal(calls.length, 1);
});

test("a conflicting pre-existing customer lot is never overwritten automatically", async () => {
  const current = workspace([{
    assignmentId: "manual-1",
    coaId: "coa-other",
    lot: "LOT-OTHER",
    quantity: 2,
    assignedAt: null,
    source: "manual",
    hasSnapshot: true,
  }]);
  await assert.rejects(
    syncPackedCoaAssignments({
      snapshot: snapshot(),
      gateway: {
        getOrderCoas: async () => current,
        assignOrderCoa: async () => {
          throw new Error("must not be called");
        },
      },
    }),
    (error: unknown) => error instanceof FulfillmentCoaSyncError && error.code === "conflict",
  );
});
