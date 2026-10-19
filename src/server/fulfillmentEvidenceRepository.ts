import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type {
  FulfillmentEvidenceFile,
  FulfillmentEvidenceKind,
  FulfillmentEvidenceWorkspace,
} from "../shared/fulfillmentEvidence.js";
import type { Database, SqlExecutor } from "./database.js";

interface FulfillmentEvidenceSetRow extends QueryResultRow {
  fulfillment_id: string;
  order_id: string | number;
  order_number: string;
  state: "draft" | "confirmed";
  version: number;
  confirmation_client_event_id: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  notification_state: FulfillmentEvidenceWorkspace["notificationState"];
  notification_message: string;
  updated_at: Date | string;
}

interface FulfillmentEvidenceFileRow extends QueryResultRow {
  id: string;
  fulfillment_id: string;
  client_event_id: string;
  kind: FulfillmentEvidenceKind;
  label: string;
  mime: FulfillmentEvidenceFile["mime"];
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  storage_key: string;
  customer_visible: boolean;
  captured_by: string;
  captured_at: Date | string;
}

interface FulfillmentRow extends QueryResultRow {
  id: string;
  order_id: string | number;
  order_number: string;
  state: string;
  updated_at: Date | string;
}

export class FulfillmentEvidenceRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "not_found" | "invalid_state" | "idempotency_conflict",
  ) {
    super(message);
    this.name = "FulfillmentEvidenceRepositoryError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new FulfillmentEvidenceRepositoryError(`${field} must be a UUID`, "invalid_input");
  }
  return normalized;
}

function requireActor(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) {
    throw new FulfillmentEvidenceRepositoryError("Actor id is invalid", "invalid_input");
  }
  return normalized;
}

function cleanNotificationMessage(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (normalized || "Customer email status was updated.").slice(0, 300);
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new FulfillmentEvidenceRepositoryError("Stored evidence timestamp is invalid", "invalid_input");
  }
  return parsed.toISOString();
}

function fileFromRow(row: FulfillmentEvidenceFileRow): FulfillmentEvidenceFile {
  return {
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    kind: row.kind,
    label: row.label,
    mime: row.mime,
    bytes: Number(row.bytes),
    width: Number(row.width),
    height: Number(row.height),
    sha256: row.sha256,
    customerVisible: row.customer_visible,
    capturedBy: row.captured_by,
    capturedAt: iso(row.captured_at)!,
    contentUrl: `/api/fulfillment/evidence/file?id=${encodeURIComponent(row.id)}`,
  };
}

async function fulfillmentRow(
  executor: SqlExecutor,
  fulfillmentId: string,
  lock = false,
): Promise<FulfillmentRow> {
  const result = await executor.query<FulfillmentRow>(
    `SELECT id, order_id, order_number, state, updated_at FROM order_fulfillments WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [fulfillmentId],
  );
  const row = result.rows[0];
  if (!row) throw new FulfillmentEvidenceRepositoryError("The fulfillment does not exist", "not_found");
  return row;
}

async function ensurePackedSet(executor: SqlExecutor, fulfillmentId: string): Promise<FulfillmentEvidenceSetRow> {
  const fulfillment = await fulfillmentRow(executor, fulfillmentId, true);
  if (fulfillment.state !== "packed") {
    throw new FulfillmentEvidenceRepositoryError("Evidence can only be captured after packing is confirmed", "invalid_state");
  }
  const inserted = await executor.query<FulfillmentEvidenceSetRow>(
    `INSERT INTO fulfillment_evidence_sets (fulfillment_id, order_id, order_number)
     VALUES ($1, $2, $3)
     ON CONFLICT (fulfillment_id) DO NOTHING
     RETURNING *`,
    [fulfillment.id, fulfillment.order_id, fulfillment.order_number],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const result = await executor.query<FulfillmentEvidenceSetRow>(
    "SELECT * FROM fulfillment_evidence_sets WHERE fulfillment_id = $1 FOR UPDATE",
    [fulfillmentId],
  );
  return result.rows[0]!;
}

async function addEvent(
  executor: SqlExecutor,
  input: {
    fulfillmentId: string;
    evidenceId?: string | null;
    clientEventId?: string | null;
    eventType: string;
    actorId: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO fulfillment_evidence_events (
      id, fulfillment_id, evidence_id, client_event_id, event_type, actor_id, details
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT (client_event_id, event_type) WHERE client_event_id IS NOT NULL DO NOTHING`,
    [
      randomUUID(), input.fulfillmentId, input.evidenceId || null, input.clientEventId || null,
      input.eventType, input.actorId, JSON.stringify(input.details || {}),
    ],
  );
}

