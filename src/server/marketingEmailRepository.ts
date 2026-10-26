import { randomUUID } from "node:crypto";

import type { Database, SqlExecutor } from "./database.js";

export type MarketingContactStatus = "subscribed" | "unconfirmed" | "unsubscribed" | "bounced";
export type MarketingContactSource = "woocommerce" | "omnisend" | "manual";

export interface MarketingContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  source: MarketingContactSource;
  status?: MarketingContactStatus;
  tags?: string[];
  wpCustomerId?: number | null;
  consentRecordedAt?: string | null;
}

export interface MarketingCampaignInput {
  name: string;
  templateKey: string;
  subject: string;
  preheader: string;
  heading: string;
  message: string;
  buttonLabel: string;
  buttonUrl: string;
  audienceTag: string;
  actorId: string;
  actorName: string;
}

interface ContactRow {
  id: string; email: string; first_name: string; last_name: string;
  source: MarketingContactSource; status: MarketingContactStatus; tags: string[];
  wp_customer_id: string | null; consent_recorded_at: Date | string | null;
  unsubscribed_at: Date | string | null; last_emailed_at: Date | string | null;
  created_at: Date | string; updated_at: Date | string;
}

interface CampaignRow {
  id: string; name: string; template_key: string; subject: string; preheader: string;
  heading: string; message: string; button_label: string; button_url: string;
  audience_tag: string; status: string; recipient_count: number; sent_count: number;
  failed_count: number; uncertain_count: number; created_by_name: string;
  created_at: Date | string; updated_at: Date | string;
  launched_at: Date | string | null; completed_at: Date | string | null;
}

interface DeliveryRow extends CampaignRow {
  delivery_id: string;
  event_id: string;
  contact_id: string;
  email: string;
  first_name: string;
  last_name: string;
  attempt_count: number;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function mapContact(row: ContactRow) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email.split("@")[0] || "Contact",
    source: row.source,
    status: row.status,
    tags: row.tags || [],
    wpCustomerId: row.wp_customer_id ? Number(row.wp_customer_id) : null,
    consentRecordedAt: iso(row.consent_recorded_at),
    unsubscribedAt: iso(row.unsubscribed_at),
    lastEmailedAt: iso(row.last_emailed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCampaign(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    templateKey: row.template_key,
    subject: row.subject,
    preheader: row.preheader,
    heading: row.heading,
    message: row.message,
    buttonLabel: row.button_label,
    buttonUrl: row.button_url,
    audienceTag: row.audience_tag,
    status: row.status,
    recipientCount: Number(row.recipient_count) || 0,
    sentCount: Number(row.sent_count) || 0,
    failedCount: Number(row.failed_count) || 0,
    uncertainCount: Number(row.uncertain_count) || 0,
    createdByName: row.created_by_name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    launchedAt: iso(row.launched_at),
    completedAt: iso(row.completed_at),
  };
}

export class MarketingEmailRepository {
  constructor(private readonly database: Database) {}

