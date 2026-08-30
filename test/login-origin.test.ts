import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import type { AppConfig } from "../src/server/config.js";
import { isLoginOriginAllowed } from "../src/server/httpServer.js";

const config = {
  dashboardOrigin: "https://monitor.phaseonelabz.com",
  cookieSecure: true,
  trustProxy: true,
} as AppConfig;

function request(headers: IncomingMessage["headers"]): IncomingMessage {
  return { headers } as IncomingMessage;
}

test("accepts the configured dashboard origin", () => {
  assert.equal(
    isLoginOriginAllowed(
      request({ origin: "https://monitor.phaseonelabz.com", "sec-fetch-site": "same-origin" }),
      config,
    ),
    true,
  );
});

test("accepts the public origin reported by a trusted Coolify proxy", () => {
  assert.equal(
    isLoginOriginAllowed(
      request({
        origin: "https://generated.example.com",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "generated.example.com",
        "x-forwarded-proto": "https",
      }),
      config,
    ),
    true,
  );
});

test("rejects cross-site login posts", () => {
  assert.equal(
    isLoginOriginAllowed(
      request({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" }),
      config,
    ),
    false,
  );
});
