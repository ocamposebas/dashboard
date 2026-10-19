import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type {
  ShippingDataMode,
  ShippingLabel,
  ShippingLabelState,
  ShippingPackageInput,
} from "../shared/shipping.js";
import type { ShipStationLabelResult, ShipStationRate } from "./shipStationGateway.js";
import type { Database, SqlExecutor } from "./database.js";
import type { ShippingDestination } from "./fulfillmentShipping.js";
import { shippingExternalShipmentKey } from "./fulfillmentShipping.js";

interface ShippingLabelRow extends QueryResultRow {
  id: string;
  fulfillment_id: string;
  client_event_id: string;
  order_id: string | number;
  order_number: string;
  state: ShippingLabelState;
  provider: "shipstation";
  provider_mode: ShippingDataMode;
  carrier_id: string;
  carrier_code: string;
  carrier_name: string;
  service_code: string;
  service_name: string;
  rate_id: string;
  rate_amount: string | number;
  currency: string;
  package_snapshot: unknown;
  destination_snapshot: unknown;
  source_shipping_snapshot: unknown;
  external_shipment_key: string;
  shipment_id: string | null;
  label_id: string | null;
  tracking_number: string | null;
  label_download_url: string | null;
  label_format: "4x6";
  failure_code: string | null;
  failure_message: string | null;
  print_count: string | number;
  last_printed_at: Date | string | null;
  wordpress_sync_state: "not_required" | "pending" | "synced" | "failed";
  wordpress_synced_at: Date | string | null;
  wordpress_sync_message: string | null;
  voided_at: Date | string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface FulfillmentShippingRow extends QueryResultRow {
  order_id: string | number;
  order_number: string;
  state: string;
}

export interface SourceShippingSnapshot {
  exported: boolean;
  shippedItemCount: number;
  shipmentIds: string[];
  trackingNumber: string;
}

export class FulfillmentShippingRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "not_found" | "invalid_state" | "idempotency_conflict",
  ) {
    super(message);
    this.name = "FulfillmentShippingRepositoryError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new FulfillmentShippingRepositoryError(`${field} must be a UUID`, "invalid_input");
  }
  return normalized;
}

function requireText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new FulfillmentShippingRepositoryError(`${field} is invalid`, "invalid_input");
  }
  return normalized;
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.trim() || "";
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function packageSnapshot(value: unknown): ShippingPackageInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FulfillmentShippingRepositoryError("Stored package details are invalid", "invalid_input");
  }
  const item = value as Partial<ShippingPackageInput>;
  if (![item.weightOz, item.lengthIn, item.widthIn, item.heightIn]
    .every((part) => typeof part === "number" && Number.isFinite(part) && part > 0)) {
    throw new FulfillmentShippingRepositoryError("Stored package details are invalid", "invalid_input");
  }
  return item as ShippingPackageInput;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new FulfillmentShippingRepositoryError("Stored shipping timestamp is invalid", "invalid_input");
  }
  return parsed.toISOString();
}

function labelFromRow(row: ShippingLabelRow): ShippingLabel {
  const orderId = Number(row.order_id);
  const amount = Number(row.rate_amount);
  const printCount = Number(row.print_count);
  const createdAt = iso(row.created_at);
  const updatedAt = iso(row.updated_at);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) ||
      !Number.isSafeInteger(printCount) || printCount < 0 || !createdAt || !updatedAt) {
    throw new FulfillmentShippingRepositoryError("Stored shipping label is invalid", "invalid_input");
  }
  return {
    id: row.id,
    fulfillmentId: row.fulfillment_id,
    orderId,
    orderNumber: row.order_number,
    state: row.state,
    provider: row.provider,
    providerMode: row.provider_mode,
    carrierId: row.carrier_id,
    carrierCode: row.carrier_code,
    carrierName: row.carrier_name,
    serviceCode: row.service_code,
    serviceName: row.service_name,
    amount,
    currency: row.currency,
    package: packageSnapshot(row.package_snapshot),
    externalShipmentKey: row.external_shipment_key,
    shipmentId: row.shipment_id,
    labelId: row.label_id,
    trackingNumber: row.tracking_number,
    labelDownloadUrl: row.label_download_url,
    labelFormat: row.label_format,
    wordpressSyncState: row.wordpress_sync_state,
    wordpressSyncedAt: iso(row.wordpress_synced_at),
    wordpressSyncMessage: row.wordpress_sync_message,
    voidedAt: iso(row.voided_at),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    printCount,
    lastPrintedAt: iso(row.last_printed_at),
    createdBy: row.created_by,
    createdAt,
    updatedAt,
  };
}

