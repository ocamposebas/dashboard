import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PoolClient } from "pg";

import type { Database } from "./database.js";

const MIGRATION_LOCK_ID = 74_110_021;

function checksum(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export async function migrateDatabase(database: Database, directory = resolve(process.cwd(), "migrations")): Promise<number> {
  return database.withClient(async (client: PoolClient) => {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS app_migrations (
          id varchar(160) PRIMARY KEY,
          checksum char(64) NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const appliedResult = await client.query<{ id: string; checksum: string }>(
        "SELECT id, checksum FROM app_migrations ORDER BY id",
      );
      const applied = new Map(appliedResult.rows.map((item) => [item.id, item.checksum]));
      const files = (await readdir(directory)).filter((file) => file.endsWith(".up.sql")).sort();
      let changed = 0;
      for (const file of files) {
        const id = file.slice(0, -".up.sql".length);
        const source = await readFile(resolve(directory, file), "utf8");
        const sourceChecksum = checksum(source);
        const existing = applied.get(id);
        if (existing) {
          if (existing !== sourceChecksum) throw new Error(`Applied migration ${id} has changed on disk`);
          continue;
        }
        await client.query("BEGIN");
        try {
          await client.query(source);
          await client.query("INSERT INTO app_migrations (id, checksum) VALUES ($1, $2)", [id, sourceChecksum]);
          await client.query("COMMIT");
          changed += 1;
        } catch (error: unknown) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
      return changed;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  });
}