async function activeFiles(executor: SqlExecutor, fulfillmentId: string): Promise<FulfillmentEvidenceFileRow[]> {
  const result = await executor.query<FulfillmentEvidenceFileRow>(
    `SELECT * FROM fulfillment_evidence_files
     WHERE fulfillment_id = $1 AND deleted_at IS NULL
     ORDER BY CASE kind WHEN 'contents' THEN 1 ELSE 2 END, captured_at`,
    [fulfillmentId],
  );
  return result.rows;
}

function workspaceFromRows(
  set: FulfillmentEvidenceSetRow,
  files: FulfillmentEvidenceFileRow[],
): FulfillmentEvidenceWorkspace {
  const orderId = Number(set.order_id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new FulfillmentEvidenceRepositoryError("Stored evidence order is invalid", "invalid_input");
  }
  return {
    fulfillmentId: set.fulfillment_id,
    orderId,
    orderNumber: set.order_number,
    state: set.state,
    version: Number(set.version),
    confirmedBy: set.confirmed_by,
    confirmedAt: iso(set.confirmed_at),
    notificationState: set.notification_state,
    notificationMessage: set.notification_message,
    files: files.map(fileFromRow),
    updatedAt: iso(set.updated_at)!,
  };
}

export interface SaveFulfillmentEvidenceInput {
  id: string;
  fulfillmentId: string;
  clientEventId: string;
  kind: FulfillmentEvidenceKind;
  label: string;
  mime: FulfillmentEvidenceFile["mime"];
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  storageKey: string;
  customerVisible: boolean;
  actorId: string;
}

export class FulfillmentEvidenceRepository {
  constructor(private readonly database: Database) {}

  async getWorkspace(fulfillmentIdInput: string): Promise<FulfillmentEvidenceWorkspace> {
    const fulfillmentId = requireUuid(fulfillmentIdInput, "Fulfillment id");
    const fulfillment = await fulfillmentRow(this.database, fulfillmentId);
    if (fulfillment.state !== "packed") {
      throw new FulfillmentEvidenceRepositoryError("Evidence is available after packing is confirmed", "invalid_state");
    }
    const setResult = await this.database.query<FulfillmentEvidenceSetRow>(
      "SELECT * FROM fulfillment_evidence_sets WHERE fulfillment_id = $1",
      [fulfillmentId],
    );
    const set = setResult.rows[0];
    if (!set) {
      return {
        fulfillmentId,
        orderId: Number(fulfillment.order_id),
        orderNumber: fulfillment.order_number,
        state: "draft",
        version: 1,
        confirmedBy: null,
        confirmedAt: null,
        notificationState: "not_configured",
        notificationMessage: "Customer email is disabled in this environment.",
        files: [],
        updatedAt: iso(fulfillment.updated_at)!,
      };
    }
    return workspaceFromRows(set, await activeFiles(this.database, fulfillmentId));
  }

