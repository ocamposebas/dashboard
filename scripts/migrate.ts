import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";

import { loadFulfillmentDatabaseConfig } from "../src/server/config.js";
import { Database } from "../src/server/database.js";

const MIGRATION_LOCK_ID = 74_110_021;
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

interface AppliedMigration {
  id: string;
  checksum: string;
}

function checksum(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function migrationFiles(suffix: ".up.sql" | ".down.sql"): Promise<string[]> {
  return (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(suffix))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function migrationId(file: string, suffix: ".up.sql" | ".down.sql"): string {
  return file.slice(0, -suffix.length);
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      id varchar(160) PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client: PoolClient): Promise<Map<string, AppliedMigration>> {
  const result = await client.query<AppliedMigration>(
    "SELECT id, checksum FROM app_migrations ORDER BY id",
  );
  return new Map(result.rows.map((item) => [item.id, item]));
}

async function migrateUp(client: PoolClient): Promise<void> {
  const applied = await appliedMigrations(client);
  const files = await migrationFiles(".up.sql");
  let changed = 0;

  for (const file of files) {
    const id = migrationId(file, ".up.sql");
    const source = await readFile(join(migrationsDirectory, file), "utf8");
    const sourceChecksum = checksum(source);
    const existing = applied.get(id);
    if (existing) {
      if (existing.checksum !== sourceChecksum) {
        throw new Error(`Applied migration ${id} has changed on disk`);
      }
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(source);
      await client.query(
        "INSERT INTO app_migrations (id, checksum) VALUES ($1, $2)",
        [id, sourceChecksum],
      );
      await client.query("COMMIT");
      console.log(`Applied migration ${id}`);
      changed += 1;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  if (changed === 0) console.log("Database schema is already current");
}

async function migrateDown(client: PoolClient, allowDestructive: boolean): Promise<void> {
  if (!allowDestructive) {
    throw new Error("Rollback is destructive; repeat with --allow-destructive in an isolated environment");
  }
  const result = await client.query<AppliedMigration>(
    "SELECT id, checksum FROM app_migrations ORDER BY id DESC LIMIT 1",
  );
  const latest = result.rows[0];
  if (!latest) {
    console.log("No applied migration is available to roll back");
    return;
  }
  const file = `${latest.id}.down.sql`;
  const source = await readFile(join(migrationsDirectory, file), "utf8").catch(() => null);
  if (source === null) throw new Error(`Migration ${latest.id} does not have a down script`);

  await client.query("BEGIN");
  try {
    await client.query(source);
    await client.query("DELETE FROM app_migrations WHERE id = $1", [latest.id]);
    await client.query("COMMIT");
    console.log(`Rolled back migration ${latest.id}`);
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] || "up";
  if (command !== "up" && command !== "down") {
    throw new Error("Usage: npm run db:migrate -- up | down --allow-destructive");
  }
  const databaseConfig = loadFulfillmentDatabaseConfig();
  if (!databaseConfig) throw new Error("DATABASE_URL is required to run migrations");
  const database = new Database(databaseConfig);
  try {
    await database.withClient(async (client) => {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
      try {
        await ensureMigrationTable(client);
        if (command === "up") await migrateUp(client);
        else await migrateDown(client, process.argv.includes("--allow-destructive"));
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
      }
    });
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
