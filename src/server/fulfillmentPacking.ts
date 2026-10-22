import type {
  FulfillmentCoaAllocation,
  FulfillmentPackingLineSnapshot,
  FulfillmentPackingSnapshot,
  FulfillmentSession,
} from "../shared/fulfillment.js";
import { evaluateFulfillmentEligibility } from "./fulfillmentEligibility.js";
import {
  coaMatchesCatalogLine,
  coaIsAvailableForVialScan,
  coaRequiresVialQrForLine,
} from "./coaScanResolver.js";
import type { CommerceCoa, CommerceOrder } from "./wooCommerceGateway.js";

interface SecuredLine {
  orderItemId: number;
  productId: number;
  variationId: number;
  sku: string;
  quantity: number;
  locationCode: string;
  coaId: string;
  lot: string;
}

interface ProgressLine {
  orderItemId: number;
  requiredQuantity: number;
  verifiedQuantity: number;
}

interface ProgressAllocation {
  orderItemId: number;
  coaId: string;
  lot: string;
  quantity: number;
}

export class FulfillmentPackingError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_state",
  ) {
    super(message);
    this.name = "FulfillmentPackingError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalized(value: string | null | undefined): string {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function securedLines(session: FulfillmentSession): SecuredLine[] {
  const snapshot = record(session.sourceSnapshot);
  if (!snapshot || !Array.isArray(snapshot.lines)) return [];
  return snapshot.lines.flatMap((value) => {
    const line = record(value);
    if (!line) return [];
    const orderItemId = positiveInteger(line.orderItemId);
    const productId = positiveInteger(line.productId);
    const variationId = nonnegativeInteger(line.variationId);
    const quantity = positiveInteger(line.quantity);
    const sku = typeof line.sku === "string" ? line.sku.trim() : "";
    const locationCode = typeof line.locationCode === "string" ? line.locationCode.trim() : "";
    const coaId = typeof line.coaId === "string" ? line.coaId.trim() : "";
    const lot = typeof line.lot === "string" ? line.lot.trim() : "";
    if (
      !orderItemId || !productId || variationId === null || !quantity || !sku
    ) return [];
    return [{ orderItemId, productId, variationId, sku, quantity, locationCode, coaId, lot }];
  });
}

function progressLines(session: FulfillmentSession): ProgressLine[] {
  const progress = record(session.progress);
  if (!progress || !Array.isArray(progress.lines)) return [];
  return progress.lines.flatMap((value) => {
    const line = record(value);
    if (!line) return [];
    const orderItemId = positiveInteger(line.orderItemId);
    const requiredQuantity = positiveInteger(line.requiredQuantity);
    const verifiedQuantity = nonnegativeInteger(line.verifiedQuantity);
    if (!orderItemId || !requiredQuantity || verifiedQuantity === null) return [];
    return [{ orderItemId, requiredQuantity, verifiedQuantity }];
  });
}

function progressAllocations(session: FulfillmentSession): ProgressAllocation[] {
  const progress = record(session.progress);
  if (!progress || !Array.isArray(progress.allocations)) return [];
  return progress.allocations.flatMap((value) => {
    const allocation = record(value);
    if (!allocation) return [];
    const orderItemId = positiveInteger(allocation.orderItemId);
    const quantity = positiveInteger(allocation.quantity);
    const coaId = typeof allocation.coaId === "string" ? allocation.coaId.trim() : "";
    const lot = typeof allocation.lot === "string" ? allocation.lot.trim() : "";
    if (!orderItemId || !quantity || !coaId || !lot) return [];
    return [{ orderItemId, coaId, lot, quantity }];
  });
}

function coaIsApproved(
  coa: CommerceCoa,
  line: SecuredLine,
  allocation: ProgressAllocation,
): boolean {
  if (!coaIsAvailableForVialScan(coa)) return false;
  if (coa.id !== allocation.coaId || normalized(coa.lot || coa.batch) !== normalized(allocation.lot)) return false;
  return coaMatchesCatalogLine(coa, line);
}

