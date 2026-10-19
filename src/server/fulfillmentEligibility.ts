import type { CommerceOrder } from "./wooCommerceGateway.js";

export type FulfillmentIneligibilityCode =
  | "order_not_processing"
  | "payment_not_approved"
  | "payment_date_missing"
  | "order_refunded"
  | "order_has_no_items"
  | "invalid_order_line"
  | "missing_sku";

export interface FulfillmentEligibility {
  eligible: boolean;
  reasons: Array<{
    code: FulfillmentIneligibilityCode;
    message: string;
  }>;
}

export function evaluateFulfillmentEligibility(order: CommerceOrder): FulfillmentEligibility {
  const reasons: FulfillmentEligibility["reasons"] = [];

  if (order.status !== "processing") {
    reasons.push({
      code: "order_not_processing",
      message: "Only processing orders can enter barcode fulfillment.",
    });
  }

  if (!["approved", "not_required"].includes(order.paymentOperations.approvalState)) {
    reasons.push({
      code: "payment_not_approved",
      message: "The existing payment workflow has not approved this order.",
    });
  }

  if (!order.paidAt) {
    reasons.push({
      code: "payment_date_missing",
      message: "The source order does not contain a paid timestamp.",
    });
  }

  if (order.refundedTotal > 0) {
    reasons.push({
      code: "order_refunded",
      message: "Refunded orders require manual review before fulfillment.",
    });
  }

  if (order.lineItems.length === 0) {
    reasons.push({
      code: "order_has_no_items",
      message: "The order has no physical line items to verify.",
    });
  }

  for (const item of order.lineItems) {
    if (
      !Number.isSafeInteger(item.id) || item.id <= 0 ||
      !Number.isSafeInteger(item.productId) || item.productId <= 0 ||
      !Number.isSafeInteger(item.variationId) || item.variationId < 0 ||
      !Number.isSafeInteger(item.quantity) || item.quantity <= 0
    ) {
      reasons.push({
        code: "invalid_order_line",
        message: `Order line ${item.id || "unknown"} does not have safe fulfillment identifiers.`,
      });
      continue;
    }
    if (!item.sku.trim()) {
      reasons.push({
        code: "missing_sku",
        message: `Order line ${item.id} does not have an SKU for barcode verification.`,
      });
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
