import {
  DEFAULT_ANALYTICS_TIME_ZONE,
  validateTimeZone,
} from "./analyticsDate.js";

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
  monitorUsername: string;
  monitorPasswordHash: string;
  sessionSecret: string;
  analyticsHmacSecret: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  analyticsTimeZone: string;
  wooCommerce?: {
    baseUrl: string;
    consumerKey: string;
    consumerSecret: string;
    syncIntervalMs: number;
    backfillDays: number;
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

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  return url.origin;
}

function loadWooCommerceConfig(): AppConfig["wooCommerce"] {
  const baseUrl = process.env.WOOCOMMERCE_URL?.trim() || "";
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY?.trim() || "";
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET?.trim() || "";
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

  return {
    baseUrl: parsedUrl.toString().replace(/\/$/, ""),
    consumerKey,
    consumerSecret,
    syncIntervalMs:
      parsePositiveInt("WOOCOMMERCE_SYNC_INTERVAL_SECONDS", 60) * 1_000,
    backfillDays: parsePositiveInt("WOOCOMMERCE_BACKFILL_DAYS", 400),
  };
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

  return {
    nodeEnv,
    port: parsePositiveInt("PORT", 8080),
    redisUrl: process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    redisKeyPrefix:
      process.env.REDIS_KEY_PREFIX?.trim() || "phaseone:live",
    presenceTtlMs: parsePositiveInt("PRESENCE_TTL_SECONDS", 45) * 1_000,
    trackerOrigins: new Set(trackerOriginValues),
    dashboardOrigin,
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
    ...(wooCommerce ? { wooCommerce } : {}),
  };
}