export function buildPackingSnapshot(input: {
  session: FulfillmentSession;
  order: CommerceOrder;
  coas: CommerceCoa[];
  clientEventId: string;
  actorId: string;
  confirmedAt?: string;
}): FulfillmentPackingSnapshot {
  if (input.session.state !== "open") {
    throw new FulfillmentPackingError("Only an active picking session can be packed", "invalid_state");
  }
  if (input.session.orderId !== input.order.id || input.session.orderNumber !== input.order.number) {
    throw new FulfillmentPackingError("The live order does not match this fulfillment session", "invalid_state");
  }
  const eligibility = evaluateFulfillmentEligibility(input.order);
  if (!eligibility.eligible) {
    throw new FulfillmentPackingError(
      eligibility.reasons[0]?.message || "This order is no longer eligible for packing",
      "invalid_state",
    );
  }
  if (input.session.sourceModifiedAt !== input.order.modifiedAt) {
    throw new FulfillmentPackingError(
      "The live order changed after picking started. Review it before packing.",
      "invalid_state",
    );
  }

  const secured = securedLines(input.session);
  const progress = progressLines(input.session);
  const recordedAllocations = progressAllocations(input.session);
  if (!secured.length || secured.length !== input.order.lineItems.length || progress.length !== secured.length) {
    throw new FulfillmentPackingError("The secured picking record is incomplete", "invalid_state");
  }

  const lines = secured.map<FulfillmentPackingLineSnapshot>((line) => {
    const live = input.order.lineItems.find((item) => item.id === line.orderItemId);
    if (
      !live || live.productId !== line.productId || live.variationId !== line.variationId ||
      live.quantity !== line.quantity || normalized(live.sku) !== normalized(line.sku)
    ) {
      throw new FulfillmentPackingError(
        "The order items changed after picking started. Review the order before packing.",
        "invalid_state",
      );
    }
    const counted = progress.find((item) => item.orderItemId === line.orderItemId);
    if (
      !counted || counted.requiredQuantity !== line.quantity ||
      counted.verifiedQuantity !== line.quantity
    ) {
      throw new FulfillmentPackingError(
        `${live.name} is not fully verified yet`,
        "invalid_state",
      );
    }
    const lineAllocations = recordedAllocations.filter((item) => item.orderItemId === line.orderItemId);
    const allocations = lineAllocations.length
      ? lineAllocations
      : line.coaId && line.lot
        ? [{
          orderItemId: line.orderItemId,
          coaId: line.coaId,
          lot: line.lot,
          quantity: counted.verifiedQuantity,
        }]
        : [];
    const requiresVialQr = input.coas.some((coa) => coaRequiresVialQrForLine(coa, line));
    if (!allocations.length && requiresVialQr) {
      throw new FulfillmentPackingError(
        `Scan the vial QR for every unit of ${live.name} before packing`,
        "invalid_state",
      );
    }
    if (allocations.length && allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== line.quantity) {
      throw new FulfillmentPackingError(
        `The scanned lot allocation for ${live.name} does not match the verified quantity`,
        "invalid_state",
      );
    }
    const packedAllocations = allocations.map<FulfillmentCoaAllocation>((allocation) => {
      const coa = input.coas.find((candidate) => candidate.id === allocation.coaId);
      if (!coa || !coaIsApproved(coa, line, allocation)) {
        throw new FulfillmentPackingError(
          `The scanned lot for ${live.name} is no longer an Available COA for this exact product and variation`,
          "invalid_state",
        );
      }
      return {
        orderItemId: line.orderItemId,
        coaId: allocation.coaId,
        coaNumber: coa.coaNumber,
        lot: allocation.lot,
        batch: coa.batch,
        quantity: allocation.quantity,
      };
    });
    const primary = packedAllocations[0];
    return {
      orderItemId: line.orderItemId,
      productId: line.productId,
      variationId: line.variationId,
      name: live.name,
      sku: line.sku,
      requiredQuantity: line.quantity,
      verifiedQuantity: counted.verifiedQuantity,
      locationCode: line.locationCode,
      coaId: primary?.coaId || "",
      coaNumber: primary?.coaNumber || "",
      lot: primary?.lot || "",
      batch: primary?.batch || "",
      allocations: packedAllocations,
    };
  });
  const totalUnits = lines.reduce((sum, line) => sum + line.requiredQuantity, 0);
  const verifiedUnits = lines.reduce((sum, line) => sum + line.verifiedQuantity, 0);
  if (!totalUnits || verifiedUnits !== totalUnits) {
    throw new FulfillmentPackingError("Every ordered unit must be verified before packing", "invalid_state");
  }

  return {
    version: 1,
    clientEventId: input.clientEventId,
    orderId: input.order.id,
    orderNumber: input.order.number,
    sourceModifiedAt: input.session.sourceModifiedAt,
    confirmedAt: input.confirmedAt || new Date().toISOString(),
    packedBy: input.actorId,
    verifiedUnits,
    totalUnits,
    lines,
  };
}
