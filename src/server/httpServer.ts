import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearSessionCookie,
  createSessionCookie,
  verifyPassword,
  verifySessionCookie,
} from "./auth.js";
import type { AppConfig } from "./config.js";
import type { PresenceStore } from "./presenceStore.js";

const dashboardDirectory = fileURLToPath(
  new URL("../../dashboard/", import.meta.url),
);
const MAX_LOGIN_BODY_BYTES = 8_192;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

interface AttemptState {
  count: number;
  resetAt: number;
}

function securityHeaders(response: ServerResponse, nonce?: string): void {
  const styleSource = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'self'; style-src ${styleSource}; connect-src 'self' ws: wss:; img-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cache-Control", "no-store");
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { Location: location });
  response.end();
}

function loginHtml(nonce: string, invalid: boolean): string {
  const error = invalid
    ? '<p class="error" role="alert">The credentials were not accepted.</p>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Phase One — Live Monitor</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #07090c; color: #f3f4f1; }
    main { width: min(100%, 390px); }
    .brand { margin-bottom: 30px; color: #f3f4f1; font-size: 12px; font-weight: 760; letter-spacing: .21em; text-transform: uppercase; }
    .brand span { display: block; margin-top: 5px; color: #717680; font: 500 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .16em; }
    form { border: 1px solid #252930; border-radius: 14px; background: #0d1014; padding: 27px; box-shadow: 0 24px 70px rgba(0,0,0,.34); }
    h1 { margin: 0 0 7px; font-size: 22px; letter-spacing: -.035em; }
    .intro { margin: 0 0 24px; color: #8e949d; font-size: 13px; line-height: 1.55; }
    label { display: block; margin: 15px 0 7px; color: #aeb3ba; font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
    input { width: 100%; min-height: 46px; border: 1px solid #2b3038; border-radius: 8px; outline: 0; background: #080a0d; padding: 0 12px; color: #fff; font: inherit; }
    input:focus { border-color: #657568; box-shadow: 0 0 0 3px rgba(115, 139, 119, .12); }
    button { width: 100%; min-height: 46px; margin-top: 22px; border: 1px solid #bcc7bc; border-radius: 8px; background: #d8dfd7; color: #101411; font: 760 12px/1 inherit; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
    button:hover { background: #edf1ec; }
    .error { margin: 0 0 16px; border-left: 2px solid #c87b72; padding-left: 10px; color: #e3a59e; font-size: 12px; }
    .secure { margin-top: 16px; color: #555b63; font: 500 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; }
  </style>
</head>
<body>
  <main>
    <div class="brand">Phase One<span>Live monitor / private access</span></div>
    <form method="post" action="/login">
      <h1>Operator access</h1>
      <p class="intro">Enter your monitor credentials to open the live presence view.</p>
      ${error}
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Open monitor</button>
    </form>
    <p class="secure">Encrypted transport required in production</p>
  </main>
</body>
</html>`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_LOGIN_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-real-ip"];
    if (typeof forwarded === "string" && forwarded.length <= 64) return forwarded;
  }
  return request.socket.remoteAddress || "unknown";
}

export function createMonitorServer(config: AppConfig, store: PresenceStore) {
  const loginAttempts = new Map<string, AttemptState>();

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url || "/", config.dashboardOrigin);
      const nonce = randomBytes(16).toString("base64");
      securityHeaders(response, nonce);

      if (url.pathname === "/health" && request.method === "GET") {
        const redisHealthy = await store.ping().catch(() => false);
        response.statusCode = redisHealthy ? 200 : 503;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ status: redisHealthy ? "ok" : "degraded" }));
        return;
      }

      const authenticated = verifySessionCookie(request.headers.cookie, {
        username: config.monitorUsername,
        sessionSecret: config.sessionSecret,
      });

      if (url.pathname === "/login" && request.method === "GET") {
        if (authenticated) {
          redirect(response, "/");
          return;
        }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(loginHtml(nonce, url.searchParams.has("invalid")));
        return;
      }

      if (url.pathname === "/login" && request.method === "POST") {
        if (request.headers.origin !== config.dashboardOrigin) {
          response.statusCode = 403;
          response.end("Forbidden");
          return;
        }

        const ip = requestIp(request, config.trustProxy);
        const now = Date.now();
        const attempt = loginAttempts.get(ip);
        if (attempt && attempt.resetAt > now && attempt.count >= 8) {
          response.statusCode = 429;
          response.setHeader("Retry-After", String(Math.ceil((attempt.resetAt - now) / 1_000)));
          response.end("Too many attempts");
          return;
        }

        const form = new URLSearchParams(await readBody(request));
        const username = form.get("username") || "";
        const password = form.get("password") || "";
        const passwordMatches = await verifyPassword(
          password,
          config.monitorPasswordHash,
        ).catch(() => false);
        const valid = username === config.monitorUsername && passwordMatches;

        if (!valid) {
          const next =
            attempt && attempt.resetAt > now
              ? { ...attempt, count: attempt.count + 1 }
              : { count: 1, resetAt: now + 15 * 60_000 };
          loginAttempts.set(ip, next);
          redirect(response, "/login?invalid=1");
          return;
        }

        loginAttempts.delete(ip);
        response.setHeader(
          "Set-Cookie",
          createSessionCookie({
            username: config.monitorUsername,
            sessionSecret: config.sessionSecret,
            sessionTtlMs: config.sessionTtlMs,
            cookieSecure: config.cookieSecure,
          }),
        );
        redirect(response, "/");
        return;
      }

      if (url.pathname === "/logout" && request.method === "POST") {
        response.setHeader("Set-Cookie", clearSessionCookie(config.cookieSecure));
        redirect(response, "/login");
        return;
      }

      if (!authenticated) {
        redirect(response, "/login");
        return;
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end('{"authenticated":true}');
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET, HEAD");
        response.end();
        return;
      }

      const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filePath = resolve(dashboardDirectory, relativePath);
      const safeRoot = resolve(dashboardDirectory) + sep;
      if (!filePath.startsWith(safeRoot) || !existsSync(filePath)) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      response.setHeader(
        "Content-Type",
        CONTENT_TYPES[extname(filePath)] || "application/octet-stream",
      );
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
    })().catch((error: unknown) => {
      console.error("HTTP request failed", error);
      if (!response.headersSent) {
        securityHeaders(response);
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      response.end("Internal server error");
    });
  });
}
