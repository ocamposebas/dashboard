import assert from "node:assert/strict";
import test from "node:test";

import {
  canAutomaticallyPublishCoa,
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
      dateDetection: { confidence: "fallback" },
    },
  }), false);
});

test("one published product wins over stale draft or trashed duplicates", () => {
  const draft = { ...product, id: 700, status: "draft" };
  const trashed = { ...product, id: 701, status: "trash" };
  assert.equal(exactAutomaticCoaProduct(coa, [draft, trashed, product])?.id, 533);
});

test("an already available current lot is repaired when its catalog mapping is missing", () => {
  assert.equal(canAutomaticallyPublishCoa({
    ...coa,
    status: "Available",
    currentShippingLot: true,
    intakeAnalysis: null,
  }), true);
});
