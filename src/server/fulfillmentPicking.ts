import type { BarcodeRegistryRecord } from "../shared/barcodeFulfillment.js";
import type {
  FulfillmentScanDecision,
  FulfillmentScanFeedback,
  FulfillmentScanReasonCode,
  FulfillmentSession,
  JsonValue,
} from "../shared/fulfillment.js";
import { evaluateFulfillmentEligibility } from "./fulfillmentEligibility.js";
import {
  coaMatchesCatalogLine,
  coaIsAvailableForVialScan,
  coaRequiresVialQrForLine,
} from "./coaScanResolver.js";
import type { CommerceCoa, CommerceOrder } from "./wooCommerceGateway.js";

interface SnapshotLine {
  orderItemId: number;
  productId: number;
  variationId: number;
  sku: string;
  quantity: number;
  locationCode: string | null;
  coaId: string | null;
  lot: string | null;
}

interface ProgressLine {
  orderItemId: number;
  requiredQuantity: number;
  verifiedQuantity: number;
}

interface PickingProgress {
  verifiedUnits: number;
  totalUnits: number;
  lines: ProgressLine[];
  allocations: Array<{
    orderItemId: number;
    coaId: string;
    lot: string;
    quantity: number;
  }>;
}

function normalized(value: string | null | undefined): string {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function snapshotLines(session: FulfillmentSession): SnapshotLine[] {
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
    if (!orderItemId || !productId || variationId === null || !quantity || !sku) return [];
    return [{
      orderItemId,
      productId,
      variationId,
      sku,
      quantity,
      locationCode: typeof line.locationCode === "string" && line.locationCode.trim()
        ? line.locationCode.trim()
        : null,
      coaId: typeof line.coaId === "string" && line.coaId.trim() ? line.coaId.trim() : null,
      lot: typeof line.lot === "string" && line.lot.trim() ? line.lot.trim() : null,
    }];
  });
}

function progressFor(session: FulfillmentSession, lines: SnapshotLine[]): PickingProgress {
  const stored = record(session.progress);
  const storedLines = stored && Array.isArray(stored.lines) ? stored.lines : [];
  const progressLines = lines.map((line) => {
    const match = storedLines.find((value) => {
      const item = record(value);
      return item && Number(item.orderItemId) === line.orderItemId;
    });
    const item = record(match);
    const verified = Math.min(
      line.quantity,
      Math.max(0, nonnegativeInteger(item?.verifiedQuantity) ?? 0),
    );
    return {
      orderItemId: line.orderItemId,
      requiredQuantity: line.quantity,
      verifiedQuantity: verified,
    };
  });
  const storedAllocations = stored && Array.isArray(stored.allocations) ? stored.allocations : [];
  const allocations = lines.flatMap((line) => {
    const verified = progressLines.find((item) => item.orderItemId === line.orderItemId)?.verifiedQuantity || 0;
    let remaining = verified;
    const parsed = storedAllocations.flatMap((value) => {
      const item = record(value);
      if (!item || Number(item.orderItemId) !== line.orderItemId || remaining <= 0) return [];
      const coaId = typeof item.coaId === "string" ? item.coaId.trim() : "";
      const lot = typeof item.lot === "string" ? item.lot.trim() : "";
      const quantity = Math.min(remaining, Math.max(0, nonnegativeInteger(item.quantity) ?? 0));
      if (!coaId || !lot || !quantity) return [];
      remaining -= quantity;
      return [{ orderItemId: line.orderItemId, coaId, lot, quantity }];
    });
    if (remaining > 0 && line.coaId && line.lot) {
      parsed.push({
        orderItemId: line.orderItemId,
        coaId: line.coaId,
        lot: line.lot,
        quantity: remaining,
      });
    }
    return parsed;
  });
  return {
    verifiedUnits: progressLines.reduce((sum, line) => sum + line.verifiedQuantity, 0),
    totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines: progressLines,
    allocations,
  };
}

