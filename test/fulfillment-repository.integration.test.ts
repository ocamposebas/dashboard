import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test, { after, before, beforeEach } from "node:test";

import { Database } from "../src/server/database.js";
import { BarcodeLabelService } from "../src/server/barcodeLabels.js";
import { BarcodeRegistryRepository } from "../src/server/barcodeRegistryRepository.js";
import {
  FulfillmentRepository,
  FulfillmentRepositoryError,
} from "../src/server/fulfillmentRepository.js";
import {
  FulfillmentShippingRepository,
  FulfillmentShippingRepositoryError,
} from "../src/server/fulfillmentShippingRepository.js";
import { FulfillmentShippingWorkflow } from "../src/server/fulfillmentShippingWorkflow.js";
import { ShipStationGatewayError } from "../src/server/shipStationGateway.js";
import { ProductLocationRepository } from "../src/server/productLocationRepository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || "";
let database: Database | undefined;
let repository: FulfillmentRepository | undefined;
let locationRepository: ProductLocationRepository | undefined;
let barcodeRepository: BarcodeRegistryRepository | undefined;
let shippingRepository: FulfillmentShippingRepository | undefined;

function activeRepository(): FulfillmentRepository {
  if (!repository) throw new Error("PostgreSQL integration test repository is unavailable");
  return repository;
}

function uniqueOrderId(offset: number): number {
  return 9_000_000 + offset;
}

before(async () => {
  if (!testDatabaseUrl) return;
  const parsed = new URL(testDatabaseUrl);
  if (!parsed.pathname.toLocaleLowerCase("en").includes("test")) {
    throw new Error("TEST_DATABASE_URL must name an isolated test database");
  }
  database = new Database({
    connectionString: testDatabaseUrl,
    ssl: false,
    maxConnections: 8,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
  });
  const exists = await database.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.order_fulfillments') AS table_name",
  );
  if (!exists.rows[0]?.table_name) {
    const migration = await readFile(
      new URL("../migrations/001_barcode_fulfillment.up.sql", import.meta.url),
      "utf8",
    );
    await database.query(migration);
  }
  const barcodeTable = await database.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.barcode_labels') AS table_name",
  );
  if (!barcodeTable.rows[0]?.table_name) {
    const migration = await readFile(
      new URL("../migrations/002_barcode_labels.up.sql", import.meta.url),
      "utf8",
    );
    await database.query(migration);
  }
  const queueIndex = await database.query<{ index_name: string | null }>(
    "SELECT to_regclass('public.order_fulfillments_single_active_idx') AS index_name",
  );
  if (!queueIndex.rows[0]?.index_name) {
    const migration = await readFile(
      new URL("../migrations/003_fulfillment_queue.up.sql", import.meta.url),
      "utf8",
    );
    await database.query(migration);
  }
  const activeColumn = await database.query<{ column_name: string | null }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'barcode_labels' AND column_name = 'is_active'`,
  );
  if (!activeColumn.rows[0]?.column_name) {
    const migration = await readFile(
      new URL("../migrations/004_barcode_picking.up.sql", import.meta.url),
      "utf8",
    );
    await database.query(migration);
  }
  const shippingTable = await database.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.fulfillment_shipping_labels') AS table_name",
  );
  if (!shippingTable.rows[0]?.table_name) {
    const migration = await readFile(
      new URL("../migrations/005_fulfillment_shipping.up.sql", import.meta.url),
      "utf8",
    );
    await database.query(migration);
  }
  const shippingReliabilityColumn = await database.query<{ column_name: string | null }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fulfillment_shipping_labels'
       AND column_name = 'external_shipment_key'`,
  );
  if (!shippingReliabilityColumn.rows[0]?.column_name) {
    const migration = await readFile(
      new URL("../migrations/006_shipping_reliability.up.sql", import.meta.url),
      "utf8",
    );
    await database.query(migration);
  }
  await database.query(
    "TRUNCATE fulfillment_shipping_events, fulfillment_shipping_labels, fulfillment_events, fulfillment_scan_events, order_fulfillments, barcode_labels, product_locations CASCADE",
  );
  repository = new FulfillmentRepository(database);
  locationRepository = new ProductLocationRepository(database);
  barcodeRepository = new BarcodeRegistryRepository(database);
  shippingRepository = new FulfillmentShippingRepository(database);
});

beforeEach(async () => {
  if (!database) return;
  await database.query(
    "TRUNCATE fulfillment_shipping_events, fulfillment_shipping_labels, fulfillment_events, fulfillment_scan_events, order_fulfillments, barcode_labels, product_locations CASCADE",
  );
});

after(async () => {
  await database?.close();
});

