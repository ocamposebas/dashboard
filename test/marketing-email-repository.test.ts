import assert from "node:assert/strict";
import test from "node:test";

import type { QueryResult, QueryResultRow } from "pg";

import type { Database, SqlExecutor } from "../src/server/database.js";
import { MarketingEmailRepository } from "../src/server/marketingEmailRepository.js";

function result<Row extends QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return { command: "UPDATE", rowCount: rows.length, oid: 0, fields: [], rows };
}

test("delivery result SQL casts status consistently for PostgreSQL", async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      return result<Row>();
    },
  };
  const database = {
    transaction: async <T>(operation: (client: SqlExecutor) => Promise<T>) => operation(executor),
  } as unknown as Database;
  const repository = new MarketingEmailRepository(database);

  await repository.markDelivery({
    deliveryId: "11111111-1111-4111-8111-111111111111",
    contactId: "22222222-2222-4222-8222-222222222222",
    campaignId: "33333333-3333-4333-8333-333333333333",
    status: "sent",
    sentAt: "2026-11-21T18:00:00.000Z",
  });

  assert.equal(queries[0]?.values[1], "sent");
  assert.match(queries[0]?.text || "", /status = \$2::varchar\(24\)/);
  assert.match(queries[0]?.text || "", /CASE WHEN \$2::varchar\(24\) = 'sent'/);
});
