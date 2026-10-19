import assert from "node:assert/strict";
import test from "node:test";

import type { BarcodeLabel } from "../src/shared/barcodeFulfillment.js";
import {
  buildThermalLabelDocument,
  normalizeThermalLabelLayout,
} from "../src/shared/labelPrint.js";

test("thermal layouts use exact standard dimensions and bounded copies", () => {
  assert.deepEqual(normalizeThermalLabelLayout("2x1", 2), {
    size: "2x1",
    widthInches: 2,
    heightInches: 1,
    barcodeHeightMillimeters: 7,
    copies: 2,
  });
  assert.deepEqual(normalizeThermalLabelLayout("3x1", 999), {
    size: "3x1",
    widthInches: 3,
    heightInches: 1,
    barcodeHeightMillimeters: 8,
    copies: 50,
  });
  assert.equal(normalizeThermalLabelLayout("unknown", 0).copies, 1);
});

test("print documents repeat labels and declare exact page dimensions", () => {
  const label: BarcodeLabel = {
    token: "P1B1.payload.signature",
    svg: '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v40z" /></svg>',
    payload: { version: 1, type: "batch", productId: 1, variationId: 0, coaId: "coa", lot: "LOT-1" },
    productName: "Product <One>",
    variantName: "",
    sku: "SKU-1",
    locationCode: "A-01",
    coaNumber: "COA-1",
    lot: "LOT-1",
    layout: normalizeThermalLabelLayout("3x1", 3),
  };
  const document = buildThermalLabelDocument(label, "test-print-nonce");
  assert.match(document, /@page \{ size: 3in 1in; margin: 0; \}/);
  assert.match(document, /<style nonce="test-print-nonce">/);
  assert.equal((document.match(/<section class="label">/g) || []).length, 3);
  assert.match(document, /Product &lt;One&gt;/);
  assert.doesNotMatch(document, /Product <One>/);
  assert.match(document, />P1B1\.payload\.signature<\/small>/);
});

test("print documents reject active or malformed SVG content", () => {
  const base: BarcodeLabel = {
    token: "token",
    svg: "<svg><script>alert(1)</script></svg>",
    payload: { version: 1, type: "product", productId: 1, variationId: 0 },
    productName: "Product",
    variantName: "",
    sku: "SKU",
    locationCode: "A-01",
    coaNumber: "",
    lot: "",
    layout: normalizeThermalLabelLayout("2x1", 1),
  };
  assert.throws(() => buildThermalLabelDocument(base), /safe SVG/);
});
