import type { ProductLocation } from "../shared/barcodeFulfillment.js";
import type {
  FulfillmentQueueEntry,
  FulfillmentQueueLine,
  FulfillmentQueueReason,
  FulfillmentSession,
  JsonValue,
} from "../shared/fulfillment.js";
import { evaluateFulfillmentEligibility } from "./fulfillmentEligibility.js";
import { coaMatchesCatalogLine } from "./coaScanResolver.js";
import type {
  CommerceCoa,
  CommerceOrder,
  CommerceOrderLineItem,
  CommerceProduct,
} from "./wooCommerceGateway.js";

function normalized(value: string | null | undefined): string {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function effectiveLocation(
  locations: ProductLocation[],
  productId: number,
  variationId: number,
): { code: string | null; inherited: boolean } {
  const exact = locations.find((item) =>
    item.productId === productId && item.variationId === variationId);
  if (exact) return { code: exact.locationCode, inherited: false };
  if (variationId > 0) {
    const parent = locations.find((item) =>
      item.productId === productId && item.variationId === 0);
    if (parent) return { code: parent.locationCode, inherited: true };
  }
  return { code: null, inherited: false };
}

function coaMatchesLine(coa: CommerceCoa, line: CommerceOrderLineItem): boolean {
  return coaMatchesCatalogLine(coa, line);
}

function currentCoa(coas: CommerceCoa[], line: CommerceOrderLineItem): CommerceCoa | null {
  const matches = coas.filter((coa) =>
    coaMatchesLine(coa, line) && Boolean((coa.lot || coa.batch).trim()));
  return matches.find((coa) => {
    const status = normalized(coa.status);
    const unavailable = ["archiv", "review", "draft", "trash", "private", "inactive"]
      .some((value) => status.includes(value));
    return coa.currentShippingLot && !unavailable;
  }) || null;
}

function verifiedQuantity(session: FulfillmentSession | null, orderItemId: number): number {
  if (!session || !session.progress || typeof session.progress !== "object") return 0;
  const progress = session.progress as Record<string, unknown>;
  if (Array.isArray(progress.lines)) {
    const line = progress.lines.find((item) => {
      if (!item || typeof item !== "object") return false;
      return Number((item as Record<string, unknown>).orderItemId) === orderItemId;
    });
    if (line && typeof line === "object") {
      return Math.max(0, Number((line as Record<string, unknown>).verifiedQuantity) || 0);
    }
  }
  if (progress.lines && typeof progress.lines === "object") {
    return Math.max(0, Number((progress.lines as Record<string, unknown>)[String(orderItemId)]) || 0);
  }
  return 0;
}

function verifiedLots(
  session: FulfillmentSession | null,
  orderItemId: number,
  coas: CommerceCoa[],
): FulfillmentQueueLine["verifiedLots"] {
  if (!session || !session.progress || typeof session.progress !== "object") return [];
  const progress = session.progress as Record<string, unknown>;
  if (!Array.isArray(progress.allocations)) return [];
  return progress.allocations.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const allocation = value as Record<string, unknown>;
    if (Number(allocation.orderItemId) !== orderItemId) return [];
    const coaId = typeof allocation.coaId === "string" ? allocation.coaId.trim() : "";
    const lot = typeof allocation.lot === "string" ? allocation.lot.trim() : "";
    const quantity = Math.max(0, Math.floor(Number(allocation.quantity) || 0));
    if (!coaId || !lot || !quantity) return [];
    const coa = coas.find((candidate) => candidate.id === coaId);
    return [{
      orderItemId,
      coaId,
      coaNumber: coa?.coaNumber || "",
      lot,
      batch: coa?.batch || lot,
      quantity,
    }];
  });
}

function paymentReasons(order: CommerceOrder): FulfillmentQueueReason[] {
  const method = `${order.paymentMethodId} ${order.paymentMethod}`.toLocaleLowerCase("en");
  if (method.includes("prism")) return [];
  if (method.includes("zelle") || method.includes("venmo") || order.paymentOperations.kind === "manual") {
    if (order.paymentOperations.approvalState === "approved") return [];
    return [{
      code: "payment_gateway_verification_required",
      message: "Approve the Zelle/Venmo payment before picking this order.",
    }];
  }
  if (method.includes("edebit") || method.includes("yodlee") || order.paymentOperations.kind === "bank") {
    return [{
      code: "payment_gateway_verification_required",
      message: "The installed eDebit workflow must be verified before picking.",
    }];
  }
  return [{
    code: "payment_method_not_verified",
    message: `Verify the ${order.paymentMethod || "payment"} workflow before picking this order.`,
  }];
}

