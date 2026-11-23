import { variationMatchesCoaStrength } from "./coaCatalogMapping.js";
import type {
  CommerceCoa,
  CommerceProduct,
  CommerceVariation,
} from "../server/wooCommerceGateway.js";

const GENERIC_PRODUCT_WORDS = new Set([
  "research",
  "peptide",
  "peptides",
  "vial",
  "formula",
]);

export function automaticCoaProductIdentity(value: string): string {
  const identity = value
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[μµ]/g, "u")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mcg|ug|mg|g)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !GENERIC_PRODUCT_WORDS.has(word))
    .join(" ")
    .trim();
  const knownAliases: Record<string, string> = {
    "rt30": "pl rt",
    "rt 30": "pl rt",
    "reta": "pl rt",
    "reta 30": "pl rt",
    "retatrutide": "pl rt",
    "lipo c blend": "lipo c",
    "lipo c b12": "lipo c",
    "klow blend": "klow",
    "wolverine": "wolverine",
    "bpc 157 tb 500": "wolverine",
    "bpc 157 tb 500 wolverine": "wolverine",
    "ghk kpv bpc": "ghk cu kpv bpc 157 blend",
    "ghk kpv bpc 157": "ghk cu kpv bpc 157 blend",
    "ghk cu kpv bpc": "ghk cu kpv bpc 157 blend",
    "ghk cu kpv bpc 157": "ghk cu kpv bpc 157 blend",
    "ghk cu kpv bpc 157 blend": "ghk cu kpv bpc 157 blend",
    "ghk kpv": "ghk cu kpv blend",
    "ghk cu kpv": "ghk cu kpv blend",
    "ghk cu kpv blend": "ghk cu kpv blend",
    "cartalax bpc tb500": "deadpool",
    "cartalax bpc 157 tb 500": "deadpool",
    "gluta": "glutathione",
    "blue korean": "blue korean glutathione",
    "blue korean gluta": "blue korean glutathione",
    "korean blue gluta": "blue korean glutathione",
  };
  return knownAliases[identity] || identity;
}

function skuIdentity(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "");
}

function uniquePreferredProduct(matches: CommerceProduct[]): CommerceProduct | null {
  const publishedMatches = matches.filter((product) => product.status === "publish");
  if (publishedMatches.length === 1) return publishedMatches[0]!;
  return matches.length === 1 ? matches[0]! : null;
}

export function exactAutomaticCoaProduct(
  coa: CommerceCoa,
  products: CommerceProduct[],
): CommerceProduct | null {
  const primaryNameIdentities = new Set(
    [coa.productName, coa.familyName, coa.compound]
      .map(automaticCoaProductIdentity)
      .filter(Boolean),
  );
  const alternateNameIdentities = new Set(
    [...(coa.aliases || []), ...(coa.keywords || [])]
      .map(automaticCoaProductIdentity)
      .filter(Boolean),
  );
  const skuIdentities = new Set((coa.skus || []).map(skuIdentity).filter(Boolean));
  const activeProducts = products.filter((product) => product.status !== "trash");

  // An explicit live catalog ID is authoritative. Names and SKUs are only
  // discovery aids for records that have not been mapped yet.
  const mappedProduct = activeProducts.find((product) => product.id === coa.matchedProductId);
  if (mappedProduct) return mappedProduct;

  // Prefer the fields detected directly from the certificate. Imported COAs
  // can contain stale SKUs from an earlier catalog mapping, so a precise
  // certificate name must win before those durable-but-possibly-wrong values.
  const primaryMatch = uniquePreferredProduct(activeProducts.filter((product) => {
    const productName = automaticCoaProductIdentity(product.name);
    return Boolean(productName && primaryNameIdentities.has(productName));
  }));
  if (primaryMatch) return primaryMatch;

  // A live catalog SKU remains the strongest fallback when the certificate
  // name has been restyled and no unique direct-name match exists.
  const skuMatch = uniquePreferredProduct(activeProducts.filter((product) => {
    const productSku = skuIdentity(product.sku || "");
    return Boolean(productSku && skuIdentities.has(productSku));
  }));
  if (skuMatch) return skuMatch;

  return uniquePreferredProduct(activeProducts.filter((product) => {
    const productName = automaticCoaProductIdentity(product.name);
    return Boolean(productName && alternateNameIdentities.has(productName));
  }));
}

export function exactAutomaticCoaVariation(
  coa: CommerceCoa,
  product: CommerceProduct,
  variations: CommerceVariation[],
): CommerceVariation | null {
  if (product.type !== "variable") return null;
  const matches = variations.filter((variation) => variationMatchesCoaStrength(variation, coa.strength));
  return matches.length === 1 ? matches[0]! : null;
}

export function canAutomaticallyPublishCoa(coa: CommerceCoa & {
  source?: string;
  currentShippingLot?: boolean;
  intakeAnalysis?: {
    status?: string;
    suggestCurrent?: boolean;
    dateDetection?: { confidence?: string; source?: string };
  } | null;
}): boolean {
  const lot = String(coa.lot || coa.batch || "").trim();
  const hasDocument = Boolean(String(coa.fileUrl || coa.verifyUrl || "").trim());
  const finalNumber = String(coa.coaNumber || "").trim();
  const dateConfidence = coa.intakeAnalysis?.dateDetection?.confidence;
  const dateSource = coa.intakeAnalysis?.dateDetection?.source;
  const dateIsPublishable =
    dateConfidence !== "missing" &&
    (dateConfidence !== "fallback" || dateSource === "reported" || dateSource === "certificate");
  const publicationRequested =
    coa.intakeAnalysis?.suggestCurrent === true ||
    (coa.status === "Available" && coa.currentShippingLot === true);
  const sourceIsPublishable =
    coa.source === "custom" ||
    coa.intakeAnalysis?.suggestCurrent === true ||
    (coa.status === "Available" && coa.currentShippingLot === true);
  return Boolean(
    sourceIsPublishable &&
    publicationRequested &&
    coa.intakeAnalysis?.status !== "failed" &&
    dateIsPublishable &&
    finalNumber &&
    !finalNumber.startsWith("DRAFT-") &&
    coa.productName !== "Needs product review" &&
    lot &&
    /^\d{4}-\d{2}-\d{2}$/.test(coa.date || "") &&
    hasDocument
  );
}

