import assert from "node:assert/strict";
import test from "node:test";

import { LoginAttemptThrottle } from "../src/server/loginAttemptThrottle.js";

test("repeated wrong credentials throttle only the same user and IP", () => {
  const throttle = new LoginAttemptThrottle(2, 60_000, 10_000);
  const now = 1_000;
  assert.equal(throttle.recordFailure("203.0.113.8", "admin", now).allowed, true);
  assert.equal(throttle.recordFailure("203.0.113.8", "admin", now + 1).allowed, true);
  assert.equal(throttle.beforeAttempt("203.0.113.8", "admin", now + 2).allowed, true);
  assert.equal(throttle.recordFailure("203.0.113.8", "admin", now + 2).allowed, false);
  assert.equal(throttle.beforeAttempt("203.0.113.8", "admin", now + 3).allowed, false);
  assert.equal(throttle.beforeAttempt("203.0.113.8", "another-user", now + 3).allowed, true);
  assert.equal(throttle.beforeAttempt("198.51.100.4", "admin", now + 3).allowed, true);
});

test("a throttled account gets a safe verification slot and clears immediately on success", () => {
  const throttle = new LoginAttemptThrottle(1, 60_000, 10_000);
  const now = 20_000;
  throttle.recordFailure("203.0.113.8", "admin", now);
  throttle.recordFailure("203.0.113.8", "admin", now + 1);
  assert.equal(throttle.beforeAttempt("203.0.113.8", "admin", now + 5_000).allowed, false);
  assert.equal(throttle.beforeAttempt("203.0.113.8", "admin", now + 10_001).allowed, true);
  throttle.clear("203.0.113.8", "admin");
  assert.equal(throttle.beforeAttempt("203.0.113.8", "admin", now + 10_002).allowed, true);
});

test("expired failures are discarded", () => {
  const throttle = new LoginAttemptThrottle(1, 1_000, 10_000);
  throttle.recordFailure("203.0.113.8", "admin", 1_000);
  throttle.recordFailure("203.0.113.8", "admin", 1_001);
  assert.equal(throttle.beforeAttempt("203.0.113.8", "admin", 2_001).allowed, true);
});
