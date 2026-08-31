import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionCookie,
  hashPassword,
  parseScryptHash,
  verifyPassword,
  verifySessionCookie,
} from "../src/server/auth.js";

test("scrypt password hashes verify without exposing the password", async () => {
  const password = "correct horse battery monitor";
  const hash = await hashPassword(password);

  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.equal(hash.includes(password), false);
  assert.equal(parseScryptHash(hash).cost, 32_768);

  const portableHash = `b64:${Buffer.from(hash).toString("base64url")}`;
  assert.equal(await verifyPassword(password, portableHash), true);
  assert.equal(await verifyPassword("wrong password", portableHash), false);
});

test("signed session cookies reject tampering", () => {
  const options = {
    username: "operator",
    sessionSecret: "a-secret-that-is-deliberately-longer-than-32-characters",
    sessionTtlMs: 60_000,
    cookieSecure: true,
  };
  const setCookie = createSessionCookie(options);
  const cookieHeader = setCookie.split(";")[0];

  assert.equal(verifySessionCookie(cookieHeader, options), true);
  assert.equal(verifySessionCookie(`${cookieHeader}x`, options), false);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
});
