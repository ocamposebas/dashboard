import type { QueryResultRow } from "pg";

import type { Database, SqlExecutor } from "./database.js";
import {
  normalizeTikTokPixelEvents,
  normalizeTikTokPixelId,
  type TikTokPixelSettings,
} from "../shared/tiktokPixel.js";

interface TikTokPixelRow extends QueryResultRow {
  version: string;
  source: string;
  provider: string;
  enabled: boolean;
  pixel_id: string;
  events: Record<string, unknown>;
  revision: string | number;
  updated_by: string;
  updated_at: Date | string;
}

export class TikTokPixelRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "revision_conflict" | "invalid_record",
  ) {
    super(message);
    this.name = "TikTokPixelRepositoryError";
  }
}

function fromRow(row: TikTokPixelRow): TikTokPixelSettings {
  const revision = Number(row.revision);
  const updatedAt = row.updated_at instanceof Date
    ? row.updated_at
    : new Date(row.updated_at);
  if (
    row.version !== "1.0" ||
    row.source !== "operations-control-plane" ||
    row.provider !== "tiktok" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isFinite(updatedAt.getTime())
  ) {
    throw new TikTokPixelRepositoryError("Stored TikTok Pixel settings are invalid", "invalid_record");
  }
  const pixelId = normalizeTikTokPixelId(row.pixel_id);
  if (row.enabled && !pixelId) {
    throw new TikTokPixelRepositoryError("An active TikTok Pixel requires a Pixel ID", "invalid_record");
  }
  return {
    version: "1.0",
    source: "operations-control-plane",
    provider: "tiktok",
    enabled: row.enabled,
    pixelId,
    events: normalizeTikTokPixelEvents(row.events),
    revision,
    updatedBy: row.updated_by,
    updatedAt: updatedAt.toISOString(),
  };
}

async function readState(
  executor: SqlExecutor,
  lock = false,
): Promise<TikTokPixelRow | null> {
  const result = await executor.query<TikTokPixelRow>(
    `SELECT version, source, provider, enabled, pixel_id, events, revision, updated_by, updated_at
       FROM marketing_pixel_settings
      WHERE provider = 'tiktok'${lock ? " FOR UPDATE" : ""}`,
  );
  return result.rows[0] || null;
}

export class TikTokPixelRepository {
  constructor(private readonly database: Database) {}

  async get(): Promise<TikTokPixelSettings | null> {
    const row = await readState(this.database);
    return row ? fromRow(row) : null;
  }

  async seed(value: TikTokPixelSettings): Promise<TikTokPixelSettings> {
    return this.database.transaction(async (client) => {
      const current = await readState(client, true);
      if (current) return fromRow(current);
      const result = await client.query<TikTokPixelRow>(
        `INSERT INTO marketing_pixel_settings (
           provider, version, source, enabled, pixel_id, events, revision, updated_by, updated_at
         ) VALUES ('tiktok', '1.0', 'operations-control-plane', $1, $2, $3::jsonb, 1, $4, $5)
         RETURNING version, source, provider, enabled, pixel_id, events, revision, updated_by, updated_at`,
        [
          value.enabled,
          normalizeTikTokPixelId(value.pixelId),
          JSON.stringify(normalizeTikTokPixelEvents(value.events)),
          value.updatedBy,
          value.updatedAt,
        ],
      );
      const stored = fromRow(result.rows[0]!);
      await client.query(
        `INSERT INTO marketing_pixel_events (provider, revision, event_type, actor, payload)
         VALUES ('tiktok', $1, 'seeded', $2, $3::jsonb)`,
        [stored.revision, stored.updatedBy, JSON.stringify(stored)],
      );
      return stored;
    });
  }

  async save(
    input: Pick<TikTokPixelSettings, "enabled" | "pixelId" | "events" | "updatedBy">,
    expectedRevision?: number,
  ): Promise<TikTokPixelSettings> {
    return this.database.transaction(async (client) => {
      const current = await readState(client, true);
      const currentRevision = current ? Number(current.revision) : 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new TikTokPixelRepositoryError(
          "TikTok Pixel settings changed in another session. Reload before saving.",
          "revision_conflict",
        );
      }
      const pixelId = normalizeTikTokPixelId(input.pixelId);
      if (input.enabled && !pixelId) {
        throw new TikTokPixelRepositoryError("Enter a TikTok Pixel ID before enabling tracking", "invalid_record");
      }
      const revision = currentRevision + 1;
      const updatedAt = new Date().toISOString();
      const result = await client.query<TikTokPixelRow>(
        `INSERT INTO marketing_pixel_settings (
           provider, version, source, enabled, pixel_id, events, revision, updated_by, updated_at
         ) VALUES ('tiktok', '1.0', 'operations-control-plane', $1, $2, $3::jsonb, $4, $5, $6)
         ON CONFLICT (provider) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           pixel_id = EXCLUDED.pixel_id,
           events = EXCLUDED.events,
           revision = EXCLUDED.revision,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at
         RETURNING version, source, provider, enabled, pixel_id, events, revision, updated_by, updated_at`,
        [
          input.enabled,
          pixelId,
          JSON.stringify(normalizeTikTokPixelEvents(input.events)),
          revision,
          input.updatedBy,
          updatedAt,
        ],
      );
      const stored = fromRow(result.rows[0]!);
      await client.query(
        `INSERT INTO marketing_pixel_events (provider, revision, event_type, actor, payload)
         VALUES ('tiktok', $1, 'updated', $2, $3::jsonb)`,
        [stored.revision, stored.updatedBy, JSON.stringify(stored)],
      );
      return stored;
    });
  }
}
