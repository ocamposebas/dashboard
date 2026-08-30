import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESENCE_SECTIONS,
  emptyPresenceCounts,
  isPresenceSection,
} from "../src/shared/protocol.js";

test("presence protocol exposes the six expected sections", () => {
  assert.deepEqual(PRESENCE_SECTIONS, [
    "HOME",
    "SHOP",
    "PRODUCT",
    "CART",
    "CHECKOUT",
    "OTHER",
  ]);
  assert.deepEqual(Object.keys(emptyPresenceCounts()), PRESENCE_SECTIONS);
  assert.equal(isPresenceSection("CHECKOUT"), true);
  assert.equal(isPresenceSection("ACCOUNT"), false);
});
