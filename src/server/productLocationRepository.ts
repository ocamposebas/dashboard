import type { QueryResultRow } from "pg";

import type { ProductLocation } from "../shared/barcodeFulfillment.js";
import type { Database } from "./database.js";

interface ProductLocationRow extends QueryResultRow {
  product_id: string | number;
  variation_id: string | number;
  location_code: string;
  updated_by: string;
  updated_at: Date | string;
}

export class ProductLocationError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "not_found",
  ) {
    super(message);
    this.name = "ProductLocationError";
  }
}

function positiveIdentifier(value: number, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new ProductLocationError(`${field} is invalid`, "invalid_input");
  }
  return value;
}

export function normalizeLocationCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*-[0-9]{2,3}$/.test(normalized) || normalized.length > 20) {
    throw new ProductLocationError(
      "Use a location such as A-01, A-02 or B-01",
      "invalid_input",
    );
  }
  return normalized;
}

function locationFromRow(row: ProductLocationRow): ProductLocation {
  const productId = Number(row.product_id);
  const variationId = Number(row.variation_id);
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  if (
    !Number.isSafeInteger(productId) || productId <= 0 ||
    !Number.isSafeInteger(variationId) || variationId < 0 ||
    !Number.isFinite(updatedAt.getTime())
  ) {
    throw new ProductLocationError("Stored location data is invalid", "invalid_input");
  }
  return {
    productId,
    variationId,
    locationCode: row.location_code,
    updatedBy: row.updated_by,
    updatedAt: updatedAt.toISOString(),
  };
}

export class ProductLocationRepository {
  constructor(private readonly database: Database) {}

  async list(): Promise<ProductLocation[]> {
    const result = await this.database.query<ProductLocationRow>(
      `SELECT product_id, variation_id, location_code, updated_by, updated_at
       FROM product_locations
       ORDER BY location_code, product_id, variation_id`,
    );
    return result.rows.map(locationFromRow);
  }

  async get(productId: number, variationId = 0): Promise<ProductLocation | null> {
    const normalizedProductId = positiveIdentifier(productId, "Product id");
    const normalizedVariationId = positiveIdentifier(variationId, "Variation id", true);
    const result = await this.database.query<ProductLocationRow>(
      `SELECT product_id, variation_id, location_code, updated_by, updated_at
       FROM product_locations WHERE product_id = $1 AND variation_id = $2`,
      [normalizedProductId, normalizedVariationId],
    );
    return result.rows[0] ? locationFromRow(result.rows[0]) : null;
  }

  async getEffective(productId: number, variationId = 0): Promise<{
    location: ProductLocation | null;
    inherited: boolean;
  }> {
    const exact = await this.get(productId, variationId);
    if (exact || variationId === 0) return { location: exact, inherited: false };
    return { location: await this.get(productId, 0), inherited: true };
  }

  async upsert(input: {
    productId: number;
    variationId?: number;
    locationCode: string;
    updatedBy: string;
  }): Promise<ProductLocation> {
    const productId = positiveIdentifier(input.productId, "Product id");
    const variationId = positiveIdentifier(input.variationId ?? 0, "Variation id", true);
    const locationCode = normalizeLocationCode(input.locationCode);
    const updatedBy = input.updatedBy.trim();
    if (!updatedBy || updatedBy.length > 100) {
      throw new ProductLocationError("Updated by is invalid", "invalid_input");
    }
    const result = await this.database.query<ProductLocationRow>(
      `INSERT INTO product_locations (
         product_id, variation_id, location_code, updated_by, updated_at
       ) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (product_id, variation_id) DO UPDATE SET
         location_code = EXCLUDED.location_code,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING product_id, variation_id, location_code, updated_by, updated_at`,
      [productId, variationId, locationCode, updatedBy],
    );
    const row = result.rows[0];
    if (!row) throw new ProductLocationError("Location could not be saved", "not_found");
    return locationFromRow(row);
  }

  async remove(productId: number, variationId = 0): Promise<boolean> {
    const result = await this.database.query(
      "DELETE FROM product_locations WHERE product_id = $1 AND variation_id = $2",
      [
        positiveIdentifier(productId, "Product id"),
        positiveIdentifier(variationId, "Variation id", true),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