test("concurrent starts converge on one durable fulfillment", {
  skip: !testDatabaseUrl,
}, async () => {
  const input = {
    orderId: uniqueOrderId(1),
    orderNumber: "TEST-1",
    sourceModifiedAt: "2026-10-15T12:00:00.000Z",
    sourceSnapshot: { lines: [{ id: 1, quantity: 2 }] },
    progress: { lines: { "1": 0 } },
    actorId: "operator-test",
  } as const;
  const results = await Promise.all([
    activeRepository().createOrResume(input),
    activeRepository().createOrResume(input),
  ]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(results[0]!.session.id, results[1]!.session.id);
  assert.equal(results[0]!.session.orderId, input.orderId);
});

test("only one different order can remain active across concurrent starts", {
  skip: !testDatabaseUrl,
}, async () => {
  const makeInput = (offset: number) => ({
    orderId: uniqueOrderId(offset),
    orderNumber: `TEST-${offset}`,
    sourceModifiedAt: "2026-10-15T12:00:00.000Z",
    sourceSnapshot: { lines: [{ id: offset, quantity: 1 }] },
    progress: { verifiedUnits: 0 },
    actorId: "operator-test",
  });
  const results = await Promise.allSettled([
    activeRepository().createOrResume(makeInput(201)),
    activeRepository().createOrResume(makeInput(202)),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof FulfillmentRepositoryError);
  assert.equal(rejected.reason.code, "active_conflict");
});

test("pause and resume preserve progress and use a new durable version", {
  skip: !testDatabaseUrl,
}, async () => {
  const input = {
    orderId: uniqueOrderId(203),
    orderNumber: "TEST-203",
    sourceModifiedAt: "2026-10-15T12:00:00.000Z",
    sourceSnapshot: { lines: [{ id: 203, quantity: 2 }] },
    progress: { verifiedUnits: 1 },
    actorId: "operator-test",
  };
  const started = await activeRepository().createOrResume(input);
  const paused = await activeRepository().pauseOpenSession({
    fulfillmentId: started.session.id,
    expectedVersion: started.session.version,
    actorId: "operator-test",
  });
  assert.equal(paused.state, "paused");
  assert.equal(paused.version, 2);
  assert.deepEqual(paused.progress, input.progress);

  const resumed = await activeRepository().createOrResume(input);
  assert.equal(resumed.created, false);
  assert.equal(resumed.session.state, "open");
  assert.equal(resumed.session.version, 3);
  assert.deepEqual(resumed.session.progress, input.progress);
});

test("a paused or otherwise non-open session cannot accept a scan", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(204),
    orderNumber: "TEST-204",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { verifiedUnits: 0 },
    actorId: "operator-test",
  });
  await activeRepository().pauseOpenSession({
    fulfillmentId: started.session.id,
    expectedVersion: started.session.version,
    actorId: "operator-test",
  });
  await assert.rejects(activeRepository().recordIdempotentScan({
    fulfillmentId: started.session.id,
    clientEventId: randomUUID(),
    rawBarcode: "13444444444444444444",
    actorId: "operator-test",
  }, () => ({
    result: "accepted",
    reasonCode: "accepted",
    quantityDelta: 1,
    nextProgress: { verifiedUnits: 1 },
    responseSnapshot: { accepted: true },
  })), (error: unknown) => error instanceof FulfillmentRepositoryError && error.code === "invalid_state");
});

test("accepted scan events update progress exactly once when replayed", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(2),
    orderNumber: "TEST-2",
    sourceModifiedAt: null,
    sourceSnapshot: { lines: [{ id: 2, quantity: 2 }] },
    progress: { scanned: 0 },
    actorId: "operator-test",
  });
  const clientEventId = randomUUID();
  const input = {
    fulfillmentId: started.session.id,
    clientEventId,
    rawBarcode: "P1P.TEST-2",
    actorId: "operator-test",
    expectedVersion: 1,
  };
  const decide = () => ({
    result: "accepted" as const,
    reasonCode: "correct_item",
    quantityDelta: 1,
    nextProgress: { scanned: 1 },
    responseSnapshot: { accepted: true, scanned: 1 },
    productId: 102,
    variationId: 0,
    orderItemId: 2,
  });

  const first = await activeRepository().recordIdempotentScan(input, decide);
  const replay = await activeRepository().recordIdempotentScan(input, () => {
    throw new Error("The decision callback must not run for a replay");
  });

  assert.equal(first.replayed, false);
  assert.equal(first.session.version, 2);
  assert.deepEqual(first.session.progress, { scanned: 1 });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.event.responseSnapshot, { accepted: true, scanned: 1 });
  const preflightReplay = await activeRepository().getRecordedScan(input);
  assert.equal(preflightReplay?.replayed, true);
  assert.deepEqual(preflightReplay?.event.responseSnapshot, { accepted: true, scanned: 1 });
  const count = await database!.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM fulfillment_scan_events WHERE client_event_id = $1",
    [clientEventId],
  );
  assert.equal(count.rows[0]?.count, "1");
});

