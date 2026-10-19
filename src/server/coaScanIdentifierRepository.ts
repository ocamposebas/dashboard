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
