import { paymentMethodKind, type PaymentMethodKind } from "./monthlyFinance.js";

export interface FinanceLineItem {
  id: number;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  quantity: number;
  total: number;
  totalTax: number;
  imageUrl?: string | null;
}

export interface FinanceLineProfitability {
  orderItemId: number;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  quantity: number;
  productRevenue: number;
  allocatedRevenue: number;
  allocatedRefund: number;
  costOfGoods: number;
  operatingCost: number;
  feeCost: number;
  affiliateCost: number;
  testingCost: number;
  completeCostCoverage: boolean;
  estimatedProfit: number | null;
}

export interface FinanceOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: number;
  refundedTotal: number;
  paymentMethod: string;
  paymentMethodId: string;
  paidAt: string | null;
  createdAt: string | null;
  repeatOperations?: { operationalRepeat: boolean };
  lineItems: FinanceLineItem[];
  profitability: {
    costOfGoods: number;
    operatingCost: number;
    feeCost: number;
    affiliateCost: number;
    testingCost?: number;
    completeCostCoverage: boolean;
    estimatedProfit: number | null;
    lines?: FinanceLineProfitability[];
  };
}

export interface FinanceCostSummary {
  costOfGoods: number;
  operating: number;
  paymentFees: number;
  affiliates: number;
  testing: number;
  refunds: number;
  total: number;
}

export interface FinanceSkuSummary {
  key: string;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  imageUrl: string | null;
  units: number;
  orders: number;
  productSales: number;
  allocatedRevenue: number;
  refunds: number;
  costs: FinanceCostSummary;
  profit: number | null;
  margin: number | null;
  coveredUnits: number;
  coverage: number;
}

export interface FinanceDailySummary {
  date: string;
  revenue: number;
  profit: number | null;
  orders: number;
  units: number;
}

export interface FinancePaymentSummary {
  kind: PaymentMethodKind;
  orders: number;
  revenue: number;
  share: number;
}

export interface FinanceSummary {
  currency: string;
  orders: number;
  units: number;
  revenue: number;
  productSales: number;
  averageOrderValue: number;
  profit: number | null;
  margin: number | null;
  knownProfit: number;
  coverage: number;
  coveredOrders: number;
  costs: FinanceCostSummary;
  skus: FinanceSkuSummary[];
  daily: FinanceDailySummary[];
  payments: FinancePaymentSummary[];
  lowMarginSkus: number;
  negativeSkus: number;
  missingCostSkus: number;
}

const PAYMENT_ORDER: PaymentMethodKind[] = ["zelle", "debit", "card", "wallet", "bank", "cash", "other"];

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function lineKey(line: Pick<FinanceLineItem, "productId" | "variationId" | "sku" | "name">): string {
  return `${line.productId}:${line.variationId}:${line.sku || line.name}`;
}

