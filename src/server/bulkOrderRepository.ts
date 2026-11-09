import type { QueryResultRow } from "pg";

import type { Database, SqlExecutor } from "./database.js";
import type {
  BulkAccessCode,
  BulkAccessRequest,
  BulkCustomerTier,
  BulkOrderSettings,
  BulkProductRule,
  BulkQuote,
} from "../shared/bulkOrders.js";

type JsonRecord = Record<string, unknown>;

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function number(value: string | number | null): number {
  return Number(value || 0);
}

interface SettingsRow extends QueryResultRow {
  revision: string | number;
  global_discount: string | number;
  default_minimum: number;
  session_days: number;
  intent_minutes: number;
  public_title: string;
  public_intro: string;
  catalog_mode: "include_all" | "legacy_explicit";
  excluded_category_ids: number[];
  excluded_product_ids: number[];
  updated_by: string;
  updated_at: Date | string;
}

interface RuleRow extends QueryResultRow {
  purchasable_id: string | number;
  product_id: string | number;
  variation_id: string | number;
  catalog_override: BulkProductRule["catalogOverride"];
  availability_override: BulkProductRule["availabilityOverride"];
  minimum_quantity: number | null;
  maximum_quantity: number;
  pricing_mode: BulkProductRule["pricingMode"];
  discount_percent: string | number;
  fixed_unit_price: string | number;
  tiers: BulkProductRule["tiers"];
  revision: string;
  source: BulkProductRule["source"];
  updated_by: string;
  updated_at: Date | string;
}

