import type { BarcodeRegistryRecord } from "../shared/barcodeFulfillment.js";
import type { CommerceCoa } from "./wooCommerceGateway.js";
import type { CoaScanIdentifier } from "./coaScanIdentifierRepository.js";

const SECURE_EQUIVALENT_HOSTS = new Set([
  "coas.freedomdiagnosticstesting.com",
  "portal.ils-lab.com",
  "koveralabs.com",
]);

function normalized(value: string | null | undefined): string {
  return String(value || "").trim().toLocaleLowerCase("en");
}

export function canonicalizeCoaScanValue(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value || value.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  parsed.hostname = parsed.hostname.toLocaleLowerCase("en");
  if (SECURE_EQUIVALENT_HOSTS.has(parsed.hostname)) parsed.protocol = "https:";
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

export function coaScanProvider(rawValue: string): string {
  const canonical = canonicalizeCoaScanValue(rawValue);
  if (!canonical) return "unknown";
  const hostname = new URL(canonical).hostname;
  if (hostname === "portal.ils-lab.com") return "ils";
  if (hostname === "koveralabs.com") return "kovera";
  if (hostname === "coas.freedomdiagnosticstesting.com") return "freedom-diagnostics";
  return "external-lab";
}

function currentCoaUrls(coa: CommerceCoa): string[] {
  return [
    coa.fileUrl,
    coa.externalFileUrl,
    coa.verifyUrl,
    coa.currentCoa?.fileUrl,
    coa.currentCoa?.verifyUrl,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function coaMatchesReference(coa: CommerceCoa, reference: string): boolean {
  const expected = normalized(reference);
  return normalized(coa.id) === expected || normalized(coa.coaNumber) === expected;
}

function recordForCoa(rawValue: string, coa: CommerceCoa, provider: string): BarcodeRegistryRecord | null {
  const lot = (coa.lot || coa.batch).trim();
  if (!lot || coa.matchedProductId <= 0 || coa.matchedVariationId < 0) return null;
  return {
    version: 1,
    barcodeValue: rawValue.trim(),
    type: "batch",
    productId: coa.matchedProductId,
    variationId: coa.matchedVariationId,
    coaId: coa.id,
    lot,
    active: true,
    createdBy: `external-coa-qr:${provider}`,
    createdAt: new Date().toISOString(),
  };
}

export function coaIsAvailableForVialScan(coa: CommerceCoa): boolean {
  return ["available", "publish", "published", "active"].includes(normalized(coa.status));
}

/**
 * Resolves a QR URL exclusively against already-governed COA records. No
 * external page is fetched here: scanning remains fast and an arbitrary URL
 * can never become proof of a product or batch.
 */
export function resolveCoaQrScan(input: {
  rawValue: string;
  coas: CommerceCoa[];
  registeredIdentifier?: CoaScanIdentifier | null;
}): BarcodeRegistryRecord | null {
  const canonical = canonicalizeCoaScanValue(input.rawValue);
  if (!canonical) return null;

  if (input.registeredIdentifier) {
    const coa = input.coas.find((candidate) =>
      coaMatchesReference(candidate, input.registeredIdentifier!.coaReference));
    return coa
      ? recordForCoa(input.rawValue, coa, input.registeredIdentifier.provider)
      : null;
  }

  const matches = input.coas.filter((coa) => currentCoaUrls(coa).some((url) =>
    canonicalizeCoaScanValue(url) === canonical));
  if (matches.length !== 1) return null;
  return recordForCoa(input.rawValue, matches[0]!, coaScanProvider(canonical));
}
