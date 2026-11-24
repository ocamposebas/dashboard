import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SqlExecutor } from "./database.js";
import { CommerceServiceError, type WooCommerceGateway } from "./wooCommerceGateway.js";

const STOREFRONT = "https://phaseonelabz.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const REVIEW_DELAY_HOURS = 48;
const REVIEW_SCAN_INTERVAL_MS = 10 * 60_000;
type TokenPurpose = "review" | "unsubscribe";
type DeliveryState = "sending" | "sent" | "uncertain" | "failed";

function signedToken(id: string, secret: string, purpose: TokenPurpose): string {
  const signature = createHmac("sha256", secret).update(`customer-reviews/v1/${purpose}/${id}`).digest("base64url");
  return `${id}.${signature}`;
}

export function reviewLink(id: string, secret: string, purpose: TokenPurpose): URL {
  const url = new URL("/review/", STOREFRONT);
  url.hash = new URLSearchParams({ [purpose]: signedToken(id, secret, purpose) }).toString();
  return url;
}

export function reviewTokenId(token: unknown, secret: string, purpose: TokenPurpose): string | null {
  if (typeof token !== "string" || token.length !== 80) return null;
  const [id = "", signature = ""] = token.split(".");
  if (!UUID.test(id) || !/^[\w-]{43}$/.test(signature)) return null;
  return timingSafeEqual(Buffer.from(signedToken(id, secret, purpose)), Buffer.from(token)) ? id : null;
}

export class CustomerReviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class CustomerReviews {
  private automationRunning = false;

  constructor(
    private readonly database: SqlExecutor,
    private readonly commerce: Pick<WooCommerceGateway, "getOrder" | "sendMarketingEmail">,
    private readonly signingSecret: string,
  ) {}

  async sendInvitation(orderId: number, actor: string, automatic = false) {
    const order = await this.commerce.getOrder(orderId).catch((error: unknown) => {
      if (error instanceof CommerceServiceError && error.status === 404) {
        throw new CustomerReviewError("Order was not found.", 404);
      }
      throw error;
    });
    const eligibleStatus = order.status === "completed" ||
      (automatic && order.status === "processing" && Boolean(order.paidAt));
    if (!eligibleStatus || order.repeatOperations.operationalRepeat || order.refundedTotal > 0) {
      throw new CustomerReviewError("Choose a completed order with no refund or internal reshipment.", 409);
    }
    const recipient = order.billing.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new CustomerReviewError("This order has no valid customer email.", 409);
    }
    const recipientKey = createHmac("sha256", this.signingSecret).update(`reviews-recipient:${recipient}`).digest("hex");
    const { rows } = await this.database.query<{ id: string }>(
      `INSERT INTO customer_review_invitations
         (id, order_id, order_number, recipient_key, created_by, expires_at, delivery_state)
       SELECT $1, $2, $3, $4, $5, now() + interval '30 days', 'sending'
       WHERE NOT EXISTS (SELECT 1 FROM customer_review_opt_outs WHERE recipient_key = $4)
         AND (NOT $6::boolean OR EXISTS (
           SELECT 1 FROM customer_review_automation WHERE id = 1 AND enabled_since IS NOT NULL
         ))
       ON CONFLICT (order_id) DO UPDATE SET delivery_state = 'sending', expires_at = EXCLUDED.expires_at
       WHERE customer_review_invitations.delivery_state = 'failed'
         AND customer_review_invitations.recipient_key = EXCLUDED.recipient_key
         AND customer_review_invitations.submitted_at IS NULL
         AND NOT $6::boolean
       RETURNING id`,
      [randomUUID(), orderId, order.number.slice(0, 80), recipientKey, actor, automatic],
    );
    const id = rows[0]?.id;
    if (!id) throw new CustomerReviewError("An invitation already exists for this order or the customer opted out.", 409);

