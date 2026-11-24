import { createHmac, timingSafeEqual } from "node:crypto";
import type { SqlExecutor } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type TokenPurpose = "review" | "unsubscribe";

function signedToken(id: string, secret: string, purpose: TokenPurpose): string {
  const signature = createHmac("sha256", secret).update(`customer-reviews/v1/${purpose}/${id}`).digest("base64url");
  return `${id}.${signature}`;
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
  constructor(
    private readonly database: SqlExecutor,
    private readonly signingSecret: string,
  ) {}

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
    const { rows } = await this.database.query(
      `SELECT id, order_number, delivery_state, sent_at, rating, body, submitted_at, published_at,
          (created_by = 'automatic-review') AS automatic
         FROM customer_review_invitations
         ORDER BY (submitted_at IS NOT NULL AND published_at IS NULL) DESC, created_at DESC LIMIT 100`,
    );
    return { invitations: rows };
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
