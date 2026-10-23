export type PaymentMethodKind = "zelle" | "debit" | "card" | "wallet" | "bank" | "cash" | "other";

export interface MonthlyFinanceOrder {
  status: string;
  currency: string;
  total: number;
  refundedTotal: number;
  paymentMethod: string;
  paymentMethodId: string;
  paidAt: string | null;
  createdAt: string | null;
  profitability: {
    costOfGoods: number;
    operatingCost: number;
    feeCost: number;
    affiliateCost: number;
    completeCostCoverage: boolean;
    estimatedProfit: number | null;
  };
}

export interface PaymentMethodTotal {
  kind: PaymentMethodKind;
  label: string;
  orders: number;
  revenue: number;
}

export interface MonthlyFinanceSummary {
  orders: number;
  currency: string;
  revenue: number;
  refunds: number;
  profit: number | null;
  costs: number | null;
  margin: number | null;
  coverage: number;
  paymentMethods: PaymentMethodTotal[];
}

const PAYMENT_LABELS: Record<PaymentMethodKind, string> = {
  zelle: "Zelle",
  debit: "eDebit",
  card: "Card",
  wallet: "Digital wallet",
  bank: "Bank transfer",
  cash: "Cash",
  other: "Other",
};

const PAYMENT_ORDER: PaymentMethodKind[] = ["zelle", "debit", "card", "wallet", "bank", "cash", "other"];

export function paymentMethodKind(order: Pick<MonthlyFinanceOrder, "paymentMethod" | "paymentMethodId">): PaymentMethodKind {
  const value = `${order.paymentMethodId} ${order.paymentMethod}`.toLocaleLowerCase("en");
  if (value.includes("zelle")) return "zelle";
  if (value.includes("debit") || value.includes("e-debit") || value.includes("edebit")) return "debit";
  if (value.includes("paypal") || value.includes("apple pay") || value.includes("google pay") || value.includes("wallet")) return "wallet";
  if (value.includes("bank") || value.includes("ach") || value.includes("bacs") || value.includes("wire")) return "bank";
  if (value.includes("cash") || value.includes("cod")) return "cash";
  if (
    value.includes("card") || value.includes("credit") || value.includes("stripe") ||
    value.includes("square") || value.includes("authorize") || value.includes("woo payment") ||
    value.includes("woocommerce_payment") || value.includes("secure checkout")
  ) return "card";
  return "other";
}

export function monthToDateStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export function summarizeMonthToDate(
  orders: MonthlyFinanceOrder[],
  now = new Date(),
): MonthlyFinanceSummary {
  const start = monthToDateStart(now).getTime();
  const end = now.getTime();
  const paid = orders.filter((order) => {
    if (order.status !== "processing" && order.status !== "completed") return false;
    const timestamp = Date.parse(order.paidAt || order.createdAt || "");
    return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
  });
  const currency = paid[0]?.currency || orders[0]?.currency || "USD";
  const paymentTotals = new Map<PaymentMethodKind, PaymentMethodTotal>();
  let revenue = 0;
  let refunds = 0;
  let profit = 0;
  let costs = 0;
  let coveredOrders = 0;

  for (const order of paid) {
    const refunded = Math.max(0, Number(order.refundedTotal) || 0);
    const net = Math.max(0, (Number(order.total) || 0) - refunded);
    const kind = paymentMethodKind(order);
    const current = paymentTotals.get(kind) || { kind, label: PAYMENT_LABELS[kind], orders: 0, revenue: 0 };
    current.orders += 1;
    current.revenue += net;
    paymentTotals.set(kind, current);
    revenue += net;
    refunds += refunded;

    if (order.profitability.completeCostCoverage && order.profitability.estimatedProfit !== null) {
      coveredOrders += 1;
      profit += order.profitability.estimatedProfit - refunded;
      costs += order.profitability.costOfGoods + order.profitability.operatingCost +
        order.profitability.feeCost + (order.profitability.affiliateCost || 0);
    }
  }

  const coverage = paid.length ? (coveredOrders / paid.length) * 100 : 0;
  const complete = paid.length > 0 && coveredOrders === paid.length;
  return {
    orders: paid.length,
    currency,
    revenue,
    refunds,
    profit: coveredOrders ? profit : null,
    costs: coveredOrders ? costs : null,
    margin: complete && revenue > 0 ? (profit / revenue) * 100 : null,
    coverage,
    paymentMethods: PAYMENT_ORDER.flatMap((kind) => {
      const total = paymentTotals.get(kind);
      return total ? [total] : [];
    }),
  };
}
