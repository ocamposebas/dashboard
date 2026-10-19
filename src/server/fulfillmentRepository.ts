import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type {
  FulfillmentEventType,
  FulfillmentPackingSnapshot,
  FulfillmentScanDecision,
  FulfillmentScanEvent,
  FulfillmentSession,
  FulfillmentState,
  FulfillmentSyncState,
  JsonValue,
  RecordedFulfillmentScan,
  RecordFulfillmentScanInput,
  StartFulfillmentInput,
} from "../shared/fulfillment.js";
import type { Database, SqlExecutor } from "./database.js";

interface FulfillmentRow extends QueryResultRow {
  id: string;
  order_id: string | number;
  order_number: string;
  state: FulfillmentState;
  source_modified_at: Date | string | null;
  source_snapshot: unknown;
  progress: unknown;
  completion_snapshot: unknown;
  started_by: string;
  cancelled_by: string | null;
  cancel_reason: string | null;
  started_at: Date | string;
  updated_at: Date | string;
  packed_at: Date | string | null;
  version: number;
  wordpress_sync_state: FulfillmentSession["wordpressSyncState"];
  wordpress_sync_attempts: number;
  wordpress_next_retry_at: Date | string | null;
  wordpress_last_error: string | null;
}

interface ScanEventRow extends QueryResultRow {
  id: string;
  fulfillment_id: string;
  client_event_id: string;
  raw_barcode: string;
  barcode_type: string | null;
  product_id: string | number | null;
  variation_id: string | number | null;
  order_item_id: string | number | null;
  coa_id: string | null;
  lot: string | null;
  result: FulfillmentScanEvent["result"];
  reason_code: string;
  quantity_delta: number;
  response_snapshot: unknown;
  actor_id: string;
  created_at: Date | string;
}

export class FulfillmentRepositoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_found"
      | "invalid_input"
      | "invalid_state"
      | "active_conflict"
      | "version_conflict"
      | "idempotency_conflict",
  ) {
    super(message);
    this.name = "FulfillmentRepositoryError";
  }
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  throw new FulfillmentRepositoryError("Stored fulfillment JSON is invalid", "invalid_input");
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new FulfillmentRepositoryError("Stored fulfillment timestamp is invalid", "invalid_input");
  }
  return parsed.toISOString();
}

function safeInteger(value: string | number | null, field: string): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new FulfillmentRepositoryError(`Stored ${field} is invalid`, "invalid_input");
  }
  return parsed;
}

function fulfillmentFromRow(row: FulfillmentRow): FulfillmentSession {
  const orderId = safeInteger(row.order_id, "order id");
  if (orderId === null || orderId <= 0) {
    throw new FulfillmentRepositoryError("Stored order id is invalid", "invalid_input");
  }
  return {
    id: row.id,
    orderId,
    orderNumber: row.order_number,
    state: row.state,
    sourceModifiedAt: iso(row.source_modified_at),
    sourceSnapshot: jsonValue(row.source_snapshot),
    progress: jsonValue(row.progress),
    completionSnapshot: row.completion_snapshot === null ? null : jsonValue(row.completion_snapshot),
    startedBy: row.started_by,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    startedAt: iso(row.started_at)!,
    updatedAt: iso(row.updated_at)!,
    packedAt: iso(row.packed_at),
    version: row.version,
    wordpressSyncState: row.wordpress_sync_state,
    wordpressSyncAttempts: row.wordpress_sync_attempts,
    wordpressNextRetryAt: iso(row.wordpress_next_retry_at),
    wordpressLastError: row.wordpress_last_error,
  };
}

function scanEventFromRow(row: ScanEventRow): FulfillmentScanEvent {
  return {
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    clientEventId: row.client_event_id,
    rawBarcode: row.raw_barcode,
    barcodeType: row.barcode_type,
    productId: safeInteger(row.product_id, "scan product id"),
    variationId: safeInteger(row.variation_id, "scan variation id"),
    orderItemId: safeInteger(row.order_item_id, "scan order item id"),
    coaId: row.coa_id,
    lot: row.lot,
    result: row.result,
    reasonCode: row.reason_code,
    quantityDelta: row.quantity_delta,
    responseSnapshot: jsonValue(row.response_snapshot),
    actorId: row.actor_id,
    createdAt: iso(row.created_at)!,
  };
}

