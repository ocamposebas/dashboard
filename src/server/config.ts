import {
  DEFAULT_ANALYTICS_TIME_ZONE,
  validateTimeZone,
} from "./analyticsDate.js";
import type { DatabaseOptions } from "./database.js";
import type { ShipStationConfig } from "./shipStationGateway.js";

const DEFAULT_TRACKER_ORIGINS = [
  "https://phaseonelabz.com",
  "https://www.phaseonelabz.com",
];

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  redisUrl: string;
  redisKeyPrefix: string;
  presenceTtlMs: number;
  trackerOrigins: Set<string>;
  dashboardOrigin: string;
  coaPublicOrigin: string;
  monitorUsername: string;
  monitorPasswordHash: string;
  sessionSecret: string;
  analyticsHmacSecret: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  analyticsTimeZone: string;
  upstreamMonitor?: {
    baseUrl: string;
    username: string;
    password: string;
  };
  wooCommerce?: {
    baseUrl: string;
    consumerKey: string;
    consumerSecret: string;
    accessMode: "read_only" | "read_write";
    syncIntervalMs: number;
    backfillDays: number;
  };
  googleSearchConsole?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    preferredSiteUrl: string;
  };
  fulfillmentDatabase?: DatabaseOptions;
  barcodeSigningSecret?: string;
  affiliateServiceSecret?: string;
  evidenceStorage?: {
    path: string;
    encryptionSecret: string;
    notificationMode: "disabled" | "outbox";
  };
  shipStation: ShipStationConfig;
}

function loadUpstreamMonitorConfig(): AppConfig["upstreamMonitor"] {
  const baseUrl = process.env.UPSTREAM_MONITOR_URL?.trim() || "";
  const username = process.env.UPSTREAM_MONITOR_USERNAME?.trim() || "";
  const password = process.env.UPSTREAM_MONITOR_PASSWORD?.trim() || "";
  const supplied = [baseUrl, username, password].filter(Boolean).length;

  if (supplied === 0) return undefined;
  if (supplied !== 3) {
    throw new Error(
      "UPSTREAM_MONITOR_URL, UPSTREAM_MONITOR_USERNAME, and " +
        "UPSTREAM_MONITOR_PASSWORD must be set together",
    );
  }

  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("UPSTREAM_MONITOR_URL must use HTTPS");
  }

  return {
    baseUrl: parsedUrl.origin,
    username,
    password,
  };
}

function requireValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadFulfillmentDatabaseConfig(): DatabaseOptions | undefined {
  const connectionString = process.env.DATABASE_URL?.trim() || "";
  if (!connectionString) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }
  const sslValue = process.env.DATABASE_SSL?.trim().toLowerCase() || "false";
  if (sslValue !== "true" && sslValue !== "false") {
    throw new Error("DATABASE_SSL must be true or false");
  }
  return {
    connectionString,
    ssl: sslValue === "true",
    maxConnections: parsePositiveInt("DATABASE_POOL_MAX", 5),
    connectionTimeoutMs: parsePositiveInt("DATABASE_CONNECTION_TIMEOUT_MS", 5_000),
    idleTimeoutMs: parsePositiveInt("DATABASE_IDLE_TIMEOUT_MS", 30_000),
  };
}

export function loadBarcodeSigningSecret(): string | undefined {
  const secret = process.env.BARCODE_SIGNING_SECRET?.trim() || "";
  if (!secret) return undefined;
  if (secret.length < 32) {
    throw new Error("BARCODE_SIGNING_SECRET must contain at least 32 characters");
  }
  return secret;
}

export function loadAffiliateServiceSecret(): string | undefined {
  const secret = process.env.AFFILIATE_SERVICE_SECRET?.trim() || "";
  if (!secret) return undefined;
  if (secret.length < 32) {
    throw new Error("AFFILIATE_SERVICE_SECRET must contain at least 32 characters");
  }
  return secret;
}

