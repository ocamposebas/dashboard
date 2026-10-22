import assert from "node:assert/strict";
import test from "node:test";
import { productSkuBase, productVariantSku, skuCandidate } from "../src/shared/productSku.js";

test("generates clean catalog SKUs from product names", () => {
  assert.equal(productSkuBase("High Dose Eloralintide + PL-RT Blend"), "HIGH-DOSE-ELORALINTIDE-PL-RT-BLEND");
  assert.equal(productSkuBase("Crème & Skin 2%"), "CREME-AND-SKIN-2");
  assert.equal(productSkuBase(""), "P1-PRODUCT");
});

test("generates deterministic variation SKUs and available suffixes", () => {
  assert.equal(productVariantSku("PL-TZ", "20 mg"), "PL-TZ-20-MG");
  assert.equal(skuCandidate("PL-TZ", 0), "PL-TZ");
  assert.equal(skuCandidate("PL-TZ", 1), "PL-TZ-1");
});
