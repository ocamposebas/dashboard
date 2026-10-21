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
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

function ilsQrCodeId(rawValue: string): string | null {
  const canonical = canonicalizeCoaScanValue(rawValue);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  if (parsed.hostname !== "portal.ils-lab.com") return null;
  return parsed.pathname.match(/^\/verify\/([A-Za-z0-9_-]{6,200})$/)?.[1] || null;
}

function matchingCoas(coas: CommerceCoa[], coaNumber: string, pdfUrl: string): CommerceCoa[] {
  const number = normalized(coaNumber);
  const pdfIdentity = coaScanIdentity(pdfUrl);
  return coas.filter((coa) => {
    if (!coaIsAvailableForVialScan(coa) || coa.matchedProductId <= 0) return false;
    if (number && (normalized(coa.coaNumber) === number || normalized(coa.id) === number)) return true;
    if (!pdfIdentity) return false;
    return [coa.fileUrl, coa.externalFileUrl, coa.verifyUrl, coa.currentCoa?.fileUrl, coa.currentCoa?.verifyUrl]
      .some((value) => value && coaScanIdentity(value) === pdfIdentity);
  });
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
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      // ILS occasionally needs several seconds to answer on the first request.
      // The result is persisted as an identifier, so later scans of the same
      // vial QR stay local and do not pay this latency again.
      signal: AbortSignal.timeout(input.timeoutMs ?? 12_000),
    });
    if (!response.ok) return null;
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 1_000_000) return null;
    const body = await response.text();
    if (body.length > 1_000_000) return null;
    const payload = JSON.parse(body) as {
      result?: { data?: { json?: IlsPublicCoaPayload } };
    };
    const publicCoa = payload.result?.data?.json;
    const coaNumber = text(publicCoa?.coaNumber);
    const pdfUrl = text(publicCoa?.pdfUrl);
    if (!coaNumber && !pdfUrl) return null;
    const matches = matchingCoas(input.coas, coaNumber, pdfUrl);
    if (matches.length !== 1) return null;
    return {
      coaReference: matches[0]!.coaNumber || matches[0]!.id,
      provider: "ils",
      coaNumber,
      pdfUrl,
    };
  } catch {
    return null;
  }
}
