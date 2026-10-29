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
    "rt30": "retatrutide",
    "rt 30": "retatrutide",
    "reta": "retatrutide",
    "reta 30": "retatrutide",
    "lipo c blend": "lipo c",
  };
  return knownAliases[identity] || identity;
}

function skuIdentity(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "");
}

export function exactAutomaticCoaProduct(
  coa: CommerceCoa,
  products: CommerceProduct[],
): CommerceProduct | null {
  const nameIdentities = new Set(
    [coa.productName, coa.familyName, coa.compound]
      .map(automaticCoaProductIdentity)
      .filter(Boolean),
  );
  const skuIdentities = new Set((coa.skus || []).map(skuIdentity).filter(Boolean));
  const matches = products.filter((product) => {
    if (product.status === "trash") return false;
    const productName = automaticCoaProductIdentity(product.name);
    const productSku = skuIdentity(product.sku || "");
    return Boolean(
      (productName && nameIdentities.has(productName)) ||
      (productSku && skuIdentities.has(productSku)),
    );
  });
  const publishedMatches = matches.filter((product) => product.status === "publish");
  if (publishedMatches.length === 1) return publishedMatches[0]!;
  return matches.length === 1 ? matches[0]! : null;
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
    (coa.status === "Review" && coa.intakeAnalysis?.suggestCurrent === true) ||
    (coa.status === "Available" && coa.currentShippingLot === true);
  return Boolean(
    coa.source === "custom" &&
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
 * When a migrated variable presentation has exactly one untouched Available
 * certificate and no current lot, that exact presentation can safely inherit
 * its own current-lot flag. Ambiguous or edited history is never promoted.
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

  const variableGroups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    if (candidate.product.type !== "variable" || candidate.variationId <= 0) continue;
    const key = `${candidate.productId}:${candidate.variationId}`;
    variableGroups.set(key, [...(variableGroups.get(key) || []), candidate]);
  }
  for (const group of variableGroups.values()) {
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
