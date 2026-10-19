import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { Database } from "../src/server/database.js";
import {
  FulfillmentEvidenceRepository,
  FulfillmentEvidenceRepositoryError,
} from "../src/server/fulfillmentEvidenceRepository.js";

const testDatabaseUrl = process.env.TEST_EVIDENCE_DATABASE_URL?.trim() || "";
let database: Database | undefined;
let repository: FulfillmentEvidenceRepository | undefined;
let fulfillmentId = "";
const orderId = 9_980_017;

before(async () => {
  if (!testDatabaseUrl) return;
  const parsed = new URL(testDatabaseUrl);
  if (!parsed.pathname.toLowerCase().includes("test")) {
    throw new Error("TEST_EVIDENCE_DATABASE_URL must name an isolated test database");
  }
  database = new Database({
    connectionString: testDatabaseUrl,
    ssl: false,
    maxConnections: 4,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
  });
  repository = new FulfillmentEvidenceRepository(database);
  fulfillmentId = randomUUID();
  await database.query("DELETE FROM order_fulfillments WHERE order_id = $1", [orderId]);
  await database.query(
    `INSERT INTO order_fulfillments (
      id, order_id, order_number, state, source_snapshot, progress, completion_snapshot,
      started_by, packed_at
    ) VALUES ($1, $2, $3, 'packed', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'evidence-test', now())`,
    [fulfillmentId, orderId, `EV-${orderId}`],
  );
});

after(async () => {
  if (!database) return;
  await database.query("DELETE FROM order_fulfillments WHERE order_id = $1", [orderId]);
  await database.close();
});

test("packaging evidence persists both photo roles, replaces drafts and locks confirmation", async (context) => {
  if (!repository) {
    context.skip("Set TEST_EVIDENCE_DATABASE_URL to run the PostgreSQL evidence test");
    return;
  }
  const initial = await repository.getWorkspace(fulfillmentId);
  assert.equal(initial.state, "draft");
  assert.deepEqual(initial.files, []);

  const contentsId = randomUUID();
  const contentsEvent = randomUUID();
  const first = await repository.saveFile({
    id: contentsId,
    fulfillmentId,
    clientEventId: contentsEvent,
    kind: "contents",
    label: "Packed contents",
    mime: "image/jpeg",
    bytes: 512,
    width: 900,
    height: 1200,
    sha256: "a".repeat(64),
    storageKey: `2026/10/${contentsId}.p1ev`,
    customerVisible: true,
    actorId: "evidence-test",
  });
  assert.equal(first.workspace.files.length, 1);
  const replay = await repository.saveFile({
    id: randomUUID(),
    fulfillmentId,
    clientEventId: contentsEvent,
    kind: "contents",
    label: "Packed contents",
    mime: "image/jpeg",
    bytes: 512,
    width: 900,
    height: 1200,
    sha256: "a".repeat(64),
    storageKey: `2026/10/${randomUUID()}.p1ev`,
    customerVisible: true,
    actorId: "evidence-test",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.workspace.files[0]?.id, contentsId);

  const sealedId = randomUUID();
  await repository.saveFile({
    id: sealedId,
    fulfillmentId,
    clientEventId: randomUUID(),
    kind: "sealed_label",
    label: "Sealed package & label",
    mime: "image/jpeg",
    bytes: 640,
    width: 1200,
    height: 900,
    sha256: "b".repeat(64),
    storageKey: `2026/10/${sealedId}.p1ev`,
    customerVisible: true,
    actorId: "evidence-test",
  });
  const confirmEvent = randomUUID();
  const confirmed = await repository.confirm({ fulfillmentId, clientEventId: confirmEvent, actorId: "evidence-test" });
  assert.equal(confirmed.workspace.state, "confirmed");
  assert.equal(confirmed.workspace.files.length, 2);
  assert.equal((await repository.confirm({ fulfillmentId, clientEventId: confirmEvent, actorId: "evidence-test" })).replayed, true);
  const notificationEvent = randomUUID();
  const queued = await repository.queueNotification({
    fulfillmentId,
    clientEventId: notificationEvent,
    actorId: "evidence-test",
  });
  assert.equal(queued.workspace.notificationState, "queued");
  const sent = await repository.markNotificationSent({
    fulfillmentId,
    clientEventId: notificationEvent,
    actorId: "evidence-test",
    message: "Sent through WordPress SMTP with two attachments.",
  });
  assert.equal(sent.notificationState, "sent");
  assert.match(sent.notificationMessage, /two attachments/i);
  assert.equal((await repository.queueNotification({
    fulfillmentId,
    clientEventId: randomUUID(),
    actorId: "evidence-test",
  })).replayed, true);
  await assert.rejects(
    repository.removeFile({ fulfillmentId, evidenceId: contentsId, clientEventId: randomUUID(), actorId: "evidence-test" }),
    (error: unknown) => error instanceof FulfillmentEvidenceRepositoryError && error.code === "invalid_state",
  );
});

