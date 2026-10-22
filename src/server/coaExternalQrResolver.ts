import type { CommerceCoa } from "./wooCommerceGateway.js";
import {
  canonicalizeCoaScanValue,
  coaIsAvailableForVialScan,
  coaScanIdentity,
} from "./coaScanResolver.js";

export interface ExternalCoaQrResolution {
  coaReference: string;
  provider: "ils";
  coaNumber: string;
  pdfUrl: string;
}

interface IlsPublicCoaPayload {
  coaNumber?: unknown;
  pdfUrl?: unknown;
  product?: unknown;
  lotNumber?: unknown;
  concentration?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

function identifier(value: string): string {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function words(value: string): string {
  return normalized(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function measurement(value: string): string {
  const match = normalized(value).match(/(\d+(?:\.\d+)?)\s*(mcg|mg|g)\b/);
  return match ? `${Number(match[1])}${match[2]}` : "";
}

function ilsQrCodeId(rawValue: string): string | null {
  const canonical = canonicalizeCoaScanValue(rawValue);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  if (parsed.hostname !== "portal.ils-lab.com") return null;
  return parsed.pathname.match(/^\/verify\/([A-Za-z0-9_-]{6,200})$/)?.[1] || null;
}

function matchingCoas(coas: CommerceCoa[], publicCoa: IlsPublicCoaPayload): CommerceCoa[] {
  const coaNumber = text(publicCoa.coaNumber);
  const pdfUrl = text(publicCoa.pdfUrl);
  const product = words(text(publicCoa.product));
  const lot = identifier(text(publicCoa.lotNumber));
  const concentration = measurement(text(publicCoa.concentration));
  const number = identifier(coaNumber);
  const pdfIdentity = coaScanIdentity(pdfUrl);
  const eligible = coas.filter((coa) => coaIsAvailableForVialScan(coa) && coa.matchedProductId > 0);
  const primaryMatches = eligible.filter((coa) => {
    if (number && (identifier(coa.coaNumber) === number || identifier(coa.id) === number)) return true;
    if (!pdfIdentity) return false;
    return [coa.fileUrl, coa.externalFileUrl, coa.verifyUrl, coa.currentCoa?.fileUrl, coa.currentCoa?.verifyUrl]
      .some((value) => value && coaScanIdentity(value) === pdfIdentity);
  });
  if (primaryMatches.length) return primaryMatches;
  if (!lot || (!product && !concentration)) return [];

  return eligible.filter((coa) => {
    const coaLots = [coa.lot, coa.batch].map(identifier).filter(Boolean);
    if (!coaLots.includes(lot)) return false;
    if (concentration && measurement(coa.strength) !== concentration) return false;
    if (!product) return true;
    const productNames = [coa.productName, coa.compound, coa.familyName, ...coa.aliases, ...coa.keywords]
      .map(words)
      .filter(Boolean);
    return productNames.some((candidate) => candidate === product || candidate.includes(product) || product.includes(candidate));
  });
}

async function fetchIlsPublicCoa(
  endpoint: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<IlsPublicCoaPayload | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        if (attempt === 0 && (response.status === 408 || response.status === 429 || response.status >= 500)) continue;
        return null;
      }
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > 1_000_000) return null;
      const body = await response.text();
      if (body.length > 1_000_000) return null;
      const payload = JSON.parse(body) as {
        result?: { data?: { json?: IlsPublicCoaPayload } };
      };
      return payload.result?.data?.json || null;
    } catch {
      if (attempt === 1) return null;
    }
  }
  return null;
}

/**
 * Resolves a previously unseen ILS vial QR through ILS' public, read-only COA
 * endpoint. The remote response is never trusted on its own: it must match one
 * and only one Available COA that is already governed by Phase One Labz.
 */
export async function resolveExternalCoaQr(input: {
  rawValue: string;
  coas: CommerceCoa[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ExternalCoaQrResolution | null> {
  const qrCodeId = ilsQrCodeId(input.rawValue);
  if (!qrCodeId) return null;
  const fetchImpl = input.fetchImpl || fetch;
  const query = encodeURIComponent(JSON.stringify({ json: { qrCodeId } }));
  const endpoint = `https://portal.ils-lab.com/api/trpc/publicCoa.getByQrCode?input=${query}`;
  const publicCoa = await fetchIlsPublicCoa(endpoint, fetchImpl, input.timeoutMs ?? 8_000);
  if (!publicCoa) return null;
  const coaNumber = text(publicCoa.coaNumber);
  const pdfUrl = text(publicCoa.pdfUrl);
  if (!coaNumber && !pdfUrl && !text(publicCoa.lotNumber)) return null;
  const matches = matchingCoas(input.coas, publicCoa);
  if (matches.length !== 1) return null;
  return {
    coaReference: matches[0]!.coaNumber || matches[0]!.id,
    provider: "ils",
    coaNumber,
    pdfUrl,
  };
}
