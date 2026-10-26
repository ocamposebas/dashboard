import { randomUUID } from "node:crypto";

import type { Database } from "./database.js";
import type { CommerceOrder } from "./wooCommerceGateway.js";

export interface InsuranceFundClaim {
  id: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  orderTotal: number;
  protectionFee: number;
  amount: number;
  reason: string;
  status: "active" | "voided";
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

interface ClaimRow {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  currency: string;
  order_total: string;
  protection_fee: string;
  claim_amount: string;
  reason: string;
  status: "active" | "voided";
  recorded_by: string;
  recorded_by_name: string;
  created_at: Date;
  voided_at: Date | null;
  void_reason: string | null;
}

function claimFromRow(row: ClaimRow): InsuranceFundClaim {
  return {
    id: row.id,
    orderId: Number(row.order_id),
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    currency: row.currency,
    orderTotal: Number(row.order_total),
    protectionFee: Number(row.protection_fee),
    amount: Number(row.claim_amount),
    reason: row.reason,
    status: row.status,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name,
    createdAt: row.created_at.toISOString(),
    voidedAt: row.voided_at?.toISOString() || null,
    voidReason: row.void_reason,
  };
}

export class InsuranceFundRepository {
  constructor(private readonly database: Database) {}

  async listClaims(limit = 250): Promise<InsuranceFundClaim[]> {
    const result = await this.database.query<ClaimRow>(`
      SELECT id, order_id, order_number, customer_name, customer_email, currency,
        order_total, protection_fee, claim_amount, reason, status, recorded_by,
        recorded_by_name, created_at, voided_at, void_reason
      FROM insurance_fund_claims
      ORDER BY created_at DESC
      LIMIT $1
    `, [Math.max(1, Math.min(1000, Math.trunc(limit) || 250))]);
    return result.rows.map(claimFromRow);
  }

  async createClaim(input: {
    order: CommerceOrder;
    amount: number;
    reason: string;
    actorId: string;
    actorName: string;
  }): Promise<InsuranceFundClaim> {
    const amount = Math.round(input.amount * 100) / 100;
    const reason = input.reason.trim();
    const result = await this.database.query<ClaimRow>(`
      INSERT INTO insurance_fund_claims (
        id, order_id, order_number, customer_name, customer_email, currency,
        order_total, protection_fee, claim_amount, reason, recorded_by, recorded_by_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, order_id, order_number, customer_name, customer_email, currency,
        order_total, protection_fee, claim_amount, reason, status, recorded_by,
        recorded_by_name, created_at, voided_at, void_reason
    `, [
      randomUUID(), input.order.id, input.order.number, input.order.customer,
      input.order.billing.email, input.order.currency, input.order.total,
      input.order.shippingOperations.protectionFee, amount, reason,
      input.actorId, input.actorName,
    ]);
    return claimFromRow(result.rows[0]!);
  }

  async voidClaim(input: { id: string; reason: string; actorId: string }): Promise<InsuranceFundClaim | null> {
    const result = await this.database.query<ClaimRow>(`
      UPDATE insurance_fund_claims
      SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3
      WHERE id = $1 AND status = 'active'
      RETURNING id, order_id, order_number, customer_name, customer_email, currency,
        order_total, protection_fee, claim_amount, reason, status, recorded_by,
        recorded_by_name, created_at, voided_at, void_reason
    `, [input.id, input.actorId, input.reason.trim()]);
    return result.rows[0] ? claimFromRow(result.rows[0]) : null;
  }
}
