export type DeliveryMonitorStatus =
  | "label_created"
  | "in_transit"
  | "delivery_attempt"
  | "exception"
  | "delivered"
  | "unknown";

export type DeliveryAlertKind = "delayed" | "exception" | null;

export interface DeliveryTrackingSnapshot {
  statusCode: string;
  statusDescription: string;
  shippedAt: string | null;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  exceptionDescription: string | null;
  lastEventAt: string | null;
  lastEventDescription: string | null;
}

export interface DeliveryMonitorItem {
  labelId: string;
  fulfillmentId: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  trackingNumber: string;
  carrierCode: string;
  serviceCode: string;
  shippedAt: string;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  lastEventAt: string | null;
  lastEventDescription: string | null;
  status: DeliveryMonitorStatus;
  statusDescription: string;
  exceptionDescription: string | null;
  daysInTransit: number;
  delayed: boolean;
  alertKind: DeliveryAlertKind;
  alertSentAt: string | null;
  alertError: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
}

export interface DeliveryMonitorSettings {
  delayDays: number;
  recipientUserId: string | null;
  emailEnabled: boolean;
  initializedAt: string | null;
  lastRunAt: string | null;
  lastRunError: string | null;
}

export interface DeliveryOwnerCandidate {
  id: string;
  displayName: string;
  email: string;
}

export interface DeliveryMonitorSummary {
  total: number;
  delayed: number;
  exceptions: number;
  inTransit: number;
  delivered: number;
  awaitingScan: number;
  acknowledged: number;
}

export interface DeliveryMonitorPayload {
  settings: DeliveryMonitorSettings;
  owners: DeliveryOwnerCandidate[];
  recipient: DeliveryOwnerCandidate | null;
  items: DeliveryMonitorItem[];
  summary: DeliveryMonitorSummary;
  writable: boolean;
  refreshing: boolean;
}

const DAY_MS = 86_400_000;

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deliveryStatusFromCode(code: string): DeliveryMonitorStatus {
  switch (code.trim().toUpperCase()) {
    case "DE":
    case "SP":
      return "delivered";
    case "EX":
      return "exception";
    case "AT":
      return "delivery_attempt";
    case "IT":
    case "AC":
      return "in_transit";
    case "NY":
      return "label_created";
    default:
      return "unknown";
  }
}

export function deliveryDaysInTransit(shippedAt: string, now = new Date()): number {
  const started = timestamp(shippedAt);
  if (started === null) return 0;
  return Math.max(0, Math.floor((now.getTime() - started) / DAY_MS));
}

export function evaluateDeliveryTracking(input: {
  tracking: DeliveryTrackingSnapshot;
  labelCreatedAt: string;
  delayDays: number;
  now?: Date;
}): {
  status: DeliveryMonitorStatus;
  shippedAt: string;
  daysInTransit: number;
  delayed: boolean;
  alertKind: DeliveryAlertKind;
} {
  const now = input.now || new Date();
  const status = deliveryStatusFromCode(input.tracking.statusCode);
  const shippedAt = timestamp(input.tracking.shippedAt)
    ? input.tracking.shippedAt!
    : input.labelCreatedAt;
  const daysInTransit = deliveryDaysInTransit(shippedAt, now);
  const delayDays = Math.max(1, Math.min(30, Math.trunc(input.delayDays) || 5));
  const delayed = status !== "delivered" && daysInTransit >= delayDays;
  return {
    status,
    shippedAt,
    daysInTransit,
    delayed,
    alertKind: status === "exception" ? "exception" : delayed ? "delayed" : null,
  };
}

export function summarizeDeliveries(items: DeliveryMonitorItem[]): DeliveryMonitorSummary {
  return items.reduce<DeliveryMonitorSummary>((summary, item) => {
    summary.total += 1;
    if (item.delayed) summary.delayed += 1;
    if (item.status === "exception") summary.exceptions += 1;
    if (item.status === "in_transit" || item.status === "delivery_attempt") summary.inTransit += 1;
    if (item.status === "delivered") summary.delivered += 1;
    if (item.status === "label_created" || item.status === "unknown") summary.awaitingScan += 1;
    if (item.acknowledgedAt) summary.acknowledged += 1;
    return summary;
  }, {
    total: 0,
    delayed: 0,
    exceptions: 0,
    inTransit: 0,
    delivered: 0,
    awaitingScan: 0,
    acknowledged: 0,
  });
}
