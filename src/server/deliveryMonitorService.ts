import { randomUUID } from "node:crypto";

import {
  evaluateDeliveryTracking,
  summarizeDeliveries,
  type DeliveryMonitorItem,
  type DeliveryMonitorPayload,
  type DeliveryOwnerCandidate,
} from "../shared/deliveryMonitor.js";
import type { PresenceStore } from "./presenceStore.js";
import type { ShipStationGateway, ShipStationTrackingResult } from "./shipStationGateway.js";
import type { WooCommerceGateway } from "./wooCommerceGateway.js";
import {
  DeliveryMonitorRepository,
  type TrackableShippingLabel,
} from "./deliveryMonitorRepository.js";

const DEFAULT_REFRESH_MS = 60 * 60_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] || character);
}

function trackingSnapshot(tracking: ShipStationTrackingResult) {
  const lastEvent = tracking.events[0];
  return {
    statusCode: tracking.statusCode,
    statusDescription: tracking.statusDescription,
    shippedAt: tracking.shippedDate,
    estimatedDeliveryAt: tracking.estimatedDeliveryDate,
    deliveredAt: tracking.actualDeliveryDate,
    exceptionDescription: tracking.exceptionDescription,
    lastEventAt: lastEvent?.occurredAt || null,
    lastEventDescription: lastEvent?.description || null,
  };
}

function ownerEmailHtml(item: DeliveryMonitorItem, dashboardOrigin: string): string {
  const problem = item.status === "exception"
    ? item.exceptionDescription || item.statusDescription || "The carrier reported a delivery exception."
    : `This shipment has been open for ${item.daysInTransit} days without a delivery confirmation.`;
  return `<!doctype html><html><body style="margin:0;background:#f3f5f4;color:#15201c;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dfe5e2;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 30px;background:#101713"><img src="https://phaseonelabz.is/assets/phase-one-email-logo-v2.png" width="178" alt="Phase One Labz" style="display:block;max-width:178px;height:auto"></td></tr><tr><td style="padding:30px"><p style="margin:0 0 10px;color:#a42e2e;font-size:12px;font-weight:700;letter-spacing:1.4px">DELIVERY ATTENTION REQUIRED</p><h1 style="margin:0 0 12px;font-size:28px;line-height:1.15">Order #${escapeHtml(item.orderNumber)} needs review</h1><p style="margin:0 0 24px;color:#56635d;font-size:15px;line-height:1.6">${escapeHtml(problem)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f7;border:1px solid #e1e5e3;border-radius:12px"><tr><td style="padding:18px"><strong style="display:block;font-size:16px">${escapeHtml(item.customerName || "Customer")}</strong><span style="display:block;margin-top:6px;color:#66726d">Tracking: ${escapeHtml(item.trackingNumber)}</span><span style="display:block;margin-top:4px;color:#66726d">Carrier: ${escapeHtml(item.carrierCode || "Carrier")} · ${item.daysInTransit} days</span></td></tr></table><p style="margin:26px 0 0"><a href="${escapeHtml(`${dashboardOrigin}/#delivery`)}" style="display:inline-block;background:#17251f;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:9px">Open delivery monitor</a></p></td></tr><tr><td style="padding:18px 30px;border-top:1px solid #e5e9e7;color:#7a847f;font-size:12px">Internal Phase One Labz operations alert. This message was sent only to the configured owner.</td></tr></table></td></tr></table></body></html>`;
}

function ownerEmailText(item: DeliveryMonitorItem, dashboardOrigin: string): string {
  const problem = item.status === "exception"
    ? item.exceptionDescription || item.statusDescription || "Carrier delivery exception"
    : `${item.daysInTransit} days without delivery confirmation`;
  return [
    `Order #${item.orderNumber} needs review`,
    problem,
    `Customer: ${item.customerName || "Customer"}`,
    `Tracking: ${item.trackingNumber}`,
    `Carrier: ${item.carrierCode || "Carrier"}`,
    `${dashboardOrigin}/#delivery`,
  ].join("\n");
}

export class DeliveryMonitorService {
  private timer: NodeJS.Timeout | undefined;
  private refreshPromise: Promise<void> | undefined;

