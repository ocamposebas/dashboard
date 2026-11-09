import assert from "node:assert/strict";
import test from "node:test";

import { BulkOrderService, BulkOrderServiceError } from "../src/server/bulkOrderService.js";
import type { BulkOrderSettings, BulkProductRule } from "../src/shared/bulkOrders.js";

const settings: BulkOrderSettings = {
  revision: 1,
  globalDiscount: 50,
  defaultMinimum: 10,
  sessionDays: 30,
  intentMinutes: 30,
  publicTitle: "Bulk Orders",
  publicIntro: "",
  catalogMode: "include_all",
  excludedCategoryIds: [],
  excludedProductIds: [],
  updatedBy: "test",
  updatedAt: new Date(0).toISOString(),
};

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: "KPV",
    slug: "kpv",
    permalink: "https://example.test/kpv",
    sku: "KPV",
    type: "simple",
    status: "publish",
    catalogVisibility: "visible",
    visibility: "public",
    price: 40,
    regularPrice: 40,
    salePrice: null,
    saleStartsAt: null,
    saleEndsAt: null,
    stockQuantity: 100,
    stockStatus: "instock",
    category: "Peptides",
    categoryId: 7,
    imageUrl: "https://example.test/kpv.png",
    thumbnailUrl: "https://example.test/kpv-thumb.png",
    images: [],
    variationIds: [],
    attributes: [],
    modifiedAt: null,
    ...overrides,
  };
}

function service(rules: BulkProductRule[] = [], products = [product()]) {
  const repository = {
    settings: async () => settings,
    listRules: async () => rules,
  };
  const commerce = {
    listProducts: async () => products,
    listProductVariations: async () => [],
  };
  return new BulkOrderService(repository as never, commerce as never, "x".repeat(64));
}

test("custom Bulk catalog applies the global price and kit minimum", async () => {
  const catalog = await service().catalog();
  assert.equal(catalog.count, 1);
  assert.equal(catalog.items[0]?.sku, "KPV");
  assert.equal(catalog.items[0]?.unitPrice, 20);
  assert.equal(catalog.items[0]?.kitPrice, 200);
  assert.equal(catalog.items[0]?.minimum, 10);
  assert.equal(catalog.items[0]?.available, true);
});

test("custom Bulk quote is authoritative and only accepts complete kits", async () => {
  const bulk = service();
  const quote = await bulk.quote([{ product_id: 100, variation_id: 0, quantity: 20 }]);
  assert.equal(quote.itemCount, 20);
  assert.equal(quote.kitCount, 2);
  assert.equal(quote.subtotal, 400);
  assert.match(quote.fingerprint, /^[a-f0-9]{64}$/);

  await assert.rejects(
    bulk.quote([{ product_id: 100, variation_id: 0, quantity: 11 }]),
    (error: unknown) => error instanceof BulkOrderServiceError && /complete kits of 10/.test(error.message),
  );
});

test("custom Bulk rules can exclude one product without changing WooCommerce", async () => {
  const rule: BulkProductRule = {
    purchasableId: 100,
    productId: 100,
    variationId: 0,
    catalogOverride: "exclude",
    availabilityOverride: "inherit",
    minimumQuantity: null,
    maximumQuantity: 0,
    pricingMode: "inherit",
    discountPercent: 0,
    fixedUnitPrice: 0,
    tiers: [],
    revision: "rule-1",
    source: "operations",
    updatedBy: "test",
    updatedAt: new Date(0).toISOString(),
  };
  const catalog = await service([rule]).catalog();
  assert.equal(catalog.count, 0);
});

