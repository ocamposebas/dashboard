export interface ProductCostProfile {
  unitCost: number;
  packagingCost: number;
  feeRate: number;
  affiliateRate: number;
}

export interface ProductProfitability {
  transactionFee: number;
  affiliateReserve: number;
  estimatedProfit: number;
  margin: number | null;
}

export function productCostForCatalogLine(
  costs: Record<string, ProductCostProfile>,
  productId: number,
  variationId: number,
): ProductCostProfile | null {
  if (variationId > 0 && costs[String(variationId)]) return costs[String(variationId)]!;
  return costs[String(productId)] || null;
}

function safeAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeRate(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export function calculateProductProfitability(
  sellingPrice: number,
  cost: ProductCostProfile,
): ProductProfitability {
  const price = safeAmount(sellingPrice);
  const unitCost = safeAmount(cost.unitCost);
  const packagingCost = safeAmount(cost.packagingCost);
  const transactionFee = price * (safeRate(cost.feeRate) / 100);
  const affiliateReserve = price * (safeRate(cost.affiliateRate) / 100);
  const estimatedProfit = price - unitCost - packagingCost - transactionFee - affiliateReserve;
  return {
    transactionFee,
    affiliateReserve,
    estimatedProfit,
    margin: price > 0 ? (estimatedProfit / price) * 100 : null,
  };
}
