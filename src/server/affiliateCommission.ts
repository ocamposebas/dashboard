import type { CommerceOrder } from "./wooCommerceGateway.js";

export type ShadowCommissionStatus = "reserved" | "pending" | "approved" | "reversed";

export interface AffiliateCommissionRule {
  type: "percent" | "fixed";
  value: number;
}

export interface AffiliateCommissionCalculation {
  status: ShadowCommissionStatus;
  eligibleAmount: number;
  commissionAmount: number;
  heldUntil: Date | null;
  reason: string;
}

const ELIGIBLE_STATUSES = new Set(["processing", "completed"]);
const REVERSED_STATUSES = new Set(["cancelled", "failed", "refunded", "trash"]);

function cents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function calculateAffiliateCommission(
  order: CommerceOrder,
  rule: AffiliateCommissionRule,
  holdDays: number,
  now = new Date(),
): AffiliateCommissionCalculation {
  const productNet = cents(order.lineItems.reduce((sum, item) => sum + Math.max(0, item.total), 0));
  // Positive operational fees are not commissionable. Negative fee lines are
  // checkout discounts (for example the Zelle discount) and reduce the same
  // merchandise base used by the legacy affiliate ledger.
  const checkoutDiscounts = cents((order.feeLines || []).reduce(
    (sum, fee) => sum + Math.min(0, fee.total),
    0,
  ));
  const adjustedProductNet = cents(Math.max(0, productNet + checkoutDiscounts));
  const fullyRefunded = order.total > 0 && order.refundedTotal >= order.total - 0.005;
  const retainedRatio = order.total > 0
    ? Math.max(0, Math.min(1, (order.total - order.refundedTotal) / order.total))
    : 0;
  const eligibleAmount = cents(adjustedProductNet * retainedRatio);
  const rawCommission = rule.type === "fixed"
    ? Math.max(0, rule.value) * retainedRatio
    : eligibleAmount * Math.max(0, rule.value) / 100;
  const commissionAmount = cents(rawCommission);
  const normalizedStatus = order.status.trim().toLowerCase();

  if (REVERSED_STATUSES.has(normalizedStatus) || fullyRefunded) {
    return { status: "reversed", eligibleAmount, commissionAmount, heldUntil: null, reason: "order_reversed" };
  }
  if (!ELIGIBLE_STATUSES.has(normalizedStatus) || !order.paidAt) {
    return { status: "reserved", eligibleAmount, commissionAmount, heldUntil: null, reason: "payment_not_eligible" };
  }

  const paidAt = new Date(order.paidAt);
  if (!Number.isFinite(paidAt.getTime())) {
    return { status: "reserved", eligibleAmount, commissionAmount, heldUntil: null, reason: "paid_date_invalid" };
  }
  const heldUntil = new Date(paidAt.getTime() + Math.max(0, holdDays) * 24 * 60 * 60 * 1_000);
  return heldUntil.getTime() <= now.getTime()
    ? { status: "approved", eligibleAmount, commissionAmount, heldUntil, reason: "hold_complete" }
    : { status: "pending", eligibleAmount, commissionAmount, heldUntil, reason: "approval_hold" };
}
