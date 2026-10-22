const DEFAULT_PRODUCT_SKU = "P1-PRODUCT";

export function productSkuBase(value: string, fallback = DEFAULT_PRODUCT_SKU): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " AND ")
    .replace(/[’']/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return normalized || fallback;
}

export function productVariantSku(productSku: string, option: string): string {
  const base = productSkuBase(productSku);
  const suffix = productSkuBase(option, "OPTION");
  return `${base}-${suffix}`.slice(0, 100).replace(/-+$/g, "");
}

export function skuCandidate(base: string, suffix: number): string {
  const normalized = productSkuBase(base);
  if (suffix <= 0) return normalized;
  const ending = `-${suffix}`;
  return `${normalized.slice(0, Math.max(1, 100 - ending.length)).replace(/-+$/g, "")}${ending}`;
}
