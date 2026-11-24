import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewTokenId } from "../src/server/customerReviews.js";

test("existing invitation links still authenticate only the intended action", () => {
  const id = "cf6af2c5-805f-4044-9e3a-46849afb061d";
  const secret = "test-only-customer-review-signing-key";
  const token = "cf6af2c5-805f-4044-9e3a-46849afb061d.hk1CkxmmDNfKK9IOcaSSf7WhFnXS0cJHZMNx4fSw1PU";

  assert.equal(reviewTokenId(token, secret, "review"), id);
  assert.equal(reviewTokenId(token, secret, "unsubscribe"), null);
  assert.equal(reviewTokenId(token, "another-test-only-key", "review"), null);
  assert.equal(reviewTokenId(`8${token.slice(1)}`, secret, "review"), null);
});
