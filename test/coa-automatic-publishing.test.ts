import assert from "node:assert/strict";
import test from "node:test";

import {
  canAutomaticallyPublishCoa,
  exactLegacyCoaCatalogRepairs,
  exactAutomaticCoaProduct,
  exactAutomaticCoaVariation,
} from "../src/shared/coaAutomaticPublishing.js";
import type {
  CommerceCoa,
  CommerceProduct,
  CommerceVariation,
} from "../src/server/wooCommerceGateway.js";

const coa = {
  source: "custom",
  status: "Review",
  coaNumber: "Phas2610190637",
  productName: "PL-TZ 60mg",
  familyName: "PL-TZ 60mg",
  compound: "PL-TZ",
  strength: "60mg",
  batch: "P1TZ60",
  lot: "P1TZ60",
  date: "2026-10-19",
  fileUrl: "https://phaseonelabz.is/api/public/v1/coas/example/document",
  verifyUrl: "",
  skus: [],
  intakeAnalysis: {
    status: "complete",
    suggestCurrent: true,
    dateDetection: { confidence: "explicit" },
  },
} as unknown as CommerceCoa & {
  source: string;
  intakeAnalysis: {
    status: string;
    suggestCurrent: boolean;
    dateDetection: { confidence: string };
  };
};

const product = {
  id: 533,
  name: "PL-TZ",
  sku: "PL-TZ",
  type: "variable",
  status: "publish",
} as CommerceProduct;

const variations = [
  { id: 3168, sku: "PL-TZ-10", attributes: [{ id: 1, name: "MG", option: "10 MG" }] },
  { id: 3171, sku: "PL-TZ-60", attributes: [{ id: 1, name: "MG", option: "60MG" }] },
] as CommerceVariation[];

test("an exact COA identity maps PL-TZ 60mg to its product and one exact variation", () => {
  assert.equal(exactAutomaticCoaProduct(coa, [product])?.id, 533);
  assert.equal(exactAutomaticCoaVariation(coa, product, variations)?.id, 3171);
  assert.equal(canAutomaticallyPublishCoa(coa), true);
});

test("automatic publication stays closed for ambiguous strengths and unconfirmed dates", () => {
  const duplicateStrength = { ...variations[1]!, id: 9999 };
  assert.equal(exactAutomaticCoaVariation(coa, product, [...variations, duplicateStrength]), null);
  assert.equal(canAutomaticallyPublishCoa({
    ...coa,
    intakeAnalysis: {
      ...coa.intakeAnalysis,
      dateDetection: { confidence: "fallback", source: "received" },
    },
  }), false);
});

test("a laboratory reported date can publish when no separate analysis date exists", () => {
  assert.equal(canAutomaticallyPublishCoa({
    ...coa,
    intakeAnalysis: {
      ...coa.intakeAnalysis,
      status: "limited",
      dateDetection: { confidence: "fallback", source: "reported" },
    },
  }), true);
});

test("one published product wins over stale draft or trashed duplicates", () => {
  const draft = { ...product, id: 700, status: "draft" };
  const trashed = { ...product, id: 701, status: "trash" };
  assert.equal(exactAutomaticCoaProduct(coa, [draft, trashed, product])?.id, 533);
});

test("RT30 is recognized as the Retatrutide 30mg catalog presentation", () => {
  const rt30 = { ...coa, productName: "RT30", familyName: "RT30", compound: "RT30", strength: "30mg" };
  const reta = { ...product, id: 700, name: "PL-RT 30mg", sku: "RT-30-MG", type: "simple" };
  assert.equal(exactAutomaticCoaProduct(rt30, [reta])?.id, 700);
});

test("legacy repair replaces a demonstrably wrong product mapping with one exact catalog match", () => {
  const rt30 = {
    ...coa, id: "rt30", source: "wordpress_import", revision: 1, status: "Available",
    productName: "RT30", familyName: "RT30", compound: "RT30", strength: "30mg",
    matchedProductId: 999, matchedVariationId: 0, skus: [], currentShippingLot: true,
  } as unknown as CommerceCoa & { source: string; revision: number };
  const wrong = { ...product, id: 999, name: "Unrelated product", sku: "WRONG", type: "simple" };
  const reta = { ...product, id: 700, name: "PL-RT 30mg", sku: "RT-30-MG", type: "simple" };
  const repairs = exactLegacyCoaCatalogRepairs([rt30], [wrong, reta], new Map());
  assert.equal(repairs[0]?.productId, 700);
  assert.deepEqual(repairs[0]?.skus, ["RT-30-MG"]);
});

