import assert from "node:assert/strict";
import test from "node:test";

import { calculateProductProfitability, productCostForCatalogLine } from "../src/shared/productProfitability.js";

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

test("variable products use the exact presentation cost before the parent fallback", () => {
  const parent = { unitCost: 18, packagingCost: 2, feeRate: 3.5, affiliateRate: 8 };
  const sixtyMg = { unitCost: 41, packagingCost: 3, feeRate: 3.5, affiliateRate: 10 };
  const costs = { "120": parent, "1260": sixtyMg };

  assert.deepEqual(productCostForCatalogLine(costs, 120, 1260), sixtyMg);
  assert.deepEqual(productCostForCatalogLine(costs, 120, 1230), parent);
  assert.deepEqual(productCostForCatalogLine(costs, 120, 0), parent);
  assert.equal(productCostForCatalogLine({}, 120, 1260), null);
});
