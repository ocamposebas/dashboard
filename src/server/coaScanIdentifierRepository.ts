import type { QueryResultRow } from "pg";

import type { Database } from "./database.js";
import { canonicalizeCoaScanValue } from "./coaScanResolver.js";

interface CoaScanIdentifierRow extends QueryResultRow {
  canonical_value: string;
  raw_value: string;
  coa_reference: string;
  provider: string;
  is_active: boolean;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CoaScanIdentifier {
  canonicalValue: string;
  rawValue: string;
  coaReference: string;
  provider: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function identifierFromRow(row: CoaScanIdentifierRow): CoaScanIdentifier {
  return {
    canonicalValue: row.canonical_value,
    rawValue: row.raw_value,
    coaReference: row.coa_reference,
    provider: row.provider,
    active: row.is_active,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class CoaScanIdentifierRepository {
  constructor(private readonly database: Database) {}

  async register(input: {
    rawValue: string;
    coaReference: string;
    provider: string;
    createdBy: string;
  }): Promise<CoaScanIdentifier | null> {
    const canonicalValue = canonicalizeCoaScanValue(input.rawValue);
    const coaReference = input.coaReference.trim();
    const provider = input.provider.trim();
    const createdBy = input.createdBy.trim();
    if (!canonicalValue || !coaReference || !provider || !createdBy) return null;
    const result = await this.database.query<CoaScanIdentifierRow>(
      `INSERT INTO coa_scan_identifiers (
         canonical_value, raw_value, coa_reference, provider, is_active, created_by
       ) VALUES ($1,$2,$3,$4,true,$5)
       ON CONFLICT (canonical_value) DO UPDATE SET
         raw_value=EXCLUDED.raw_value,
         provider=EXCLUDED.provider,
         is_active=true,
         updated_at=now()
       WHERE lower(coa_scan_identifiers.coa_reference) = lower(EXCLUDED.coa_reference)
       RETURNING canonical_value, raw_value, coa_reference, provider, is_active,
                 created_by, created_at, updated_at`,
      [canonicalValue, input.rawValue.trim(), coaReference, provider, createdBy],
    );
    return result.rows[0] ? identifierFromRow(result.rows[0]) : null;
  }

  async resolve(rawValue: string): Promise<CoaScanIdentifier | null> {
    const canonicalValue = canonicalizeCoaScanValue(rawValue);
    if (!canonicalValue) return null;
    const result = await this.database.query<CoaScanIdentifierRow>(
      `SELECT canonical_value, raw_value, coa_reference, provider, is_active,
              created_by, created_at, updated_at
       FROM coa_scan_identifiers
       WHERE canonical_value = $1 AND is_active = true`,
      [canonicalValue],
    );
    return result.rows[0] ? identifierFromRow(result.rows[0]) : null;
  }
}
