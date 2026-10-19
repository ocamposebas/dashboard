import assert from "node:assert/strict";
import test from "node:test";
import type { PresenceStore } from "../src/server/presenceStore.js";
import { SearchConsoleGateway } from "../src/server/searchConsoleGateway.js";

test("Search Console authorization uses the read-only scope and protected callback state", () => {
  const gateway = new SearchConsoleGateway({
    clientId: "example-client.apps.googleusercontent.com",
    clientSecret: "example-secret",
    redirectUri: "http://localhost:8080/api/seo/callback",
  }, {} as PresenceStore, "a-stable-session-secret-that-is-longer-than-thirty-two-characters");

  const url = new URL(gateway.authorizationUrl("protected-state"));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/webmasters.readonly");
  assert.equal(url.searchParams.get("state"), "protected-state");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8080/api/seo/callback");
});

test("Search Console status exposes its callback without leaking credentials", async () => {
  const gateway = new SearchConsoleGateway({
    clientId: "example-client.apps.googleusercontent.com",
    clientSecret: "example-secret",
    redirectUri: "https://phaseonelabz.is/api/seo/callback",
  }, {
    getSeoConnection: async () => null,
  } as unknown as PresenceStore, "a-stable-session-secret-that-is-longer-than-thirty-two-characters");

  const status = await gateway.status();
  assert.equal(status.connected, false);
  assert.equal(status.callbackUrl, "https://phaseonelabz.is/api/seo/callback");
  assert.equal("clientSecret" in status, false);
});
