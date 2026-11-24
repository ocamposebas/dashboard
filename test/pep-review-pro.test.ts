import assert from "node:assert/strict";
import { test } from "node:test";
import type { Database } from "../src/server/database.js";
import { PepReviewPro } from "../src/server/pepReviewPro.js";
import type { CommerceOrder } from "../src/server/wooCommerceGateway.js";

test("Pep receives only newly completed orders and updates for orders already synced", async (t) => {
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const order = (id: number, completed: number, status = "completed") => ({
    id, status, paidAt: at(90).toISOString(), completedAt: at(completed).toISOString(),
    modifiedAt: at(5).toISOString(), refundedTotal: 0,
    billing: { firstName: "Test", lastName: "Buyer", email: "buyer@example.com", address1: "Private address" },
    lineItems: [{ productId: 7, variationId: 8, name: "Test item", quantity: 1 }],
    repeatOperations: { operationalRepeat: false },
  } as CommerceOrder);
  const sentOrders: { id: string; status: string; email?: string; line_items?: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    if (input.endsWith("/my-stores?store=phase-one-labz")) {
      return Response.json({ stores: [{ slug: "phase-one-labz" }] });
    }
    assert.equal(input, "https://pepreviewpro.com/api/v1/orders");
    assert.match(new Headers(init?.headers).get("Idempotency-Key") ?? "", /^phase-one-/);
    const body = JSON.parse(String(init?.body)) as { orders: typeof sentOrders };
    sentOrders.push(...body.orders);
    return Response.json({ results: [{ id: body.orders[0]?.id, status: "created" }] });
  });
  let encryptedKey = "";
  const query = async (sql: string, values?: string[]) => {
    if (sql.includes("INSERT INTO pep_review_connection")) encryptedKey = values?.[0] ?? "";
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT * FROM pep_review_connection")) return {
      rows: [{ encrypted_key: encryptedKey, enabled_at: at(60), cursor_at: at(10) }],
    };
    if (sql.includes("SELECT order_id, last_status")) return {
      rows: [{ order_id: "3", last_status: "completed" }],
    };
    return { rows: [] };
  };
  const database = {
    query,
    withClient: async (callback: (client: { query: typeof query }) => Promise<void>) => callback({ query }),
  } as unknown as Database;
  const integration = new PepReviewPro(database, {
    listOrdersModifiedSince: async () => [
      order(1, 120), order(2, 5), order(3, 120, "cancelled"), order(4, 5, "processing"),
    ],
  }, "test-only-signing-secret");
  await integration.connect("sk_live_testonly_value_for_review_sync");
  await integration.close();

  assert.deepEqual(sentOrders.map(({ id, status }) => [id, status]), [["2", "completed"], ["3", "cancelled"]]);
  assert.equal(sentOrders[0]?.email, "buyer@example.com");
  assert.equal(JSON.stringify(sentOrders).includes("Private address"), false);
  assert.deepEqual(sentOrders[1], { id: "3", status: "cancelled" });
});