function destinationSnapshot(value: unknown): ShippingDestination {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FulfillmentShippingRepositoryError("Stored shipping destination is invalid", "invalid_input");
  }
  const item = value as Partial<ShippingDestination>;
  const fields: Array<keyof ShippingDestination> = [
    "name", "company", "address1", "address2", "city", "state", "postalCode", "countryCode", "phone",
  ];
  if (fields.some((field) => typeof item[field] !== "string")) {
    throw new FulfillmentShippingRepositoryError("Stored shipping destination is invalid", "invalid_input");
  }
  return item as ShippingDestination;
}

async function rowByFulfillment(
  executor: SqlExecutor,
  fulfillmentId: string,
  lock = false,
): Promise<ShippingLabelRow | null> {
  const result = await executor.query<ShippingLabelRow>(
    `SELECT * FROM fulfillment_shipping_labels WHERE fulfillment_id = $1${lock ? " FOR UPDATE" : ""}`,
    [fulfillmentId],
  );
  return result.rows[0] || null;
}

async function addEvent(
  executor: SqlExecutor,
  shippingLabelId: string,
  eventType: string,
  actorId: string,
  clientEventId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await executor.query(
    `INSERT INTO fulfillment_shipping_events (
      id, shipping_label_id, client_event_id, event_type, actor_id, details
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    ON CONFLICT (client_event_id, event_type) WHERE client_event_id IS NOT NULL DO NOTHING`,
    [randomUUID(), shippingLabelId, clientEventId, eventType, actorId, JSON.stringify(details)],
  );
}

export interface BeginShippingLabelInput {
  fulfillmentId: string;
  clientEventId: string;
  actorId: string;
  providerMode: ShippingDataMode;
  destination: ShippingDestination;
  package: ShippingPackageInput;
  rate: ShipStationRate;
  sourceShipping: SourceShippingSnapshot;
}

export interface CreateMockShippingLabelInput extends Omit<BeginShippingLabelInput, "providerMode" | "sourceShipping"> {
  sourceShipping?: SourceShippingSnapshot;
}

export class FulfillmentShippingRepository {
  constructor(private readonly database: Database) {}

  async getByFulfillmentId(fulfillmentId: string): Promise<ShippingLabel | null> {
    const row = await rowByFulfillment(this.database, requireUuid(fulfillmentId, "Fulfillment id"));
    return row ? labelFromRow(row) : null;
  }

  async getAttemptContext(fulfillmentId: string): Promise<{
    label: ShippingLabel;
    clientEventId: string;
    rateId: string;
  } | null> {
    const row = await rowByFulfillment(this.database, requireUuid(fulfillmentId, "Fulfillment id"));
    return row ? {
      label: labelFromRow(row),
      clientEventId: row.client_event_id,
      rateId: row.rate_id,
    } : null;
  }

  async getPrintRecord(fulfillmentId: string): Promise<{
    label: ShippingLabel;
    destination: ShippingDestination;
  } | null> {
    const result = await this.database.query<ShippingLabelRow>(
      "SELECT * FROM fulfillment_shipping_labels WHERE fulfillment_id = $1",
      [requireUuid(fulfillmentId, "Fulfillment id")],
    );
    const row = result.rows[0];
    return row ? { label: labelFromRow(row), destination: destinationSnapshot(row.destination_snapshot) } : null;
  }