    const url = reviewLink(id, this.signingSecret, "review").href;
    const unsubscribeUrl = reviewLink(id, this.signingSecret, "unsubscribe").href;
    let state: DeliveryState = "uncertain";
    let sentAt: string | null = null;
    try {
      const result = await this.commerce.sendMarketingEmail({
        eventId: id,
        recipient,
        subject: "How was your Phase One Labz order?",
        html: `<h1 style="font-size:24px">How was your order?</h1><p>Tell us about your experience with Phase One Labz. We welcome honest feedback.</p><p><a href="${url}" style="display:inline-block;padding:13px 20px;background:#173762;color:#fff;text-decoration:none;border-radius:8px">Leave a review</a></p><p style="font-size:12px"><a href="${unsubscribeUrl}">Unsubscribe from review invitations</a><br>Phase One Labz · {{PHASEONE_BUSINESS_ADDRESS}}</p>`,
        text: `Tell us about your experience with Phase One Labz.\n${url}\n\nUnsubscribe: ${unsubscribeUrl}`,
        unsubscribeUrl,
      });
      state = result.state;
      sentAt = result.sentAt;
    } catch (error) {
      if (error instanceof CommerceServiceError && ["phaseone_marketing_mail", "phaseone_marketing_recipient"].includes(error.code)) {
        state = "failed";
      }
    }
    await this.database.query(
      "UPDATE customer_review_invitations SET delivery_state = $2, sent_at = $3 WHERE id = $1",
      [id, state, sentAt],
    );
    return { state };
  }

  startAutomation() {
    const timer = setInterval(() => {
      void this.runAutomation().catch(() => console.warn("Customer review automation could not scan delivered orders."));
    }, REVIEW_SCAN_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  async setAutomation(enabled: boolean) {
    await this.database.query(
      `UPDATE customer_review_automation
       SET enabled_since = CASE WHEN $1::boolean THEN COALESCE(enabled_since, now()) ELSE NULL END
       WHERE id = 1`, [enabled],
    );
  }

  async runAutomation() {
    if (this.automationRunning) return;
    this.automationRunning = true;
    try {
      const { rows } = await this.database.query<{ order_id: string }>(
        `SELECT shipment.order_id
         FROM delivery_monitor_shipments shipment
         JOIN fulfillment_shipping_labels label
           ON label.label_id = shipment.label_id AND label.order_id = shipment.order_id
           AND label.state = 'label_ready' AND label.voided_at IS NULL AND label.provider_mode = 'live'
         JOIN customer_review_automation config ON config.id = 1
         WHERE shipment.status = 'delivered'
           AND shipment.delivered_at >= config.enabled_since
           AND shipment.delivered_at >= now() - interval '14 days'
           AND NOT EXISTS (SELECT 1 FROM customer_review_invitations WHERE order_id = shipment.order_id)
           AND NOT EXISTS (SELECT 1 FROM customer_review_automation_skips WHERE order_id = shipment.order_id)
           AND NOT EXISTS (
             SELECT 1 FROM fulfillment_shipping_labels other
             LEFT JOIN delivery_monitor_shipments tracked ON tracked.label_id = other.label_id
             WHERE other.order_id = shipment.order_id AND other.state = 'label_ready'
               AND other.voided_at IS NULL AND other.provider_mode = 'live'
               AND (tracked.status IS DISTINCT FROM 'delivered' OR tracked.delivered_at IS NULL
                 OR tracked.delivered_at > now() - ($1::int * interval '1 hour'))
           )
         GROUP BY shipment.order_id ORDER BY max(shipment.delivered_at), shipment.order_id LIMIT 10`, [REVIEW_DELAY_HOURS],
      );
      for (const row of rows) {
        try {
          await this.sendInvitation(Number(row.order_id), "automatic-review", true);
        } catch (error) {
          if (error instanceof CustomerReviewError && [404, 409].includes(error.status)) {
            await this.database.query(
              `INSERT INTO customer_review_automation_skips (order_id)
               SELECT $1 WHERE EXISTS (
                 SELECT 1 FROM customer_review_automation WHERE id = 1 AND enabled_since IS NOT NULL
               ) ON CONFLICT DO NOTHING`, [row.order_id],
            );
          } else {
            console.warn("Automatic review invitation could not be prepared for an eligible order.");
          }
        }
      }
    } finally {
      this.automationRunning = false;
    }
  }

  async submit(token: unknown, rating: unknown, message: unknown) {
    const id = reviewTokenId(token, this.signingSecret, "review");
    if (!id) throw new CustomerReviewError("This review link is invalid.", 404);
    const body = typeof message === "string" ? message.replace(/\u0000/g, "").trim() : "";
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5 || body.length > 1200) {
      throw new CustomerReviewError("Choose a rating from 1 to 5 and use at most 1,200 characters.", 400);
    }
    const { rowCount } = await this.database.query(
      `UPDATE customer_review_invitations
       SET rating = $2, body = $3, submitted_at = now()
       WHERE id = $1 AND expires_at > now() AND submitted_at IS NULL AND delivery_state <> 'failed'`,
      [id, rating, body],
    );
    if (rowCount) return;
    const { rows } = await this.database.query<{ submitted: boolean }>(
      "SELECT submitted_at IS NOT NULL AS submitted FROM customer_review_invitations WHERE id = $1", [id],
    );
    if (rows[0]?.submitted) return;
    throw new CustomerReviewError("This review link has expired or is unavailable.", 410);
  }

  async unsubscribe(token: unknown) {
    const id = reviewTokenId(token, this.signingSecret, "unsubscribe");
    if (!id) throw new CustomerReviewError("This unsubscribe link is invalid.", 404);
    await this.database.query(
      `INSERT INTO customer_review_opt_outs (recipient_key)
       SELECT recipient_key FROM customer_review_invitations WHERE id = $1
       ON CONFLICT DO NOTHING`,
      [id],
    );
  }

  async setPublished(id: string, publish: boolean) {
    if (!UUID.test(id)) throw new CustomerReviewError("Review was not found.", 404);
    const { rowCount } = await this.database.query(
      `UPDATE customer_review_invitations SET published_at =
         CASE WHEN $2 THEN COALESCE(published_at, now()) ELSE NULL END
       WHERE id = $1 AND submitted_at IS NOT NULL`,
      [id, publish],
    );
    if (!rowCount) throw new CustomerReviewError("Review was not found.", 404);
  }

  async dashboard() {
    const [{ rows }, { rows: automation }] = await Promise.all([
      this.database.query(
        `SELECT id, order_number, delivery_state, sent_at, rating, body, submitted_at, published_at,
          (created_by = 'automatic-review') AS automatic
         FROM customer_review_invitations
         ORDER BY (submitted_at IS NOT NULL AND published_at IS NULL) DESC, created_at DESC LIMIT 100`,
      ),
      this.database.query<{ enabled: boolean }>(
        "SELECT enabled_since IS NOT NULL AS enabled FROM customer_review_automation WHERE id = 1",
      ),
    ]);
    return { invitations: rows, automation: { enabled: automation[0]?.enabled ?? false, delayHours: REVIEW_DELAY_HOURS } };
  }

  async published() {
    const [{ rows: [aggregate] }, { rows: reviews }] = await Promise.all([
      this.database.query<{ count: number; rating: number | null }>(
        `SELECT count(*)::int AS count, avg(rating)::float8 AS rating
         FROM customer_review_invitations WHERE published_at IS NOT NULL`,
      ),
      this.database.query(
        `SELECT id, rating, body FROM customer_review_invitations
         WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 6`,
      ),
    ]);
    return { count: aggregate?.count ?? 0, rating: aggregate?.rating ?? null, reviews };
  }
}
