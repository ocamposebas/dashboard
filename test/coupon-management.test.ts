import assert from "node:assert/strict";
import test from "node:test";

import { CouponInputError, couponStatusLabel, couponWriteInput } from "../src/shared/coupons.js";

test("coupon input keeps advanced WooCommerce restrictions safe", () => {
  assert.deepEqual(couponWriteInput({
    code: " launch 25! ", description: "Launch offer", discountType: "percent", amount: "25",
    status: "active", expiresAt: "2027-01-15T23:59:59-05:00", minimumAmount: "50",
    maximumAmount: "500", usageLimit: "100", usageLimitPerUser: "1", limitUsageToXItems: "4",
    individualUse: true, freeShipping: false, excludeSaleItems: true,
    productIds: [12, 12, "14", 0], excludedProductIds: [99], categoryIds: [3],
    excludedCategoryIds: [8], emailRestrictions: ["VIP@Example.com, *@phaseonelabz.com"],
  }), {
    code: "LAUNCH25", description: "Launch offer", discountType: "percent", amount: 25,
    status: "active", expiresAt: "2027-01-16T04:59:59.000Z", minimumAmount: 50,
    maximumAmount: 500, usageLimit: 100, usageLimitPerUser: 1, limitUsageToXItems: 4,
    individualUse: true, freeShipping: false, excludeSaleItems: true,
    productIds: [12, 14], excludedProductIds: [99], categoryIds: [3],
    excludedCategoryIds: [8], emailRestrictions: ["vip@example.com", "*@phaseonelabz.com"],
  });
});

test("coupon input rejects impossible values", () => {
  assert.throws(() => couponWriteInput({ code: "X", discountType: "percent", amount: 10 }), CouponInputError);
  assert.throws(() => couponWriteInput({ code: "SALE", discountType: "percent", amount: 101 }), /cannot exceed 100/);
  assert.throws(() => couponWriteInput({ code: "SALE", discountType: "fixed_cart", amount: 10, minimumAmount: 100, maximumAmount: 20 }), /Maximum spend/);
});

test("coupon status reports expiration before published state", () => {
  assert.equal(couponStatusLabel({ status: "publish", expiresAt: "2020-01-01T00:00:00.000Z" }), "expired");
  assert.equal(couponStatusLabel({ status: "draft", expiresAt: null }), "paused");
  assert.equal(couponStatusLabel({ status: "publish", expiresAt: null }), "active");
});