export function loadEvidenceStorageConfig(): AppConfig["evidenceStorage"] {
  const path = process.env.EVIDENCE_STORAGE_PATH?.trim() || "";
  const encryptionSecret = process.env.EVIDENCE_ENCRYPTION_SECRET?.trim() || "";
  const supplied = [path, encryptionSecret].filter(Boolean).length;
  if (supplied === 0) return undefined;
  if (supplied !== 2) {
    throw new Error("EVIDENCE_STORAGE_PATH and EVIDENCE_ENCRYPTION_SECRET must be set together");
  }
  if (encryptionSecret.length < 32) {
    throw new Error("EVIDENCE_ENCRYPTION_SECRET must contain at least 32 characters");
  }
  const notificationMode = process.env.EVIDENCE_NOTIFICATION_MODE?.trim().toLowerCase() || "disabled";
  if (notificationMode !== "disabled" && notificationMode !== "outbox") {
    throw new Error("EVIDENCE_NOTIFICATION_MODE must be disabled or outbox");
  }
  return { path, encryptionSecret, notificationMode };
}

export function loadShipStationConfig(): ShipStationConfig {
  const apiKey = process.env.SHIPSTATION_API_KEY?.trim() || "";
  const rateMode = process.env.SHIPSTATION_RATE_MODE?.trim().toLowerCase() || "live";
  const warehouseId = process.env.SHIPSTATION_WAREHOUSE_ID?.trim() || "";
  const labelPurchaseRaw = process.env.SHIPSTATION_LABEL_PURCHASE_ENABLED?.trim().toLowerCase() || "false";
  if (rateMode !== "live" && rateMode !== "mock") {
    throw new Error("SHIPSTATION_RATE_MODE must be live or mock");
  }
  if (apiKey && (apiKey.length > 512 || /\s/.test(apiKey))) {
    throw new Error("SHIPSTATION_API_KEY has an invalid format");
  }
  if (warehouseId && (warehouseId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(warehouseId))) {
    throw new Error("SHIPSTATION_WAREHOUSE_ID has an invalid format");
  }
  if (labelPurchaseRaw !== "true" && labelPurchaseRaw !== "false") {
    throw new Error("SHIPSTATION_LABEL_PURCHASE_ENABLED must be true or false");
  }
  return {
    rateMode,
    labelPurchaseEnabled: labelPurchaseRaw === "true",
    ...(apiKey ? { apiKey } : {}),
    ...(warehouseId ? { warehouseId } : {}),
  };
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}

function loadWooCommerceConfig(): AppConfig["wooCommerce"] {
  const baseUrl = process.env.WOOCOMMERCE_URL?.trim() || "";
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY?.trim() || "";
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET?.trim() || "";
  const accessModeRaw = process.env.WOOCOMMERCE_ACCESS_MODE?.trim() || "read_only";
  const supplied = [baseUrl, consumerKey, consumerSecret].filter(Boolean).length;

  if (supplied === 0) return undefined;
  if (supplied !== 3) {
    throw new Error(
      "WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, and " +
        "WOOCOMMERCE_CONSUMER_SECRET must be set together",
    );
  }

  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost") {
    throw new Error("WOOCOMMERCE_URL must use HTTPS");
  }
  if (accessModeRaw !== "read_only" && accessModeRaw !== "read_write") {
    throw new Error("WOOCOMMERCE_ACCESS_MODE must be read_only or read_write");
  }

  return {
    baseUrl: parsedUrl.toString().replace(/\/$/, ""),
    consumerKey,
    consumerSecret,
    accessMode: accessModeRaw,
    syncIntervalMs:
      parsePositiveInt("WOOCOMMERCE_SYNC_INTERVAL_SECONDS", 15) * 1_000,
    backfillDays: parsePositiveInt("WOOCOMMERCE_BACKFILL_DAYS", 400),
  };
}