test("concurrent retries of one scan event return one result and one progress change", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(6),
    orderNumber: "TEST-6",
    sourceModifiedAt: null,
    sourceSnapshot: { lines: [{ id: 6, quantity: 1 }] },
    progress: { scanned: 0 },
    actorId: "operator-test",
  });
  const clientEventId = randomUUID();
  const input = {
    fulfillmentId: started.session.id,
    clientEventId,
    rawBarcode: "P1P.TEST-6",
    actorId: "operator-test",
    expectedVersion: 1,
  };
  let decisions = 0;
  const attempts = await Promise.all(Array.from({ length: 12 }, () =>
    activeRepository().recordIdempotentScan(input, () => {
      decisions += 1;
      return {
        result: "accepted" as const,
        reasonCode: "correct_item",
        quantityDelta: 1,
        nextProgress: { scanned: 1 },
        responseSnapshot: { accepted: true, scanned: 1 },
        productId: 106,
        variationId: 0,
        orderItemId: 6,
      };
    }),
  ));

  assert.equal(decisions, 1);
  assert.equal(attempts.filter((attempt) => !attempt.replayed).length, 1);
  assert.ok(attempts.every((attempt) => attempt.session.version === 2));
  assert.ok(attempts.every((attempt) =>
    JSON.stringify(attempt.session.progress) === JSON.stringify({ scanned: 1 })));
  const count = await database!.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM fulfillment_scan_events WHERE client_event_id = $1",
    [clientEventId],
  );
  assert.equal(count.rows[0]?.count, "1");
});

test("concurrent distinct scans serialize against current progress without exceeding quantity", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(207),
    orderNumber: "TEST-207",
    sourceModifiedAt: null,
    sourceSnapshot: { lines: [{ id: 207, quantity: 1 }] },
    progress: { verifiedUnits: 0, totalUnits: 1 },
    actorId: "operator-test",
  });
  const decide = (locked: { progress: unknown }) => {
    const progress = locked.progress as { verifiedUnits: number; totalUnits: number };
    if (progress.verifiedUnits >= progress.totalUnits) {
      return {
        result: "rejected" as const,
        reasonCode: "quantity_complete",
        quantityDelta: 0,
        responseSnapshot: { accepted: false, complete: true },
      };
    }
    return {
      result: "accepted" as const,
      reasonCode: "accepted",
      quantityDelta: 1,
      nextProgress: { ...progress, verifiedUnits: progress.verifiedUnits + 1 },
      responseSnapshot: { accepted: true },
    };
  };
  const results = await Promise.all([
    activeRepository().recordIdempotentScan({
      fulfillmentId: started.session.id,
      clientEventId: randomUUID(),
      rawBarcode: "13111111111111111111",
      actorId: "operator-test",
    }, decide),
    activeRepository().recordIdempotentScan({
      fulfillmentId: started.session.id,
      clientEventId: randomUUID(),
      rawBarcode: "13111111111111111111",
      actorId: "operator-test",
    }, decide),
  ]);
  assert.equal(results.filter((result) => result.event.result === "accepted").length, 1);
  assert.equal(results.filter((result) => result.event.result === "rejected").length, 1);
  assert.equal((await activeRepository().getById(started.session.id))?.version, 2);
});

test("a new repository instance resumes persisted picking progress after refresh", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(208),
    orderNumber: "TEST-208",
    sourceModifiedAt: null,
    sourceSnapshot: { lines: [{ id: 208, quantity: 2 }] },
    progress: { verifiedUnits: 0 },
    actorId: "operator-test",
  });
  const scanned = await activeRepository().recordIdempotentScan({
    fulfillmentId: started.session.id,
    clientEventId: randomUUID(),
    rawBarcode: "13222222222222222222",
    actorId: "operator-test",
  }, () => ({
    result: "accepted",
    reasonCode: "accepted",
    quantityDelta: 1,
    nextProgress: { verifiedUnits: 1 },
    responseSnapshot: { accepted: true },
  }));
  const afterRefresh = await new FulfillmentRepository(database!).getById(started.session.id);
  assert.deepEqual(afterRefresh?.progress, scanned.session.progress);
  assert.equal(afterRefresh?.version, 2);
});

