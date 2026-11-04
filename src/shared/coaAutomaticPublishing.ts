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

  // A live catalog SKU is the strongest durable identity. Product names can
  // be restyled while the sellable SKU remains stable.
  const skuMatch = uniquePreferredProduct(activeProducts.filter((product) => {
    const productSku = skuIdentity(product.sku || "");
    return Boolean(productSku && skuIdentities.has(productSku));
  }));
  if (skuMatch) return skuMatch;

  // Prefer the fields detected directly from the certificate before its
  // broader aliases. This keeps generic aliases such as "Korean Glutathione"
  // from overriding a precise name such as "Blue Korean Glutathione".
  const primaryMatch = uniquePreferredProduct(activeProducts.filter((product) => {
    const productName = automaticCoaProductIdentity(product.name);
    return Boolean(productName && primaryNameIdentities.has(productName));
  }));
  if (primaryMatch) return primaryMatch;

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
 * Builds conservative repairs for untouched WordPress-era COAs. Existing
 * catalog IDs remain authoritative; otherwise only a unique exact name/SKU
 * match and, for variable products, a unique exact strength match are used.
 *
 * The old WordPress model could designate one lot only at the parent level.
 * When an exact catalog presentation has exactly one untouched migrated
 * Available certificate and no current lot, that presentation can safely
 * inherit its own current-lot flag. Ambiguous or edited history is never
 * promoted.
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
    const product = exactProduct && mappedProduct && exactProduct.id !== mappedProduct.id
      ? exactProduct
      : mappedProduct || exactProduct;
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
      skus: uniqueCatalogSkus([...(coa.skus || []), product.sku || "", variation?.sku || ""]),
      currentShippingLot: coa.currentShippingLot,
    }];
  });

  const exactPresentationGroups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = `${candidate.productId}:${candidate.variationId}`;
    exactPresentationGroups.set(key, [...(exactPresentationGroups.get(key) || []), candidate]);
  }
  for (const group of exactPresentationGroups.values()) {
    if (group.some((candidate) => candidate.currentShippingLot) || group.length !== 1) continue;
    const candidate = group[0]!;
    if (candidate.coa.source === "wordpress_import" && candidate.coa.revision === 1) {
      candidate.currentShippingLot = true;
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
