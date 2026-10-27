import { analyticsFingerprint } from "./analyticsIdentity.js";
import type { OrderNotificationSource } from "./orderNotifications.js";

const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const CURSOR_OVERLAP_MS = 5 * 60 * 1_000;
const PAID_STATUSES = new Set(["processing", "completed"]);

interface WooOrder {
  id?: number | string;
  number?: number | string;
  status?: string;
  currency?: string;
  total?: number | string;
  payment_method?: string;
  billing?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  date_paid_gmt?: string | null;
  date_completed_gmt?: string | null;
  date_modified_gmt?: string | null;
  date_created_gmt?: string | null;
}

interface OrderSyncStore {
  recordReconciledOrder(
    orderFingerprint: string,
    paidAt: Date,
  ): Promise<boolean>;
  getOrderSyncCursor(): Promise<Date | null>;
  setOrderSyncCursor(value: Date): Promise<void>;
}

export interface WooOrderSyncConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  analyticsHmacSecret: string;
  syncIntervalMs: number;
  backfillDays: number;
}

export interface WooOrderSyncResult {
  mode: "backfill" | "incremental";
  scanned: number;
  paid: number;
  recorded: number;
}

interface WooOrderSyncOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logger?: Pick<Console, "info" | "error">;
  onNewPaidOrder?: (order: OrderNotificationSource) => Promise<void>;
}

function parseWooUtcDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : `${value}Z`;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function paidAt(order: WooOrder): Date | null {
  return (
    parseWooUtcDate(order.date_paid_gmt) ||
    parseWooUtcDate(order.date_completed_gmt) ||
    parseWooUtcDate(order.date_modified_gmt) ||
    parseWooUtcDate(order.date_created_gmt)
  );
}

export class WooOrderSync {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly logger: Pick<Console, "info" | "error">;
  private readonly onNewPaidOrder: ((order: OrderNotificationSource) => Promise<void>) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly config: WooOrderSyncConfig,
    private readonly store: OrderSyncStore,
    options: WooOrderSyncOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => new Date());
    this.logger = options.logger || console;
    this.onNewPaidOrder = options.onNewPaidOrder;
  }

  start(): void {
    if (this.timer) return;
    this.queueSync();
    this.timer = setInterval(() => this.queueSync(), this.config.syncIntervalMs);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async syncOnce(): Promise<WooOrderSyncResult> {
    const startedAt = this.now();
    const cursor = await this.store.getOrderSyncCursor();
    const mode = cursor ? "incremental" : "backfill";
    const since = cursor
      ? new Date(cursor.getTime() - CURSOR_OVERLAP_MS)
      : new Date(
          startedAt.getTime() - this.config.backfillDays * 24 * 60 * 60 * 1_000,
        );
    const orders = await this.fetchOrders(mode, since);
    const paidOrders = orders.flatMap((order) => {
      const status = String(order.status || "").toLowerCase();
      const id = String(order.id || "").trim();
      const paidDate = paidAt(order);
      const firstName = String(order.billing?.first_name || "").trim();
      const lastName = String(order.billing?.last_name || "").trim();
      const email = String(order.billing?.email || "").trim();
      const parsedTotal = Number(order.total);
      return PAID_STATUSES.has(status) && id && paidDate
        ? [{
            id,
            paidAt: paidDate,
            notification: {
              id: Number(id),
              number: String(order.number || id),
              customer: [firstName, lastName].filter(Boolean).join(" ") || email || "Customer",
              currency: String(order.currency || "USD").toUpperCase(),
              total: Number.isFinite(parsedTotal) ? parsedTotal : 0,
              paymentMethodId: String(order.payment_method || ""),
            } satisfies OrderNotificationSource,
          }]
        : [];
    });

    let recorded = 0;
    for (let index = 0; index < paidOrders.length; index += 25) {
      const batch = paidOrders.slice(index, index + 25);
      const results = await Promise.all(
        batch.map((order) =>
          this.store.recordReconciledOrder(
            analyticsFingerprint(
              this.config.analyticsHmacSecret,
              "order",
              order.id,
            ),
            order.paidAt,
          ),
        ),
      );
      recorded += results.filter(Boolean).length;
      if (mode === "incremental" && this.onNewPaidOrder) {
        await Promise.all(batch.flatMap((order, batchIndex) => results[batchIndex] && order.notification.id > 0
          ? [this.onNewPaidOrder!(order.notification)]
          : []));
      }
    }

    await this.store.setOrderSyncCursor(startedAt);
    return {
      mode,
      scanned: orders.length,
      paid: paidOrders.length,
      recorded,
    };
  }

  private queueSync(): void {
    if (this.inFlight) return;
    const operation = this.syncOnce()
      .then((result) => {
        this.logger.info(
          `Woo order ${result.mode} scanned ${result.scanned}, ` +
            `found ${result.paid} paid, recorded ${result.recorded}`,
        );
      })
      .catch((error: unknown) => {
        this.logger.error("Woo order reconciliation failed", error);
      });
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined;
    });
  }

  private async fetchOrders(
    mode: WooOrderSyncResult["mode"],
    since: Date,
  ): Promise<WooOrder[]> {
    const orders: WooOrder[] = [];
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page += 1) {
      const url = new URL("/wp-json/wc/v3/orders", `${this.config.baseUrl}/`);
      url.searchParams.set("status", "any");
      url.searchParams.set("per_page", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));
      url.searchParams.set("dates_are_gmt", "true");
      url.searchParams.set("order", "asc");
      if (mode === "backfill") {
        url.searchParams.set("after", since.toISOString());
        url.searchParams.set("orderby", "date");
      } else {
        url.searchParams.set("modified_after", since.toISOString());
        url.searchParams.set("orderby", "modified");
      }

      const response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          Authorization:
            "Basic " +
            Buffer.from(
              `${this.config.consumerKey}:${this.config.consumerSecret}`,
            ).toString("base64"),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        throw new Error(`WooCommerce returned ${response.status}: ${body}`);
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("WooCommerce orders response was not an array");
      }
      orders.push(...(payload as WooOrder[]));

      const headerPages = Number.parseInt(
        response.headers.get("x-wp-totalpages") || "",
        10,
      );
      if (Number.isSafeInteger(headerPages) && headerPages > 0) {
        totalPages = headerPages;
      } else if (payload.length === PAGE_SIZE) {
        totalPages = page + 1;
      }
    }

    return orders;
  }
}