test("an already available current lot is repaired when its catalog mapping is missing", () => {
  assert.equal(canAutomaticallyPublishCoa({
    ...coa,
    status: "Available",
    currentShippingLot: true,
    intakeAnalysis: null,
  }), true);
});

test("legacy variable COAs are separated by exact strength and receive independent current lots", () => {
  const legacy10 = {
    ...coa,
    id: "kpv-10",
    source: "wordpress_import",
    revision: 1,
    status: "Available",
    coaNumber: "KPV-10",
    productName: "KPV",
    familyName: "KPV",
    compound: "KPV",
    strength: "10mg",
    matchedProductId: 539,
    matchedVariationId: 0,
    skus: ["KPV"],
    currentShippingLot: true,
  } as unknown as CommerceCoa & { source: string; revision: number };
  const legacy30 = {
    ...legacy10,
    id: "kpv-30",
    coaNumber: "KPV-30",
    strength: "30 mg",
    currentShippingLot: false,
  };
  const kpv = { ...product, id: 539, name: "KPV", sku: "KPV", variationIds: [2846, 2847] };
  const kpvVariations = [
    { id: 2846, sku: "KPV-10-MG", attributes: [{ id: 1, name: "MG", option: "10 MG" }] },
    { id: 2847, sku: "KPV-30-MG", attributes: [{ id: 1, name: "MG", option: "30 MG" }] },
  ] as CommerceVariation[];

  const repairs = exactLegacyCoaCatalogRepairs(
    [legacy10, legacy30],
    [kpv],
    new Map([[539, kpvVariations]]),
  );

  assert.deepEqual(repairs.map((repair) => ({
    id: repair.coa.id,
    variationId: repair.variationId,
    current: repair.currentShippingLot,
    skus: repair.skus,
  })), [
    { id: "kpv-10", variationId: 2846, current: true, skus: ["KPV", "KPV-10-MG"] },
    { id: "kpv-30", variationId: 2847, current: true, skus: ["KPV", "KPV-30-MG"] },
  ]);
});

test("legacy catalog repair appends the exact live SKU without replacing history", () => {
  const deadpool = {
    ...coa,
    id: "deadpool",
    source: "wordpress_import",
    revision: 1,
    status: "Available",
    productName: "Deadpool",
    familyName: "Deadpool",
    compound: "Deadpool",
    matchedProductId: 1783,
    matchedVariationId: 0,
    skus: ["CARTALAX-AND-BPC-AND-TB500-BLEND"],
    currentShippingLot: true,
  } as unknown as CommerceCoa & { source: string; revision: number };
  const catalog = { ...product, id: 1783, name: "Deadpool", sku: "DEADPOOL", type: "simple" };

  const repairs = exactLegacyCoaCatalogRepairs([deadpool], [catalog], new Map());

  assert.deepEqual(repairs[0]?.skus, ["CARTALAX-AND-BPC-AND-TB500-BLEND", "DEADPOOL"]);
  assert.equal(repairs[0]?.currentShippingLot, true);
});

test("legacy current-lot promotion stays closed for ambiguous or previously edited history", () => {
  const base = {
    ...coa,
    source: "wordpress_import",
    revision: 2,
    status: "Available",
    productName: "KPV",
    familyName: "KPV",
    compound: "KPV",
    strength: "30mg",
    matchedProductId: 539,
    matchedVariationId: 2847,
    skus: ["KPV", "KPV-30-MG"],
    currentShippingLot: false,
  } as unknown as CommerceCoa & { source: string; revision: number };
  const kpv = { ...product, id: 539, name: "KPV", sku: "KPV", variationIds: [2847] };
  const variation = {
    id: 2847,
    sku: "KPV-30-MG",
    attributes: [{ id: 1, name: "MG", option: "30 MG" }],
  } as CommerceVariation;

  assert.deepEqual(exactLegacyCoaCatalogRepairs([base], [kpv], new Map([[539, [variation]]])), []);
  assert.deepEqual(exactLegacyCoaCatalogRepairs([
    { ...base, id: "a", revision: 1 },
    { ...base, id: "b", revision: 1 },
  ], [kpv], new Map([[539, [variation]]])), []);
});