test("a database write failure rolls back both scan history and progress", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(209),
    orderNumber: "TEST-209",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { verifiedUnits: 0 },
    actorId: "operator-test",
  });
  const clientEventId = randomUUID();
  await assert.rejects(activeRepository().recordIdempotentScan({
    fulfillmentId: started.session.id,
    clientEventId,
    rawBarcode: "13333333333333333333",
    actorId: "operator-test",
  }, () => ({
    result: "accepted",
    reasonCode: "accepted",
    quantityDelta: 1,
    nextProgress: { verifiedUnits: 1 },
    responseSnapshot: undefined as never,
  })));
  const stored = await activeRepository().getById(started.session.id);
  assert.deepEqual(stored?.progress, { verifiedUnits: 0 });
  const count = await database!.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM fulfillment_scan_events WHERE client_event_id = $1",
    [clientEventId],
  );
  assert.equal(count.rows[0]?.count, "0");
});

test("an idempotency key cannot be reused for different request content", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(3),
    orderNumber: "TEST-3",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { scanned: 0 },
    actorId: "operator-test",
  });
  const clientEventId = randomUUID();
  await activeRepository().recordIdempotentScan({
    fulfillmentId: started.session.id,
    clientEventId,
    rawBarcode: "WRONG",
    actorId: "operator-test",
  }, () => ({
    result: "rejected",
    reasonCode: "wrong_item",
    quantityDelta: 0,
    responseSnapshot: { accepted: false },
  }));

  await assert.rejects(
    activeRepository().recordIdempotentScan({
      fulfillmentId: started.session.id,
      clientEventId,
      rawBarcode: "DIFFERENT",
      actorId: "operator-test",
    }, () => ({
      result: "rejected",
      reasonCode: "wrong_item",
      quantityDelta: 0,
      responseSnapshot: { accepted: false },
    })),
    (error: unknown) => error instanceof FulfillmentRepositoryError &&
      error.code === "idempotency_conflict",
  );
});

test("rejected scans are durable but do not mutate progress or version", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(4),
    orderNumber: "TEST-4",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { scanned: 0 },
    actorId: "operator-test",
  });
  const result = await activeRepository().recordIdempotentScan({
    fulfillmentId: started.session.id,
    clientEventId: randomUUID(),
    rawBarcode: "NOT-REQUIRED",
    actorId: "operator-test",
    expectedVersion: 1,
  }, () => ({
    result: "rejected",
    reasonCode: "wrong_item",
    quantityDelta: 0,
    responseSnapshot: { accepted: false, reason: "wrong_item" },
  }));
  assert.equal(result.event.result, "rejected");
  assert.equal(result.session.version, 1);
  assert.deepEqual(result.session.progress, { scanned: 0 });
});

test("state transitions require the current version and cannot repeat", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(5),
    orderNumber: "TEST-5",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { scanned: 1 },
    actorId: "operator-test",
  });
  const packed = await activeRepository().transitionOpenSession({
    fulfillmentId: started.session.id,
    expectedVersion: 1,
    nextState: "packed",
    actorId: "operator-test",
    completionSnapshot: { verified: true },
  });
  assert.equal(packed.state, "packed");
  assert.equal(packed.version, 2);
  assert.equal(packed.wordpressSyncState, "pending");

  await assert.rejects(
    activeRepository().transitionOpenSession({
      fulfillmentId: started.session.id,
      expectedVersion: 1,
      nextState: "cancelled",
      actorId: "operator-test",
      reason: "Should not be possible",
    }),
    (error: unknown) => error instanceof FulfillmentRepositoryError &&
      error.code === "invalid_state",
  );
});

test("packed COA synchronization attempts are durable and auditable", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(50),
    orderNumber: "TEST-50",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { verifiedUnits: 1 },
    actorId: "operator-test",
  });
  const packed = await activeRepository().transitionOpenSession({
    fulfillmentId: started.session.id,
    expectedVersion: started.session.version,
    nextState: "packed",
    actorId: "operator-test",
    completionSnapshot: { verified: true },
  });
  const failed = await activeRepository().recordWordPressSync({
    fulfillmentId: packed.id,
    actorId: "operator-test",
    state: "failed",
    error: "Temporary bridge outage",
    details: { orderId: packed.orderId },
  });
  assert.equal(failed.wordpressSyncState, "failed");
  assert.equal(failed.wordpressSyncAttempts, 1);
  assert.equal(failed.wordpressLastError, "Temporary bridge outage");
  assert.ok(failed.wordpressNextRetryAt);

  const synced = await activeRepository().recordWordPressSync({
    fulfillmentId: packed.id,
    actorId: "operator-test",
    state: "synced",
    details: { assignedUnits: 1 },
  });
  assert.equal(synced.wordpressSyncState, "synced");
  assert.equal(synced.wordpressSyncAttempts, 2);
  assert.equal(synced.wordpressLastError, null);
  assert.equal(synced.wordpressNextRetryAt, null);
  const events = await database!.query<{ event_type: string }>(
    `SELECT event_type FROM fulfillment_events
     WHERE fulfillment_id = $1 AND event_type IN ('sync_failed', 'sync_succeeded')
     ORDER BY created_at`,
    [packed.id],
  );
  assert.deepEqual(events.rows.map((row) => row.event_type), ["sync_failed", "sync_succeeded"]);
});