  async beginPurchase(input: BeginShippingLabelInput): Promise<{
    execute: boolean;
    replayed: boolean;
    label: ShippingLabel;
  }> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    return this.database.transaction(async (client) => {
      const fulfillment = await client.query<FulfillmentShippingRow>(
        "SELECT order_id, order_number, state FROM order_fulfillments WHERE id = $1 FOR UPDATE",
        [fulfillmentId],
      );
      const session = fulfillment.rows[0];
      if (!session) throw new FulfillmentShippingRepositoryError("The fulfillment does not exist", "not_found");
      if (session.state !== "packed") {
        throw new FulfillmentShippingRepositoryError("Only packed orders can generate a label", "invalid_state");
      }
      const orderId = Number(session.order_id);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        throw new FulfillmentShippingRepositoryError("The fulfillment order is invalid", "invalid_input");
      }
      const existing = await rowByFulfillment(client, fulfillmentId, true);
      if (existing && existing.client_event_id === clientEventId) {
        await addEvent(client, existing.id, "purchase_replayed", actorId, clientEventId, { state: existing.state });
        return { execute: false, replayed: true, label: labelFromRow(existing) };
      }
      if (existing && existing.state !== "failed") {
        throw new FulfillmentShippingRepositoryError(
          existing.state === "purchase_unknown" || existing.state === "purchase_pending"
            ? "A label request is unresolved. Reconcile it before trying again."
            : "A shipping label already exists for this packed order",
          "idempotency_conflict",
        );
      }
      const externalShipmentKey = shippingExternalShipmentKey(fulfillmentId);
      const values = [
        fulfillmentId, clientEventId, orderId, session.order_number, input.providerMode,
        input.rate.carrierId, input.rate.carrierCode, input.rate.carrierName,
        input.rate.serviceCode, input.rate.serviceName, input.rate.rateId,
        input.rate.amount, input.rate.currency, JSON.stringify(input.package),
        JSON.stringify(input.destination), actorId, externalShipmentKey,
        JSON.stringify(input.sourceShipping),
      ];
      let row: ShippingLabelRow | undefined;
      if (existing) {
        const updated = await client.query<ShippingLabelRow>(
          `UPDATE fulfillment_shipping_labels SET
            client_event_id = $2, order_id = $3, order_number = $4,
            state = 'purchase_pending', provider_mode = $5,
            carrier_id = $6, carrier_code = $7, carrier_name = $8,
            service_code = $9, service_name = $10, rate_id = $11,
            rate_amount = $12, currency = $13, package_snapshot = $14::jsonb,
            destination_snapshot = $15::jsonb, created_by = $16,
            external_shipment_key = $17, source_shipping_snapshot = $18::jsonb,
            shipment_id = NULL, label_id = NULL, tracking_number = NULL,
            label_download_url = NULL, failure_code = NULL, failure_message = NULL,
            purchase_started_at = now(), purchase_completed_at = NULL,
            last_reconciled_at = NULL, updated_at = now()
          WHERE fulfillment_id = $1 RETURNING *`,
          values,
        );
        row = updated.rows[0];
      } else {
        const inserted = await client.query<ShippingLabelRow>(
          `INSERT INTO fulfillment_shipping_labels (
            id, fulfillment_id, client_event_id, order_id, order_number, state,
            provider, provider_mode, carrier_id, carrier_code, carrier_name,
            service_code, service_name, rate_id, rate_amount, currency,
            package_snapshot, destination_snapshot, created_by,
            external_shipment_key, source_shipping_snapshot
          ) VALUES (
            $19, $1, $2, $3, $4, 'purchase_pending', 'shipstation', $5,
            $6, $7, $8, $9, $10, $11, $12, $13,
            $14::jsonb, $15::jsonb, $16, $17, $18::jsonb
          ) RETURNING *`,
          [...values, randomUUID()],
        );
        row = inserted.rows[0];
      }
      if (!row) throw new FulfillmentShippingRepositoryError("The shipping attempt was not stored", "invalid_input");
      await addEvent(client, row.id, "purchase_started", actorId, clientEventId, {
        providerMode: input.providerMode,
        rateId: input.rate.rateId,
        externalShipmentKey,
      });
      return { execute: true, replayed: false, label: labelFromRow(row) };
    });
  }

  async markWordPressSync(input: {
    fulfillmentId: string;
    actorId: string;
    state: "synced" | "failed";
    message: string;
  }): Promise<ShippingLabel> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    const message = requireText(input.message, "WordPress sync message", 500);
    return this.database.transaction(async (client) => {
      const existing = await rowByFulfillment(client, fulfillmentId, true);
      if (!existing) throw new FulfillmentShippingRepositoryError("The shipping label does not exist", "not_found");
      if (existing.state !== "label_ready" && existing.state !== "voided") {
        throw new FulfillmentShippingRepositoryError("Only a completed or voided label can synchronize tracking", "invalid_state");
      }
      const updated = await client.query<ShippingLabelRow>(
        `UPDATE fulfillment_shipping_labels SET
          wordpress_sync_state = $2::varchar,
          wordpress_synced_at = CASE WHEN $2::varchar = 'synced' THEN now() ELSE NULL END,
          wordpress_sync_message = $3, updated_at = now()
        WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId, input.state, message],
      );
      const row = updated.rows[0]!;
      await addEvent(client, row.id, input.state === "synced" ? "wordpress_sync_succeeded" : "wordpress_sync_failed", actorId, null, { message });
      return labelFromRow(row);
    });
  }

  async markVoided(input: {
    fulfillmentId: string;
    actorId: string;
    message: string;
  }): Promise<ShippingLabel> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    const message = requireText(input.message, "Void message", 500);
    return this.database.transaction(async (client) => {
      const existing = await rowByFulfillment(client, fulfillmentId, true);
      if (!existing) throw new FulfillmentShippingRepositoryError("The shipping label does not exist", "not_found");
      if (existing.state === "voided") return labelFromRow(existing);
      if (existing.state !== "label_ready") {
        throw new FulfillmentShippingRepositoryError("Only a completed label can be voided", "invalid_state");
      }
      const updated = await client.query<ShippingLabelRow>(
        `UPDATE fulfillment_shipping_labels SET state = 'voided', voided_at = now(),
          wordpress_sync_state = 'pending', wordpress_synced_at = NULL, wordpress_sync_message = NULL,
          failure_code = 'voided', failure_message = $2, updated_at = now()
        WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId, message],
      );
      const row = updated.rows[0]!;
      await addEvent(client, row.id, "label_voided", actorId, null, { message });
      return labelFromRow(row);
    });
  }

  async markReady(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    result: ShipStationLabelResult;
  }): Promise<ShippingLabel> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    const labelId = requireText(input.result.labelId, "Label id", 160);
    const trackingNumber = requireText(input.result.trackingNumber || "", "Tracking number", 160);
    return this.database.transaction(async (client) => {
      const existing = await rowByFulfillment(client, fulfillmentId, true);
      if (!existing) throw new FulfillmentShippingRepositoryError("The shipping attempt does not exist", "not_found");
      if (existing.client_event_id !== clientEventId) {
        throw new FulfillmentShippingRepositoryError("The label attempt does not match", "idempotency_conflict");
      }
      if (existing.state === "label_ready") return labelFromRow(existing);
      if (existing.state !== "purchase_pending" && existing.state !== "purchase_unknown") {
        throw new FulfillmentShippingRepositoryError("The shipping attempt cannot become ready", "invalid_state");
      }
      const updated = await client.query<ShippingLabelRow>(
        `UPDATE fulfillment_shipping_labels SET
          state = 'label_ready', shipment_id = $2, label_id = $3,
          tracking_number = $4, label_download_url = $5,
          rate_amount = $6, currency = $7, failure_code = NULL,
          failure_message = NULL, purchase_completed_at = now(),
          wordpress_sync_state = CASE WHEN provider_mode = 'live' THEN 'pending' ELSE 'not_required' END,
          wordpress_synced_at = NULL, wordpress_sync_message = NULL,
          last_reconciled_at = CASE WHEN state = 'purchase_unknown' THEN now() ELSE last_reconciled_at END,
          updated_at = now()
        WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId, optionalText(input.result.shipmentId, 160), labelId, trackingNumber,
          optionalText(input.result.labelDownloadUrl, 2_000), input.result.amount,
          requireText(input.result.currency.toUpperCase(), "Currency", 3)],
      );
      const row = updated.rows[0];
      if (!row) throw new FulfillmentShippingRepositoryError("The label result was not stored", "invalid_input");
      await addEvent(client, row.id, "label_ready", actorId, clientEventId, {
        labelId, shipmentId: input.result.shipmentId, trackingNumber,
      });
      return labelFromRow(row);
    });
  }

  async markUnknown(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    message: string;
  }): Promise<ShippingLabel> {
    return this.markProblem({ ...input, state: "purchase_unknown", code: "outcome_unknown" });
  }

  async markFailed(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    code: string;
    message: string;
  }): Promise<ShippingLabel> {
    return this.markProblem({ ...input, state: "failed" });
  }

  private async markProblem(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
    state: "purchase_unknown" | "failed";
    code: string;
    message: string;
  }): Promise<ShippingLabel> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const clientEventId = requireUuid(input.clientEventId, "Client event id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    const code = requireText(input.code, "Failure code", 80);
    const message = requireText(input.message, "Failure message", 500);
    return this.database.transaction(async (client) => {
      const existing = await rowByFulfillment(client, fulfillmentId, true);
      if (!existing) throw new FulfillmentShippingRepositoryError("The shipping attempt does not exist", "not_found");
      if (existing.client_event_id !== clientEventId) {
        throw new FulfillmentShippingRepositoryError("The label attempt does not match", "idempotency_conflict");
      }
      if (existing.state === "label_ready") return labelFromRow(existing);
      const updated = await client.query<ShippingLabelRow>(
        `UPDATE fulfillment_shipping_labels SET
          state = $2::varchar, failure_code = $3, failure_message = $4,
          last_reconciled_at = CASE WHEN $2::varchar = 'purchase_unknown' THEN now() ELSE last_reconciled_at END,
          updated_at = now()
        WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId, input.state, code, message],
      );
      const row = updated.rows[0];
      if (!row) throw new FulfillmentShippingRepositoryError("The shipping failure was not stored", "invalid_input");
      await addEvent(
        client,
        row.id,
        input.state === "failed" ? "purchase_failed" : "purchase_unknown",
        actorId,
        clientEventId,
        { code, message },
      );
      return labelFromRow(row);
    });
  }

  async markReconciliationWaiting(input: {
    fulfillmentId: string;
    actorId: string;
  }): Promise<ShippingLabel> {
    const fulfillmentId = requireUuid(input.fulfillmentId, "Fulfillment id");
    const actorId = requireText(input.actorId, "Actor id", 100);
    return this.database.transaction(async (client) => {
      const existing = await rowByFulfillment(client, fulfillmentId, true);
      if (!existing) throw new FulfillmentShippingRepositoryError("The shipping attempt does not exist", "not_found");
      if (existing.state !== "purchase_pending" && existing.state !== "purchase_unknown") {
        return labelFromRow(existing);
      }
      const updated = await client.query<ShippingLabelRow>(
        `UPDATE fulfillment_shipping_labels SET
          state = 'purchase_unknown', failure_code = 'reconciliation_pending',
          failure_message = 'No matching label was found. Do not retry the purchase yet.',
          last_reconciled_at = now(), updated_at = now()
        WHERE fulfillment_id = $1 RETURNING *`,
        [fulfillmentId],
      );
      const row = updated.rows[0]!;
      await addEvent(client, row.id, "reconciliation_waiting", actorId, null, { rateId: row.rate_id });
      return labelFromRow(row);
    });
  }

  async recordPrint(fulfillmentId: string, actorId: string): Promise<ShippingLabel> {
    const normalizedId = requireUuid(fulfillmentId, "Fulfillment id");
    const normalizedActor = requireText(actorId, "Actor id", 100);
    return this.database.transaction(async (client) => {
      const existing = await rowByFulfillment(client, normalizedId, true);
      if (!existing) throw new FulfillmentShippingRepositoryError("The shipping label does not exist", "not_found");
      if (existing.state !== "label_ready") {
        throw new FulfillmentShippingRepositoryError("Only a completed label can be printed", "invalid_state");
      }
      const updated = await client.query<ShippingLabelRow>(
        `UPDATE fulfillment_shipping_labels SET
          print_count = print_count + 1, last_printed_at = now(), updated_at = now()
        WHERE fulfillment_id = $1 RETURNING *`,
        [normalizedId],
      );
      const row = updated.rows[0]!;
      await addEvent(client, row.id, "label_reprinted", normalizedActor, null, { printCount: row.print_count });
      return labelFromRow(row);
    });
  }

  async createMockLabel(
    input: CreateMockShippingLabelInput,
  ): Promise<{ replayed: boolean; label: ShippingLabel }> {
    const begun = await this.beginPurchase({
      ...input,
      providerMode: "mock",
      sourceShipping: input.sourceShipping || {
        exported: false, shippedItemCount: 0, shipmentIds: [], trackingNumber: "",
      },
    });
    if (!begun.execute) return { replayed: true, label: begun.label };
    const orderToken = begun.label.orderNumber.replace(/[^a-zA-Z0-9]/g, "").slice(-20);
    const result: ShipStationLabelResult = {
      labelId: `mock-${randomUUID()}`,
      shipmentId: `mock-shipment-${randomUUID()}`,
      status: "completed",
      trackingNumber: `TEST-${orderToken}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      carrierId: input.rate.carrierId,
      carrierCode: input.rate.carrierCode,
      serviceCode: input.rate.serviceCode,
      amount: input.rate.amount,
      currency: input.rate.currency,
      labelDownloadUrl: null,
    };
    return {
      replayed: false,
      label: await this.markReady({
        fulfillmentId: input.fulfillmentId,
        clientEventId: input.clientEventId,
        actorId: input.actorId,
        result,
      }),
    };
  }
}
