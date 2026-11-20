import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";

import type { Database } from "./database.js";

export const RESEARCHER_TYPES = [
  "academic_university",
  "independent_private_lab",
  "commercial_biotech",
  "institute_nonprofit",
  "qualified_research_organization",
] as const;

export type ResearcherType = typeof RESEARCHER_TYPES[number];

interface ResearchConsentRow extends QueryResultRow {
  id: string;
  researcher_type: ResearcherType;
  consent_version: string;
  policy_version: string;
  customer_id: string | number | null;
  customer_email: string | null;
  customer_display_name: string | null;
  accepted_at: Date | string;
  expires_at: Date | string;
  linked_at: Date | string | null;
}

export interface ResearchConsentRecord {
  id: string;
  researcherType: ResearcherType;
  consentVersion: string;
  policyVersion: string;
  customerId: number | null;
  customerEmail: string;
  customerDisplayName: string;
  acceptedAt: string;
  expiresAt: string;
  linkedAt: string | null;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function fromRow(row: ResearchConsentRow): ResearchConsentRecord {
  return {
    id: row.id,
    researcherType: row.researcher_type,
    consentVersion: row.consent_version,
    policyVersion: row.policy_version,
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    customerEmail: row.customer_email || "",
    customerDisplayName: row.customer_display_name || "",
    acceptedAt: iso(row.accepted_at),
    expiresAt: iso(row.expires_at),
    linkedAt: row.linked_at ? iso(row.linked_at) : null,
  };
}

const RETURNING = `
  id, researcher_type, consent_version, policy_version,
  customer_id, customer_email, customer_display_name,
  accepted_at, expires_at, linked_at
`;

export class ResearchConsentRepository {
  constructor(private readonly database: Database) {}

  async status(visitorTokenHash: string): Promise<ResearchConsentRecord | null> {
    const result = await this.database.query<ResearchConsentRow>(
      `SELECT ${RETURNING}
         FROM researcher_consents
        WHERE visitor_token_hash = $1
          AND expires_at > now()`,
      [visitorTokenHash],
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async accept(input: {
    visitorTokenHash: string;
    researcherType: ResearcherType;
    consentVersion: string;
    policyVersion: string;
    ipHash: string | null;
    userAgentHash: string | null;
  }): Promise<ResearchConsentRecord> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM researcher_consents WHERE visitor_token_hash = $1 FOR UPDATE",
        [input.visitorTokenHash],
      );
      const eventType = existing.rows[0] ? "renewed" : "accepted";
      const id = existing.rows[0]?.id || randomUUID();
      const acceptedAt = new Date();
      const expiresAt = new Date(acceptedAt.getTime() + 180 * 24 * 60 * 60 * 1000);
      const result = await client.query<ResearchConsentRow>(
        `INSERT INTO researcher_consents (
           id, visitor_token_hash, researcher_type,
           confirms_legal_age, confirms_research_only,
           consent_version, policy_version, source,
           ip_hash, user_agent_hash, accepted_at, expires_at, last_seen_at, updated_at
         ) VALUES ($1, $2, $3, true, true, $4, $5, 'storefront_gate', $6, $7, $8, $9, $8, $8)
         ON CONFLICT (visitor_token_hash) DO UPDATE SET
           researcher_type = EXCLUDED.researcher_type,
           confirms_legal_age = true,
           confirms_research_only = true,
           consent_version = EXCLUDED.consent_version,
           policy_version = EXCLUDED.policy_version,
           ip_hash = EXCLUDED.ip_hash,
           user_agent_hash = EXCLUDED.user_agent_hash,
           accepted_at = EXCLUDED.accepted_at,
           expires_at = EXCLUDED.expires_at,
           last_seen_at = EXCLUDED.last_seen_at,
           updated_at = EXCLUDED.updated_at
         RETURNING ${RETURNING}`,
        [
          id,
          input.visitorTokenHash,
          input.researcherType,
          input.consentVersion,
          input.policyVersion,
          input.ipHash,
          input.userAgentHash,
          acceptedAt,
          expiresAt,
        ],
      );
      const saved = fromRow(result.rows[0]!);
      await client.query(
        `INSERT INTO researcher_consent_events (consent_id, event_type, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [
          saved.id,
          eventType,
          JSON.stringify({
            researcherType: saved.researcherType,
            consentVersion: saved.consentVersion,
            policyVersion: saved.policyVersion,
            acceptedAt: saved.acceptedAt,
            expiresAt: saved.expiresAt,
          }),
        ],
      );
      return saved;
    });
  }

  async link(input: {
    visitorTokenHash: string;
    customerId: number;
    customerEmail: string;
    customerDisplayName: string;
  }): Promise<ResearchConsentRecord | null> {
    return this.database.transaction(async (client) => {
      const result = await client.query<ResearchConsentRow>(
        `UPDATE researcher_consents
            SET customer_id = $2,
                customer_email = $3,
                customer_display_name = $4,
                linked_at = now(),
                last_seen_at = now(),
                updated_at = now()
          WHERE visitor_token_hash = $1
            AND expires_at > now()
        RETURNING ${RETURNING}`,
        [input.visitorTokenHash, input.customerId, input.customerEmail, input.customerDisplayName],
      );
      const row = result.rows[0];
      if (!row) return null;
      const saved = fromRow(row);
      await client.query(
        `INSERT INTO researcher_consent_events (consent_id, event_type, payload)
         VALUES ($1, 'linked', $2::jsonb)`,
        [saved.id, JSON.stringify({
          customerId: saved.customerId,
          customerEmail: saved.customerEmail,
          linkedAt: saved.linkedAt,
        })],
      );
      return saved;
    });
  }
}