test("packing confirmation is atomic and idempotent under concurrent retries", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(51),
    orderNumber: "TEST-51",
    sourceModifiedAt: "2026-10-16T14:05:00.000Z",
    sourceSnapshot: { lines: [{ id: 51, quantity: 1 }] },
    progress: { verifiedUnits: 1 },
    actorId: "operator-test",
  });
  const clientEventId = randomUUID();
  const snapshot = {
    version: 1 as const,
    clientEventId,
    orderId: started.session.orderId,
    orderNumber: started.session.orderNumber,
    sourceModifiedAt: started.session.sourceModifiedAt,
    confirmedAt: "2026-10-16T14:08:00.000Z",
    packedBy: "operator-test",
    verifiedUnits: 1,
    totalUnits: 1,
    lines: [{
      orderItemId: 51,
      productId: 201,
      variationId: 0,
      name: "Test product",
      sku: "TEST-51",
      requiredQuantity: 1,
      verifiedQuantity: 1,
      locationCode: "A-01",
      coaId: "coa-51",
      coaNumber: "P1-51",
      lot: "LOT-51",
      batch: "BATCH-51",
    }],
  };
  const results = await Promise.all([
    activeRepository().completePacking({
      fulfillmentId: started.session.id,
      clientEventId,
      expectedVersion: started.session.version,
      actorId: "operator-test",
    }, () => snapshot),
    activeRepository().completePacking({
      fulfillmentId: started.session.id,
      clientEventId,
      expectedVersion: started.session.version,
      actorId: "operator-test",
    }, () => snapshot),
  ]);
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.ok(results.every((result) => result.session.state === "packed"));
  assert.deepEqual(results[0]!.snapshot, results[1]!.snapshot);
  const events = await database!.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM fulfillment_events WHERE fulfillment_id = $1 AND event_type = 'packed'",
    [started.session.id],
  );
  assert.equal(events.rows[0]?.count, "1");
});

test("a second logical packing confirmation cannot purchase or mutate twice", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(52),
    orderNumber: "TEST-52",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { verifiedUnits: 1 },
    actorId: "operator-test",
  });
  const firstEventId = randomUUID();
  const makeSnapshot = (eventId: string) => ({
    version: 1 as const,
    clientEventId: eventId,
    orderId: started.session.orderId,
    orderNumber: started.session.orderNumber,
    sourceModifiedAt: null,
    confirmedAt: "2026-10-16T14:08:00.000Z",
    packedBy: "operator-test",
    verifiedUnits: 1,
    totalUnits: 1,
    lines: [],
  });
  await activeRepository().completePacking({
    fulfillmentId: started.session.id,
    clientEventId: firstEventId,
    expectedVersion: started.session.version,
    actorId: "operator-test",
  }, () => makeSnapshot(firstEventId));
  await assert.rejects(activeRepository().completePacking({
    fulfillmentId: started.session.id,
    clientEventId: randomUUID(),
    expectedVersion: started.session.version,
    actorId: "operator-test",
  }, () => makeSnapshot(randomUUID())), (error: unknown) =>
    error instanceof FulfillmentRepositoryError && error.code === "idempotency_conflict");
});

test("mock shipping-label retries create one durable label and block a second logical purchase", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(53),
    orderNumber: "TEST-53",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { verifiedUnits: 1 },
    actorId: "operator-test",
  });
  const packedEventId = randomUUID();
  await activeRepository().completePacking({
    fulfillmentId: started.session.id,
    clientEventId: packedEventId,
    expectedVersion: started.session.version,
    actorId: "operator-test",
  }, () => ({
    version: 1,
    clientEventId: packedEventId,
    orderId: started.session.orderId,
    orderNumber: started.session.orderNumber,
    sourceModifiedAt: null,
    confirmedAt: "2026-10-16T14:08:00.000Z",
    packedBy: "operator-test",
    verifiedUnits: 1,
    totalUnits: 1,
    lines: [],
  }));
  const clientEventId = randomUUID();
  const input = {
    fulfillmentId: started.session.id,
    clientEventId,
    actorId: "operator-test",
    destination: {
      name: "Ana Lopez", company: "", address1: "100 Test Street", address2: "",
      city: "Miami", state: "FL", postalCode: "33101", countryCode: "US", phone: "",
    },
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    rate: {
      rateId: "mock-rate-integration", carrierId: "mock-ups", carrierCode: "ups",
      carrierName: "UPS", serviceCode: "ups_ground", serviceName: "UPS Ground",
      amount: 10.25, currency: "USD", deliveryDays: 4,
      estimatedDeliveryDate: null, guaranteed: false, isEstimate: true,
    },
  };
  const results = await Promise.all([
    shippingRepository!.createMockLabel(input),
    shippingRepository!.createMockLabel(input),
  ]);
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(results[0]!.label.id, results[1]!.label.id);
  assert.equal((await shippingRepository!.getPrintRecord(started.session.id))?.destination.address1, "100 Test Street");
  await assert.rejects(
    shippingRepository!.createMockLabel({ ...input, clientEventId: randomUUID() }),
    (error: unknown) => error instanceof FulfillmentShippingRepositoryError &&
      error.code === "idempotency_conflict",
  );
});

