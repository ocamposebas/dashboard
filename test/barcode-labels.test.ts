import assert from "node:assert/strict";
import test from "node:test";

import {
  BarcodeLabelError,
  BarcodeLabelService,
} from "../src/server/barcodeLabels.js";

const service = new BarcodeLabelService("test-barcode-signing-secret-at-least-32-characters");

test("barcode identifiers are short, deterministic and entity-specific", () => {
  const product = service.identifierFor({
    type: "product",
    productId: 101,
    variationId: 0,
  });
  assert.equal(product, service.identifierFor({
    type: "product",
    productId: 101,
    variationId: 0,
  }));
  assert.match(product, /^11[0-9]{18}$/);

  const variation = service.identifierFor({
    type: "variation",
    productId: 101,
    variationId: 202,
  });
  const batch = service.identifierFor({
    type: "batch",
    productId: 101,
    variationId: 202,
    coaId: "coa-55",
    lot: "LOT-2026-10",
  });
  assert.notEqual(product, variation);
  assert.notEqual(variation, batch);
  assert.match(variation, /^12[0-9]{18}$/);
  assert.match(batch, /^13[0-9]{18}$/);
});

test("invalid entity combinations and unregistered identifier shapes are rejected", () => {
  assert.throws(
    () => service.identifierFor({ type: "variation", productId: 101, variationId: 0 }),
    /Variation labels require a variation id/,
  );
  assert.throws(
    () => service.identifierFor({ type: "batch", productId: 101, variationId: 0 }),
    /COA id is invalid/,
  );
  assert.throws(
    () => service.createLabel({
      type: "product",
      productId: 101,
      barcodeValue: "12999999999999999999",
      productName: "Product",
      sku: "SKU",
      locationCode: "A-01",
    }),
    (error: unknown) => error instanceof BarcodeLabelError && error.code === "invalid_input",
  );
});

test("Code 128 label artwork is valid SVG and reprints identically", () => {
  const input = {
    type: "batch" as const,
    productId: 101,
    variationId: 202,
    coaId: "coa-55",
    lot: "LOT-2026-10",
    productName: "Research Product",
    variantName: "10 mg",
    sku: "RP-10",
    locationCode: "A-01",
    coaNumber: "COA-55",
    size: "2x1" as const,
    copies: 2,
  };
  const first = service.createLabel(input);
  const second = service.createLabel(input);
  assert.equal(first.token, second.token);
  assert.equal(first.svg, second.svg);
  assert.match(first.svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(first.svg, /<path/);
  assert.match(first.token, /^13[0-9]{18}$/);
  const artworkWidth = Number(first.svg.match(/viewBox="0 0 (\d+) /)?.[1]);
  assert.ok(artworkWidth > 0 && artworkWidth < 600, "2×1 output must preserve scannable bar width");
  assert.equal(first.layout.copies, 2);
  assert.equal(first.payload.type, "batch");
});