  async dashboard(search = "", status = "all") {
    const normalizedSearch = search.trim().slice(0, 120);
    const normalizedStatus = ["subscribed", "unconfirmed", "unsubscribed", "bounced"].includes(status) ? status : "all";
    const [counts, contacts, campaigns, tags] = await Promise.all([
      this.database.query<{ total: string; subscribed: string; unconfirmed: string; unsubscribed: string; bounced: string }>(`
        SELECT count(*)::text AS total,
          count(*) FILTER (WHERE status = 'subscribed')::text AS subscribed,
          count(*) FILTER (WHERE status = 'unconfirmed')::text AS unconfirmed,
          count(*) FILTER (WHERE status = 'unsubscribed')::text AS unsubscribed,
          count(*) FILTER (WHERE status = 'bounced')::text AS bounced
        FROM marketing_contacts
      `),
      this.database.query<ContactRow>(`
        SELECT * FROM marketing_contacts
        WHERE ($1 = '' OR email ILIKE '%' || $1 || '%' OR first_name ILIKE '%' || $1 || '%' OR last_name ILIKE '%' || $1 || '%')
          AND ($2 = 'all' OR status = $2)
        ORDER BY updated_at DESC LIMIT 150
      `, [normalizedSearch, normalizedStatus]),
      this.database.query<CampaignRow>(`
        SELECT * FROM marketing_email_campaigns ORDER BY created_at DESC LIMIT 40
      `),
      this.database.query<{ tag: string; contacts: string }>(`
        SELECT tag, count(*)::text AS contacts
        FROM marketing_contacts, unnest(tags) AS tag
        WHERE status = 'subscribed' AND length(trim(tag)) > 0
        GROUP BY tag ORDER BY count(*) DESC, tag ASC LIMIT 50
      `),
    ]);
    const count = counts.rows[0] || { total: "0", subscribed: "0", unconfirmed: "0", unsubscribed: "0", bounced: "0" };
    return {
      counts: {
        total: Number(count.total) || 0,
        subscribed: Number(count.subscribed) || 0,
        unconfirmed: Number(count.unconfirmed) || 0,
        unsubscribed: Number(count.unsubscribed) || 0,
        bounced: Number(count.bounced) || 0,
      },
      contacts: contacts.rows.map(mapContact),
      campaigns: campaigns.rows.map(mapCampaign),
      tags: tags.rows.map((item) => ({ tag: item.tag, contacts: Number(item.contacts) || 0 })),
    };
  }

  async upsertContacts(inputs: MarketingContactInput[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;
    await this.database.transaction(async (client) => {
      for (const input of inputs) {
        const email = input.email.trim().toLocaleLowerCase("en");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
          skipped += 1;
          continue;
        }
        const status = input.status || "unconfirmed";
        const tags = [...new Set((input.tags || []).map((tag) => tag.trim().toLocaleLowerCase("en")).filter(Boolean))].slice(0, 30);
        await client.query(`
          INSERT INTO marketing_contacts (
            id, email, first_name, last_name, source, status, tags, wp_customer_id,
            consent_recorded_at, unsubscribed_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $6 = 'unsubscribed' THEN now() ELSE NULL END,now(),now())
          ON CONFLICT (lower(email)) DO UPDATE SET
            first_name = CASE WHEN EXCLUDED.first_name <> '' THEN EXCLUDED.first_name ELSE marketing_contacts.first_name END,
            last_name = CASE WHEN EXCLUDED.last_name <> '' THEN EXCLUDED.last_name ELSE marketing_contacts.last_name END,
            source = EXCLUDED.source,
            status = CASE
              WHEN marketing_contacts.status = 'unsubscribed' AND EXCLUDED.status <> 'unsubscribed' THEN 'unsubscribed'
              ELSE EXCLUDED.status
            END,
            tags = ARRAY(SELECT DISTINCT value FROM unnest(marketing_contacts.tags || EXCLUDED.tags) AS value WHERE value <> ''),
            wp_customer_id = COALESCE(EXCLUDED.wp_customer_id, marketing_contacts.wp_customer_id),
            consent_recorded_at = COALESCE(marketing_contacts.consent_recorded_at, EXCLUDED.consent_recorded_at),
            unsubscribed_at = CASE
              WHEN EXCLUDED.status = 'unsubscribed' THEN COALESCE(marketing_contacts.unsubscribed_at, now())
              ELSE marketing_contacts.unsubscribed_at
            END,
            updated_at = now()
        `, [
          randomUUID(), email, (input.firstName || "").trim().slice(0, 120),
          (input.lastName || "").trim().slice(0, 120), input.source, status, tags,
          input.wpCustomerId && input.wpCustomerId > 0 ? input.wpCustomerId : null,
          input.consentRecordedAt || null,
        ]);
        imported += 1;
      }
    });
    return { imported, skipped };
  }