test("shipping attempts survive uncertain outcomes, reconcile once, and reprint without another purchase", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(54),
    orderNumber: "TEST-54",
    sourceModifiedAt: null,
    sourceSnapshot: {},
    progress: { verifiedUnits: 1 },
    actorId: "operator-test",
  });
  const packedEventId = randomUUID();
  await activeRepository().completePacking({
    fulfillmentId: started.session.id,
    clientEventId: packedEventId,
    expectedVersion: started.session.version,
    actorId: "operator-test",
  }, () => ({
    version: 1,
    clientEventId: packedEventId,
    orderId: started.session.orderId,
    orderNumber: started.session.orderNumber,
    sourceModifiedAt: null,
    confirmedAt: "2026-10-16T14:08:00.000Z",
    packedBy: "operator-test",
    verifiedUnits: 1,
    totalUnits: 1,
    lines: [],
  }));
  const clientEventId = randomUUID();
  const base = {
    fulfillmentId: started.session.id,
    clientEventId,
    actorId: "operator-test",
    providerMode: "live" as const,
    destination: {
      name: "Ana Lopez", company: "", address1: "100 Test Street", address2: "",
      city: "Miami", state: "FL", postalCode: "33101", countryCode: "US", phone: "",
    },
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    rate: {
      rateId: "se-rate-uncertain", carrierId: "se-ups", carrierCode: "ups",
      carrierName: "UPS", serviceCode: "ups_ground", serviceName: "UPS Ground",
      amount: 11.25, currency: "USD", deliveryDays: 4,
      estimatedDeliveryDate: null, guaranteed: false, isEstimate: true,
    },
    sourceShipping: { exported: false, shippedItemCount: 0, shipmentIds: [], trackingNumber: "" },
  };
  const begun = await shippingRepository!.beginPurchase(base);
  assert.equal(begun.execute, true);
  assert.equal(begun.label.state, "purchase_pending");

  const uncertain = await shippingRepository!.markUnknown({
    fulfillmentId: base.fulfillmentId,
    clientEventId,
    actorId: "operator-test",
    message: "Connection ended after submission",
  });
  assert.equal(uncertain.state, "purchase_unknown");
  await assert.rejects(
    shippingRepository!.beginPurchase({ ...base, clientEventId: randomUUID() }),
    (error: unknown) => error instanceof FulfillmentShippingRepositoryError &&
      error.code === "idempotency_conflict",
  );

  const ready = await shippingRepository!.markReady({
    fulfillmentId: base.fulfillmentId,
    clientEventId,
    actorId: "operator-test",
    result: {
      labelId: "se-label-recovered", shipmentId: "se-shipment-recovered",
      status: "completed", trackingNumber: "1ZRECOVERED", carrierId: "se-ups",
      carrierCode: "ups", serviceCode: "ups_ground", amount: 11.25,
      currency: "USD", labelDownloadUrl: "https://api.shipstation.com/v2/downloads/test/recovered.pdf",
    },
  });
  assert.equal(ready.state, "label_ready");
  assert.equal(ready.trackingNumber, "1ZRECOVERED");
  assert.equal((await shippingRepository!.recordPrint(base.fulfillmentId, "operator-test")).printCount, 1);
  assert.equal((await shippingRepository!.recordPrint(base.fulfillmentId, "operator-test")).printCount, 2);
  const synced = await shippingRepository!.markWordPressSync({
    fulfillmentId: base.fulfillmentId,
    actorId: "operator-test",
    state: "synced",
    message: "Tracking saved to the source order.",
  });
  assert.equal(synced.wordpressSyncState, "synced");
  const voided = await shippingRepository!.markVoided({
    fulfillmentId: base.fulfillmentId,
    actorId: "operator-test",
    message: "Carrier accepted the void request.",
  });
  assert.equal(voided.state, "voided");
  assert.equal(voided.wordpressSyncState, "pending");
  const voidSynced = await shippingRepository!.markWordPressSync({
    fulfillmentId: base.fulfillmentId,
    actorId: "operator-test",
    state: "synced",
    message: "Voided tracking removed from the source order.",
  });
  assert.equal(voidSynced.wordpressSyncState, "synced");

  const eventCounts = await database!.query<{ event_type: string; count: string }>(
    `SELECT event_type, count(*)::text AS count FROM fulfillment_shipping_events
     GROUP BY event_type ORDER BY event_type`,
  );
  const counts = Object.fromEntries(eventCounts.rows.map((row) => [row.event_type, Number(row.count)]));
  assert.equal(counts.purchase_started, 1);
  assert.equal(counts.purchase_unknown, 1);
  assert.equal(counts.label_ready, 1);
  assert.equal(counts.label_reprinted, 2);
  assert.equal(counts.wordpress_sync_succeeded, 2);
  assert.equal(counts.label_voided, 1);
});