function dateKey(value: string | null): string {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyCosts(): FinanceCostSummary {
  return { costOfGoods: 0, operating: 0, paymentFees: 0, affiliates: 0, testing: 0, refunds: 0, total: 0 };
}

function normalizeOrders(orders: FinanceOrder[]): FinanceOrder[] {
  return orders.filter((order) =>
    !order.repeatOperations?.operationalRepeat &&
    (order.status === "processing" || order.status === "completed"),
  );
}

export function summarizeFinance(orders: FinanceOrder[]): FinanceSummary {
  const paid = normalizeOrders(orders);
  const currency = paid[0]?.currency || orders[0]?.currency || "USD";
  const skuMap = new Map<string, FinanceSkuSummary & { orderIds: Set<number> }>();
  const dailyMap = new Map<string, FinanceDailySummary>();
  const paymentMap = new Map<PaymentMethodKind, { kind: PaymentMethodKind; orders: number; revenue: number }>();
  const costs = emptyCosts();
  let revenue = 0;
  let productSales = 0;
  let units = 0;
  let knownProfit = 0;
  let coveredOrders = 0;

  for (const order of paid) {
    const refund = Math.max(0, finite(order.refundedTotal));
    const orderRevenue = Math.max(0, finite(order.total) - refund);
    const orderUnits = order.lineItems.reduce((sum, line) => sum + Math.max(0, finite(line.quantity)), 0);
    const orderProductSales = order.lineItems.reduce((sum, line) => sum + Math.max(0, finite(line.total)), 0);
    revenue += orderRevenue;
    productSales += orderProductSales;
    units += orderUnits;
    costs.costOfGoods += finite(order.profitability.costOfGoods);
    costs.operating += finite(order.profitability.operatingCost);
    costs.paymentFees += finite(order.profitability.feeCost);
    costs.affiliates += finite(order.profitability.affiliateCost);
    costs.testing += finite(order.profitability.testingCost);
    costs.refunds += refund;
    const covered = order.profitability.completeCostCoverage && order.profitability.estimatedProfit !== null;
    const orderProfit = covered ? finite(order.profitability.estimatedProfit) - refund : null;
    if (orderProfit !== null) {
      coveredOrders += 1;
      knownProfit += orderProfit;
    }

    const day = dateKey(order.paidAt || order.createdAt);
    if (day !== "unknown") {
      const currentDay = dailyMap.get(day) || { date: day, revenue: 0, profit: 0, orders: 0, units: 0 };
      currentDay.revenue += orderRevenue;
      currentDay.orders += 1;
      currentDay.units += orderUnits;
      currentDay.profit = currentDay.profit === null || orderProfit === null ? null : currentDay.profit + orderProfit;
      dailyMap.set(day, currentDay);
    }

    const kind = paymentMethodKind(order);
    const payment = paymentMap.get(kind) || { kind, orders: 0, revenue: 0 };
    payment.orders += 1;
    payment.revenue += orderRevenue;
    paymentMap.set(kind, payment);

    const recordedLines = new Map((order.profitability.lines || []).map((line) => [line.orderItemId, line]));
    for (const item of order.lineItems) {
      const key = lineKey(item);
      const row = skuMap.get(key) || {
        key,
        productId: item.productId,
        variationId: item.variationId,
        name: item.name,
        sku: item.sku,
        imageUrl: item.imageUrl || null,
        units: 0,
        orders: 0,
        productSales: 0,
        allocatedRevenue: 0,
        refunds: 0,
        costs: emptyCosts(),
        profit: 0,
        margin: null,
        coveredUnits: 0,
        coverage: 0,
        orderIds: new Set<number>(),
      };
      const exact = recordedLines.get(item.id);
      const share = orderProductSales > 0
        ? Math.max(0, finite(item.total)) / orderProductSales
        : orderUnits > 0 ? Math.max(0, finite(item.quantity)) / orderUnits : 0;
      const allocatedRevenue = exact ? finite(exact.allocatedRevenue) : finite(order.total) * share;
      const allocatedRefund = exact ? finite(exact.allocatedRefund) : refund * share;
      const lineCovered = exact ? exact.completeCostCoverage : covered;
      const fallbackTotalCosts = finite(order.profitability.costOfGoods) + finite(order.profitability.operatingCost) +
        finite(order.profitability.feeCost) + finite(order.profitability.affiliateCost) + finite(order.profitability.testingCost);
      const lineCosts = exact ? {
        costOfGoods: finite(exact.costOfGoods),
        operating: finite(exact.operatingCost),
        paymentFees: finite(exact.feeCost),
        affiliates: finite(exact.affiliateCost),
        testing: finite(exact.testingCost),
      } : {
        costOfGoods: finite(order.profitability.costOfGoods) * share,
        operating: finite(order.profitability.operatingCost) * share,
        paymentFees: finite(order.profitability.feeCost) * share,
        affiliates: finite(order.profitability.affiliateCost) * share,
        testing: finite(order.profitability.testingCost) * share,
      };
      const lineProfit = exact?.estimatedProfit ?? (lineCovered ? allocatedRevenue - allocatedRefund - fallbackTotalCosts * share : null);
      row.units += Math.max(0, finite(item.quantity));
      row.orderIds.add(order.id);
      row.productSales += Math.max(0, finite(item.total));
      row.allocatedRevenue += allocatedRevenue;
      row.refunds += allocatedRefund;
      row.costs.costOfGoods += lineCosts.costOfGoods;
      row.costs.operating += lineCosts.operating;
      row.costs.paymentFees += lineCosts.paymentFees;
      row.costs.affiliates += lineCosts.affiliates;
      row.costs.testing += lineCosts.testing;
      row.costs.refunds += allocatedRefund;
      row.costs.total += lineCosts.costOfGoods + lineCosts.operating + lineCosts.paymentFees + lineCosts.affiliates + lineCosts.testing + allocatedRefund;
      if (lineCovered && lineProfit !== null) {
        row.coveredUnits += Math.max(0, finite(item.quantity));
        row.profit = (row.profit || 0) + finite(lineProfit);
      } else {
        row.profit = null;
      }
      if (!row.imageUrl && item.imageUrl) row.imageUrl = item.imageUrl;
      skuMap.set(key, row);
    }
  }

  costs.total = costs.costOfGoods + costs.operating + costs.paymentFees + costs.affiliates + costs.testing + costs.refunds;
  const skus = [...skuMap.values()].map((row) => {
    const coverage = row.units > 0 ? (row.coveredUnits / row.units) * 100 : 0;
    const profit = coverage >= 99.999 ? row.profit : null;
    return {
      ...row,
      orders: row.orderIds.size,
      profit,
      margin: profit !== null && row.allocatedRevenue - row.refunds > 0
        ? (profit / (row.allocatedRevenue - row.refunds)) * 100
        : null,
      coverage,
      orderIds: undefined,
    } as FinanceSkuSummary;
  }).sort((left, right) => right.units - left.units || right.productSales - left.productSales || left.name.localeCompare(right.name));
  const complete = paid.length > 0 && coveredOrders === paid.length;
  const profit = complete ? knownProfit : null;
  return {
    currency,
    orders: paid.length,
    units,
    revenue,
    productSales,
    averageOrderValue: paid.length ? revenue / paid.length : 0,
    profit,
    margin: profit !== null && revenue > 0 ? (profit / revenue) * 100 : null,
    knownProfit,
    coverage: paid.length ? (coveredOrders / paid.length) * 100 : 0,
    coveredOrders,
    costs,
    skus,
    daily: [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
    payments: PAYMENT_ORDER.flatMap((kind) => {
      const payment = paymentMap.get(kind);
      return payment ? [{ ...payment, share: revenue > 0 ? (payment.revenue / revenue) * 100 : 0 }] : [];
    }),
    lowMarginSkus: skus.filter((sku) => sku.margin !== null && sku.margin >= 0 && sku.margin < 20).length,
    negativeSkus: skus.filter((sku) => sku.profit !== null && sku.profit < 0).length,
    missingCostSkus: skus.filter((sku) => sku.coverage < 99.999).length,
  };
}
