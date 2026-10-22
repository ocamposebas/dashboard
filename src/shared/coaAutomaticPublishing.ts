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
  return value
    .toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[μµ]/g, "u")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mcg|ug|mg|g)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !GENERIC_PRODUCT_WORDS.has(word))
    .join(" ")
    .trim();
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
    dateDetection?: { confidence?: string };
  } | null;
}): boolean {
  const lot = String(coa.lot || coa.batch || "").trim();
  const hasDocument = Boolean(String(coa.fileUrl || coa.verifyUrl || "").trim());
  const finalNumber = String(coa.coaNumber || "").trim();
  const dateConfidence = coa.intakeAnalysis?.dateDetection?.confidence;
  const publicationRequested =
    (coa.status === "Review" && coa.intakeAnalysis?.suggestCurrent === true) ||
    (coa.status === "Available" && coa.currentShippingLot === true);
  return Boolean(
    coa.source === "custom" &&
    publicationRequested &&
    coa.intakeAnalysis?.status !== "failed" &&
    dateConfidence !== "fallback" &&
    dateConfidence !== "missing" &&
    finalNumber &&
    !finalNumber.startsWith("DRAFT-") &&
    coa.productName !== "Needs product review" &&
    lot &&
    /^\d{4}-\d{2}-\d{2}$/.test(coa.date || "") &&
    hasDocument
  );
}
