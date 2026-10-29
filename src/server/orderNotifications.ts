export interface OrderNotificationSource {
  id: number;
  number: string;
  customer: string;
  currency: string;
  total: number;
  paymentMethodId: string;
  status?: string;
}

export function ordersEnteringAttentionStatus<T extends { id: number; status?: string }>(
  currentOrders: T[],
  previousOrders: unknown,
): T[] {
  if (!Array.isArray(previousOrders)) return [];
  const previous = new Map<number, string>();
  for (const value of previousOrders) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const id = Number(item.id);
    if (Number.isSafeInteger(id) && id > 0) previous.set(id, String(item.status || "").toLowerCase());
  }
  return currentOrders.filter((order) => {
    const status = String(order.status || "").toLowerCase();
    return ["pending", "failed"].includes(status) && previous.has(order.id) && previous.get(order.id) !== status;
  });
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
  const status = String(order.status || "").toLowerCase();
  const needsAttention = status === "pending" || status === "failed";
  const statusLabel = status === "failed" ? "failed" : "pending";
  return {
    dedupeKey: needsAttention ? `commerce-order:${order.id}:${status}` : `commerce-order:${order.id}`,
    notification: {
      type: "order",
      severity: manualReview || needsAttention ? "warning" : "success",
      title: needsAttention ? `Order #${order.number} ${statusLabel}` : `New order #${order.number}`,
      message: `${order.customer} · ${order.currency} ${order.total.toFixed(2)}${status === "failed" ? " · Payment or checkout failed" : status === "pending" ? " · Waiting for payment or review" : manualReview ? " · Payment review required" : ""}`,
      actionView: "orders",
      actionEntityId: order.id,
    },
  };
}