function feedback(
  progress: PickingProgress,
  input: {
    accepted: boolean;
    reasonCode: FulfillmentScanReasonCode;
    message: string;
    line?: SnapshotLine | null | undefined;
    productName?: string | null | undefined;
    verifiedQuantity?: number;
    scannedProductName?: string | null | undefined;
    scannedSku?: string | null | undefined;
    expectedProductName?: string | null | undefined;
    expectedSku?: string | null | undefined;
    lot?: string | null | undefined;
  },
): FulfillmentScanFeedback {
  const lineProgress = input.line
    ? progress.lines.find((item) => item.orderItemId === input.line?.orderItemId)
    : null;
  const verifiedQuantity = input.verifiedQuantity ?? lineProgress?.verifiedQuantity ?? 0;
  return {
    accepted: input.accepted,
    reasonCode: input.reasonCode,
    message: input.message,
    productName: input.productName || null,
    sku: input.line?.sku || null,
    locationCode: input.line?.locationCode || null,
    lot: input.lot ?? input.line?.lot ?? null,
    orderItemId: input.line?.orderItemId || null,
    verifiedQuantity,
    requiredQuantity: input.line?.quantity || 0,
    verifiedUnits: progress.verifiedUnits,
    totalUnits: progress.totalUnits,
    complete: progress.totalUnits > 0 && progress.verifiedUnits === progress.totalUnits,
    scannedProductName: input.scannedProductName || null,
    scannedSku: input.scannedSku || null,
    expectedProductName: input.expectedProductName || null,
    expectedSku: input.expectedSku || null,
  };
}

function rejected(
  progress: PickingProgress,
  reasonCode: Exclude<FulfillmentScanReasonCode, "accepted">,
  message: string,
  options: {
    barcode?: BarcodeRegistryRecord | null;
    line?: SnapshotLine | null | undefined;
    productName?: string | null | undefined;
    scannedProductName?: string | null | undefined;
    scannedSku?: string | null | undefined;
    expectedProductName?: string | null | undefined;
    expectedSku?: string | null | undefined;
  } = {},
): FulfillmentScanDecision {
  const response = feedback(progress, {
    accepted: false,
    reasonCode,
    message,
    line: options.line,
    productName: options.productName,
    scannedProductName: options.scannedProductName,
    scannedSku: options.scannedSku,
    expectedProductName: options.expectedProductName,
    expectedSku: options.expectedSku,
  });
  return {
    result: "rejected",
    reasonCode,
    quantityDelta: 0,
    responseSnapshot: response as unknown as JsonValue,
    ...(options.barcode ? {
      barcodeType: options.barcode.type,
      productId: options.barcode.productId,
      variationId: options.barcode.variationId,
      ...(options.barcode.coaId ? { coaId: options.barcode.coaId } : {}),
      ...(options.barcode.lot ? { lot: options.barcode.lot } : {}),
    } : {}),
    ...(options.line ? { orderItemId: options.line.orderItemId } : {}),
  };
}

function coaIsApproved(coa: CommerceCoa, line: SnapshotLine, barcode: BarcodeRegistryRecord): boolean {
  if (!coaIsAvailableForVialScan(coa)) return false;
  if (coa.id !== barcode.coaId || normalized(coa.lot || coa.batch) !== normalized(barcode.lot)) {
    return false;
  }
  return coaMatchesCatalogLine(coa, line);
}

function liveLinesStillMatch(order: CommerceOrder, lines: SnapshotLine[]): boolean {
  if (order.lineItems.length !== lines.length) return false;
  return lines.every((line) => {
    const current = order.lineItems.find((item) => item.id === line.orderItemId);
    return Boolean(
      current &&
      current.productId === line.productId &&
      current.variationId === line.variationId &&
      current.quantity === line.quantity &&
      normalized(current.sku) === normalized(line.sku),
    );
  });
}

