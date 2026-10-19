import { createHmac, timingSafeEqual } from "node:crypto";

const AFFILIATE_COOKIE = "phaseone_affiliate_session";

export interface AffiliateSession {
  sub: string;
  email: string;
  authVersion: number;
  exp: number;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(`affiliate:${value}`).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function createAffiliateSessionCookie(input: {
  affiliateId: string;
  email: string;
  authVersion: number;
  sessionSecret: string;
  cookieSecure: boolean;
  ttlMs?: number;
}): string {
  const ttlMs = input.ttlMs || 7 * 24 * 60 * 60 * 1_000;
  const payload: AffiliateSession = {
    sub: input.affiliateId,
    email: input.email,
    authVersion: input.authVersion,
    exp: Date.now() + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secure = input.cookieSecure ? "; Secure" : "";
  return `${AFFILIATE_COOKIE}=${encoded}.${sign(encoded, input.sessionSecret)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1_000)}${secure}`;
}

export function clearAffiliateSessionCookie(cookieSecure: boolean): string {
  return `${AFFILIATE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecure ? "; Secure" : ""}`;
}

export function readAffiliateSession(cookieHeader: string | undefined, sessionSecret: string): AffiliateSession | null {
  const token = cookieValue(cookieHeader, AFFILIATE_COOKIE);
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  if (!equal(token.slice(separator + 1), sign(encoded, sessionSecret))) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<AffiliateSession>;
    if (
      typeof value.sub !== "string" || !value.sub ||
      typeof value.email !== "string" || !value.email ||
      !Number.isSafeInteger(value.authVersion) || Number(value.authVersion) <= 0 ||
      typeof value.exp !== "number" || value.exp <= Date.now()
    ) return null;
    return value as AffiliateSession;
  } catch {
    return null;
  }
}