test("mocked end-to-end shipping reconciles an interrupted provider response without repurchasing", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(55), orderNumber: "TEST-55", sourceModifiedAt: null,
    sourceSnapshot: {}, progress: { verifiedUnits: 1 }, actorId: "operator-test",
  });
  const packedEventId = randomUUID();
  await activeRepository().completePacking({
    fulfillmentId: started.session.id, clientEventId: packedEventId,
    expectedVersion: started.session.version, actorId: "operator-test",
  }, () => ({
    version: 1, clientEventId: packedEventId, orderId: started.session.orderId,
    orderNumber: started.session.orderNumber, sourceModifiedAt: null,
    confirmedAt: "2026-10-16T14:08:00.000Z", packedBy: "operator-test",
    verifiedUnits: 1, totalUnits: 1, lines: [],
  }));
  let purchaseCalls = 0;
  let reconciliationCalls = 0;
  const provider = {
    async purchaseLabelFromRate() {
      purchaseCalls += 1;
      throw new ShipStationGatewayError(
        "The response was interrupted after submission",
        "purchase_unknown",
      );
    },
    async findLabelsByRateId() {
      reconciliationCalls += 1;
      return [{
        labelId: "se-label-55", shipmentId: "se-shipment-55", status: "completed" as const,
        trackingNumber: "1ZTEST55", carrierId: "se-ups", carrierCode: "ups",
        serviceCode: "ups_ground", amount: 10.5, currency: "USD",
        labelDownloadUrl: "https://api.shipstation.com/v2/downloads/test/55.pdf",
      }];
    },
  };
  const workflow = new FulfillmentShippingWorkflow(shippingRepository!, provider, true);
  const clientEventId = randomUUID();
  const request = {
    fulfillmentId: started.session.id, clientEventId, actorId: "operator-test",
    providerMode: "live" as const,
    destination: {
      name: "Ana Lopez", company: "", address1: "100 Test Street", address2: "",
      city: "Miami", state: "FL", postalCode: "33101", countryCode: "US", phone: "",
    },
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    rate: {
      rateId: "se-rate-55", carrierId: "se-ups", carrierCode: "ups",
      carrierName: "UPS", serviceCode: "ups_ground", serviceName: "UPS Ground",
      amount: 10.5, currency: "USD", deliveryDays: 4,
      estimatedDeliveryDate: null, guaranteed: false, isEstimate: true,
    },
    sourceShipping: { exported: false, shippedItemCount: 0, shipmentIds: [], trackingNumber: "" },
  };

  const interrupted = await workflow.create(request);
  assert.equal(interrupted.label.state, "purchase_unknown");
  const replay = await workflow.create(request);
  assert.equal(replay.replayed, true);
  assert.equal(purchaseCalls, 1);

  const recovered = await workflow.reconcile({
    fulfillmentId: started.session.id,
    actorId: "operator-test",
  });
  assert.equal(recovered.state, "label_ready");
  assert.equal(recovered.trackingNumber, "1ZTEST55");
  assert.equal(purchaseCalls, 1);
  assert.equal(reconciliationCalls, 1);
});

