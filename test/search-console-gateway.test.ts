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

test("Search Console scopes the connection to the configured Phase One Labz property", async (context) => {
  let encryptedConnection = "";
  const store = {
    saveSeoConnection: async (value: string) => { encryptedConnection = value; },
    getSeoConnection: async () => encryptedConnection || null,
  } as unknown as PresenceStore;
  const gateway = new SearchConsoleGateway({
    clientId: "example-client.apps.googleusercontent.com",
    clientSecret: "example-secret",
    redirectUri: "https://phaseonelabz.is/api/seo/callback",
    preferredSiteUrl: "sc-domain:phaseonelabz.com",
  }, store, "a-stable-session-secret-that-is-longer-than-thirty-two-characters");

  context.mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const url = String(args[0]);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("googleapis.com/webmasters/v3/sites")) {
      return new Response(JSON.stringify({ siteEntry: [
        { siteUrl: "sc-domain:labcorepep.com", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:phaseonelabz.com", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:coreaminosresearch.com", permissionLevel: "siteOwner" },
      ] }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  });

  await gateway.exchangeCode("authorization-code");
  const status = await gateway.status();
  assert.equal(status.connected, true);
  assert.equal(status.siteUrl, "sc-domain:phaseonelabz.com");
  assert.deepEqual(status.sites.map((site) => site.siteUrl), ["sc-domain:phaseonelabz.com"]);
  await assert.rejects(() => gateway.selectSite("sc-domain:labcorepep.com"), /Unknown Search Console property/);
});