  async createCampaign(input: MarketingCampaignInput) {
    const result = await this.database.query<CampaignRow>(`
      INSERT INTO marketing_email_campaigns (
        id, name, template_key, subject, preheader, heading, message, button_label,
        button_url, audience_tag, created_by, created_by_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      randomUUID(), input.name, input.templateKey, input.subject, input.preheader,
      input.heading, input.message, input.buttonLabel, input.buttonUrl,
      input.audienceTag, input.actorId, input.actorName,
    ]);
    return mapCampaign(result.rows[0]!);
  }

  async campaign(id: string) {
    const result = await this.database.query<CampaignRow>("SELECT * FROM marketing_email_campaigns WHERE id = $1", [id]);
    return result.rows[0] ? mapCampaign(result.rows[0]) : null;
  }

  async launchCampaign(id: string): Promise<{ campaign: ReturnType<typeof mapCampaign>; queued: number }> {
    return this.database.transaction(async (client) => {
      const result = await client.query<CampaignRow>(`
        SELECT * FROM marketing_email_campaigns WHERE id = $1 FOR UPDATE
      `, [id]);
      const campaign = result.rows[0];
      if (!campaign) throw new Error("Campaign not found");
      if (campaign.status !== "draft") throw new Error("Only a draft campaign can be launched");
      const contacts = await client.query<{ id: string }>(`
        SELECT id FROM marketing_contacts
        WHERE status = 'subscribed' AND ($1 = '' OR $1 = ANY(tags))
        ORDER BY created_at ASC
      `, [campaign.audience_tag]);
      for (let offset = 0; offset < contacts.rows.length; offset += 500) {
        const chunk = contacts.rows.slice(offset, offset + 500);
        if (!chunk.length) continue;
        const values: unknown[] = [];
        const placeholders = chunk.map((contact, index) => {
          const base = index * 4;
          values.push(randomUUID(), id, contact.id, randomUUID());
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4})`;
        });
        await client.query(`
          INSERT INTO marketing_email_deliveries (id, campaign_id, contact_id, event_id)
          VALUES ${placeholders.join(",")}
          ON CONFLICT (campaign_id, contact_id) DO NOTHING
        `, values);
      }
      const queued = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM marketing_email_deliveries WHERE campaign_id = $1",
        [id],
      );
      const queuedCount = Number(queued.rows[0]?.count) || 0;
      if (queuedCount === 0) throw new Error("No subscribed contacts match this audience");
      const updated = await client.query<CampaignRow>(`
        UPDATE marketing_email_campaigns SET status = 'queued', recipient_count = $2,
          launched_at = now(), updated_at = now() WHERE id = $1 RETURNING *
      `, [id, queuedCount]);
      return { campaign: mapCampaign(updated.rows[0]!), queued: queuedCount };
    });
  }

  async cancelCampaign(id: string): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE marketing_email_campaigns SET status = 'cancelled', updated_at = now(), completed_at = now()
      WHERE id = $1 AND status IN ('draft','queued','sending')
    `, [id]);
    await this.database.query(`
      UPDATE marketing_email_deliveries SET status = 'skipped', updated_at = now(), last_error = 'Campaign cancelled'
      WHERE campaign_id = $1 AND status = 'queued'
    `, [id]);
    return (result.rowCount || 0) > 0;
  }

  async claimDelivery(): Promise<null | {
    deliveryId: string; campaignId: string; eventId: string; contactId: string;
    email: string; firstName: string; lastName: string; attemptCount: number;
    campaign: ReturnType<typeof mapCampaign>;
  }> {
    return this.database.transaction(async (client) => {
      const result = await client.query<DeliveryRow>(`
        SELECT d.id AS delivery_id, d.event_id, d.contact_id, d.attempt_count,
          c.email, c.first_name, c.last_name, m.*
        FROM marketing_email_deliveries d
        JOIN marketing_contacts c ON c.id = d.contact_id
        JOIN marketing_email_campaigns m ON m.id = d.campaign_id
        WHERE m.status IN ('queued','sending')
          AND c.status = 'subscribed'
          AND (d.status = 'queued' OR (d.status = 'sending' AND d.updated_at < now() - interval '15 minutes'))
        ORDER BY d.created_at ASC
        FOR UPDATE OF d SKIP LOCKED LIMIT 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      await client.query(`
        UPDATE marketing_email_deliveries SET status = 'sending', attempt_count = attempt_count + 1,
          updated_at = now() WHERE id = $1
      `, [row.delivery_id]);
      await client.query(`
        UPDATE marketing_email_campaigns SET status = 'sending', updated_at = now()
        WHERE id = $1 AND status = 'queued'
      `, [row.id]);
      return {
        deliveryId: row.delivery_id,
        campaignId: row.id,
        eventId: row.event_id,
        contactId: row.contact_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        attemptCount: Number(row.attempt_count) + 1,
        campaign: mapCampaign(row),
      };
    });
  }

  async markDelivery(input: { deliveryId: string; contactId: string; campaignId: string; status: "sent" | "failed" | "uncertain"; error?: string; sentAt?: string | null }): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(`
        UPDATE marketing_email_deliveries SET status = $2, last_error = $3,
          sent_at = CASE WHEN $2 = 'sent' THEN COALESCE($4::timestamptz, now()) ELSE sent_at END,
          updated_at = now() WHERE id = $1
      `, [input.deliveryId, input.status, (input.error || "").slice(0, 1000), input.sentAt || null]);
      if (input.status === "sent") {
        await client.query("UPDATE marketing_contacts SET last_emailed_at = now(), updated_at = now() WHERE id = $1", [input.contactId]);
      }
      await this.refreshCampaignCounts(client, input.campaignId);
    });
  }

  async unsubscribe(contactId: string): Promise<boolean> {
    const result = await this.database.query(`
      UPDATE marketing_contacts SET status = 'unsubscribed', unsubscribed_at = now(), updated_at = now()
      WHERE id = $1 AND status <> 'unsubscribed'
    `, [contactId]);
    return (result.rowCount || 0) > 0;
  }

  async reconcileQueue(): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(`
        UPDATE marketing_email_deliveries d SET status = 'skipped', updated_at = now(),
          last_error = 'Contact unsubscribed before delivery'
        FROM marketing_contacts c
        WHERE d.contact_id = c.id AND d.status = 'queued' AND c.status <> 'subscribed'
      `);
      const campaigns = await client.query<{ id: string }>(`
        SELECT id FROM marketing_email_campaigns WHERE status IN ('queued','sending')
      `);
      for (const campaign of campaigns.rows) await this.refreshCampaignCounts(client, campaign.id);
    });
  }

  private async refreshCampaignCounts(executor: SqlExecutor, campaignId: string): Promise<void> {
    await executor.query(`
      UPDATE marketing_email_campaigns m SET
        sent_count = totals.sent,
        failed_count = totals.failed,
        uncertain_count = totals.uncertain,
        status = CASE WHEN totals.pending = 0 THEN 'completed' ELSE m.status END,
        completed_at = CASE WHEN totals.pending = 0 THEN now() ELSE m.completed_at END,
        updated_at = now()
      FROM (
        SELECT campaign_id,
          count(*) FILTER (WHERE status = 'sent')::int AS sent,
          count(*) FILTER (WHERE status = 'failed')::int AS failed,
          count(*) FILTER (WHERE status = 'uncertain')::int AS uncertain,
          count(*) FILTER (WHERE status IN ('queued','sending'))::int AS pending
        FROM marketing_email_deliveries WHERE campaign_id = $1 GROUP BY campaign_id
      ) totals
      WHERE m.id = totals.campaign_id
    `, [campaignId]);
  }
}
