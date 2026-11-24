import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewLink, reviewTokenId } from "../src/server/customerReviews.js";

test("an invitation opens the storefront and authenticates only the intended action", () => {
  const id = "cf6af2c5-805f-4044-9e3a-46849afb061d";
  const secret = "test-only-customer-review-signing-key";
  const url = reviewLink(id, secret, "review");
  const token = new URLSearchParams(url.hash.slice(1)).get("review");

  assert.equal(url.origin + url.pathname, "https://phaseonelabz.com/review/");
  assert.equal(url.search, "");
  assert.equal(reviewTokenId(token, secret, "review"), id);
  assert.equal(reviewTokenId(token, secret, "unsubscribe"), null);
  assert.equal(reviewTokenId(token, "another-test-only-key", "review"), null);
  assert.equal(reviewTokenId(`8${token?.slice(1)}`, secret, "review"), null);
});