export function fulfillmentSourceSnapshot(
  order: CommerceOrder,
  lines: FulfillmentQueueLine[],
): JsonValue {
  return {
    orderId: order.id,
    orderNumber: order.number,
    modifiedAt: order.modifiedAt,
    status: order.status,
    paidAt: order.paidAt,
    refundedTotal: order.refundedTotal,
    paymentMethodId: order.paymentMethodId,
    lines: lines.map((line) => ({
      orderItemId: line.orderItemId,
      productId: line.productId,
      variationId: line.variationId,
      sku: line.sku,
      quantity: line.quantity,
      locationCode: line.locationCode,
      coaId: line.coa?.id || null,
      lot: line.coa?.lot || line.coa?.batch || null,
    })),
  };
}

export function initialFulfillmentProgress(lines: FulfillmentQueueLine[]): JsonValue {
  return {
    verifiedUnits: 0,
    totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines: lines.map((line) => ({
      orderItemId: line.orderItemId,
      requiredQuantity: line.quantity,
      verifiedQuantity: 0,
    })),
    allocations: [],
  };
}

export function shouldIncludeFulfillmentOrder(
  order: CommerceOrder,
  session: FulfillmentSession | null,
): boolean {
  if (normalized(order.status) === "processing") return true;
  // Keep an active exception visible so the operator can safely release the
  // workstation. Once paused, a non-processing order leaves the operational
  // queue while its progress and audit trail stay durable in PostgreSQL.
  return session?.state === "open";
}

export function compareFulfillmentQueueEntries(
  left: FulfillmentQueueEntry,
  right: FulfillmentQueueEntry,
): number {
  const rank: Record<FulfillmentQueueEntry["queueStatus"], number> = {
    active: 0,
    paused: 1,
    waiting: 2,
    blocked: 3,
    packed: 4,
  };
  const statusDifference = rank[left.queueStatus] - rank[right.queueStatus];
  if (statusDifference) return statusDifference;
  const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.POSITIVE_INFINITY;
  const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.POSITIVE_INFINITY;
  const chronologicalDifference = leftTime - rightTime;
  if (Number.isFinite(chronologicalDifference) && chronologicalDifference) {
    return chronologicalDifference;
  }
  return left.orderId - right.orderId;
}

export function buildFulfillmentQueueEntry(input: {
  order: CommerceOrder;
  products: CommerceProduct[];
  coas: CommerceCoa[];
  locations: ProductLocation[];
  session?: FulfillmentSession | null;
}): FulfillmentQueueEntry {
  const { order, products, coas, locations } = input;
  const session = input.session || null;
  const reasons: FulfillmentQueueReason[] = [
    ...evaluateFulfillmentEligibility(order).reasons,
    ...paymentReasons(order),
  ];

  const lines = order.lineItems.map<FulfillmentQueueLine>((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) {
      reasons.push({
        code: "missing_product_mapping",
        message: `${item.name} is no longer mapped to a catalog product.`,
      });
    } else if (item.variationId > 0 && !product.variationIds.includes(item.variationId)) {
      reasons.push({
        code: "missing_variation_mapping",
        message: `${item.name} is no longer mapped to the ordered variation.`,
      });
    }
    const location = effectiveLocation(locations, item.productId, item.variationId);
    const coa = currentCoa(coas, item);
    return {
      orderItemId: item.id,
      productId: item.productId,
      variationId: item.variationId,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      locationCode: location.code,
      inheritedLocation: location.inherited,
      coa: coa ? {
        id: coa.id,
        number: coa.coaNumber,
        lot: coa.lot,
        batch: coa.batch,
      } : null,
      verifiedQuantity: verifiedQuantity(session, item.id),
      verifiedLots: verifiedLots(session, item.id, coas),
    };
  });

  if (
    session &&
    normalized(order.status) === "processing" &&
    session.sourceModifiedAt !== order.modifiedAt
  ) {
    reasons.push({
      code: "source_order_changed",
      message: "The live order changed after this fulfillment session started. Review it before continuing.",
    });
  }
  if (session?.state === "cancelled") {
    reasons.push({
      code: "fulfillment_cancelled",
      message: "This local fulfillment session was cancelled and cannot be restarted.",
    });
  }

  const verifiedUnits = lines.reduce((sum, line) => sum + line.verifiedQuantity, 0);
  const queueStatus = session?.state === "packed"
    ? "packed"
    : reasons.length > 0
      ? "blocked"
      : session?.state === "open"
        ? "active"
        : session?.state === "paused"
          ? "paused"
          : "waiting";
  const primaryAction = queueStatus === "waiting"
    ? "start"
    : queueStatus === "paused"
      ? "resume"
      : queueStatus === "active" || queueStatus === "packed"
        ? "open"
        : "review";

  return {
    orderId: order.id,
    orderNumber: order.number,
    customer: order.customer,
    orderStatus: order.status,
    paymentMethod: order.paymentMethod,
    createdAt: order.createdAt,
    modifiedAt: order.modifiedAt,
    queueStatus,
    itemCount: lines.length,
    unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    verifiedUnits,
    lines,
    reasons,
    primaryAction,
    session,
  };
}
