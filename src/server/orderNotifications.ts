export interface OrderNotificationSource {
  id: number;
  number: string;
  customer: string;
  currency: string;
  total: number;
  paymentMethodId: string;
}

export interface OrderNotificationPayload {
  dedupeKey: string;
  notification: {
    type: "order";
    severity: "success" | "warning";
    title: string;
    message: string;
    actionView: "orders";
    actionEntityId: number;
  };
}

export function ordersMissingFromSnapshot<T extends { id: number }>(
  currentOrders: T[],
  previousOrders: unknown,
): T[] {
  if (!Array.isArray(previousOrders)) return [];
  const knownIds = new Set(previousOrders.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const id = Number((value as Record<string, unknown>).id);
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  }));
  return currentOrders.filter((order) => !knownIds.has(order.id));
}

export function orderNotificationPayload(order: OrderNotificationSource): OrderNotificationPayload {
  const manualReview = order.paymentMethodId === "phaseone_zelle";
  return {
    dedupeKey: `commerce-order:${order.id}`,
    notification: {
      type: "order",
      severity: manualReview ? "warning" : "success",
      title: `New order #${order.number}`,
      message: `${order.customer} · ${order.currency} ${order.total.toFixed(2)}${manualReview ? " · Payment review required" : ""}`,
      actionView: "orders",
      actionEntityId: order.id,
    },
  };
}