test("a definitive mocked provider rejection can be retried explicitly with a new event", {
  skip: !testDatabaseUrl,
}, async () => {
  const started = await activeRepository().createOrResume({
    orderId: uniqueOrderId(56), orderNumber: "TEST-56", sourceModifiedAt: null,
    sourceSnapshot: {}, progress: { verifiedUnits: 1 }, actorId: "operator-test",
  });
  const packedEventId = randomUUID();
  await activeRepository().completePacking({
    fulfillmentId: started.session.id, clientEventId: packedEventId,
    expectedVersion: started.session.version, actorId: "operator-test",
  }, () => ({
    version: 1, clientEventId: packedEventId, orderId: started.session.orderId,
    orderNumber: started.session.orderNumber, sourceModifiedAt: null,
    confirmedAt: "2026-10-16T14:08:00.000Z", packedBy: "operator-test",
    verifiedUnits: 1, totalUnits: 1, lines: [],
  }));
  let calls = 0;
  const provider = {
    async purchaseLabelFromRate() {
      calls += 1;
      if (calls === 1) {
        throw new ShipStationGatewayError("The simulated request was rejected", "purchase_rejected");
      }
      return {
        labelId: "se-label-56", shipmentId: "se-shipment-56", status: "completed" as const,
        trackingNumber: "1ZTEST56", carrierId: "se-ups", carrierCode: "ups",
        serviceCode: "ups_ground", amount: 10.75, currency: "USD", labelDownloadUrl: null,
      };
    },
    async findLabelsByRateId() { return []; },
  };
  const workflow = new FulfillmentShippingWorkflow(shippingRepository!, provider, true);
  const request = {
    fulfillmentId: started.session.id, clientEventId: randomUUID(), actorId: "operator-test",
    providerMode: "live" as const,
    destination: {
      name: "Ana Lopez", company: "", address1: "100 Test Street", address2: "",
      city: "Miami", state: "FL", postalCode: "33101", countryCode: "US", phone: "",
    },
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    rate: {
      rateId: "se-rate-56", carrierId: "se-ups", carrierCode: "ups",
      carrierName: "UPS", serviceCode: "ups_ground", serviceName: "UPS Ground",
      amount: 10.75, currency: "USD", deliveryDays: 4,
      estimatedDeliveryDate: null, guaranteed: false, isEstimate: true,
    },
    sourceShipping: { exported: false, shippedItemCount: 0, shipmentIds: [], trackingNumber: "" },
  };

  const failed = await workflow.create(request);
  assert.equal(failed.label.state, "failed");
  assert.equal(failed.label.failureCode, "purchase_rejected");
  const ready = await workflow.create({ ...request, clientEventId: randomUUID() });
  assert.equal(ready.label.state, "label_ready");
  assert.equal(ready.label.trackingNumber, "1ZTEST56");
  assert.equal(calls, 2);
});

test("product and variation locations upsert, inherit and remove safely", {
  skip: !testDatabaseUrl,
}, async () => {
  const locations = locationRepository!;
  const productId = uniqueOrderId(100);
  const product = await locations.upsert({
    productId,
    locationCode: " a-01 ",
    updatedBy: "administrator-test",
  });
  assert.equal(product.locationCode, "A-01");

  const inherited = await locations.getEffective(productId, 501);
  assert.equal(inherited.inherited, true);
  assert.equal(inherited.location?.locationCode, "A-01");

  const variation = await locations.upsert({
    productId,
    variationId: 501,
    locationCode: "B-02",
    updatedBy: "administrator-test",
  });
  assert.equal(variation.locationCode, "B-02");
  assert.equal((await locations.getEffective(productId, 501)).inherited, false);

  const replaced = await locations.upsert({
    productId,
    variationId: 501,
    locationCode: "B-03",
    updatedBy: "administrator-test",
  });
  assert.equal(replaced.locationCode, "B-03");
  assert.equal((await locations.list()).filter((item) =>
    item.productId === productId && item.variationId === 501).length, 1);

  assert.equal(await locations.remove(productId, 501), true);
  assert.equal((await locations.getEffective(productId, 501)).inherited, true);
});

test("opaque barcode identifiers resolve exactly and reject altered values", {
  skip: !testDatabaseUrl,
}, async () => {
  const labels = new BarcodeLabelService("integration-barcode-signing-secret-at-least-32-characters");
  const payload = {
    version: 1 as const,
    type: "batch" as const,
    productId: uniqueOrderId(101),
    variationId: 701,
    coaId: "coa-integration-1",
    lot: "LOT-INTEGRATION-1",
  };
  const barcodeValue = labels.identifierFor(payload);
  const first = await barcodeRepository!.createOrGet({
    barcodeValue,
    payload,
    createdBy: "administrator-test",
  });
  const replay = await barcodeRepository!.createOrGet({
    barcodeValue,
    payload,
    createdBy: "another-user",
  });

  assert.equal(first.barcodeValue, barcodeValue);
  assert.equal(first.active, true);
  assert.equal(replay.barcodeValue, barcodeValue);
  assert.equal(replay.createdBy, "administrator-test");
  assert.deepEqual(await barcodeRepository!.resolve(barcodeValue), first);
  assert.deepEqual(await barcodeRepository!.list(), [first]);

  const finalDigit = barcodeValue.endsWith("9") ? "8" : "9";
  const altered = `${barcodeValue.slice(0, -1)}${finalDigit}`;
  assert.equal(await barcodeRepository!.resolve(altered), null);
});
