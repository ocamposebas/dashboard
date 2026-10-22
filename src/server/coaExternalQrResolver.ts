import type { CommerceCoa } from "./wooCommerceGateway.js";
import {
  canonicalizeCoaScanValue,
  coaIsAvailableForVialScan,
  coaScanIdentity,
  coaScanProvider,
} from "./coaScanResolver.js";

export interface ExternalCoaQrResolution {
  coaReference: string;
  provider: string;
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

const APPROVED_LAB_HOSTS = new Set([
  "coas.freedomdiagnosticstesting.com",
  "files.ils-lab.com",
  "portal.ils-lab.com",
  "koveralabs.com",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

function currentCoaUrls(coa: CommerceCoa): string[] {
  return [
    coa.fileUrl,
    coa.externalFileUrl,
    coa.verifyUrl,
    coa.currentCoa?.fileUrl,
    coa.currentCoa?.verifyUrl,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function directlyMatchingCoas(coas: CommerceCoa[], rawValue: string): CommerceCoa[] {
  const identity = coaScanIdentity(rawValue);
  if (!identity) return [];
  return coas.filter((coa) =>
    coaIsAvailableForVialScan(coa) &&
    coa.matchedProductId > 0 &&
    currentCoaUrls(coa).some((value) => coaScanIdentity(value) === identity));
}

function approvedLabDestination(rawValue: string): string | null {
  const canonical = canonicalizeCoaScanValue(rawValue);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  if (parsed.protocol !== "https:" || !APPROVED_LAB_HOSTS.has(parsed.hostname)) return null;
  return canonical;
}

function bitlyToken(rawValue: string): { url: string; token: string } | null {
  const canonical = canonicalizeCoaScanValue(rawValue);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  if (parsed.hostname !== "bit.ly" || parsed.port) return null;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_-]{4,32})\/?$/);
  if (!match?.[1]) return null;
  parsed.pathname = `/${match[1]}`;
  parsed.search = "";
  parsed.hash = "";
  return { url: parsed.toString(), token: match[1] };
}

async function fetchRedirectDestination(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ status: number; destination: string | null }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "HEAD",
        headers: { Accept: "text/html,application/pdf;q=0.9,*/*;q=0.1" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const location = response.headers.get("location");
      if (REDIRECT_STATUSES.has(response.status) && location) {
        return {
          status: response.status,
          destination: approvedLabDestination(new URL(location, url).toString()),
        };
      }
      if (attempt === 0 && (response.status === 408 || response.status === 429 || response.status >= 500)) continue;
      return { status: response.status, destination: null };
    } catch {
      if (attempt === 1) return { status: 0, destination: null };
    }
  }
  return { status: 0, destination: null };
}

function oneCaseFlipCandidates(url: string, token: string): string[] {
  const candidates: string[] = [];
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index]!;
    if (!/[A-Za-z]/.test(character)) continue;
    const flipped = character === character.toUpperCase()
      ? character.toLowerCase()
      : character.toUpperCase();
    const candidateToken = `${token.slice(0, index)}${flipped}${token.slice(index + 1)}`;
    candidates.push(url.replace(`/${token}`, `/${candidateToken}`));
  }
  return candidates.slice(0, 12);
}

async function resolveBitlyDestination(
  rawValue: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  const shortLink = bitlyToken(rawValue);
  if (!shortLink) return null;
  const exact = await fetchRedirectDestination(shortLink.url, fetchImpl, timeoutMs);
  if (exact.destination) return exact.destination;
  // QR payloads are case-sensitive. Some old vial labels contain one incorrect
  // letter case, so recover only a single-case typo and only when it resolves
  // unambiguously to an approved laboratory. Anything broader fails closed.
  if (![404, 410].includes(exact.status)) return null;
  const candidates = oneCaseFlipCandidates(shortLink.url, shortLink.token);
  const results = await Promise.all(candidates.map((candidate) =>
    fetchRedirectDestination(candidate, fetchImpl, timeoutMs)));
  const destinations = [...new Set(results.map((result) => result.destination).filter((value): value is string => Boolean(value)))];
  return destinations.length === 1 ? destinations[0]! : null;
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
  const fetchImpl = input.fetchImpl || fetch;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const shortLink = bitlyToken(input.rawValue);
  const resolvedValue = shortLink
    ? await resolveBitlyDestination(input.rawValue, fetchImpl, Math.min(timeoutMs, 4_000))
    : input.rawValue;
  if (!resolvedValue) return null;

  if (shortLink) {
    const directMatches = directlyMatchingCoas(input.coas, resolvedValue);
    if (directMatches.length === 1) {
      const match = directMatches[0]!;
      return {
        coaReference: match.coaNumber || match.id,
        provider: `bitly-${coaScanProvider(resolvedValue)}`,
        coaNumber: match.coaNumber,
        pdfUrl: resolvedValue,
      };
    }
    if (directMatches.length > 1) return null;
  }

  const qrCodeId = ilsQrCodeId(resolvedValue);
  if (!qrCodeId) return null;
  const query = encodeURIComponent(JSON.stringify({ json: { qrCodeId } }));
  const endpoint = `https://portal.ils-lab.com/api/trpc/publicCoa.getByQrCode?input=${query}`;
  const publicCoa = await fetchIlsPublicCoa(endpoint, fetchImpl, timeoutMs);
  if (!publicCoa) return null;
  const coaNumber = text(publicCoa.coaNumber);
  const pdfUrl = text(publicCoa.pdfUrl);
  if (!coaNumber && !pdfUrl && !text(publicCoa.lotNumber)) return null;
  const matches = matchingCoas(input.coas, publicCoa);
  if (matches.length !== 1) return null;
  return {
    coaReference: matches[0]!.coaNumber || matches[0]!.id,
    provider: shortLink ? "bitly-ils" : "ils",
    coaNumber,
    pdfUrl,
  };
}
