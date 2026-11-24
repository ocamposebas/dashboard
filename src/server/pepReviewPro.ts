import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type { Database } from "./database.js";
import type { CommerceOrder, WooCommerceGateway } from "./wooCommerceGateway.js";

const API = "https://pepreviewpro.com/api/v1";
const STORE = "phase-one-labz";
const SYNC_INTERVAL_MS = 5 * 60_000;
const SYNC_OVERLAP_MS = 10 * 60_000;

type PepStatus = "completed" | "refunded" | "cancelled";

type Connection = {
  encrypted_key: string;
  enabled_at: Date;
  cursor_at: Date;
  last_success: Date | null;
  last_error: string | null;
};

function orderPayload(order: CommerceOrder, status: PepStatus) {
  if (status !== "completed") return { id: String(order.id), status };
  return {
    id: String(order.id),
    status,
    email: order.billing.email.trim().slice(0, 255),
    name: [order.billing.firstName, order.billing.lastName].filter(Boolean).join(" ").slice(0, 200),
    completed_at: order.completedAt,
    line_items: order.lineItems
      .filter((line) => line.productId > 0 && line.quantity > 0 && line.name.trim())
      .slice(0, 500)
      .map((line) => ({
        product_id: String(line.productId),
        ...(line.variationId > 0 ? { variation_id: String(line.variationId) } : {}),
        name: line.name.trim().slice(0, 255),
        quantity: line.quantity,
      })),
  };
}

function cancellationStatus(order: CommerceOrder): PepStatus | null {
  if (order.status === "refunded" || order.refundedTotal > 0) return "refunded";
  if (["cancelled", "failed", "trash"].includes(order.status)) return "cancelled";
  return null;
}

export class PepReviewPro {
  private readonly encryptionKey: Buffer;
  private timer?: NodeJS.Timeout;
  private pending: Promise<void> | undefined;

  constructor(
    private readonly database: Database,
    private readonly commerce: Pick<WooCommerceGateway, "listOrdersModifiedSince">,
    secret: string,
  ) {
    this.encryptionKey = createHmac("sha256", secret).update("phaseone-pepreviewpro-key-v1").digest();
  }

  async connect(value: unknown): Promise<void> {
    const key = typeof value === "string" ? value.trim() : "";
    if (!/^sk_live_[A-Za-z0-9_-]{12,160}$/.test(key)) throw new Error("Enter the PepReviewPro store key.");
    const response = await this.request("/my-stores?store=" + STORE, key);
    const data = await response.json() as { stores?: { slug?: string }[] };
    if (!data.stores?.some((store) => store.slug === STORE)) throw new Error("This key could not verify the Phase One Labz store.");

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const contents = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
    const encrypted = Buffer.concat([iv, cipher.getAuthTag(), contents]).toString("base64url");
    await this.database.query(
      `INSERT INTO pep_review_connection (id, encrypted_key, enabled_at, cursor_at)
       VALUES (1, $1, now(), now())
       ON CONFLICT (id) DO UPDATE SET encrypted_key = EXCLUDED.encrypted_key, last_error = NULL`, [encrypted],
    );
    this.scheduleSync();
  }

  async status() {
    const { rows } = await this.database.query<Pick<Connection, "last_success" | "last_error">>(
      "SELECT last_success, last_error FROM pep_review_connection WHERE id = 1",
    );
    return {
      connected: Boolean(rows.length),
      lastSuccess: rows[0]?.last_success?.toISOString() ?? null,
      error: rows[0]?.last_error ?? null,
    };
  }

  start(): void {
    this.scheduleSync();
    this.timer = setInterval(() => this.scheduleSync(), SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.pending;
  }

  private scheduleSync(): void {
    if (this.pending) return;
    this.pending = this.sync().catch(() => {
      console.warn("PepReviewPro order synchronization could not complete.");
    }).finally(() => { this.pending = undefined; });
  }

  private async request(path: string, key: string, body?: string): Promise<Response> {
    const headers = new Headers({ Authorization: "Bearer " + key, Accept: "application/json" });
    if (body) {
      headers.set("Content-Type", "application/json");
      headers.set("Idempotency-Key", "phase-one-" + createHash("sha256").update(body).digest("hex"));
    }
    const response = await fetch(API + path, {
      method: body ? "POST" : "GET", headers, ...(body ? { body } : {}),
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`PepReviewPro returned HTTP ${response.status}.`);
    return response;
  }

  private async sync(): Promise<void> {
    await this.database.withClient(async (client) => {
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(1243090625) AS locked");
      if (!lock.rows[0]?.locked) return;
      try {
        const { rows } = await client.query<Connection>("SELECT * FROM pep_review_connection WHERE id = 1");
        const connection = rows[0];
        if (!connection) return;
        const end = new Date(Date.now() - 60_000);
        if (end <= connection.cursor_at) return;
        const from = new Date(Math.max(connection.enabled_at.getTime(), connection.cursor_at.getTime() - SYNC_OVERLAP_MS));
        const encrypted = Buffer.from(connection.encrypted_key, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, encrypted.subarray(0, 12));
        decipher.setAuthTag(encrypted.subarray(12, 28));
        const key = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString("utf8");

        const orders = (await this.commerce.listOrdersModifiedSince(from.toISOString(), end.toISOString()))
          .filter((order) => order.modifiedAt && Date.parse(order.modifiedAt) <= end.getTime());
        const acknowledged = orders.length ? await client.query<{ order_id: string; last_status: PepStatus }>(
          "SELECT order_id, last_status FROM pep_review_sent_orders WHERE order_id = ANY($1::bigint[])",
          [orders.map((order) => order.id)],
        ) : { rows: [] };
        const sent = new Map(acknowledged.rows.map((row) => [Number(row.order_id), row.last_status]));

        for (const order of orders) {
          const previous = sent.get(order.id);
          const cancelled = cancellationStatus(order);
          const eligible = order.status === "completed" && order.completedAt &&
            Date.parse(order.completedAt) >= connection.enabled_at.getTime() &&
            !order.repeatOperations.operationalRepeat && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.billing.email.trim());
          const status = cancelled ? previous && cancelled : eligible ? "completed" : null;
          if (!status || previous === status) continue;

          const payload = orderPayload(order, status);
          if ("line_items" in payload && !payload.line_items?.length) continue;
          const result = await this.request("/orders", key, JSON.stringify({ store: STORE, orders: [payload] }));
          const receipt = await result.json() as { results?: { id?: string; status?: string }[] };
          const item = receipt.results?.[0];
          if (item?.id !== String(order.id) || !["created", "updated", "unchanged"].includes(item?.status ?? "")) {
            throw new Error("PepReviewPro did not acknowledge the order update.");
          }
          await client.query(
            `INSERT INTO pep_review_sent_orders (order_id, last_status) VALUES ($1, $2)
             ON CONFLICT (order_id) DO UPDATE SET last_status = EXCLUDED.last_status`,
            [order.id, status],
          );
        }
        await client.query(
          "UPDATE pep_review_connection SET cursor_at = $1, last_success = now(), last_error = NULL WHERE id = 1", [end],
        );
      } catch (error) {
        const message = error instanceof Error && /^PepReviewPro (returned HTTP \d{3}\.|did not acknowledge the order update\.)$/.test(error.message)
          ? error.message : "Order sync could not complete. The next scan will retry.";
        await client.query("UPDATE pep_review_connection SET last_error = $1 WHERE id = 1", [message]);
        throw error;
      } finally {
        await client.query("SELECT pg_advisory_unlock(1243090625)");
      }
    });
  }
}
