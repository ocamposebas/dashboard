import { createHmac, timingSafeEqual } from "node:crypto";

import type { ShippingDataMode, ShippingPackageInput } from "../shared/shipping.js";
import type { ShipStationRate } from "./shipStationGateway.js";

const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 8_192;

export interface ShippingQuoteClaims {
  version: 1;
  fulfillmentId: string;
  destinationHash: string;
  dataMode: ShippingDataMode;
  package: ShippingPackageInput;
  rate: ShipStationRate;
  issuedAt: number;
  expiresAt: number;
}

export class ShippingQuoteTokenError extends Error {
  constructor(message: string, readonly code: "invalid" | "expired") {
    super(message);
    this.name = "ShippingQuoteTokenError";
  }
}

function signature(secret: string, encoded: string): Buffer {
  return createHmac("sha256", secret).update(encoded).digest();
}

function assertClaims(value: unknown): ShippingQuoteClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ShippingQuoteTokenError("The selected rate is invalid", "invalid");
  }
  const claims = value as Partial<ShippingQuoteClaims>;
  const rate = claims.rate as Partial<ShipStationRate> | undefined;
  const parcel = claims.package as Partial<ShippingPackageInput> | undefined;
  if (
    claims.version !== TOKEN_VERSION || typeof claims.fulfillmentId !== "string" ||
    typeof claims.destinationHash !== "string" ||
    (claims.dataMode !== "live" && claims.dataMode !== "mock") ||
    !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt) ||
    !rate || typeof rate.rateId !== "string" || typeof rate.carrierId !== "string" ||
    (typeof rate.shipmentId !== "string" && rate.shipmentId !== null) ||
    typeof rate.carrierCode !== "string" || typeof rate.carrierName !== "string" ||
    typeof rate.serviceCode !== "string" || typeof rate.serviceName !== "string" ||
    typeof rate.amount !== "number" || !Number.isFinite(rate.amount) || rate.amount < 0 ||
    typeof rate.currency !== "string" || typeof rate.isEstimate !== "boolean" ||
    (claims.dataMode === "live" && (!rate.shipmentId || rate.isEstimate)) || !parcel ||
    ![parcel.weightOz, parcel.lengthIn, parcel.widthIn, parcel.heightIn]
      .every((item) => typeof item === "number" && Number.isFinite(item) && item > 0) ||
    (parcel.packageCode !== undefined &&
      (typeof parcel.packageCode !== "string" || !/^[a-z0-9_]{1,80}$/.test(parcel.packageCode))) ||
    (parcel.packageName !== undefined && typeof parcel.packageName !== "string")
  ) {
    throw new ShippingQuoteTokenError("The selected rate is invalid", "invalid");
  }
  return claims as ShippingQuoteClaims;
}

export function createShippingQuoteToken(
  secret: string,
  claims: Omit<ShippingQuoteClaims, "version" | "issuedAt" | "expiresAt">,
  now = Date.now(),
  ttlMs = 20 * 60 * 1_000,
): string {
  const payload: ShippingQuoteClaims = {
    ...claims,
    version: TOKEN_VERSION,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(secret, encoded).toString("base64url")}`;
}

export function verifyShippingQuoteToken(
  secret: string,
  token: string,
  now = Date.now(),
): ShippingQuoteClaims {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw new ShippingQuoteTokenError("The selected rate is invalid", "invalid");
  }
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra) {
    throw new ShippingQuoteTokenError("The selected rate is invalid", "invalid");
  }
  let suppliedBuffer: Buffer;
  try {
    suppliedBuffer = Buffer.from(supplied, "base64url");
  } catch {
    throw new ShippingQuoteTokenError("The selected rate is invalid", "invalid");
  }
  const expected = signature(secret, encoded);
  if (suppliedBuffer.length !== expected.length || !timingSafeEqual(suppliedBuffer, expected)) {
    throw new ShippingQuoteTokenError("The selected rate is invalid", "invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ShippingQuoteTokenError("The selected rate is invalid", "invalid");
  }
  const claims = assertClaims(decoded);
  if (claims.expiresAt < now) {
    throw new ShippingQuoteTokenError("This rate expired. Compare rates again.", "expired");
  }
  return claims;
}
