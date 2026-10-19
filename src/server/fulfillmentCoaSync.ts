import { createHash } from "node:crypto";

import type {
  FulfillmentCoaAllocation,
  FulfillmentPackingSnapshot,
} from "../shared/fulfillment.js";
import type {
  CommerceOrderCoaWorkspace,
  WooCommerceGateway,
} from "./wooCommerceGateway.js";

type CoaGateway = Pick<WooCommerceGateway, "getOrderCoas" | "assignOrderCoa">;

export class FulfillmentCoaSyncError extends Error {
  constructor(message: string, readonly code: "invalid_state" | "conflict" | "upstream_unavailable") {
    super(message);
    this.name = "FulfillmentCoaSyncError";
  }
}

function normalized(value: string | null | undefined): string {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function desiredAllocations(snapshot: FulfillmentPackingSnapshot): FulfillmentCoaAllocation[] {
  const allocations = snapshot.lines.flatMap((line) => line.allocations?.length
    ? line.allocations
    : [{
        orderItemId: line.orderItemId,
        coaId: line.coaId,
        coaNumber: line.coaNumber,
        lot: line.lot,
        batch: line.batch,
        quantity: line.verifiedQuantity,
      }]);
  const grouped = new Map<string, FulfillmentCoaAllocation>();
  for (const allocation of allocations) {
    if (
      !Number.isSafeInteger(allocation.orderItemId) || allocation.orderItemId <= 0 ||
      !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0 ||
      !allocation.coaId.trim() || !allocation.lot.trim()
    ) {
      throw new FulfillmentCoaSyncError("The packed COA allocation is invalid", "invalid_state");
    }
    const key = `${allocation.orderItemId}:${allocation.coaId}:${normalized(allocation.lot)}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += allocation.quantity;
    else grouped.set(key, { ...allocation });
  }
  return [...grouped.values()];
}

function matchingQuantity(
  workspace: CommerceOrderCoaWorkspace,
  allocation: FulfillmentCoaAllocation,
): number {
  const line = workspace.items.find((item) => item.itemId === allocation.orderItemId);
  if (!line) return 0;
  return line.assignments
    .filter((assignment) =>
      assignment.coaId === allocation.coaId &&
      normalized(assignment.lot) === normalized(allocation.lot))
    .reduce((sum, assignment) => sum + assignment.quantity, 0);
}

function eventId(snapshot: FulfillmentPackingSnapshot, allocation: FulfillmentCoaAllocation): string {
  return createHash("sha256")
    .update([
      "phaseone-fulfillment-coa-v1",
      snapshot.clientEventId,
      String(snapshot.orderId),
      String(allocation.orderItemId),
      allocation.coaId,
      normalized(allocation.lot),
      String(allocation.quantity),
    ].join("|"))
    .digest("hex");
}

export async function syncPackedCoaAssignments(input: {
  snapshot: FulfillmentPackingSnapshot;
  gateway: CoaGateway;
}): Promise<{ assignedUnits: number; workspace: CommerceOrderCoaWorkspace }> {
  const desired = desiredAllocations(input.snapshot);
  let workspace: CommerceOrderCoaWorkspace;
  try {
    workspace = await input.gateway.getOrderCoas(input.snapshot.orderId);
  } catch (error) {
    throw new FulfillmentCoaSyncError(
      error instanceof Error ? error.message : "The order COA workspace is unavailable",
      "upstream_unavailable",
    );
  }

  let assignedUnits = 0;
  for (const allocation of desired) {
    const line = workspace.items.find((item) => item.itemId === allocation.orderItemId);
    if (!line) {
      throw new FulfillmentCoaSyncError(
        `Order item ${allocation.orderItemId} is no longer available for COA assignment`,
        "conflict",
      );
    }
    const alreadyAssigned = matchingQuantity(workspace, allocation);
    const missing = allocation.quantity - alreadyAssigned;
    if (missing <= 0) continue;
    if (line.remainingQuantity < missing) {
      throw new FulfillmentCoaSyncError(
        `${line.name} already has a different COA allocation. Review it before replacing the scanned lot.`,
        "conflict",
      );
    }
    try {
      workspace = await input.gateway.assignOrderCoa(
        input.snapshot.orderId,
        allocation.orderItemId,
        allocation.coaId,
        missing,
        eventId(input.snapshot, allocation),
      );
    } catch (error) {
      throw new FulfillmentCoaSyncError(
        error instanceof Error ? error.message : "WordPress did not confirm the COA assignment",
        "upstream_unavailable",
      );
    }
    assignedUnits += missing;
  }

  for (const allocation of desired) {
    if (matchingQuantity(workspace, allocation) < allocation.quantity) {
      throw new FulfillmentCoaSyncError(
        "WordPress did not return the complete scanned COA allocation",
        "upstream_unavailable",
      );
    }
  }
  return { assignedUnits, workspace };
}
