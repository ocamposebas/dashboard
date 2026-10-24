export interface ProductCostProfile {
  unitCost: number;
  packagingCost: number;
  feeRate: number;
  affiliateRate: number;
  testingCost?: number;
}

export interface ProductProfitability {
  transactionFee: number;
  affiliateReserve: number;
  testingCost: number;
  estimatedProfit: number;
  margin: number | null;
}

export interface RecordedTestingCostAllocation {
  quantity: number;
  cost: number;
}

export function allocatedTestingCost(
  orderedQuantity: number,
  recorded: RecordedTestingCostAllocation | undefined,
  currentPerUnit: number,
): number {
  const ordered = Number.isFinite(orderedQuantity) ? Math.max(0, orderedQuantity) : 0;
  const recordedQuantity = Number.isFinite(recorded?.quantity)
    ? Math.max(0, recorded?.quantity || 0)
    : 0;
  const exactQuantity = Math.min(ordered, recordedQuantity);
  const recordedCost = Number.isFinite(recorded?.cost) ? Math.max(0, recorded?.cost || 0) : 0;
  const exactCost = recordedQuantity > 0 ? recordedCost * (exactQuantity / recordedQuantity) : 0;
  const fallbackCost = safeAmount(currentPerUnit) * Math.max(0, ordered - exactQuantity);
  return exactCost + fallbackCost;
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
  const testingCost = safeAmount(cost.testingCost || 0);
  const transactionFee = price * (safeRate(cost.feeRate) / 100);
  const affiliateReserve = price * (safeRate(cost.affiliateRate) / 100);
  const estimatedProfit = price - unitCost - packagingCost - testingCost - transactionFee - affiliateReserve;
  return {
    transactionFee,
    affiliateReserve,
    testingCost,
    estimatedProfit,
    margin: price > 0 ? (estimatedProfit / price) * 100 : null,
  };
}
