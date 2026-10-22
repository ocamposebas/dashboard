import type { BarcodeRegistryRecord } from "../shared/barcodeFulfillment.js";
import type { CommerceCoa } from "./wooCommerceGateway.js";
import type { CoaScanIdentifier } from "./coaScanIdentifierRepository.js";

const SECURE_EQUIVALENT_HOSTS = new Set([
  "bit.ly",
  "coas.freedomdiagnosticstesting.com",
  "files.ils-lab.com",
  "portal.ils-lab.com",
  "koveralabs.com",
]);

const LAB_HOST_ALIASES = new Map([
  ["www.bit.ly", "bit.ly"],
  ["www.coas.freedomdiagnosticstesting.com", "coas.freedomdiagnosticstesting.com"],
  ["www.files.ils-lab.com", "files.ils-lab.com"],
  ["www.portal.ils-lab.com", "portal.ils-lab.com"],
  ["www.koveralabs.com", "koveralabs.com"],
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
  parsed.hostname = LAB_HOST_ALIASES.get(parsed.hostname) || parsed.hostname;
  if (SECURE_EQUIVALENT_HOSTS.has(parsed.hostname)) parsed.protocol = "https:";
  if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
    parsed.port = "";
  }
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");

  // These providers use the path or fragment token as the durable certificate
  // identity. Marketing/tracking query parameters and harmless fragments must
  // not make a QR already printed on a vial appear to be a different code.
  if (parsed.hostname === "coas.freedomdiagnosticstesting.com" || parsed.hostname === "portal.ils-lab.com") {
    parsed.search = "";
    parsed.hash = "";
  }
  if (parsed.hostname === "bit.ly") {
    parsed.search = "";
    parsed.hash = "";
  }
  if (parsed.hostname === "koveralabs.com") {
    const fragment = parsed.hash.replace(/^#/, "");
    const query = fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : parsed.search.replace(/^\?/, "");
    const token = new URLSearchParams(query).get("t") || new URLSearchParams(query).get("code");
    if (token && /^[A-Za-z0-9_-]{6,200}$/.test(token)) {
      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = `/verify?t=${token}`;
    }
  }
  return parsed.toString();
}

/**
 * Returns a provider-scoped identity for URL variants that represent the same
 * certificate. The identity never crosses laboratory hosts, so a filename or
 * token from an arbitrary domain cannot be accepted as a Phase One COA.
 */
export function coaScanIdentity(rawValue: string): string | null {
  const canonical = canonicalizeCoaScanValue(rawValue);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  if (parsed.hostname === "coas.freedomdiagnosticstesting.com") {
    const certificate = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "")
      .replace(/\.pdf$/i, "")
      .trim();
    return certificate ? `freedom-diagnostics:${certificate.toLocaleLowerCase("en")}` : null;
  }
  if (parsed.hostname === "portal.ils-lab.com") {
    const match = parsed.pathname.match(/^\/verify\/([A-Za-z0-9_-]{6,200})$/);
    return match?.[1] ? `ils:${match[1]}` : null;
  }
  if (parsed.hostname === "koveralabs.com") {
    const fragment = parsed.hash.replace(/^#/, "");
    const query = fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : parsed.search.replace(/^\?/, "");
    const token = new URLSearchParams(query).get("t") || new URLSearchParams(query).get("code");
    return token && /^[A-Za-z0-9_-]{6,200}$/.test(token) ? `kovera:${token}` : null;
  }
  return `url:${canonical}`;
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
 * Determines whether an Available COA makes physical lot verification
 * mandatory for an exact catalog line. Product/variation warehouse barcodes
 * are intentionally allowed only when no governed COA applies to that line.
 */
export function coaRequiresVialQrForLine(
  coa: CommerceCoa,
  line: { productId: number; variationId: number; sku: string },
): boolean {
  if (!coaIsAvailableForVialScan(coa)) return false;
  if (coa.matchedProductId > 0 && coa.matchedProductId !== line.productId) return false;
  if (coa.matchedVariationId > 0 && coa.matchedVariationId !== line.variationId) return false;
  if (coa.matchedProductId === line.productId) return true;
  return Boolean(
    line.sku.trim() && coa.skus.some((sku) => normalized(sku) === normalized(line.sku)),
  );
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

  const identity = coaScanIdentity(canonical);
  const directMatches = input.coas.filter((coa) => currentCoaUrls(coa).some((url) =>
    coaScanIdentity(url) === identity));

  if (input.registeredIdentifier) {
    const registeredCoa = input.coas.find((candidate) =>
      coaMatchesReference(candidate, input.registeredIdentifier!.coaReference));
    if (directMatches.length === 1) {
      if (registeredCoa && registeredCoa.id !== directMatches[0]!.id) return null;
      return recordForCoa(input.rawValue, directMatches[0]!, input.registeredIdentifier.provider);
    }
    return registeredCoa
      ? recordForCoa(input.rawValue, registeredCoa, input.registeredIdentifier.provider)
      : null;
  }

  if (directMatches.length !== 1) return null;
  return recordForCoa(input.rawValue, directMatches[0]!, coaScanProvider(canonical));
}