  async saveFile(input: SaveFulfillmentEvidenceInput): Promise<{ workspace: FulfillmentEvidenceWorkspace; replayed: boolean }> {
    const id = requireUuid(input.id, "Evidence id");
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireActor(input.actorId);
    if (!["contents", "sealed_label"].includes(input.kind)) {
      throw new FulfillmentEvidenceRepositoryError("Evidence kind is invalid", "invalid_input");
    }
    return this.database.transaction(async (client) => {
      const replay = await client.query<FulfillmentEvidenceFileRow>(
        "SELECT * FROM fulfillment_evidence_files WHERE client_event_id = $1",
        [clientEventId],
      );
      if (replay.rows[0]) {
        if (replay.rows[0].fulfillment_id !== fulfillmentId || replay.rows[0].kind !== input.kind) {
          throw new FulfillmentEvidenceRepositoryError("This upload event was already used for different evidence", "idempotency_conflict");
        }
        if (replay.rows[0].sha256 !== input.sha256) {
          throw new FulfillmentEvidenceRepositoryError("This upload event was already used for a different photo", "idempotency_conflict");
        }
        const setResult = await client.query<FulfillmentEvidenceSetRow>(
          "SELECT * FROM fulfillment_evidence_sets WHERE fulfillment_id = $1",
          [fulfillmentId],
        );
        return { workspace: workspaceFromRows(setResult.rows[0]!, await activeFiles(client, fulfillmentId)), replayed: true };
      }
      const set = await ensurePackedSet(client, fulfillmentId);
      if (set.state === "confirmed") {
        throw new FulfillmentEvidenceRepositoryError("Confirmed evidence is locked and cannot be replaced", "invalid_state");
      }
      const existing = await client.query<FulfillmentEvidenceFileRow>(
        "SELECT * FROM fulfillment_evidence_files WHERE fulfillment_id = $1 AND kind = $2 AND deleted_at IS NULL FOR UPDATE",
        [fulfillmentId, input.kind],
      );
      if (existing.rows[0]) {
        await client.query(
          "UPDATE fulfillment_evidence_files SET deleted_by = $2, deleted_at = now() WHERE id = $1",
          [existing.rows[0].id, actorId],
        );
      }
      await client.query(
        `INSERT INTO fulfillment_evidence_files (
          id, fulfillment_id, client_event_id, kind, label, mime, bytes, width, height,
          sha256, storage_key, customer_visible, captured_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, fulfillmentId, clientEventId, input.kind, input.label, input.mime, input.bytes,
          input.width, input.height, input.sha256, input.storageKey, input.customerVisible, actorId,
        ],
      );
      await client.query(
        "UPDATE fulfillment_evidence_sets SET version = version + 1, updated_at = now() WHERE fulfillment_id = $1",
        [fulfillmentId],
      );
      await addEvent(client, {
        fulfillmentId,
        evidenceId: id,
        clientEventId,
        eventType: existing.rows[0] ? "replaced" : "uploaded",
        actorId,
        details: { kind: input.kind, sha256: input.sha256 },
      });
      const setResult = await client.query<FulfillmentEvidenceSetRow>(
        "SELECT * FROM fulfillment_evidence_sets WHERE fulfillment_id = $1",
        [fulfillmentId],
      );
      return { workspace: workspaceFromRows(setResult.rows[0]!, await activeFiles(client, fulfillmentId)), replayed: false };
    });
  }

  async removeFile(input: { fulfillmentId: string; evidenceId: string; clientEventId: string; actorId: string }): Promise<FulfillmentEvidenceWorkspace> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const evidenceId = requireUuid(input.evidenceId, "Evidence id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireActor(input.actorId);
    return this.database.transaction(async (client) => {
      const set = await ensurePackedSet(client, fulfillmentId);
      if (set.state === "confirmed") {
        throw new FulfillmentEvidenceRepositoryError("Confirmed evidence is locked and cannot be removed", "invalid_state");
      }
      const updated = await client.query<FulfillmentEvidenceFileRow>(
        `UPDATE fulfillment_evidence_files SET deleted_by = $3, deleted_at = now()
         WHERE id = $1 AND fulfillment_id = $2 AND deleted_at IS NULL RETURNING *`,
        [evidenceId, fulfillmentId, actorId],
      );
      if (!updated.rows[0]) throw new FulfillmentEvidenceRepositoryError("The evidence photo was not found", "not_found");
      await client.query(
        "UPDATE fulfillment_evidence_sets SET version = version + 1, updated_at = now() WHERE fulfillment_id = $1",
        [fulfillmentId],
      );
      await addEvent(client, { fulfillmentId, evidenceId, clientEventId, eventType: "removed", actorId });
      const setResult = await client.query<FulfillmentEvidenceSetRow>(
        "SELECT * FROM fulfillment_evidence_sets WHERE fulfillment_id = $1",
        [fulfillmentId],
      );
      return workspaceFromRows(setResult.rows[0]!, await activeFiles(client, fulfillmentId));
    });
  }

  async confirm(input: { fulfillmentId: string; clientEventId: string; actorId: string }): Promise<{ workspace: FulfillmentEvidenceWorkspace; replayed: boolean }> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireActor(input.actorId);
    return this.database.transaction(async (client) => {
      const set = await ensurePackedSet(client, fulfillmentId);
      if (set.state === "confirmed") {
        if (set.confirmation_client_event_id !== clientEventId) {
          throw new FulfillmentEvidenceRepositoryError("Packaging evidence is already confirmed", "idempotency_conflict");
        }
        return { workspace: workspaceFromRows(set, await activeFiles(client, fulfillmentId)), replayed: true };
      }
      const files = await activeFiles(client, fulfillmentId);
      const kinds = new Set(files.map((file) => file.kind));
      if (!kinds.has("contents") || !kinds.has("sealed_label")) {
        throw new FulfillmentEvidenceRepositoryError("Capture both required photos before confirming evidence", "invalid_state");
      }
      const result = await client.query<FulfillmentEvidenceSetRow>(
        `UPDATE fulfillment_evidence_sets SET
          state = 'confirmed', confirmation_client_event_id = $2, confirmed_by = $3,
          confirmed_at = now(), version = version + 1, updated_at = now()
         WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId, clientEventId, actorId],
      );
      await addEvent(client, {
        fulfillmentId,
        clientEventId,
        eventType: "confirmed",
        actorId,
        details: { requiredPhotos: ["contents", "sealed_label"], notificationState: "not_configured" },
      });
      return { workspace: workspaceFromRows(result.rows[0]!, files), replayed: false };
    });
  }

  async queueNotification(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
  }): Promise<{ workspace: FulfillmentEvidenceWorkspace; replayed: boolean }> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireActor(input.actorId);
    return this.database.transaction(async (client) => {
      const set = await ensurePackedSet(client, fulfillmentId);
      if (set.state !== "confirmed") {
        throw new FulfillmentEvidenceRepositoryError("Confirm packaging evidence before emailing it", "invalid_state");
      }
      if (set.notification_state === "sent") {
        return { workspace: workspaceFromRows(set, await activeFiles(client, fulfillmentId)), replayed: true };
      }
      if (set.notification_state === "uncertain") {
        throw new FulfillmentEvidenceRepositoryError("Email delivery requires reconciliation before retrying", "invalid_state");
      }
      const result = await client.query<FulfillmentEvidenceSetRow>(
        `UPDATE fulfillment_evidence_sets SET
          notification_state = 'queued', notification_message = $2,
          version = version + 1, updated_at = now()
         WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId, "Customer email is queued through WordPress SMTP."],
      );
      await addEvent(client, {
        fulfillmentId,
        clientEventId,
        eventType: "notification_queued",
        actorId,
        details: { transport: "wordpress_wp_mail", attachments: ["contents", "sealed_label"] },
      });
      return {
        workspace: workspaceFromRows(result.rows[0]!, await activeFiles(client, fulfillmentId)),
        replayed: false,
      };
    });
  }

  async markNotificationSent(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    message: string;
  }): Promise<FulfillmentEvidenceWorkspace> {
    return this.updateNotification({
      ...input,
      state: "sent",
      eventType: "notification_sent",
    });
  }

  async markNotificationFailed(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    message: string;
  }): Promise<FulfillmentEvidenceWorkspace> {
    return this.updateNotification({
      ...input,
      state: "failed",
      eventType: "notification_failed",
    });
  }

  async markNotificationUncertain(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    message: string;
  }): Promise<FulfillmentEvidenceWorkspace> {
    return this.updateNotification({
      ...input,
      state: "uncertain",
      eventType: "notification_uncertain",
    });
  }

  private async updateNotification(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    state: "sent" | "failed" | "uncertain";
    eventType: "notification_sent" | "notification_failed" | "notification_uncertain";
    message: string;
  }): Promise<FulfillmentEvidenceWorkspace> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireActor(input.actorId);
    const message = cleanNotificationMessage(input.message);
    return this.database.transaction(async (client) => {
      const set = await ensurePackedSet(client, fulfillmentId);
      if (set.state !== "confirmed") {
        throw new FulfillmentEvidenceRepositoryError("Confirm packaging evidence before updating email delivery", "invalid_state");
      }
      if (set.notification_state === "sent" && input.state !== "sent") {
        return workspaceFromRows(set, await activeFiles(client, fulfillmentId));
      }
      const result = await client.query<FulfillmentEvidenceSetRow>(
        `UPDATE fulfillment_evidence_sets SET
          notification_state = $2, notification_message = $3,
          version = version + 1, updated_at = now()
         WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId, input.state, message],
      );
      await addEvent(client, {
        fulfillmentId,
        clientEventId,
        eventType: input.eventType,
        actorId,
        details: { transport: "wordpress_wp_mail", message },
      });
      return workspaceFromRows(result.rows[0]!, await activeFiles(client, fulfillmentId));
    });
  }

  async getFile(evidenceIdInput: string): Promise<{ file: FulfillmentEvidenceFile; storageKey: string }> {
    const evidenceId = requireUuid(evidenceIdInput, "Evidence id");
    const result = await this.database.query<FulfillmentEvidenceFileRow>(
      "SELECT * FROM fulfillment_evidence_files WHERE id = $1 AND deleted_at IS NULL",
      [evidenceId],
    );
    const row = result.rows[0];
    if (!row) throw new FulfillmentEvidenceRepositoryError("The evidence photo was not found", "not_found");
    return { file: fileFromRow(row), storageKey: row.storage_key };
  }
}

