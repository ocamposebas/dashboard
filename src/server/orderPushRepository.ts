import type { Database } from "./database.js";

export interface WebPushKeyMaterial {
  publicKey: string;
  privateKey: string;
}

export interface BrowserPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface StoredPushSubscription extends BrowserPushSubscription {
  userId: string;
}

interface PushSettingsRow {
  public_key: string;
  private_key: string;
}

interface PushSubscriptionRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function requiredBoundedString(value: unknown, maximum: number, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} is invalid`);
  return normalized;
}

export function normalizeBrowserPushSubscription(value: unknown): BrowserPushSubscription {
  if (!value || typeof value !== "object") throw new Error("A push subscription is required");
  const input = value as Record<string, unknown>;
  const keys = input.keys;
  if (!keys || typeof keys !== "object") throw new Error("Push encryption keys are required");
  const endpoint = requiredBoundedString(input.endpoint, 4_096, "Push endpoint");
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== "https:") throw new Error("Push endpoint must use HTTPS");
  const keyInput = keys as Record<string, unknown>;
  const p256dh = requiredBoundedString(keyInput.p256dh, 256, "Push public key");
  const auth = requiredBoundedString(keyInput.auth, 128, "Push authentication key");
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) {
    throw new Error("Push encryption keys are invalid");
  }
  return { endpoint, keys: { p256dh, auth } };
}

export class OrderPushRepository {
  constructor(private readonly database: Database) {}

  async getOrCreateKeyMaterial(factory: () => WebPushKeyMaterial): Promise<WebPushKeyMaterial> {
    const existing = await this.database.query<PushSettingsRow>(
      "SELECT public_key, private_key FROM web_push_settings WHERE id = 1",
    );
    const first = existing.rows[0];
    if (first) return { publicKey: first.public_key, privateKey: first.private_key };

    const generated = factory();
    await this.database.query(
      `INSERT INTO web_push_settings (id, public_key, private_key)
       VALUES (1, $1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [generated.publicKey, generated.privateKey],
    );
    const saved = await this.database.query<PushSettingsRow>(
      "SELECT public_key, private_key FROM web_push_settings WHERE id = 1",
    );
    const material = saved.rows[0];
    if (!material) throw new Error("Web Push key material could not be initialized");
    return { publicKey: material.public_key, privateKey: material.private_key };
  }

  async upsert(userId: string, subscription: BrowserPushSubscription, userAgent: string): Promise<void> {
    await this.database.query(
      `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         updated_at = now(),
         failure_count = 0`,
      [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent.slice(0, 512)],
    );
  }

  async remove(userId: string, endpoint: string): Promise<void> {
    await this.database.query(
      "DELETE FROM web_push_subscriptions WHERE user_id = $1 AND endpoint = $2",
      [userId, endpoint],
    );
  }

  async removeEndpoint(endpoint: string): Promise<void> {
    await this.database.query("DELETE FROM web_push_subscriptions WHERE endpoint = $1", [endpoint]);
  }

  async list(): Promise<StoredPushSubscription[]> {
    const result = await this.database.query<PushSubscriptionRow>(
      "SELECT user_id, endpoint, p256dh, auth FROM web_push_subscriptions ORDER BY id",
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }));
  }

  async markSuccess(endpoint: string): Promise<void> {
    await this.database.query(
      `UPDATE web_push_subscriptions
       SET last_success_at = now(), failure_count = 0, updated_at = now()
       WHERE endpoint = $1`,
      [endpoint],
    );
  }

  async markFailure(endpoint: string): Promise<void> {
    await this.database.query(
      `UPDATE web_push_subscriptions
       SET failure_count = failure_count + 1, updated_at = now()
       WHERE endpoint = $1`,
      [endpoint],
    );
  }
}
