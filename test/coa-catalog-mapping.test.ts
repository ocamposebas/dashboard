import assert from "node:assert/strict";
import test from "node:test";

import {
  coaNeedsExactVariation,
  suggestedCoaVariationId,
} from "../src/shared/coaCatalogMapping.js";

const variations = [
  { id: 3010, attributes: [{ option: "30 mg" }] },
  { id: 3060, attributes: [{ option: "60MG" }] },
];

test("a detected 60 mg COA selects only the 60 mg catalog presentation", () => {
  assert.equal(suggestedCoaVariationId(variations, "PL-TZ 60mg"), 3060);
  assert.equal(suggestedCoaVariationId(variations, "30 mg"), 3010);
});

test("an existing exact COA mapping is preserved and ambiguous strengths stay unselected", () => {
  assert.equal(suggestedCoaVariationId(variations, "60 mg", 3010), 3010);
  assert.equal(suggestedCoaVariationId([
    ...variations,
    { id: 4060, attributes: [{ option: "60 mg premium" }] },
  ], "60 mg"), 0);
});

test("available variable-product COAs require an exact variation", () => {
  assert.equal(coaNeedsExactVariation("variable", "Available", 0), true);
  assert.equal(coaNeedsExactVariation("variable", "Review", 0), false);
  assert.equal(coaNeedsExactVariation("variable", "Available", 3060), false);
  assert.equal(coaNeedsExactVariation("simple", "Available", 0), false);
});
