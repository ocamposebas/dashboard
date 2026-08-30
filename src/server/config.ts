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
  sessionTtlMs: number;
  cookieSecure: boolean;
  trustProxy: boolean;
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

  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
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
    monitorUsername: requireValue("MONITOR_USERNAME"),
    monitorPasswordHash: requireValue("MONITOR_PASSWORD_HASH"),
    sessionSecret,
    sessionTtlMs: parsePositiveInt("SESSION_TTL_HOURS", 12) * 60 * 60 * 1_000,
    cookieSecure:
      process.env.COOKIE_SECURE?.trim().toLowerCase() !== "false" &&
      nodeEnv === "production",
    trustProxy: process.env.TRUST_PROXY?.trim().toLowerCase() === "true",
  };
}
