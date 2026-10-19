import type { QueryResultRow } from "pg";

import type {
  BarcodeEntityType,
  BarcodeRegistryRecord,
  FulfillmentBarcodePayload,
} from "../shared/barcodeFulfillment.js";
import type { Database } from "./database.js";

interface BarcodeRegistryRow extends QueryResultRow {
  barcode_value: string;
  entity_type: BarcodeEntityType;
  product_id: string | number;
  variation_id: string | number;
  coa_id: string;
  lot: string;
  is_active: boolean;
  created_by: string;
  created_at: Date | string;
}

export class BarcodeRegistryError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "not_found" | "conflict",
  ) {
    super(message);
    this.name = "BarcodeRegistryError";
  }
}

function recordFromRow(row: BarcodeRegistryRow): BarcodeRegistryRecord {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    version: 1,
    barcodeValue: row.barcode_value,
    type: row.entity_type,
    productId: Number(row.product_id),
    variationId: Number(row.variation_id),
    ...(row.coa_id ? { coaId: row.coa_id } : {}),
    ...(row.lot ? { lot: row.lot } : {}),
    active: row.is_active,
    createdBy: row.created_by,
    createdAt: createdAt.toISOString(),
  };
}

function normalizeActor(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) {
    throw new BarcodeRegistryError("The barcode author is invalid", "invalid_input");
  }
  return normalized;
}

export function normalizeBarcodeValue(value: string): string {
  const normalized = value.trim();
  if (!/^[0-9]{20}$/.test(normalized)) {
    throw new BarcodeRegistryError("The barcode identifier is invalid", "invalid_input");
  }
  return normalized;
}

function normalizedPayload(payload: FulfillmentBarcodePayload): FulfillmentBarcodePayload {
  if (payload.version !== 1 || !["product", "variation", "batch"].includes(payload.type)) {
    throw new BarcodeRegistryError("The barcode payload is invalid", "invalid_input");
  }
  if (!Number.isSafeInteger(payload.productId) || payload.productId <= 0) {
    throw new BarcodeRegistryError("The barcode product is invalid", "invalid_input");
  }
  if (!Number.isSafeInteger(payload.variationId) || payload.variationId < 0) {
    throw new BarcodeRegistryError("The barcode variation is invalid", "invalid_input");
  }
  const coaId = payload.coaId?.trim() || "";
  const lot = payload.lot?.trim() || "";
  if (coaId.length > 120 || lot.length > 120) {
    throw new BarcodeRegistryError("The barcode batch reference is too long", "invalid_input");
  }
  if (payload.type === "product" && (payload.variationId !== 0 || coaId || lot)) {
    throw new BarcodeRegistryError("Product barcode data is invalid", "invalid_input");
  }
  if (payload.type === "variation" && (payload.variationId === 0 || coaId || lot)) {
    throw new BarcodeRegistryError("Variation barcode data is invalid", "invalid_input");
  }
  if (payload.type === "batch" && (!coaId || !lot)) {
    throw new BarcodeRegistryError("Batch barcodes require an existing COA and lot", "invalid_input");
  }
  return {
    version: 1,
    type: payload.type,
    productId: payload.productId,
    variationId: payload.variationId,
    ...(coaId ? { coaId } : {}),
    ...(lot ? { lot } : {}),
  };
}

export class BarcodeRegistryRepository {
  constructor(private readonly database: Database) {}

  async list(limit = 500): Promise<BarcodeRegistryRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new BarcodeRegistryError("The barcode list limit is invalid", "invalid_input");
    }
    const result = await this.database.query<BarcodeRegistryRow>(
      `SELECT barcode_value, entity_type, product_id, variation_id,
              coa_id, lot, is_active, created_by, created_at
       FROM barcode_labels
       ORDER BY created_at DESC, barcode_value
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(recordFromRow);
  }

  async createOrGet(input: {
    barcodeValue: string;
    payload: FulfillmentBarcodePayload;
    createdBy: string;
  }): Promise<BarcodeRegistryRecord> {
    const barcodeValue = normalizeBarcodeValue(input.barcodeValue);
    const payload = normalizedPayload(input.payload);
    const createdBy = normalizeActor(input.createdBy);
    try {
      const result = await this.database.query<BarcodeRegistryRow>(
        `INSERT INTO barcode_labels (
           barcode_value, entity_type, product_id, variation_id, coa_id, lot, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (entity_type, product_id, variation_id, coa_id, lot)
         DO UPDATE SET barcode_value = barcode_labels.barcode_value
         RETURNING barcode_value, entity_type, product_id, variation_id,
                   coa_id, lot, is_active, created_by, created_at`,
        [
          barcodeValue,
          payload.type,
          payload.productId,
          payload.variationId,
          payload.coaId || "",
          payload.lot || "",
          createdBy,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new BarcodeRegistryError("The barcode could not be registered", "not_found");
      return recordFromRow(row);
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new BarcodeRegistryError(
          "The generated barcode conflicts with an existing label",
          "conflict",
        );
      }
      throw error;
    }
  }

  async resolve(value: string): Promise<BarcodeRegistryRecord | null> {
    const barcodeValue = normalizeBarcodeValue(value);
    const result = await this.database.query<BarcodeRegistryRow>(
      `SELECT barcode_value, entity_type, product_id, variation_id,
              coa_id, lot, is_active, created_by, created_at
       FROM barcode_labels WHERE barcode_value = $1`,
      [barcodeValue],
    );
    return result.rows[0] ? recordFromRow(result.rows[0]) : null;
  }
}
