import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeLocationCode,
  ProductLocationError,
} from "../src/server/productLocationRepository.js";

test("warehouse locations normalize simple aisle and shelf identifiers", () => {
  assert.equal(normalizeLocationCode(" a-01 "), "A-01");
  assert.equal(normalizeLocationCode("rack2-105"), "RACK2-105");
});

test("warehouse locations reject ambiguous or unsafe identifiers", () => {
  for (const value of ["A1", "A-1", "A 01", "../A-01", "A-0000", "-01"]) {
    assert.throws(
      () => normalizeLocationCode(value),
      (error: unknown) => error instanceof ProductLocationError &&
        error.code === "invalid_input",
    );
  }
});
