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
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; overflow-x: hidden; padding: 32px; background: radial-gradient(circle at 18% 5%, rgba(11,111,255,.28), transparent 32%), radial-gradient(circle at 92% 92%, rgba(0,57,163,.22), transparent 34%), #020817; color: #f4f8ff; }
    body::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .18; background-image: linear-gradient(rgba(89,145,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(89,145,255,.16) 1px, transparent 1px); background-size: 70px 70px; mask-image: linear-gradient(to bottom, black, transparent 80%); }
    main { position: relative; width: min(100%, 1080px); }
    .brand { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px; color: #f5f9ff; font-size: 12px; font-weight: 820; letter-spacing: .23em; text-transform: uppercase; }
    .brand span { color: #6685ba; font: 600 9px/1.4 ui-monospace, monospace; letter-spacing: .15em; }
    .access-shell { display: grid; grid-template-columns: 1.2fr .8fr; overflow: hidden; border: 1px solid rgba(87,143,240,.28); border-radius: 24px; background: rgba(4,15,37,.88); box-shadow: 0 45px 120px rgba(0,24,78,.55), inset 0 1px rgba(255,255,255,.04); backdrop-filter: blur(20px); }
    .story { position: relative; min-height: 570px; display: flex; flex-direction: column; justify-content: space-between; padding: 54px; overflow: hidden; background: linear-gradient(145deg, rgba(8,92,211,.97), rgba(4,37,102,.96)); }
    .story::after { content: "01"; position: absolute; right: -22px; bottom: -72px; color: rgba(255,255,255,.055); font-size: 310px; font-weight: 800; line-height: 1; letter-spacing: -.12em; }
    .status { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 9px; color: #cce4ff; font: 650 9px/1 monospace; letter-spacing: .14em; text-transform: uppercase; }
    .status i { width: 7px; height: 7px; border-radius: 50%; background: #79c3ff; box-shadow: 0 0 0 5px rgba(121,195,255,.12), 0 0 22px #57afff; }
    .story-copy { position: relative; z-index: 1; }
    .story h1 { max-width: 570px; margin: 0; font-size: clamp(46px, 6vw, 78px); font-weight: 630; line-height: .9; letter-spacing: -.065em; }
    .story p { max-width: 430px; margin: 24px 0 0; color: #b7d5fb; font-size: 13px; line-height: 1.7; }
    .login-panel { display: flex; flex-direction: column; justify-content: center; padding: 46px; }
    .panel-label { margin: 0 0 10px; color: #4f75ae; font: 650 9px/1 monospace; letter-spacing: .15em; text-transform: uppercase; }
    h2 { margin: 0 0 8px; font-size: 28px; letter-spacing: -.045em; }
    .intro { margin: 0 0 27px; color: #718bb6; font-size: 12px; line-height: 1.55; }
    label { display: block; margin: 16px 0 8px; color: #9db1d1; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    input { width: 100%; min-height: 49px; border: 1px solid rgba(88,128,194,.28); border-radius: 10px; outline: 0; background: rgba(1,8,23,.72); padding: 0 14px; color: #fff; font: inherit; transition: border-color .2s, box-shadow .2s; }
    input:focus { border-color: #268cff; box-shadow: 0 0 0 4px rgba(26,126,255,.11), 0 0 30px rgba(0,102,255,.08); }
    button, .shop-link { width: 100%; min-height: 49px; display: flex; align-items: center; justify-content: center; border-radius: 10px; font: 780 10px/1 inherit; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; transition: transform .2s, background .2s, border-color .2s; }
    button { margin-top: 24px; border: 1px solid #4ba5ff; background: linear-gradient(135deg, #1684ff, #0757c6); color: #fff; box-shadow: 0 14px 35px rgba(0,91,218,.25); }
    button:hover, .shop-link:hover { transform: translateY(-2px); }
    button:hover { background: linear-gradient(135deg, #3295ff, #0962dd); }
    .divider { display: flex; align-items: center; gap: 12px; margin: 24px 0; color: #38547e; font: 600 8px/1 monospace; letter-spacing: .14em; text-transform: uppercase; }
    .divider::before, .divider::after { content: ""; height: 1px; flex: 1; background: rgba(73,111,173,.22); }
    .shop-link { border: 1px solid rgba(89,139,220,.3); color: #9fc8ff; text-decoration: none; background: rgba(9,34,75,.5); }
    .shop-link:hover { border-color: #318df2; background: rgba(13,54,116,.7); color: #fff; }
    .error { margin: 0 0 12px; border: 1px solid rgba(255,104,104,.25); border-radius: 9px; background: rgba(128,25,35,.13); padding: 11px; color: #ffaaaa; font-size: 11px; }
    .secure { margin: 20px 0 0; color: #38547e; font: 500 8px/1.5 ui-monospace, monospace; text-align: center; letter-spacing: .08em; text-transform: uppercase; }
    @media (max-width: 760px) { body { padding: 18px; } .brand span { display: none; } .access-shell { grid-template-columns: 1fr; } .story { min-height: 260px; padding: 34px 28px; } .story h1 { font-size: 45px; } .story p { margin-top: 16px; } .login-panel { padding: 34px 28px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand">Phase One <span>Private intelligence network / 2026</span></div>
    <div class="access-shell">
      <section class="story">
        <div class="status"><i></i> Systems online</div>
        <div class="story-copy"><h1>See the signal.<br />Lead the move.</h1><p>Live storefront intelligence for Phase One operators. Watch attention move through the catalog in real time.</p></div>
      </section>
      <section class="login-panel">
        <p class="panel-label">Authorized personnel</p>
        <h2>Welcome back.</h2>
        <p class="intro">Enter your credentials to open the command center.</p>
        <form method="post" action="/login">
          ${error}
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" required autofocus />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button type="submit">Enter live monitor →</button>
        </form>
        <div class="divider">or visit</div>
        <a class="shop-link" href="https://phaseonelabz.com/">Phase One Labz Shop ↗</a>
        <p class="secure">Protected session · encrypted transport</p>
      </section>
    </div>
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

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] || "" : value || "";
  return raw.split(",")[0]?.trim() || "";
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestOrigin(request: IncomingMessage, config: AppConfig): string | null {
  const host = config.trustProxy
    ? firstHeaderValue(request.headers["x-forwarded-host"]) || request.headers.host || ""
    : request.headers.host || "";
  const protocol = config.trustProxy
    ? firstHeaderValue(request.headers["x-forwarded-proto"]) ||
      (config.cookieSecure ? "https" : "http")
    : config.cookieSecure
      ? "https"
      : "http";

  return host ? normalizeOrigin(`${protocol}://${host}`) : null;
}

export function isLoginOriginAllowed(
  request: IncomingMessage,
  config: AppConfig,
): boolean {
  const fetchSite = firstHeaderValue(request.headers["sec-fetch-site"]);
  if (fetchSite === "cross-site") return false;

  const suppliedOrigin = firstHeaderValue(request.headers.origin);
  if (!suppliedOrigin) return fetchSite === "same-origin" || fetchSite === "none";

  const normalizedSuppliedOrigin = normalizeOrigin(suppliedOrigin);
  return (
    normalizedSuppliedOrigin === config.dashboardOrigin ||
    normalizedSuppliedOrigin === requestOrigin(request, config)
  );
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