interface RequestRow extends QueryResultRow {
  id: string | number;
  customer_id: string | number;
  customer_name: string;
  customer_email: string;
  completed_orders: number;
  eligible: boolean;
  status: BulkAccessRequest["status"];
  customer_note: string;
  internal_note: string;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  source: BulkAccessRequest["source"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface CodeRow extends QueryResultRow {
  id: string | number;
  code_suffix: string;
  status: BulkAccessCode["status"];
  expires_at: Date | string | null;
  usage_limit: string | number | null;
  uses: string | number;
  notes: string;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  last_used_at: Date | string | null;
}

interface TierRow extends QueryResultRow {
  customer_id: string | number;
  customer_email: string;
  customer_name: string;
  status: BulkCustomerTier["status"];
  note: string;
  granted_by: string;
  granted_at: Date | string;
  revoked_by: string | null;
  revoked_at: Date | string | null;
}

interface SessionRow extends QueryResultRow {
  id: string | number;
  access_code_id: string | number | null;
  customer_id: string | number;
  source: "code" | "tier";
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

interface IntentRow extends QueryResultRow {
  id: string | number;
  session_id: string | number;
  access_code_id: string | number | null;
  customer_id: string | number;
  cart_payload: Array<{ productId: number; variationId: number; quantity: number }>;
  quote_payload: BulkQuote;
  quote_fingerprint: string;
  status: "open" | "processing" | "ordered" | "expired" | "cancelled";
  order_id: string | number;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapSettings(row: SettingsRow): BulkOrderSettings {
  return {
    revision: number(row.revision),
    globalDiscount: number(row.global_discount),
    defaultMinimum: row.default_minimum,
    sessionDays: row.session_days,
    intentMinutes: row.intent_minutes,
    publicTitle: row.public_title,
    publicIntro: row.public_intro,
    catalogMode: row.catalog_mode,
    excludedCategoryIds: row.excluded_category_ids || [],
    excludedProductIds: row.excluded_product_ids || [],
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapRule(row: RuleRow): BulkProductRule {
  return {
    purchasableId: number(row.purchasable_id), productId: number(row.product_id), variationId: number(row.variation_id),
    catalogOverride: row.catalog_override, availabilityOverride: row.availability_override,
    minimumQuantity: row.minimum_quantity, maximumQuantity: row.maximum_quantity,
    pricingMode: row.pricing_mode, discountPercent: number(row.discount_percent), fixedUnitPrice: number(row.fixed_unit_price),
    tiers: Array.isArray(row.tiers) ? row.tiers : [], revision: row.revision, source: row.source,
    updatedBy: row.updated_by, updatedAt: iso(row.updated_at)!,
  };
}

function mapRequest(row: RequestRow): BulkAccessRequest {
  return {
    id: number(row.id), customerId: number(row.customer_id), customerName: row.customer_name,
    customerEmail: row.customer_email, completedOrders: row.completed_orders, eligible: row.eligible,
    status: row.status, customerNote: row.customer_note, internalNote: row.internal_note,
    reviewedBy: row.reviewed_by, reviewedAt: iso(row.reviewed_at), source: row.source,
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  };
}

function mapCode(row: CodeRow): BulkAccessCode {
  return {
    id: number(row.id), codeSuffix: row.code_suffix, status: row.status, expiresAt: iso(row.expires_at),
    usageLimit: row.usage_limit === null ? null : number(row.usage_limit), uses: number(row.uses), notes: row.notes,
    createdBy: row.created_by, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, lastUsedAt: iso(row.last_used_at),
  };
}

function mapTier(row: TierRow): BulkCustomerTier {
  return {
    customerId: number(row.customer_id), customerEmail: row.customer_email, customerName: row.customer_name,
    status: row.status, note: row.note, grantedBy: row.granted_by, grantedAt: iso(row.granted_at)!,
    revokedBy: row.revoked_by, revokedAt: iso(row.revoked_at),
  };
}

export class BulkOrderRepository {
  constructor(private readonly database: Database) {}

  async settings(executor: SqlExecutor = this.database): Promise<BulkOrderSettings> {
    const result = await executor.query<SettingsRow>("SELECT * FROM bulk_order_settings WHERE singleton = 1");
    if (!result.rows[0]) throw new Error("Bulk order settings are not initialized");
    return mapSettings(result.rows[0]);
  }

  async saveSettings(input: Omit<BulkOrderSettings, "revision" | "updatedAt">, expectedRevision?: number): Promise<BulkOrderSettings> {
    return this.database.transaction(async (client) => {
      const current = await client.query<SettingsRow>("SELECT * FROM bulk_order_settings WHERE singleton = 1 FOR UPDATE");
      const row = current.rows[0];
      if (!row) throw new Error("Bulk order settings are not initialized");
      if (expectedRevision !== undefined && number(row.revision) !== expectedRevision) throw new Error("revision_conflict");
      const saved = await client.query<SettingsRow>(
        `UPDATE bulk_order_settings SET revision = revision + 1, global_discount = $1, default_minimum = $2,
          session_days = $3, intent_minutes = $4, public_title = $5, public_intro = $6, catalog_mode = $7,
          excluded_category_ids = $8, excluded_product_ids = $9, updated_by = $10, updated_at = now()
         WHERE singleton = 1 RETURNING *`,
        [input.globalDiscount, input.defaultMinimum, input.sessionDays, input.intentMinutes, input.publicTitle,
          input.publicIntro, input.catalogMode, input.excludedCategoryIds, input.excludedProductIds, input.updatedBy],
      );
      const value = mapSettings(saved.rows[0]!);
      await this.event(client, "settings_published", input.updatedBy, "settings", "1", value as unknown as JsonRecord);
      return value;
    });
  }

  async listRules(): Promise<BulkProductRule[]> {
    return (await this.database.query<RuleRow>("SELECT * FROM bulk_product_rules ORDER BY updated_at DESC")).rows.map(mapRule);
  }

  async saveRule(rule: BulkProductRule, actor: string): Promise<BulkProductRule> {
    const saved = await this.database.query<RuleRow>(
      `INSERT INTO bulk_product_rules (purchasable_id, product_id, variation_id, catalog_override, availability_override,
        minimum_quantity, maximum_quantity, pricing_mode, discount_percent, fixed_unit_price, tiers, revision, source, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
       ON CONFLICT (purchasable_id) DO UPDATE SET product_id=EXCLUDED.product_id, variation_id=EXCLUDED.variation_id,
        catalog_override=EXCLUDED.catalog_override, availability_override=EXCLUDED.availability_override,
        minimum_quantity=EXCLUDED.minimum_quantity, maximum_quantity=EXCLUDED.maximum_quantity,
        pricing_mode=EXCLUDED.pricing_mode, discount_percent=EXCLUDED.discount_percent,
        fixed_unit_price=EXCLUDED.fixed_unit_price, tiers=EXCLUDED.tiers, revision=EXCLUDED.revision,
        source=EXCLUDED.source, updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING *`,
      [rule.purchasableId, rule.productId, rule.variationId, rule.catalogOverride, rule.availabilityOverride,
        rule.minimumQuantity, rule.maximumQuantity, rule.pricingMode, rule.discountPercent, rule.fixedUnitPrice,
        JSON.stringify(rule.tiers), rule.revision, rule.source, actor],
    );
    await this.event(this.database, "rule_saved", actor, "product_rule", String(rule.purchasableId), { revision: rule.revision });
    return mapRule(saved.rows[0]!);
  }

  async deleteRule(purchasableId: number, actor: string): Promise<boolean> {
    const result = await this.database.query("DELETE FROM bulk_product_rules WHERE purchasable_id = $1", [purchasableId]);
    if (result.rowCount) await this.event(this.database, "rule_deleted", actor, "product_rule", String(purchasableId), {});
    return Boolean(result.rowCount);
  }

  async listRequests(): Promise<BulkAccessRequest[]> {
    return (await this.database.query<RequestRow>("SELECT * FROM bulk_access_requests ORDER BY created_at DESC LIMIT 500")).rows.map(mapRequest);
  }

  async currentRequest(customerId: number): Promise<BulkAccessRequest | null> {
    const result = await this.database.query<RequestRow>("SELECT * FROM bulk_access_requests WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1", [customerId]);
    return result.rows[0] ? mapRequest(result.rows[0]) : null;
  }

  async submitRequest(identity: { customerId: number; displayName: string; email: string; completedOrders: number }, note: string): Promise<BulkAccessRequest> {
    const result = await this.database.query<RequestRow>(
      `INSERT INTO bulk_access_requests (customer_id, customer_name, customer_email, completed_orders, eligible, status, customer_note)
       VALUES ($1,$2,$3,$4,$5,'pending',$6)
       ON CONFLICT (customer_id) WHERE status='pending' DO UPDATE SET customer_name=EXCLUDED.customer_name,
        customer_email=EXCLUDED.customer_email, completed_orders=EXCLUDED.completed_orders,
        eligible=EXCLUDED.eligible, customer_note=EXCLUDED.customer_note, updated_at=now()
       RETURNING *`,
      [identity.customerId, identity.displayName, identity.email, identity.completedOrders, identity.completedOrders > 0, note],
    );
    return mapRequest(result.rows[0]!);
  }

  async reviewRequest(id: number, status: "approved" | "rejected" | "archived", note: string, actor: string): Promise<BulkAccessRequest | null> {
    const result = await this.database.query<RequestRow>(
      `UPDATE bulk_access_requests SET status=$2, internal_note=$3, reviewed_by=$4, reviewed_at=now(), updated_at=now()
       WHERE id=$1 RETURNING *`, [id, status, note, actor],
    );
    return result.rows[0] ? mapRequest(result.rows[0]) : null;
  }

  async listCodes(): Promise<BulkAccessCode[]> {
    return (await this.database.query<CodeRow>("SELECT * FROM bulk_access_codes ORDER BY created_at DESC LIMIT 500")).rows.map(mapCode);
  }

  async insertCode(input: { lookup: string; suffix: string; expiresAt: string | null; usageLimit: number | null; notes: string; actor: string }): Promise<BulkAccessCode> {
    const result = await this.database.query<CodeRow>(
      `INSERT INTO bulk_access_codes (code_lookup, code_suffix, expires_at, usage_limit, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.lookup, input.suffix, input.expiresAt, input.usageLimit, input.notes, input.actor],
    );
    return mapCode(result.rows[0]!);
  }

  async setCodeStatus(id: number, status: "active" | "paused" | "revoked", actor: string): Promise<BulkAccessCode | null> {
    const result = await this.database.query<CodeRow>(
      `UPDATE bulk_access_codes SET status=$2, revoked_at=CASE WHEN $2='revoked' THEN now() ELSE NULL END, updated_at=now()
       WHERE id=$1 RETURNING *`, [id, status],
    );
    if (status === "revoked") await this.database.query("UPDATE bulk_sessions SET revoked_at=now() WHERE access_code_id=$1 AND revoked_at IS NULL", [id]);
    if (result.rows[0]) await this.event(this.database, `code_${status}`, actor, "access_code", String(id), {});
    return result.rows[0] ? mapCode(result.rows[0]) : null;
  }

  async consumeCode(lookup: string): Promise<{ id: number; expiresAt: string | null } | null> {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ id: string | number; expires_at: Date | string | null } & QueryResultRow>(
        `UPDATE bulk_access_codes SET uses=uses+1,last_used_at=now(),updated_at=now()
         WHERE code_lookup=$1 AND status='active' AND (expires_at IS NULL OR expires_at>now())
           AND (usage_limit IS NULL OR uses<usage_limit)
         RETURNING id, expires_at`, [lookup],
      );
      const row = result.rows[0];
      return row ? { id: number(row.id), expiresAt: iso(row.expires_at) } : null;
    });
  }

  async listTiers(): Promise<BulkCustomerTier[]> {
    return (await this.database.query<TierRow>("SELECT * FROM bulk_customer_tiers ORDER BY granted_at DESC LIMIT 500")).rows.map(mapTier);
  }

  async tier(customerId: number): Promise<BulkCustomerTier | null> {
    const result = await this.database.query<TierRow>("SELECT * FROM bulk_customer_tiers WHERE customer_id=$1", [customerId]);
    return result.rows[0] ? mapTier(result.rows[0]) : null;
  }

  async grantTier(input: { customerId: number; email: string; name: string; note: string; actor: string }): Promise<BulkCustomerTier> {
    const result = await this.database.query<TierRow>(
      `INSERT INTO bulk_customer_tiers (customer_id,customer_email,customer_name,status,note,granted_by)
       VALUES ($1,$2,$3,'active',$4,$5)
       ON CONFLICT (customer_id) DO UPDATE SET customer_email=EXCLUDED.customer_email,customer_name=EXCLUDED.customer_name,
        status='active',note=EXCLUDED.note,granted_by=EXCLUDED.granted_by,granted_at=now(),revoked_by=NULL,revoked_at=NULL
       RETURNING *`, [input.customerId, input.email, input.name, input.note, input.actor],
    );
    return mapTier(result.rows[0]!);
  }

  async revokeTier(customerId: number, actor: string): Promise<BulkCustomerTier | null> {
    const result = await this.database.query<TierRow>(
      "UPDATE bulk_customer_tiers SET status='revoked',revoked_by=$2,revoked_at=now() WHERE customer_id=$1 RETURNING *",
      [customerId, actor],
    );
    await this.database.query("UPDATE bulk_sessions SET revoked_at=now() WHERE customer_id=$1 AND source='tier' AND revoked_at IS NULL", [customerId]);
    return result.rows[0] ? mapTier(result.rows[0]) : null;
  }

  async createSession(input: { tokenLookup: string; accessCodeId: number | null; customerId: number; source: "code" | "tier"; expiresAt: string; ipHash: string; userAgentHash: string }): Promise<number> {
    if (input.source === "tier") await this.database.query("UPDATE bulk_sessions SET revoked_at=now() WHERE customer_id=$1 AND source='tier' AND revoked_at IS NULL", [input.customerId]);
    const result = await this.database.query<{ id: string | number } & QueryResultRow>(
      `INSERT INTO bulk_sessions (token_lookup,access_code_id,customer_id,source,expires_at,ip_hash,user_agent_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [input.tokenLookup, input.accessCodeId, input.customerId, input.source, input.expiresAt, input.ipHash, input.userAgentHash],
    );
    return number(result.rows[0]!.id);
  }

  async session(tokenLookup: string): Promise<SessionRow | null> {
    const result = await this.database.query<SessionRow>(
      `SELECT s.* FROM bulk_sessions s LEFT JOIN bulk_access_codes c ON c.id=s.access_code_id
       WHERE s.token_lookup=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
         AND (s.source='tier' OR (c.status='active' AND (c.expires_at IS NULL OR c.expires_at>now())))`, [tokenLookup],
    );
    if (result.rows[0]) await this.database.query("UPDATE bulk_sessions SET last_seen_at=now() WHERE id=$1 AND last_seen_at<now()-interval '5 minutes'", [result.rows[0].id]);
    return result.rows[0] || null;
  }

  async revokeSession(tokenLookup: string): Promise<void> {
    await this.database.query("UPDATE bulk_sessions SET revoked_at=now() WHERE token_lookup=$1 AND revoked_at IS NULL", [tokenLookup]);
  }

  async createIntent(input: { tokenLookup: string; session: SessionRow; items: unknown; quote: BulkQuote; expiresAt: string }): Promise<number> {
    const result = await this.database.query<{ id: string | number } & QueryResultRow>(
      `INSERT INTO bulk_checkout_intents (token_lookup,session_id,access_code_id,customer_id,cart_payload,quote_payload,quote_fingerprint,expires_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) RETURNING id`,
      [input.tokenLookup, input.session.id, input.session.access_code_id, input.session.customer_id,
        JSON.stringify(input.items), JSON.stringify(input.quote), input.quote.fingerprint, input.expiresAt],
    );
    return number(result.rows[0]!.id);
  }

  async intent(tokenLookup: string): Promise<IntentRow | null> {
    const result = await this.database.query<IntentRow>("SELECT * FROM bulk_checkout_intents WHERE token_lookup=$1", [tokenLookup]);
    return result.rows[0] || null;
  }

  async bindAndClaimIntent(id: number, customerId: number): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE bulk_checkout_intents SET customer_id=$2,status='processing',updated_at=now()
       WHERE id=$1 AND status='open' AND expires_at>now() AND (customer_id=0 OR customer_id=$2)`, [id, customerId],
    );
    return result.rowCount === 1;
  }

  async releaseIntent(id: number): Promise<void> {
    await this.database.query("UPDATE bulk_checkout_intents SET status='open',updated_at=now() WHERE id=$1 AND status='processing' AND order_id=0", [id]);
  }

  async completeIntent(id: number, orderId: number): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE bulk_checkout_intents SET status='ordered',order_id=$2,updated_at=now()
       WHERE id=$1 AND (status='processing' OR (status='ordered' AND order_id=$2)) RETURNING id`, [id, orderId],
    );
    return Boolean(result.rows[0]);
  }

  async stats(): Promise<{ activeCodes: number; pendingRequests: number; openCheckouts: number; completedBulkOrders: number }> {
    const result = await this.database.query<{ active_codes: string; pending_requests: string; open_checkouts: string; completed_orders: string } & QueryResultRow>(
      `SELECT
        (SELECT count(*) FROM bulk_access_codes WHERE status='active' AND (expires_at IS NULL OR expires_at>now())) active_codes,
        (SELECT count(*) FROM bulk_access_requests WHERE status='pending') pending_requests,
        (SELECT count(*) FROM bulk_checkout_intents WHERE status IN ('open','processing') AND expires_at>now()) open_checkouts,
        (SELECT count(*) FROM bulk_checkout_intents WHERE status='ordered') completed_orders`,
    );
    const row = result.rows[0]!;
    return { activeCodes: number(row.active_codes), pendingRequests: number(row.pending_requests), openCheckouts: number(row.open_checkouts), completedBulkOrders: number(row.completed_orders) };
  }

  async recentEvents(): Promise<Array<{ id: number; eventType: string; actor: string; entityType: string; entityId: string; payload: JsonRecord; createdAt: string }>> {
    const result = await this.database.query<QueryResultRow & { id: string | number; event_type: string; actor: string; entity_type: string; entity_id: string; payload: JsonRecord; created_at: Date | string }>(
      "SELECT * FROM bulk_order_events ORDER BY created_at DESC LIMIT 50",
    );
    return result.rows.map((row) => ({ id: number(row.id), eventType: row.event_type, actor: row.actor, entityType: row.entity_type, entityId: row.entity_id, payload: row.payload || {}, createdAt: iso(row.created_at)! }));
  }

  async migrationState(): Promise<{ imported: boolean; sourceVersion: string; importedAt: string | null; summary: JsonRecord }> {
    const result = await this.database.query<QueryResultRow & { source_version: string; imported_at: Date | string; summary: JsonRecord }>(
      "SELECT source_version,imported_at,summary FROM bulk_wordpress_imports ORDER BY imported_at DESC LIMIT 1",
    );
    const row = result.rows[0];
    return row ? { imported: true, sourceVersion: row.source_version, importedAt: iso(row.imported_at), summary: row.summary || {} } : { imported: false, sourceVersion: "", importedAt: null, summary: {} };
  }

  async recordImport(input: { sourceKey: string; version: string; hash: string; actor: string; summary: JsonRecord }): Promise<void> {
    await this.database.query(
      `INSERT INTO bulk_wordpress_imports (source_key,source_version,payload_hash,imported_by,summary)
       VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (source_key) DO UPDATE SET source_version=EXCLUDED.source_version,
        payload_hash=EXCLUDED.payload_hash,imported_by=EXCLUDED.imported_by,imported_at=now(),summary=EXCLUDED.summary`,
      [input.sourceKey, input.version, input.hash, input.actor, JSON.stringify(input.summary)],
    );
  }

  async importLegacyCode(input: { id: number; suffix: string; status: BulkAccessCode["status"]; expiresAt: string | null; usageLimit: number | null; uses: number; notes: string; actor: string }): Promise<void> {
    await this.database.query(
      `INSERT INTO bulk_access_codes (code_lookup,code_suffix,status,expires_at,usage_limit,uses,notes,created_by,legacy_wordpress_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (code_lookup) DO NOTHING`,
      [`legacy:${input.id}`.padEnd(64, "0").slice(0, 64), input.suffix, input.status, input.expiresAt, input.usageLimit, input.uses, input.notes, input.actor, input.id],
    );
  }

  async importAccessRequest(input: {
    customerId: number; customerName: string; customerEmail: string; completedOrders: number; eligible: boolean;
    status: BulkAccessRequest["status"]; customerNote: string; internalNote: string; reviewedBy: string | null;
    reviewedAt: string | null; createdAt: string; updatedAt: string;
  }): Promise<void> {
    const existing = await this.database.query(
      `SELECT id FROM bulk_access_requests WHERE customer_id=$1 AND status=$2 AND created_at=$3::timestamptz LIMIT 1`,
      [input.customerId, input.status, input.createdAt],
    );
    if (existing.rows[0]) return;
    await this.database.query(
      `INSERT INTO bulk_access_requests (customer_id,customer_name,customer_email,completed_orders,eligible,status,
        customer_note,internal_note,reviewed_by,reviewed_at,source,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'wordpress_import',$11,$12)
       ON CONFLICT DO NOTHING`,
      [input.customerId, input.customerName, input.customerEmail, input.completedOrders, input.eligible, input.status,
        input.customerNote, input.internalNote, input.reviewedBy, input.reviewedAt, input.createdAt, input.updatedAt],
    );
  }

  async event(executor: SqlExecutor, eventType: string, actor: string, entityType: string, entityId: string, payload: JsonRecord): Promise<void> {
    await executor.query(
      "INSERT INTO bulk_order_events (event_type,actor,entity_type,entity_id,payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [eventType, actor, entityType, entityId, JSON.stringify(payload)],
    );
  }
}

export type BulkSessionRecord = SessionRow;
export type BulkIntentRecord = IntentRow;