function loadGoogleSearchConsoleConfig(dashboardOrigin: string): AppConfig["googleSearchConsole"] {
  const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI?.trim() || `${dashboardOrigin}/api/seo/callback`;
  const preferredSiteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim() || "";
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_SEARCH_CONSOLE_CLIENT_ID and GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET must be set together");
  }
  const parsedRedirect = new URL(redirectUri);
  if (parsedRedirect.protocol !== "https:" && parsedRedirect.hostname !== "localhost") {
    throw new Error("GOOGLE_SEARCH_CONSOLE_REDIRECT_URI must use HTTPS outside localhost");
  }
  return { clientId, clientSecret, redirectUri: parsedRedirect.toString(), preferredSiteUrl };
}

export function loadConfig(): AppConfig {
  const nodeEnvRaw = process.env.NODE_ENV?.trim() || "development";
  const nodeEnv =
    nodeEnvRaw === "production" || nodeEnvRaw === "test"
      ? nodeEnvRaw
      : "development";
  const dashboardOrigin = normalizeOrigin(
    process.env.DASHBOARD_ORIGIN?.trim() || "http://localhost:8080",
  );
  const coaPublicOrigin = normalizeOrigin(
    process.env.COA_PUBLIC_ORIGIN?.trim() || dashboardOrigin,
  );
  const trackerOriginValues = (
    process.env.TRACKER_ORIGINS || DEFAULT_TRACKER_ORIGINS.join(",")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeOrigin);
  const sessionSecret = requireValue("SESSION_SECRET");
  const analyticsHmacSecret = requireValue("ANALYTICS_HMAC_SECRET");

  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  if (analyticsHmacSecret.length < 32) {
    throw new Error("ANALYTICS_HMAC_SECRET must contain at least 32 characters");
  }
  const wooCommerce = loadWooCommerceConfig();
  const upstreamMonitor = loadUpstreamMonitorConfig();
  const googleSearchConsole = loadGoogleSearchConsoleConfig(dashboardOrigin);
  const fulfillmentDatabase = loadFulfillmentDatabaseConfig();
  const barcodeSigningSecret = loadBarcodeSigningSecret();
  const affiliateServiceSecret = loadAffiliateServiceSecret();
  const evidenceStorage = loadEvidenceStorageConfig();
  const shipStation = loadShipStationConfig();
  if (evidenceStorage?.notificationMode === "outbox" && !wooCommerce) {
    throw new Error("EVIDENCE_NOTIFICATION_MODE=outbox requires a configured WordPress connection");
  }

  return {
    nodeEnv,
    port: parsePositiveInt("PORT", 8080),
    redisUrl: process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    redisKeyPrefix:
      process.env.REDIS_KEY_PREFIX?.trim() || "phaseone:live",
    presenceTtlMs: parsePositiveInt("PRESENCE_TTL_SECONDS", 45) * 1_000,
    trackerOrigins: new Set(trackerOriginValues),
    dashboardOrigin,
    coaPublicOrigin,
    monitorUsername: requireValue("MONITOR_USERNAME"),
    monitorPasswordHash: requireValue("MONITOR_PASSWORD_HASH"),
    sessionSecret,
    analyticsHmacSecret,
    sessionTtlMs: parsePositiveInt("SESSION_TTL_HOURS", 12) * 60 * 60 * 1_000,
    cookieSecure:
      process.env.COOKIE_SECURE?.trim().toLowerCase() !== "false" &&
      nodeEnv === "production",
    trustProxy: process.env.TRUST_PROXY?.trim().toLowerCase() === "true",
    analyticsTimeZone: validateTimeZone(
      process.env.ANALYTICS_TIME_ZONE?.trim() || DEFAULT_ANALYTICS_TIME_ZONE,
    ),
    ...(upstreamMonitor ? { upstreamMonitor } : {}),
    ...(wooCommerce ? { wooCommerce } : {}),
    ...(googleSearchConsole ? { googleSearchConsole } : {}),
    ...(fulfillmentDatabase ? { fulfillmentDatabase } : {}),
    ...(barcodeSigningSecret ? { barcodeSigningSecret } : {}),
    ...(affiliateServiceSecret ? { affiliateServiceSecret } : {}),
    ...(evidenceStorage ? { evidenceStorage } : {}),
    shipStation,
  };
}
