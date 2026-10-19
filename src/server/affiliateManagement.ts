import type { AffiliateStatus } from "../shared/affiliates.js";

export interface AffiliateCouponManagementInput {
  affiliateId: string;
  couponId: string | null;
  code: string;
  discountValue: number;
  commissionValue: number;
}

export class AffiliateManagementError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AffiliateManagementError";
  }
}

function boundedPercent(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 100) {
    throw new AffiliateManagementError("invalid_percentage", `${field} must be between 0.01 and 100`);
  }
  return Math.round(parsed * 100) / 100;
}

export function affiliateCouponInput(value: Record<string, unknown>): AffiliateCouponManagementInput {
  const affiliateId = typeof value.affiliateId === "string" ? value.affiliateId.trim() : "";
  const couponId = typeof value.couponId === "string" && value.couponId.trim() ? value.couponId.trim() : null;
  const code = typeof value.code === "string" ? value.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) {
    throw new AffiliateManagementError(
      "invalid_coupon_code",
      "Coupon codes must use 3–40 letters, numbers, hyphens or underscores",
    );
  }
  if (!/^[a-f0-9-]{36}$/i.test(affiliateId) || (couponId && !/^[a-f0-9-]{36}$/i.test(couponId))) {
    throw new AffiliateManagementError("invalid_affiliate", "The affiliate selection is invalid");
  }
  return {
    affiliateId,
    couponId,
    code,
    discountValue: boundedPercent(value.discountValue, "Customer discount"),
    commissionValue: boundedPercent(value.commissionValue, "Affiliate commission"),
  };
}

export function affiliateStatusInput(value: Record<string, unknown>): {
  affiliateId: string;
  status: Extract<AffiliateStatus, "active" | "suspended">;
} {
  const affiliateId = typeof value.affiliateId === "string" ? value.affiliateId.trim() : "";
  const status = value.status === "active" || value.status === "suspended" ? value.status : null;
  if (!/^[a-f0-9-]{36}$/i.test(affiliateId) || !status) {
    throw new AffiliateManagementError("invalid_status_change", "The affiliate status action is invalid");
  }
  return { affiliateId, status };
}