export function decideFulfillmentScan(input: {
  session: FulfillmentSession;
  barcode: BarcodeRegistryRecord | null;
  order: CommerceOrder;
  coas: CommerceCoa[];
}): FulfillmentScanDecision {
  const lines = snapshotLines(input.session);
  const progress = progressFor(input.session, lines);
  const eligibility = evaluateFulfillmentEligibility(input.order);
  if (!eligibility.eligible) {
    return rejected(
      progress,
      "order_ineligible",
      eligibility.reasons[0]?.message || "This order is no longer eligible for picking.",
    );
  }
  if (input.session.sourceModifiedAt !== input.order.modifiedAt) {
    return rejected(
      progress,
      "order_changed",
      "The live order changed. Pause picking and review the order before continuing.",
    );
  }
  if (!lines.length || !liveLinesStillMatch(input.order, lines)) {
    return rejected(
      progress,
      "line_changed",
      "The order items no longer match the secured picking session.",
    );
  }
  if (!input.barcode) {
    return rejected(
      progress,
      "unknown_barcode",
      "This code is not registered. Link the vial QR to an Available COA, or generate a product barcode from the catalog for an item that does not use COAs.",
    );
  }
  if (!input.barcode.active) {
    return rejected(
      progress,
      "inactive_barcode",
      "This barcode has been disabled and cannot be used.",
      { barcode: input.barcode },
    );
  }

  const scannedCoa = input.barcode.type === "batch"
    ? input.coas.find((candidate) => candidate.id === input.barcode?.coaId) || null
    : null;
  const barcodeMatchesCoaCatalog = Boolean(
    scannedCoa &&
    scannedCoa.matchedProductId === input.barcode.productId &&
    scannedCoa.matchedVariationId === input.barcode.variationId
  );
  const migratedSkuLines = scannedCoa && barcodeMatchesCoaCatalog && coaIsAvailableForVialScan(scannedCoa)
    ? lines.filter((line) => coaMatchesCatalogLine(scannedCoa, line))
    : [];
  const exactProductLines = lines.filter((line) => line.productId === input.barcode?.productId);
  const productLines = exactProductLines.length ? exactProductLines : migratedSkuLines;
  if (!productLines.length) {
    const expectedLine = lines.find((line) => {
      const item = progress.lines.find((candidate) => candidate.orderItemId === line.orderItemId);
      return item && item.verifiedQuantity < item.requiredQuantity;
    }) || lines[0];
    const expectedItem = input.order.lineItems.find((item) => item.id === expectedLine?.orderItemId);
    return rejected(progress, "wrong_product", "This vial belongs to a different product. No quantity was added.", {
      barcode: input.barcode,
      scannedProductName: scannedCoa?.productName || scannedCoa?.compound || "Different product",
      scannedSku: scannedCoa?.skus[0] || null,
      expectedProductName: expectedItem?.name || null,
      expectedSku: expectedLine?.sku || null,
    });
  }
  const exactVariationLines = productLines.filter((line) => line.variationId === input.barcode?.variationId);
  const variationLines = exactVariationLines.length
    ? exactVariationLines
    : productLines.filter((line) => migratedSkuLines.some((candidate) => candidate.orderItemId === line.orderItemId));
  if (!variationLines.length) {
    const expectedLine = productLines[0];
    const expectedItem = input.order.lineItems.find((item) => item.id === expectedLine?.orderItemId);
    return rejected(progress, "wrong_variation", "This is the wrong variation for the order.", {
      barcode: input.barcode,
      productName: expectedItem?.name,
      scannedProductName: scannedCoa?.productName || scannedCoa?.compound || null,
      scannedSku: scannedCoa?.skus[0] || null,
      expectedProductName: expectedItem?.name || null,
      expectedSku: expectedLine?.sku || null,
    });
  }
  const line = variationLines.find((candidate) => {
    const item = progress.lines.find((value) => value.orderItemId === candidate.orderItemId);
    return item && item.verifiedQuantity < item.requiredQuantity;
  });
  if (!line) {
    const completedLine = variationLines[0]!;
    return rejected(progress, "quantity_complete", "The required quantity for this item is already complete.", {
      barcode: input.barcode,
      line: completedLine,
      productName: input.order.lineItems.find((item) => item.id === completedLine.orderItemId)?.name,
    });
  }

  if (input.barcode.type !== "batch") {
    const productName = input.order.lineItems.find((item) => item.id === line.orderItemId)?.name || "Product";
    if (input.coas.some((coa) => coaRequiresVialQrForLine(coa, line))) {
      return rejected(
        progress,
        "batch_required",
        "This product has an Available COA. Scan the QR printed on the vial so the physical lot is captured.",
        { barcode: input.barcode, line, productName },
      );
    }
    const nextLines = progress.lines.map((item) => item.orderItemId === line.orderItemId
      ? { ...item, verifiedQuantity: item.verifiedQuantity + 1 }
      : item);
    const nextProgress: PickingProgress = {
      verifiedUnits: progress.verifiedUnits + 1,
      totalUnits: progress.totalUnits,
      lines: nextLines,
      allocations: progress.allocations,
    };
    const current = nextLines.find((item) => item.orderItemId === line.orderItemId)!;
    const response = feedback(nextProgress, {
      accepted: true,
      reasonCode: "accepted",
      message: `${productName} verified with its registered product barcode. This item does not require a COA lot.`,
      line,
      productName,
      verifiedQuantity: current.verifiedQuantity,
      lot: null,
    });
    return {
      result: "accepted",
      reasonCode: "accepted",
      quantityDelta: 1,
      nextProgress: nextProgress as unknown as JsonValue,
      responseSnapshot: response as unknown as JsonValue,
      barcodeType: input.barcode.type,
      productId: input.barcode.productId,
      variationId: input.barcode.variationId,
      orderItemId: line.orderItemId,
    };
  }

  const coa = input.coas.find((candidate) => candidate.id === input.barcode?.coaId);
  if (!coa || !coaIsApproved(coa, line, input.barcode)) {
    return rejected(
      progress,
      "invalid_coa",
      "The scanned COA is not Available or no longer matches this product, variation and lot.",
      {
        barcode: input.barcode,
        line,
        productName: input.order.lineItems.find((item) => item.id === line.orderItemId)?.name,
      },
    );
  }

  const nextLines = progress.lines.map((item) => item.orderItemId === line.orderItemId
    ? { ...item, verifiedQuantity: item.verifiedQuantity + 1 }
    : item);
  const allocationIndex = progress.allocations.findIndex((item) =>
    item.orderItemId === line.orderItemId &&
    item.coaId === input.barcode?.coaId &&
    normalized(item.lot) === normalized(input.barcode?.lot));
  const nextAllocations = progress.allocations.map((item, index) => index === allocationIndex
    ? { ...item, quantity: item.quantity + 1 }
    : item);
  if (allocationIndex < 0) {
    nextAllocations.push({
      orderItemId: line.orderItemId,
      coaId: input.barcode.coaId!,
      lot: input.barcode.lot!,
      quantity: 1,
    });
  }
  const nextProgress: PickingProgress = {
    verifiedUnits: progress.verifiedUnits + 1,
    totalUnits: progress.totalUnits,
    lines: nextLines,
    allocations: nextAllocations,
  };
  const current = nextLines.find((item) => item.orderItemId === line.orderItemId)!;
  const productName = input.order.lineItems.find((item) => item.id === line.orderItemId)?.name || "Product";
  const response = feedback(nextProgress, {
    accepted: true,
    reasonCode: "accepted",
    message: `${productName} verified. Lot ${input.barcode.lot} is now captured for this customer order.`,
    line,
    productName,
    verifiedQuantity: current.verifiedQuantity,
    lot: input.barcode.lot,
  });
  return {
    result: "accepted",
    reasonCode: "accepted",
    quantityDelta: 1,
    nextProgress: nextProgress as unknown as JsonValue,
    responseSnapshot: response as unknown as JsonValue,
    barcodeType: input.barcode.type,
    productId: input.barcode.productId,
    variationId: input.barcode.variationId,
    orderItemId: line.orderItemId,
    coaId: input.barcode.coaId!,
    lot: input.barcode.lot!,
  };
}