type CurrentLotCandidate = Pick<CommerceCoa, "id" | "date"> & {
  recordId?: string;
  currentShippingLot?: boolean;
};

function certificateId(coa: CurrentLotCandidate): string {
  return String(coa.recordId || coa.id || "").trim();
}

/**
 * Selects the only certificate that may become the current shipping lot for
 * one exact catalog presentation. A newer analysis date can advance the lot;
 * an older upload is kept as history and can never replace it. When two
 * certificates share a date, the already-current record wins so a replay or
 * historical import cannot silently switch customer-facing documentation.
 */
export function newestCurrentCoaId(coas: CurrentLotCandidate[]): string | null {
  const dated = coas.filter((coa) =>
    Boolean(certificateId(coa)) && /^\d{4}-\d{2}-\d{2}$/.test(String(coa.date || "")),
  );
  if (!dated.length) return null;

  const winner = dated.reduce((winner, candidate) => {
    if (candidate.date > winner.date) return candidate;
    if (candidate.date < winner.date) return winner;
    if (candidate.currentShippingLot && !winner.currentShippingLot) return candidate;
    return winner;
  });
  return certificateId(winner) || null;
}

export interface ExactLegacyCoaCatalogRepair {
  coa: CommerceCoa & { recordId?: string; source?: string; revision?: number };
  productId: number;
  variationId: number;
  skus: string[];
  currentShippingLot: boolean;
}

function uniqueCatalogSkus(values: string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const sku = value.trim();
    const identity = sku.toLocaleLowerCase("en");
    if (!sku || seen.has(identity)) return [];
    seen.add(identity);
    return [sku];
  });
}

/**
 * Returns the complete SKU identity for one exact catalog presentation.
 * Previous COA SKUs are intentionally excluded: they describe an old mapping
 * and must not survive when an administrator changes the selected product.
 */
export function exactCatalogSkus(
  product: { sku?: string | null },
  variation?: { sku?: string | null } | null,
): string[] {
  return uniqueCatalogSkus([product.sku || "", variation?.sku || ""]);
}

/**
 * Builds conservative repairs for untouched WordPress-era COAs. Existing
 * catalog IDs remain authoritative; otherwise only a unique exact name/SKU
 * match and, for variable products, a unique exact strength match are used.
 *
 * The old WordPress model could designate one lot only at the parent level.
 * For every exact catalog presentation, the newest dated Available
 * certificate is the only current shipping lot. This also repairs stale
 * flags left behind by later imports while preserving strict variation
 * matching for variable products.
 */
export function exactLegacyCoaCatalogRepairs(
  coas: Array<CommerceCoa & { recordId?: string; source?: string; revision?: number }>,
  products: CommerceProduct[],
  variationsByProduct: ReadonlyMap<number, CommerceVariation[]>,
): ExactLegacyCoaCatalogRepair[] {
  const available = coas.filter((coa) => coa.status.toLocaleLowerCase("en") === "available");
  const candidates = available.flatMap((coa) => {
    const mappedProduct = products.find((product) =>
      product.id === coa.matchedProductId && product.status !== "trash");
    const exactProduct = exactAutomaticCoaProduct(coa, products);
    const product = mappedProduct || exactProduct;
    if (!product) return [];

    const variations = variationsByProduct.get(product.id) || [];
    const storedVariation = variations.find((variation) => variation.id === coa.matchedVariationId) || null;
    const variation = product.type === "variable"
      ? storedVariation || exactAutomaticCoaVariation(coa, product, variations)
      : null;
    if (product.type === "variable" && !variation) return [];

    return [{
      coa,
      product,
      productId: product.id,
      variationId: variation?.id || 0,
      skus: exactCatalogSkus(product, variation),
      currentShippingLot: coa.currentShippingLot,
    }];
  });

  const exactPresentationGroups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = `${candidate.productId}:${candidate.variationId}`;
    exactPresentationGroups.set(key, [...(exactPresentationGroups.get(key) || []), candidate]);
  }
  for (const group of exactPresentationGroups.values()) {
    const winnerId = newestCurrentCoaId(group.map((candidate) => candidate.coa));
    if (!winnerId) continue;
    for (const candidate of group) {
      candidate.currentShippingLot = certificateId(candidate.coa) === winnerId;
    }
  }

  return candidates.flatMap((candidate) => {
    const mappingChanged = candidate.coa.matchedProductId !== candidate.productId ||
      candidate.coa.matchedVariationId !== candidate.variationId;
    const skusChanged = candidate.skus.length !== candidate.coa.skus.length ||
      candidate.skus.some((sku, index) => sku !== candidate.coa.skus[index]);
    const currentChanged = candidate.currentShippingLot !== candidate.coa.currentShippingLot;
    return mappingChanged || skusChanged || currentChanged
      ? [{
          coa: candidate.coa,
          productId: candidate.productId,
          variationId: candidate.variationId,
          skus: candidate.skus,
          currentShippingLot: candidate.currentShippingLot,
        }]
      : [];
  });
}