function requireText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new FulfillmentRepositoryError(`${field} is invalid`, "invalid_input");
  }
  return normalized;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): string {
  const normalized = requireText(value, field, 36);
  if (!UUID_PATTERN.test(normalized)) {
    throw new FulfillmentRepositoryError(`${field} must be a UUID`, "invalid_input");
  }
  return normalized;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FulfillmentRepositoryError(`${field} is invalid`, "invalid_input");
  }
  return value;
}

function validateScanDecision(decision: FulfillmentScanDecision): void {
  requireText(decision.reasonCode, "Scan reason code", 40);
  if (!Number.isSafeInteger(decision.quantityDelta) || decision.quantityDelta < 0) {
    throw new FulfillmentRepositoryError("Scan quantity delta is invalid", "invalid_input");
  }
  if (decision.result === "accepted") {
    if (decision.quantityDelta <= 0 || decision.nextProgress === undefined) {
      throw new FulfillmentRepositoryError(
        "Accepted scans must include a positive quantity and next progress",
        "invalid_input",
      );
    }
  } else if (decision.quantityDelta !== 0 || decision.nextProgress !== undefined) {
    throw new FulfillmentRepositoryError(
      "Rejected scans cannot change fulfillment progress",
      "invalid_input",
    );
  }
}

async function fulfillmentById(
  executor: SqlExecutor,
  fulfillmentId: string,
  lock = false,
): Promise<FulfillmentSession | null> {
  const result = await executor.query<FulfillmentRow>(
    `SELECT * FROM order_fulfillments WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [fulfillmentId],
  );
  return result.rows[0] ? fulfillmentFromRow(result.rows[0]) : null;
}

async function scanByClientEventId(
  executor: SqlExecutor,
  clientEventId: string,
): Promise<FulfillmentScanEvent | null> {
  const result = await executor.query<ScanEventRow>(
    "SELECT * FROM fulfillment_scan_events WHERE client_event_id = $1",
    [clientEventId],
  );
  return result.rows[0] ? scanEventFromRow(result.rows[0]) : null;
}

function assertReplayMatches(
  event: FulfillmentScanEvent,
  input: RecordFulfillmentScanInput,
): void {
  if (
    event.fulfillmentId !== input.fulfillmentId ||
    event.rawBarcode !== input.rawBarcode ||
    event.actorId !== input.actorId
  ) {
    throw new FulfillmentRepositoryError(
      "The scan event id was already used for different request content",
      "idempotency_conflict",
    );
  }
}

export class FulfillmentRepository {
  constructor(private readonly database: Database) {}

  async getById(id: string): Promise<FulfillmentSession | null> {
    return fulfillmentById(this.database, requireUuid(id, "Fulfillment id"));
  }

  async getByOrderId(orderId: number): Promise<FulfillmentSession | null> {
    const result = await this.database.query<FulfillmentRow>(
      "SELECT * FROM order_fulfillments WHERE order_id = $1",
      [requirePositiveInteger(orderId, "Order id")],
    );
    return result.rows[0] ? fulfillmentFromRow(result.rows[0]) : null;
  }

  async list(): Promise<FulfillmentSession[]> {
    const result = await this.database.query<FulfillmentRow>(
      "SELECT * FROM order_fulfillments ORDER BY updated_at DESC",
    );
    return result.rows.map(fulfillmentFromRow);
  }

  async getRecordedScan(input: RecordFulfillmentScanInput): Promise<RecordedFulfillmentScan | null> {
    const normalized: RecordFulfillmentScanInput = {
      fulfillmentId: requireUuid(input.fulfillmentId, "Fulfillment id"),
      clientEventId: requireUuid(input.clientEventId, "Client event id"),
      rawBarcode: requireText(input.rawBarcode, "Barcode", 512),
      actorId: requireText(input.actorId, "Actor id", 100),
    };
    const event = await scanByClientEventId(this.database, normalized.clientEventId);
    if (!event) return null;
    assertReplayMatches(event, normalized);
    const session = await fulfillmentById(this.database, event.fulfillmentId);
    if (!session) {
      throw new FulfillmentRepositoryError("The fulfillment no longer exists", "not_found");
    }
    return { replayed: true, session, event };
  }

  async createOrResume(input: StartFulfillmentInput): Promise<{
    created: boolean;
    session: FulfillmentSession;
  }> {
    const orderId = requirePositiveInteger(input.orderId, "Order id");
    const orderNumber = requireText(input.orderNumber, "Order number", 40);
    const actorId = requireText(input.actorId, "Actor id", 100);
    const id = randomUUID();

    try {
      return await this.database.transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1, $2)", [7319, 3003]);
        const existing = await client.query<FulfillmentRow>(
          "SELECT * FROM order_fulfillments WHERE order_id = $1 FOR UPDATE",
          [orderId],
        );
        const row = existing.rows[0];
        if (!row) {
          const active = await client.query<{ id: string }>(
            "SELECT id FROM order_fulfillments WHERE state = 'open' LIMIT 1",
          );
          if (active.rows[0]) {
            throw new FulfillmentRepositoryError(
              "Pause the active order before starting another one",
              "active_conflict",
            );
          }
          const inserted = await client.query<FulfillmentRow>(
            `INSERT INTO order_fulfillments (
              id, order_id, order_number, state, source_modified_at,
              source_snapshot, progress, started_by
            ) VALUES ($1, $2, $3, 'open', $4, $5::jsonb, $6::jsonb, $7)
            RETURNING *`,
            [
              id,
              orderId,
              orderNumber,
              input.sourceModifiedAt,
              JSON.stringify(input.sourceSnapshot),
              JSON.stringify(input.progress),
              actorId,
            ],
          );
          const createdRow = inserted.rows[0];
          if (!createdRow) {
            throw new FulfillmentRepositoryError(
              "The fulfillment could not be created",
              "not_found",
            );
          }
          await this.insertEvent(client, id, "started", actorId, null, {
            orderId,
            orderNumber,
          });
          return { created: true, session: fulfillmentFromRow(createdRow) };
        }
        const session = fulfillmentFromRow(row);
        if (session.sourceModifiedAt !== iso(input.sourceModifiedAt)) {
          throw new FulfillmentRepositoryError(
            "The source order changed after this fulfillment session was created",
            "invalid_state",
          );
        }
        if (session.state === "open") return { created: false, session };
        if (session.state !== "paused") {
          throw new FulfillmentRepositoryError(
            `The fulfillment is already ${session.state}`,
            "invalid_state",
          );
        }
        const resumed = await client.query<FulfillmentRow>(
          `UPDATE order_fulfillments
           SET state = 'open', version = version + 1, updated_at = now()
           WHERE id = $1 AND state = 'paused' AND version = $2
           RETURNING *`,
          [session.id, session.version],
        );
        const resumedRow = resumed.rows[0];
        if (!resumedRow) {
          throw new FulfillmentRepositoryError(
            "The fulfillment changed while it was being resumed",
            "version_conflict",
          );
        }
        await this.insertEvent(client, session.id, "resumed", actorId, null, {
          orderId,
          orderNumber,
        });
        return { created: false, session: fulfillmentFromRow(resumedRow) };
      });
    } catch (error: unknown) {
      const postgres = error as { code?: string; constraint?: string };
      if (
        postgres.code === "23505" &&
        postgres.constraint === "order_fulfillments_single_active_idx"
      ) {
        throw new FulfillmentRepositoryError(
          "Pause the active order before starting another one",
          "active_conflict",
        );
      }
      throw error;
    }
  }

  async pauseOpenSession(input: {
    fulfillmentId: string;
    expectedVersion: number;
    actorId: string;
  }): Promise<FulfillmentSession> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const expectedVersion = requirePositiveInteger(input.expectedVersion, "Expected version");
    const actorId = requireText(input.actorId, "Actor id", 100);
    return this.database.transaction(async (client) => {
      const session = await fulfillmentById(client, fulfillmentId, true);
      if (!session) {
        throw new FulfillmentRepositoryError("The fulfillment does not exist", "not_found");
      }
      if (session.state !== "open") {
        throw new FulfillmentRepositoryError(
          `The fulfillment is already ${session.state}`,
          "invalid_state",
        );
      }
      if (session.version !== expectedVersion) {
        throw new FulfillmentRepositoryError(
          "The fulfillment changed after the client loaded it",
          "version_conflict",
        );
      }
      const updated = await client.query<FulfillmentRow>(
        `UPDATE order_fulfillments
         SET state = 'paused', version = version + 1, updated_at = now()
         WHERE id = $1 AND state = 'open' AND version = $2
         RETURNING *`,
        [fulfillmentId, expectedVersion],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new FulfillmentRepositoryError(
          "The fulfillment changed while it was being paused",
          "version_conflict",
        );
      }
      await this.insertEvent(client, fulfillmentId, "paused", actorId, null, {
        orderId: session.orderId,
        orderNumber: session.orderNumber,
      });
      return fulfillmentFromRow(row);
    });
  }

  async recordIdempotentScan(
    input: RecordFulfillmentScanInput,
    decide: (session: FulfillmentSession) => FulfillmentScanDecision,
  ): Promise<RecordedFulfillmentScan> {
    const normalized: RecordFulfillmentScanInput = {
      fulfillmentId: requireUuid(input.fulfillmentId, "Fulfillment id"),
      clientEventId: requireUuid(input.clientEventId, "Client event id"),
      rawBarcode: requireText(input.rawBarcode, "Barcode", 512),
      actorId: requireText(input.actorId, "Actor id", 100),
      ...(input.expectedVersion === undefined
        ? {}
        : { expectedVersion: requirePositiveInteger(input.expectedVersion, "Expected version") }),
    };

    return this.database.transaction(async (client) => {
      const earlyReplay = await scanByClientEventId(client, normalized.clientEventId);
      if (earlyReplay) {
        assertReplayMatches(earlyReplay, normalized);
        const session = await fulfillmentById(client, earlyReplay.fulfillmentId);
        if (!session) {
          throw new FulfillmentRepositoryError("The fulfillment no longer exists", "not_found");
        }
        return { replayed: true, session, event: earlyReplay };
      }

      const session = await fulfillmentById(client, normalized.fulfillmentId, true);
      if (!session) {
        throw new FulfillmentRepositoryError("The fulfillment does not exist", "not_found");
      }

      const lockedReplay = await scanByClientEventId(client, normalized.clientEventId);
      if (lockedReplay) {
        assertReplayMatches(lockedReplay, normalized);
        return { replayed: true, session, event: lockedReplay };
      }

      if (session.state !== "open") {
        throw new FulfillmentRepositoryError(
          `The fulfillment is ${session.state} and cannot accept scans`,
          "invalid_state",
        );
      }
      if (
        normalized.expectedVersion !== undefined &&
        normalized.expectedVersion !== session.version
      ) {
        throw new FulfillmentRepositoryError(
          "The fulfillment changed after the client loaded it",
          "version_conflict",
        );
      }

      const decision = decide(session);
      validateScanDecision(decision);
      const eventId = randomUUID();
      const inserted = await client.query<ScanEventRow>(
        `INSERT INTO fulfillment_scan_events (
          id, fulfillment_id, client_event_id, raw_barcode, barcode_type,
          product_id, variation_id, order_item_id, coa_id, lot,
          result, reason_code, quantity_delta, response_snapshot, actor_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14::jsonb, $15
        ) ON CONFLICT (client_event_id) DO NOTHING
        RETURNING *`,
        [
          eventId,
          normalized.fulfillmentId,
          normalized.clientEventId,
          normalized.rawBarcode,
          decision.barcodeType ?? null,
          decision.productId ?? null,
          decision.variationId ?? null,
          decision.orderItemId ?? null,
          decision.coaId ?? null,
          decision.lot ?? null,
          decision.result,
          decision.reasonCode,
          decision.quantityDelta,
          JSON.stringify(decision.responseSnapshot),
          normalized.actorId,
        ],
      );

      let eventRow = inserted.rows[0];
      if (!eventRow) {
        const replay = await scanByClientEventId(client, normalized.clientEventId);
        if (!replay) {
          throw new FulfillmentRepositoryError("The scan event could not be recorded", "not_found");
        }
        assertReplayMatches(replay, normalized);
        return { replayed: true, session, event: replay };
      }

      let updatedSession = session;
      if (decision.result === "accepted") {
        const updated = await client.query<FulfillmentRow>(
          `UPDATE order_fulfillments
          SET progress = $2::jsonb, version = version + 1, updated_at = now()
          WHERE id = $1 AND state = 'open' AND version = $3
          RETURNING *`,
          [normalized.fulfillmentId, JSON.stringify(decision.nextProgress), session.version],
        );
        const row = updated.rows[0];
        if (!row) {
          throw new FulfillmentRepositoryError(
            "The fulfillment changed while the scan was being recorded",
            "version_conflict",
          );
        }
        updatedSession = fulfillmentFromRow(row);
      }

      eventRow = { ...eventRow };
      return {
        replayed: false,
        session: updatedSession,
        event: scanEventFromRow(eventRow),
      };
    });
  }

  async transitionOpenSession(input: {
    fulfillmentId: string;
    expectedVersion: number;
    nextState: "packed" | "cancelled";
    actorId: string;
    reason?: string;
    completionSnapshot?: JsonValue;
  }): Promise<FulfillmentSession> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    const expectedVersion = requirePositiveInteger(input.expectedVersion, "Expected version");
    const reason = input.reason?.trim() || null;
    if (input.nextState === "cancelled" && !reason) {
      throw new FulfillmentRepositoryError("Cancellation requires a reason", "invalid_input");
    }
    if (input.nextState === "packed" && input.completionSnapshot === undefined) {
      throw new FulfillmentRepositoryError(
        "Packed fulfillment requires a completion snapshot",
        "invalid_input",
      );
    }

    return this.database.transaction(async (client) => {
      const session = await fulfillmentById(client, fulfillmentId, true);
      if (!session) {
        throw new FulfillmentRepositoryError("The fulfillment does not exist", "not_found");
      }
      if (session.state !== "open") {
        throw new FulfillmentRepositoryError(
          `The fulfillment is already ${session.state}`,
          "invalid_state",
        );
      }
      if (session.version !== expectedVersion) {
        throw new FulfillmentRepositoryError(
          "The fulfillment changed after the client loaded it",
          "version_conflict",
        );
      }

      const updated = await client.query<FulfillmentRow>(
        `UPDATE order_fulfillments SET
          state = $2::varchar(20),
          completion_snapshot = CASE WHEN $2::varchar(20) = 'packed' THEN $3::jsonb ELSE completion_snapshot END,
          packed_at = CASE WHEN $2::varchar(20) = 'packed' THEN now() ELSE packed_at END,
          cancelled_by = CASE WHEN $2::varchar(20) = 'cancelled' THEN $4 ELSE cancelled_by END,
          cancel_reason = CASE WHEN $2::varchar(20) = 'cancelled' THEN $5 ELSE cancel_reason END,
          wordpress_sync_state = CASE WHEN $2::varchar(20) = 'packed' THEN 'pending' ELSE wordpress_sync_state END,
          version = version + 1,
          updated_at = now()
        WHERE id = $1 AND state = 'open' AND version = $6
        RETURNING *`,
        [
          fulfillmentId,
          input.nextState,
          input.completionSnapshot === undefined
            ? null
            : JSON.stringify(input.completionSnapshot),
          actorId,
          reason,
          expectedVersion,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new FulfillmentRepositoryError(
          "The fulfillment changed during the state transition",
          "version_conflict",
        );
      }
      await this.insertEvent(
        client,
        fulfillmentId,
        input.nextState,
        actorId,
        reason,
        input.completionSnapshot ?? {},
      );
      return fulfillmentFromRow(row);
    });
  }

  async completePacking(
    input: {
      fulfillmentId: string;
      clientEventId: string;
      expectedVersion: number;
      actorId: string;
    },
    createSnapshot: (session: FulfillmentSession) => FulfillmentPackingSnapshot,
  ): Promise<{ replayed: boolean; session: FulfillmentSession; snapshot: FulfillmentPackingSnapshot }> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const expectedVersion = requirePositiveInteger(input.expectedVersion, "Expected version");
    const actorId = requireText(input.actorId, "Actor id", 100);

    return this.database.transaction(async (client) => {
      const session = await fulfillmentById(client, fulfillmentId, true);
      if (!session) {
        throw new FulfillmentRepositoryError("The fulfillment does not exist", "not_found");
      }
      if (session.state === "packed") {
        const stored = session.completionSnapshot && typeof session.completionSnapshot === "object" &&
          !Array.isArray(session.completionSnapshot)
          ? session.completionSnapshot as Record<string, JsonValue>
          : null;
        if (stored?.clientEventId !== clientEventId) {
          throw new FulfillmentRepositoryError(
            "This order was already packed by another confirmation",
            "idempotency_conflict",
          );
        }
        return {
          replayed: true,
          session,
          snapshot: stored as unknown as FulfillmentPackingSnapshot,
        };
      }
      if (session.state !== "open") {
        throw new FulfillmentRepositoryError(
          `The fulfillment is ${session.state} and cannot be packed`,
          "invalid_state",
        );
      }
      if (session.version !== expectedVersion) {
        throw new FulfillmentRepositoryError(
          "The fulfillment changed after the packing review was opened",
          "version_conflict",
        );
      }

      const snapshot = createSnapshot(session);
      if (snapshot.clientEventId !== clientEventId || snapshot.packedBy !== actorId) {
        throw new FulfillmentRepositoryError(
          "The packing confirmation identity is invalid",
          "invalid_input",
        );
      }
      const updated = await client.query<FulfillmentRow>(
        `UPDATE order_fulfillments SET
          state = 'packed', completion_snapshot = $2::jsonb, packed_at = now(),
          wordpress_sync_state = 'pending', version = version + 1, updated_at = now()
         WHERE id = $1 AND state = 'open' AND version = $3
         RETURNING *`,
        [fulfillmentId, JSON.stringify(snapshot), expectedVersion],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new FulfillmentRepositoryError(
          "The fulfillment changed during packing confirmation",
          "version_conflict",
        );
      }
      await this.insertEvent(client, fulfillmentId, "packed", actorId, null, snapshot);
      return { replayed: false, session: fulfillmentFromRow(row), snapshot };
    });
  }

  async recordWordPressSync(input: {
    fulfillmentId: string;
    actorId: string;
    state: Extract<FulfillmentSyncState, "synced" | "failed">;
    error?: string;
    details?: JsonValue;
  }): Promise<FulfillmentSession> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    const error = input.state === "failed"
      ? requireText(input.error || "WordPress COA synchronization failed", "Sync error", 2_000)
      : null;
    return this.database.transaction(async (client) => {
      const session = await fulfillmentById(client, fulfillmentId, true);
      if (!session) {
        throw new FulfillmentRepositoryError("The fulfillment does not exist", "not_found");
      }
      if (session.state !== "packed") {
        throw new FulfillmentRepositoryError(
          "COA assignments can only be synchronized after packing",
          "invalid_state",
        );
      }
      const updated = await client.query<FulfillmentRow>(
        `UPDATE order_fulfillments SET
          wordpress_sync_state = $2::varchar(20),
          wordpress_sync_attempts = wordpress_sync_attempts + 1,
          wordpress_next_retry_at = CASE
            WHEN $2::varchar(20) = 'failed' THEN now() + interval '5 minutes'
            ELSE NULL
          END,
          wordpress_last_error = $3,
          version = version + 1,
          updated_at = now()
         WHERE id = $1 AND state = 'packed'
         RETURNING *`,
        [fulfillmentId, input.state, error],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new FulfillmentRepositoryError("The fulfillment sync state could not be saved", "not_found");
      }
      await this.insertEvent(
        client,
        fulfillmentId,
        input.state === "synced" ? "sync_succeeded" : "sync_failed",
        actorId,
        error,
        input.details || {},
      );
      return fulfillmentFromRow(row);
    });
  }

  private async insertEvent(
    executor: SqlExecutor,
    fulfillmentId: string,
    eventType: FulfillmentEventType,
    actorId: string,
    reason: string | null,
    details: JsonValue,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO fulfillment_events (
        id, fulfillment_id, event_type, actor_id, reason, details
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [randomUUID(), fulfillmentId, eventType, actorId, reason, JSON.stringify(details)],
    );
  }
}
