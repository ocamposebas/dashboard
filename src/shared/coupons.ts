export type CouponDiscountType = "percent" | "fixed_cart" | "fixed_product";

export interface CouponWriteInput {
  code: string;
  description: string;
  discountType: CouponDiscountType;
  amount: number;
  status: "active" | "paused";
  expiresAt: string | null;
  minimumAmount: number | null;
  maximumAmount: number | null;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  limitUsageToXItems: number | null;
  individualUse: boolean;
  freeShipping: boolean;
  excludeSaleItems: boolean;
  productIds: number[];
  excludedProductIds: number[];
  categoryIds: number[];
  excludedCategoryIds: number[];
  emailRestrictions: string[];
}

export class CouponInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CouponInputError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalMoney(value: unknown, label: string): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
    throw new CouponInputError("invalid_amount", `${label} must be a valid positive amount.`);
  }
  return Math.round(amount * 100) / 100;
}

function optionalCount(value: unknown, label: string): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000_000) {
    throw new CouponInputError("invalid_limit", `${label} must be a whole number greater than zero.`);
  }
  return count;
}

function ids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500);
}

function emails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result = value.flatMap((entry) => typeof entry === "string"
    ? entry.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean)
    : []);
  for (const email of result) {
    if (email.length > 190 || (!email.includes("@") && !email.includes("*"))) {
      throw new CouponInputError("invalid_email_restriction", `“${email}” is not a valid email restriction.`);
    }
  }
  return [...new Set(result)].slice(0, 500);
}

function expiration(value: unknown): string | null {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string") throw new CouponInputError("invalid_expiration", "Choose a valid expiration date.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new CouponInputError("invalid_expiration", "Choose a valid expiration date.");
  return date.toISOString();
}

export function couponWriteInput(value: unknown): CouponWriteInput {
  const input = record(value);
  const code = text(input.code, 120).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (code.length < 2) throw new CouponInputError("invalid_code", "Coupon code must contain at least two letters or numbers.");

  const discountType = text(input.discountType, 30) as CouponDiscountType;
  if (!(["percent", "fixed_cart", "fixed_product"] as string[]).includes(discountType)) {
    throw new CouponInputError("invalid_discount_type", "Choose percentage, fixed order, or fixed product discount.");
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new CouponInputError("invalid_amount", "Discount value must be greater than zero.");
  }
  if (discountType === "percent" && amount > 100) {
    throw new CouponInputError("invalid_percent", "Percentage discounts cannot exceed 100%.");
  }

  const minimumAmount = optionalMoney(input.minimumAmount, "Minimum spend");
  const maximumAmount = optionalMoney(input.maximumAmount, "Maximum spend");
  if (minimumAmount !== null && maximumAmount !== null && maximumAmount < minimumAmount) {
    throw new CouponInputError("invalid_spend_range", "Maximum spend must be greater than minimum spend.");
  }

  return {
    code,
    description: text(input.description, 1_000),
    discountType,
    amount: Math.round(amount * 100) / 100,
    status: input.status === "paused" ? "paused" : "active",
    expiresAt: expiration(input.expiresAt),
    minimumAmount,
    maximumAmount,
    usageLimit: optionalCount(input.usageLimit, "Total usage limit"),
    usageLimitPerUser: optionalCount(input.usageLimitPerUser, "Per-customer limit"),
    limitUsageToXItems: optionalCount(input.limitUsageToXItems, "Item limit"),
    individualUse: input.individualUse === true,
    freeShipping: input.freeShipping === true,
    excludeSaleItems: input.excludeSaleItems === true,
    productIds: ids(input.productIds),
    excludedProductIds: ids(input.excludedProductIds),
    categoryIds: ids(input.categoryIds),
    excludedCategoryIds: ids(input.excludedCategoryIds),
    emailRestrictions: emails(input.emailRestrictions),
  };
}

export function couponStatusLabel(input: { status: string; expiresAt: string | null }): "active" | "paused" | "expired" {
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) return "expired";
  return input.status === "publish" || input.status === "active" ? "active" : "paused";
}