  constructor(
    private readonly repository: DeliveryMonitorRepository,
    private readonly shipStation: ShipStationGateway,
    private readonly mailer: WooCommerceGateway,
    private readonly store: PresenceStore,
    private readonly dashboardOrigin: string,
    private readonly refreshMs = DEFAULT_REFRESH_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    const begin = () => void this.refresh().catch((error: unknown) => {
      console.warn("Delivery monitor refresh failed", error instanceof Error ? error.message : error);
    });
    this.timer = setInterval(begin, this.refreshMs);
    this.timer.unref();
    setTimeout(begin, 5_000).unref();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  get refreshing(): boolean {
    return Boolean(this.refreshPromise);
  }

  private async owners(): Promise<DeliveryOwnerCandidate[]> {
    return (await this.store.listUsers())
      .filter((user) => user.role === "owner" && user.status === "active" && /.+@.+\..+/.test(user.email))
      .map((user) => ({ id: user.id, displayName: user.displayName, email: user.email }));
  }

  private async recipient(recipientUserId: string | null): Promise<DeliveryOwnerCandidate | null> {
    const owners = await this.owners();
    return owners.find((owner) => owner.id === recipientUserId) || owners[0] || null;
  }

  async payload(writable: boolean): Promise<DeliveryMonitorPayload> {
    const [settings, owners, items] = await Promise.all([
      this.repository.getSettings(),
      this.owners(),
      this.repository.list(),
    ]);
    const recipient = owners.find((owner) => owner.id === settings.recipientUserId) || owners[0] || null;
    return {
      settings,
      owners,
      recipient,
      items,
      summary: summarizeDeliveries(items),
      writable,
      refreshing: this.refreshing,
    };
  }

  async saveSettings(input: {
    delayDays: number;
    recipientUserId: string | null;
    emailEnabled: boolean;
  }): Promise<void> {
    const owners = await this.owners();
    if (input.emailEnabled && owners.length === 0) {
      throw new Error("An active owner account with an email is required for alerts");
    }
    if (input.recipientUserId && !owners.some((owner) => owner.id === input.recipientUserId)) {
      throw new Error("The alert recipient must be an active owner account");
    }
    await this.repository.saveSettings(input);
  }

  async acknowledge(labelId: string, actorId: string): Promise<DeliveryMonitorItem | null> {
    return this.repository.acknowledge(labelId, actorId);
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.runRefresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async runRefresh(): Promise<void> {
    const settings = await this.repository.getSettings();
    const baseline = !settings.initializedAt;
    const labels = await this.repository.listTrackableLabels();
    const failures: string[] = [];
    let index = 0;
    const workers = Array.from({ length: Math.min(4, Math.max(1, labels.length)) }, async () => {
      while (index < labels.length) {
        const label = labels[index++];
        if (!label) continue;
        try {
          await this.checkLabel(label, settings.delayDays, settings.emailEnabled, settings.recipientUserId, baseline);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown tracking failure";
          failures.push(`#${label.orderNumber}: ${message}`);
          await this.repository.recordCheckFailure(label.labelId, message).catch(() => undefined);
        }
      }
    });
    await Promise.all(workers);
    const runError = failures.length
      ? `${failures.length} of ${labels.length} shipments could not be refreshed. ${failures.slice(0, 3).join(" · ")}`
      : null;
    await this.repository.completeRun(runError, baseline);
  }

  private async checkLabel(
    label: TrackableShippingLabel,
    delayDays: number,
    emailEnabled: boolean,
    recipientUserId: string | null,
    baseline: boolean,
  ): Promise<void> {
    const previous = await this.repository.getByLabelId(label.labelId);
    const tracking = await this.shipStation.trackLabelById(label.labelId);
    const snapshot = trackingSnapshot(tracking);
    const evaluated = evaluateDeliveryTracking({ tracking: snapshot, labelCreatedAt: label.createdAt, delayDays });
    const current = await this.repository.upsertTracking({
      labelId: label.labelId,
      fulfillmentId: label.fulfillmentId,
      orderId: label.orderId,
      orderNumber: label.orderNumber,
      customerName: label.customerName,
      trackingNumber: tracking.trackingNumber || label.trackingNumber,
      carrierCode: label.carrierCode,
      serviceCode: label.serviceCode,
      shippedAt: evaluated.shippedAt,
      estimatedDeliveryAt: snapshot.estimatedDeliveryAt,
      deliveredAt: snapshot.deliveredAt,
      lastEventAt: snapshot.lastEventAt,
      lastEventDescription: snapshot.lastEventDescription,
      status: evaluated.status,
      statusDescription: snapshot.statusDescription,
      exceptionDescription: snapshot.exceptionDescription,
      daysInTransit: evaluated.daysInTransit,
      delayed: evaluated.delayed,
      alertKind: evaluated.alertKind,
    });
    if (baseline || !current.alertKind) return;
    const needsAlert = !previous || !previous.alertSentAt ||
      (current.alertKind === "exception" && previous.alertKind !== "exception");
    if (!needsAlert) return;

    const dedupeKey = `delivery:${current.labelId}:${current.alertKind}:${delayDays}`;
    await this.store.addNotificationOnce(dedupeKey, {
      type: "system",
      severity: "critical",
      title: current.alertKind === "exception"
        ? `Delivery exception · Order #${current.orderNumber}`
        : `Delivery delayed · Order #${current.orderNumber}`,
      message: current.alertKind === "exception"
        ? current.exceptionDescription || current.statusDescription
        : `${current.customerName || "Customer"}'s shipment has been open for ${current.daysInTransit} days.`,
      actionView: "delivery",
      actionEntityId: current.orderId,
    });
    if (!emailEnabled) return;
    const owner = await this.recipient(recipientUserId);
    if (!owner) return;
    const eventId = randomUUID();
    try {
      await this.mailer.sendMarketingEmail({
        eventId,
        recipient: owner.email,
        subject: current.alertKind === "exception"
          ? `Delivery exception · Order #${current.orderNumber}`
          : `Delivery delayed ${current.daysInTransit} days · Order #${current.orderNumber}`,
        html: ownerEmailHtml(current, this.dashboardOrigin),
        text: ownerEmailText(current, this.dashboardOrigin),
        unsubscribeUrl: "https://phaseonelabz.com/account/",
      });
      await this.repository.recordAlert({ labelId: current.labelId, eventId, sent: true, error: null });
    } catch (error: unknown) {
      await this.repository.recordAlert({
        labelId: current.labelId,
        eventId,
        sent: false,
        error: error instanceof Error ? error.message : "Owner email could not be sent",
      });
    }
  }
}
