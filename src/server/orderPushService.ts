import webPush from "web-push";

import type { OrderNotificationSource } from "./orderNotifications.js";
import {
  normalizeBrowserPushSubscription,
  type BrowserPushSubscription,
  type OrderPushRepository,
} from "./orderPushRepository.js";

export interface NewOrderPushPayload {
  title: string;
  body: string;
  tag: string;
  url: "/#orders";
}

export function newOrderPushPayload(order: OrderNotificationSource): NewOrderPushPayload {
  const manualReview = order.paymentMethodId === "phaseone_zelle";
  return {
    title: `New order #${order.number}`,
    body: `${manualReview ? "Zelle · " : ""}${order.customer} · ${order.currency} ${order.total.toFixed(2)}`,
    tag: `phaseone-order-${order.id}`,
    url: "/#orders",
  };
}

function pushStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

export class OrderPushService {
  private constructor(
    private readonly repository: OrderPushRepository,
    private readonly publicVapidKey: string,
  ) {}

  static async create(repository: OrderPushRepository): Promise<OrderPushService> {
    const keys = await repository.getOrCreateKeyMaterial(() => webPush.generateVAPIDKeys());
    webPush.setVapidDetails(
      "mailto:operations@phaseonelabz.com",
      keys.publicKey,
      keys.privateKey,
    );
    return new OrderPushService(repository, keys.publicKey);
  }

  publicKey(): string {
    return this.publicVapidKey;
  }

  async subscribe(userId: string, value: unknown, userAgent: string): Promise<void> {
    await this.repository.upsert(userId, normalizeBrowserPushSubscription(value), userAgent);
  }

  async unsubscribe(userId: string, endpoint: unknown): Promise<void> {
    const normalized = normalizeBrowserPushSubscription({
      endpoint,
      keys: { p256dh: "unused", auth: "unused" },
    });
    await this.repository.remove(userId, normalized.endpoint);
  }

  async sendNewOrder(order: OrderNotificationSource): Promise<void> {
    const subscriptions = await this.repository.list();
    if (subscriptions.length === 0) return;
    const payload = JSON.stringify(newOrderPushPayload(order));
    await Promise.all(subscriptions.map(async (subscription) => {
      const target: BrowserPushSubscription = {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      };
      try {
        await webPush.sendNotification(target, payload, {
          TTL: 300,
          urgency: "high",
          topic: `order-${order.id}`,
        });
        await this.repository.markSuccess(subscription.endpoint);
      } catch (error: unknown) {
        const status = pushStatusCode(error);
        if (status === 404 || status === 410) {
          await this.repository.removeEndpoint(subscription.endpoint);
          return;
        }
        await this.repository.markFailure(subscription.endpoint);
        console.warn("New-order push delivery failed", status || "network_error");
      }
    }));
  }
}
