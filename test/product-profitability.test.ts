import assert from "node:assert/strict";
import test from "node:test";

import { calculateProductProfitability } from "../src/shared/productProfitability.js";

test("product profitability includes transaction and affiliate percentages", () => {
  const result = calculateProductProfitability(100, {
    unitCost: 30,
    packagingCost: 5,
    feeRate: 3,
    affiliateRate: 10,
  });
  assert.equal(result.transactionFee, 3);
  assert.equal(result.affiliateReserve, 10);
  assert.equal(result.estimatedProfit, 52);
  assert.equal(result.margin, 52);
});

test("product profitability clamps invalid percentages safely", () => {
  const result = calculateProductProfitability(100, {
    unitCost: 10,
    packagingCost: 0,
    feeRate: -5,
    affiliateRate: 150,
  });
  assert.equal(result.transactionFee, 0);
  assert.equal(result.affiliateReserve, 100);
  assert.equal(result.estimatedProfit, -10);
});
