import type { QueryResultRow } from "pg";

import type { Database, SqlExecutor } from "./database.js";
import type { IndependentSiteControls } from "./siteControls.js";

interface SiteControlRow extends QueryResultRow {
  version: string;
  source: "operations-control-plane";
  revision: string | number;
  promo: Record<string, unknown>;
  maintenance: Record<string, unknown>;
  updated_by: string;
  updated_at: Date | string;
}

export class SiteControlRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "revision_conflict" | "invalid_record",
  ) {
    super(message);
    this.name = "SiteControlRepositoryError";
  }
}

export function nextSiteControlRevision(
  currentRevision: number,
  expectedRevision?: number,
): number {
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
    throw new SiteControlRepositoryError("Current Site Controls revision is invalid", "invalid_record");
  }
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new SiteControlRepositoryError(
      "Site Controls changed in another session. Reload the current state before publishing.",
      "revision_conflict",
    );
  }
  return currentRevision + 1;
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new SiteControlRepositoryError("Stored Site Controls timestamp is invalid", "invalid_record");
  }
  return parsed.toISOString();
}

function fromRow(row: SiteControlRow): IndependentSiteControls {
  const revision = Number(row.revision);
  if (
    row.source !== "operations-control-plane" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !row.promo ||
    typeof row.promo !== "object" ||
    !row.maintenance ||
    typeof row.maintenance !== "object"
  ) {
    throw new SiteControlRepositoryError("Stored Site Controls record is invalid", "invalid_record");
  }
  return {
    version: row.version,
    source: row.source,
    revision,
    promo: row.promo as IndependentSiteControls["promo"],
    maintenance: row.maintenance as IndependentSiteControls["maintenance"],
    updatedBy: row.updated_by,
    updatedAt: iso(row.updated_at),
  };
}

async function readState(executor: SqlExecutor, lock = false): Promise<SiteControlRow | null> {
  const result = await executor.query<SiteControlRow>(
    `SELECT version, source, revision, promo, maintenance, updated_by, updated_at
       FROM site_control_state
      WHERE singleton = 1${lock ? " FOR UPDATE" : ""}`,
  );
  return result.rows[0] || null;
}

export class SiteControlRepository {
  constructor(private readonly database: Database) {}

  async get(): Promise<IndependentSiteControls | null> {
    const row = await readState(this.database);
    return row ? fromRow(row) : null;
  }

  async seed(value: IndependentSiteControls): Promise<IndependentSiteControls> {
    return this.database.transaction(async (client) => {
      const existing = await readState(client, true);
      if (existing) return fromRow(existing);
      const revision = Math.max(1, Number(value.revision) || 1);
      const updatedAt = Number.isFinite(Date.parse(value.updatedAt))
        ? value.updatedAt
        : new Date().toISOString();
      const inserted = await client.query<SiteControlRow>(
        `INSERT INTO site_control_state (
           singleton, version, source, revision, promo, maintenance, updated_by, updated_at
         ) VALUES (1, $1, 'operations-control-plane', $2, $3::jsonb, $4::jsonb, $5, $6)
         ON CONFLICT (singleton) DO NOTHING
         RETURNING version, source, revision, promo, maintenance, updated_by, updated_at`,
        [
          value.version,
          revision,
          JSON.stringify(value.promo),
          JSON.stringify(value.maintenance),
          value.updatedBy,
          updatedAt,
        ],
      );
      if (!inserted.rows[0]) {
        const concurrent = await readState(client, true);
        if (!concurrent) {
          throw new SiteControlRepositoryError("Site Controls could not be initialized", "invalid_record");
        }
        return fromRow(concurrent);
      }
      const stored = fromRow(inserted.rows[0]);
      await client.query(
        `INSERT INTO site_control_events (revision, event_type, actor, payload)
         VALUES ($1, 'seeded', $2, $3::jsonb)`,
        [stored.revision, stored.updatedBy, JSON.stringify(stored)],
      );
      return stored;
    });
  }

  async save(
    input: Omit<IndependentSiteControls, "revision" | "updatedAt">,
    expectedRevision?: number,
  ): Promise<IndependentSiteControls> {
    return this.database.transaction(async (client) => {
      const current = await readState(client, true);
      const currentRevision = current ? Number(current.revision) : 0;
      const nextRevision = nextSiteControlRevision(currentRevision, expectedRevision);
      const updatedAt = new Date().toISOString();
      const result = await client.query<SiteControlRow>(
        `INSERT INTO site_control_state (
           singleton, version, source, revision, promo, maintenance, updated_by, updated_at
         ) VALUES (1, $1, 'operations-control-plane', $2, $3::jsonb, $4::jsonb, $5, $6)
         ON CONFLICT (singleton) DO UPDATE SET
           version = EXCLUDED.version,
           source = EXCLUDED.source,
           revision = EXCLUDED.revision,
           promo = EXCLUDED.promo,
           maintenance = EXCLUDED.maintenance,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at
         RETURNING version, source, revision, promo, maintenance, updated_by, updated_at`,
        [
          input.version,
          nextRevision,
          JSON.stringify(input.promo),
          JSON.stringify(input.maintenance),
          input.updatedBy,
          updatedAt,
        ],
      );
      const stored = fromRow(result.rows[0]!);
      await client.query(
        `INSERT INTO site_control_events (revision, event_type, actor, payload)
         VALUES ($1, 'published', $2, $3::jsonb)`,
        [stored.revision, stored.updatedBy, JSON.stringify(stored)],
      );
      return stored;
    });
  }
}
