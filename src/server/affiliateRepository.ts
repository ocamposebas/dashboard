import { createHash, randomUUID } from "node:crypto";

import type {
  AffiliateApplicationSummary,
  AffiliateAdminDirectory,
  AffiliateCommissionSummary,
  AffiliatePayoutStatus,
  AffiliatePayoutSummary,
  AffiliatePortalDashboard,
  AffiliateSummary,
  LegacyAffiliateCoupon,
} from "../shared/affiliates.js";
import { hashPassword } from "./auth.js";
import { calculateAffiliateCommission } from "./affiliateCommission.js";
import type { Database, SqlExecutor } from "./database.js";
import type { CommerceOrder } from "./wooCommerceGateway.js";

interface AffiliateRow {
  id: string;
  wp_user_id: string | null;
  email: string;
  username: string;
  display_name: string;
  status: AffiliateSummary["status"];
  source: string;
  legacy_sales: string;
  legacy_commission: string;
  legacy_available: string;
  legacy_pending_payout: string;
  joined_at: Date | null;
  last_login_at: Date | null;
  paid_payouts: string;
  open_payouts: string;
  shadow_orders: string;
  shadow_sales: string;
  shadow_commission: string;
}

interface CouponRow {
  id: string;
  affiliate_id: string;
  wp_coupon_id: string | null;
  code: string;
  status: string;
  discount_value: string;
  commission_value: string;
  usage_count: number;
  referral_url: string;
}

interface PayoutRow {
  id: string;
  affiliate_id: string;
  display_name: string;
  email: string;
  amount: string;
  currency: string;
  status: AffiliatePayoutStatus;
  payout_method: string;
  payout_destination: string;
  note: string;
  external_reference: string | null;
  requested_at: Date;
  reviewed_at: Date | null;
  paid_at: Date | null;
}

interface SettingsRow {
  default_commission_rate: string;
  minimum_payout: string;
  approval_hold_days: number;
  currency: string;
  shadow_mode_enabled: boolean;
  shadow_started_at: Date | null;
  shadow_last_synced_at: Date | null;
}

interface ShadowAggregateRow {
  tracked_orders: string;
  tracked_sales: string;
  tracked_commission: string;
  reserved_orders: string;
  pending_orders: string;
  approved_orders: string;
  reversed_orders: string;
}

interface PluginDeltaRow {
  plugin_order_delta: string;
  plugin_sales_delta: string;
  plugin_commission_delta: string;
}

interface ShadowCouponRow {
  id: string;
  affiliate_id: string;
  code: string;
  commission_type: "percent" | "fixed";
  commission_value: string;
}

interface CommissionRow {
  id: string;
  affiliate_id: string;
  display_name: string;
  email: string;
  coupon_code: string;
  wc_order_id: string;
  wc_order_number: string;
  currency: string;
  order_total: string;
  eligible_amount: string;
  commission_type: "percent" | "fixed";
  commission_rate: string;
  commission_amount: string;
  status: AffiliateCommissionSummary["status"];
  order_status: string;
  held_until: Date | null;
  approved_at: Date | null;
  reversed_at: Date | null;
  attributed_at: Date;
  updated_at: Date;
}

export interface AffiliateShadowSyncResult {
  scanned: number;
  matched: number;
  upserted: number;
  conflicts: number;
  ignored: number;
}

export interface AffiliateManagementTarget {
  id: string;
  wpUserId: number | null;
  displayName: string;
  email: string;
  status: AffiliateSummary["status"];
  coupons: Array<{
    id: string;
    wpCouponId: number | null;
    code: string;
    status: string;
  }>;
}

interface ApplicationRow {
  id: string;
  wp_user_id: string | null;
  email: string;
  display_name: string;
  preferred_coupon: string;
  platform: string;
  social_handle: string;
  audience_size: string;
  promotion_notes: string;
  source: AffiliateApplicationSummary["source"];
  status: AffiliateApplicationSummary["status"];
  created_at: Date;
  reviewed_at: Date | null;
}

function money(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AffiliateRepository {
  constructor(private readonly database: Database) {}

  async importLegacy(coupons: LegacyAffiliateCoupon[]): Promise<void> {
    const grouped = new Map<number, LegacyAffiliateCoupon[]>();
    for (const coupon of coupons) {
      const existing = grouped.get(coupon.wpUserId) || [];
      existing.push(coupon);
      grouped.set(coupon.wpUserId, existing);
    }

    await this.database.transaction(async (client) => {
      const shadowSettings = await client.query<{ shadow_started_at: Date | null }>(
        "SELECT shadow_started_at FROM affiliate_program_settings WHERE singleton = true",
      );
      const shadowStarted = Boolean(shadowSettings.rows[0]?.shadow_started_at);
      for (const [wpUserId, affiliateCoupons] of grouped) {
        const identity = affiliateCoupons[0]!;
        const totals = affiliateCoupons.reduce((sum, coupon) => ({
          grossSales: sum.grossSales + coupon.grossSales,
          commission: sum.commission + coupon.totalCommission,
          available: sum.available + coupon.availableCommission,
          pending: sum.pending + coupon.pendingPayout,
        }), { grossSales: 0, commission: 0, available: 0, pending: 0 });
        const affiliateId = randomUUID();
        const profile = await client.query<{ id: string }>(`
          INSERT INTO affiliate_profiles (
            id, wp_user_id, email, username, display_name, source,
            legacy_sales, legacy_commission, legacy_available, legacy_pending_payout,
            joined_at, legacy_synced_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, 'coupon_affiliates_migration', $6, $7, $8, $9, now(), now(), now())
          ON CONFLICT (wp_user_id) DO UPDATE SET
            email = EXCLUDED.email,
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            legacy_sales = EXCLUDED.legacy_sales,
            legacy_commission = EXCLUDED.legacy_commission,
            legacy_available = EXCLUDED.legacy_available,
            legacy_pending_payout = EXCLUDED.legacy_pending_payout,
            legacy_synced_at = now(),
            updated_at = now()
          RETURNING id
        `, [
          affiliateId,
          wpUserId,
          identity.email || `affiliate-${wpUserId}@migration.invalid`,
          identity.username,
          identity.displayName || identity.username || `Affiliate ${wpUserId}`,
          money(totals.grossSales),
          money(totals.commission),
          money(totals.available),
          money(totals.pending),
        ]);
        const persistedAffiliateId = profile.rows[0]!.id;
        for (const coupon of affiliateCoupons) {
          await client.query(`
            INSERT INTO affiliate_coupons (
              id, affiliate_id, wp_coupon_id, code, discount_type, discount_value,
              commission_type, commission_value, status, referral_url, usage_count,
              legacy_snapshot, shadow_baseline_usage_count, shadow_baseline_sales,
              shadow_baseline_commission, legacy_synced_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, now(), now())
            ON CONFLICT (wp_coupon_id) DO UPDATE SET
              affiliate_id = EXCLUDED.affiliate_id,
              code = EXCLUDED.code,
              discount_type = EXCLUDED.discount_type,
              discount_value = EXCLUDED.discount_value,
              commission_type = EXCLUDED.commission_type,
              commission_value = EXCLUDED.commission_value,
              status = EXCLUDED.status,
              referral_url = EXCLUDED.referral_url,
              usage_count = EXCLUDED.usage_count,
              legacy_snapshot = EXCLUDED.legacy_snapshot,
              legacy_synced_at = now(),
              updated_at = now()
          `, [
            randomUUID(), persistedAffiliateId, coupon.wpCouponId, coupon.code,
            coupon.discountType, money(coupon.discountValue), coupon.commissionType,
            coupon.commissionValue, coupon.status, coupon.referralUrl, coupon.usageCount,
            JSON.stringify({
              grossSales: coupon.grossSales,
              totalDiscount: coupon.totalDiscount,
              totalCommission: coupon.totalCommission,
              availableCommission: coupon.availableCommission,
              pendingPayout: coupon.pendingPayout,
              importedAt: new Date().toISOString(),
            }),
            shadowStarted ? coupon.usageCount : null,
            shadowStarted ? money(coupon.grossSales) : null,
            shadowStarted ? money(coupon.totalCommission) : null,
          ]);
        }
      }
    });
  }

  async initializeShadowMode(startedAt = new Date()): Promise<{
    enabled: boolean;
    startedAt: Date | null;
    lastSyncedAt: Date | null;
  }> {
    return this.database.transaction(async (client) => {
      const result = await client.query<SettingsRow>(`
        SELECT default_commission_rate, minimum_payout, approval_hold_days, currency,
          shadow_mode_enabled, shadow_started_at, shadow_last_synced_at
        FROM affiliate_program_settings
        WHERE singleton = true
        FOR UPDATE
      `);
      const settings = result.rows[0];
      if (!settings) throw new Error("affiliate_settings_missing");
      if (!settings.shadow_mode_enabled || settings.shadow_started_at) {
        return {
          enabled: settings.shadow_mode_enabled,
          startedAt: settings.shadow_started_at,
          lastSyncedAt: settings.shadow_last_synced_at,
        };
      }

      await client.query(`
        UPDATE affiliate_coupons
        SET shadow_baseline_usage_count = COALESCE(shadow_baseline_usage_count, usage_count),
            shadow_baseline_sales = COALESCE(
              shadow_baseline_sales,
              COALESCE(NULLIF(legacy_snapshot->>'grossSales', '')::numeric, 0)
            ),
            shadow_baseline_commission = COALESCE(
              shadow_baseline_commission,
              COALESCE(NULLIF(legacy_snapshot->>'totalCommission', '')::numeric, 0)
            )
      `);
      await client.query(`
        UPDATE affiliate_program_settings
        SET shadow_started_at = $1, updated_at = now()
        WHERE singleton = true
      `, [startedAt]);
      return { enabled: true, startedAt, lastSyncedAt: null };
    });
  }

  async shadowSyncWindow(now = new Date()): Promise<{
    enabled: boolean;
    after: Date;
    before: Date;
  }> {
    const result = await this.database.query<Pick<SettingsRow, "shadow_mode_enabled" | "shadow_started_at" | "shadow_last_synced_at">>(`
      SELECT shadow_mode_enabled, shadow_started_at, shadow_last_synced_at
      FROM affiliate_program_settings
      WHERE singleton = true
    `);
    const settings = result.rows[0];
    if (!settings?.shadow_started_at) throw new Error("affiliate_shadow_not_initialized");
    const overlapMs = 2 * 24 * 60 * 60 * 1_000;
    const cursor = settings.shadow_last_synced_at || settings.shadow_started_at;
    const after = settings.shadow_last_synced_at
      ? new Date(Math.max(settings.shadow_started_at.getTime(), cursor.getTime() - overlapMs))
      : cursor;
    return { enabled: settings.shadow_mode_enabled, after, before: now };
  }

  async reconcileShadowOrders(
    orders: CommerceOrder[],
    syncedAt = new Date(),
  ): Promise<AffiliateShadowSyncResult> {
    return this.database.transaction(async (client) => {
      const settingsResult = await client.query<SettingsRow>(`
        SELECT default_commission_rate, minimum_payout, approval_hold_days, currency,
          shadow_mode_enabled, shadow_started_at, shadow_last_synced_at
        FROM affiliate_program_settings
        WHERE singleton = true
        FOR UPDATE
      `);
      const settings = settingsResult.rows[0];
      if (!settings?.shadow_mode_enabled || !settings.shadow_started_at) {
        return { scanned: orders.length, matched: 0, upserted: 0, conflicts: 0, ignored: orders.length };
      }
      const couponResult = await client.query<ShadowCouponRow>(`
        SELECT id, affiliate_id, code, commission_type, commission_value
        FROM affiliate_coupons
        WHERE status = 'active'
      `);
      const coupons = new Map(couponResult.rows.map((coupon) => [coupon.code.trim().toLowerCase(), coupon]));
      let matched = 0;
      let upserted = 0;
      let conflicts = 0;
      let ignored = 0;

      for (const order of orders) {
        const attributionDate = new Date(order.paidAt || order.createdAt || "");
        if (
          !Number.isFinite(attributionDate.getTime()) ||
          attributionDate.getTime() < settings.shadow_started_at.getTime()
        ) {
          ignored += 1;
          continue;
        }
        const matchedCoupons = [...new Map(order.couponLines.flatMap((line) => {
          const coupon = coupons.get(line.code.trim().toLowerCase());
          return coupon ? [[coupon.id, coupon] as const] : [];
        })).values()];
        if (!matchedCoupons.length) {
          ignored += 1;
          continue;
        }
        if (matchedCoupons.length > 1) {
          conflicts += 1;
          continue;
        }
        matched += 1;
        const coupon = matchedCoupons[0]!;
        const calculation = calculateAffiliateCommission(order, {
          type: coupon.commission_type,
          value: Number(coupon.commission_value),
        }, settings.approval_hold_days, syncedAt);
        const sourceSnapshot = {
          calculationVersion: 1,
          source: "woocommerce_read_only_shadow",
          modifiedAt: order.modifiedAt,
          paidAt: order.paidAt,
          couponCodes: order.couponLines.map((line) => line.code),
          commissionType: coupon.commission_type,
          commissionValue: Number(coupon.commission_value),
          productNet: money(order.lineItems.reduce((sum, item) => sum + Math.max(0, item.total), 0)),
          shipping: money(order.shippingTotal),
          tax: money(order.totalTax),
          fees: money(order.feeLines.reduce((sum, fee) => sum + fee.total, 0)),
          refunded: money(order.refundedTotal),
          reason: calculation.reason,
        };
        const saved = await client.query<{ id: string }>(`
          INSERT INTO affiliate_commissions (
            id, affiliate_id, coupon_id, wc_order_id, wc_order_number, currency,
            order_total, eligible_amount, commission_rate, commission_amount,
            status, order_status, held_until, approved_at, reversed_at, source_snapshot
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10,
            $11::varchar, $12, $13,
            CASE WHEN $11::varchar = 'approved' THEN $14::timestamptz ELSE NULL END,
            CASE WHEN $11::varchar = 'reversed' THEN $14::timestamptz ELSE NULL END,
            $15::jsonb
          )
          ON CONFLICT (wc_order_id, coupon_id) DO UPDATE SET
            wc_order_number = EXCLUDED.wc_order_number,
            currency = EXCLUDED.currency,
            order_total = EXCLUDED.order_total,
            eligible_amount = EXCLUDED.eligible_amount,
            commission_rate = EXCLUDED.commission_rate,
            commission_amount = EXCLUDED.commission_amount,
            status = EXCLUDED.status,
            order_status = EXCLUDED.order_status,
            held_until = EXCLUDED.held_until,
            approved_at = CASE
              WHEN EXCLUDED.status = 'approved' THEN COALESCE(affiliate_commissions.approved_at, $14::timestamptz)
              ELSE NULL
            END,
            reversed_at = CASE
              WHEN EXCLUDED.status = 'reversed' THEN COALESCE(affiliate_commissions.reversed_at, $14::timestamptz)
              ELSE NULL
            END,
            source_snapshot = EXCLUDED.source_snapshot,
            updated_at = now()
          WHERE affiliate_commissions.status <> 'paid'
          RETURNING id
        `, [
          randomUUID(), coupon.affiliate_id, coupon.id, order.id, order.number, order.currency || settings.currency,
          money(order.total), calculation.eligibleAmount, Number(coupon.commission_value), calculation.commissionAmount,
          calculation.status, order.status, calculation.heldUntil, syncedAt, JSON.stringify(sourceSnapshot),
        ]);
        if (saved.rows[0]) upserted += 1;
      }

      await client.query(`
        UPDATE affiliate_commissions
        SET status = 'approved', approved_at = COALESCE(approved_at, $1), updated_at = now()
        WHERE status = 'pending' AND held_until IS NOT NULL AND held_until <= $1
      `, [syncedAt]);
      await client.query(`
        UPDATE affiliate_program_settings
        SET shadow_last_synced_at = $1, updated_at = now()
        WHERE singleton = true
      `, [syncedAt]);
      return { scanned: orders.length, matched, upserted, conflicts, ignored };
    });
  }

  async adminDirectory(): Promise<AffiliateAdminDirectory> {
    const [settings, profiles, coupons, commissions, payouts, applications, shadowAggregate, pluginDelta] = await Promise.all([
      this.database.query<SettingsRow>(`SELECT default_commission_rate, minimum_payout, approval_hold_days, currency,
        shadow_mode_enabled, shadow_started_at, shadow_last_synced_at
        FROM affiliate_program_settings WHERE singleton = true`),
      this.database.query<AffiliateRow>(`
        SELECT p.*,
          COALESCE((SELECT sum(amount) FROM affiliate_payout_requests pr WHERE pr.affiliate_id = p.id AND pr.status = 'paid'), 0) AS paid_payouts,
          COALESCE((SELECT sum(amount) FROM affiliate_payout_requests pr WHERE pr.affiliate_id = p.id AND pr.status IN ('requested','approved','processing')), 0) AS open_payouts,
          COALESCE((SELECT count(*) FROM affiliate_commissions ac WHERE ac.affiliate_id = p.id AND ac.status IN ('pending','approved','paid')), 0) AS shadow_orders,
          COALESCE((SELECT sum(eligible_amount) FROM affiliate_commissions ac WHERE ac.affiliate_id = p.id AND ac.status IN ('pending','approved','paid')), 0) AS shadow_sales,
          COALESCE((SELECT sum(commission_amount) FROM affiliate_commissions ac WHERE ac.affiliate_id = p.id AND ac.status IN ('pending','approved','paid')), 0) AS shadow_commission
        FROM affiliate_profiles p
        ORDER BY p.legacy_sales DESC, p.display_name ASC
      `),
      this.database.query<CouponRow>("SELECT id, affiliate_id, wp_coupon_id, code, status, discount_value, commission_value, usage_count, referral_url FROM affiliate_coupons ORDER BY usage_count DESC, code ASC"),
      this.commissionRows(this.database),
      this.payoutRows(this.database),
      this.database.query<ApplicationRow>(`
        SELECT id, wp_user_id, email, display_name, preferred_coupon, platform,
          social_handle, audience_size, promotion_notes, source, status, created_at, reviewed_at
        FROM affiliate_applications
        ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 500
      `),
      this.database.query<ShadowAggregateRow>(`
        SELECT
          count(*) FILTER (WHERE status IN ('pending','approved','paid')) AS tracked_orders,
          COALESCE(sum(eligible_amount) FILTER (WHERE status IN ('pending','approved','paid')), 0) AS tracked_sales,
          COALESCE(sum(commission_amount) FILTER (WHERE status IN ('pending','approved','paid')), 0) AS tracked_commission,
          count(*) FILTER (WHERE status = 'reserved') AS reserved_orders,
          count(*) FILTER (WHERE status = 'pending') AS pending_orders,
          count(*) FILTER (WHERE status IN ('approved','paid')) AS approved_orders,
          count(*) FILTER (WHERE status = 'reversed') AS reversed_orders
        FROM affiliate_commissions
      `),
      this.database.query<PluginDeltaRow>(`
        SELECT
          COALESCE(sum(GREATEST(0, usage_count - COALESCE(shadow_baseline_usage_count, usage_count))), 0) AS plugin_order_delta,
          COALESCE(sum(GREATEST(0,
            COALESCE(NULLIF(legacy_snapshot->>'grossSales', '')::numeric, 0) -
            COALESCE(shadow_baseline_sales, COALESCE(NULLIF(legacy_snapshot->>'grossSales', '')::numeric, 0))
          )), 0) AS plugin_sales_delta,
          COALESCE(sum(GREATEST(0,
            COALESCE(NULLIF(legacy_snapshot->>'totalCommission', '')::numeric, 0) -
            COALESCE(shadow_baseline_commission, COALESCE(NULLIF(legacy_snapshot->>'totalCommission', '')::numeric, 0))
          )), 0) AS plugin_commission_delta
        FROM affiliate_coupons
      `),
    ]);
    const couponMap = new Map<string, CouponRow[]>();
    for (const coupon of coupons.rows) {
      const list = couponMap.get(coupon.affiliate_id) || [];
      list.push(coupon);
      couponMap.set(coupon.affiliate_id, list);
    }
    const affiliates = profiles.rows.map((row) => this.mapAffiliate(row, couponMap.get(row.id) || []));
    const payoutSummaries = payouts.map((row) => this.mapPayout(row));
    const setting = settings.rows[0];
    const shadowRow = shadowAggregate.rows[0];
    const pluginRow = pluginDelta.rows[0];
    const trackedCommission = money(shadowRow?.tracked_commission);
    const pluginCommissionDelta = money(pluginRow?.plugin_commission_delta);
    const commissionVariance = money(trackedCommission - pluginCommissionDelta);
    const varianceTolerance = Math.max(0.05, pluginCommissionDelta * 0.01);
    const shadowStatus = !setting?.shadow_started_at
      ? "not_started" as const
      : trackedCommission === 0 && pluginCommissionDelta === 0
        ? "collecting" as const
        : Math.abs(commissionVariance) <= varianceTolerance
          ? "aligned" as const
          : "review" as const;
    const metrics = affiliates.reduce((sum, affiliate) => ({
      affiliates: sum.affiliates + 1,
      activeAffiliates: sum.activeAffiliates + (affiliate.status === "active" ? 1 : 0),
      couponUses: sum.couponUses + affiliate.coupons.reduce((count, coupon) => count + coupon.usageCount, 0),
      grossSales: sum.grossSales + affiliate.grossSales,
      totalCommission: sum.totalCommission + affiliate.totalCommission,
      availableBalance: sum.availableBalance + affiliate.availableBalance,
      pendingPayoutAmount: sum.pendingPayoutAmount + affiliate.pendingPayout,
      pendingPayoutRequests: sum.pendingPayoutRequests,
    }), {
      affiliates: 0, activeAffiliates: 0, couponUses: 0, grossSales: 0,
      totalCommission: 0, availableBalance: 0, pendingPayoutAmount: 0,
      pendingPayoutRequests: payoutSummaries.filter((payout) => ["requested", "approved", "processing"].includes(payout.status)).length,
    });
    return {
      configured: true,
      source: "phaseone",
      syncedAt: new Date().toISOString(),
      metrics: {
        ...metrics,
        grossSales: money(metrics.grossSales),
        totalCommission: money(metrics.totalCommission),
        availableBalance: money(metrics.availableBalance),
        pendingPayoutAmount: money(metrics.pendingPayoutAmount),
      },
      settings: {
        defaultCommissionRate: Number(setting?.default_commission_rate || 10),
        minimumPayout: money(setting?.minimum_payout || 50),
        approvalHoldDays: setting?.approval_hold_days || 14,
        currency: setting?.currency || "USD",
      },
      shadow: {
        mode: "shadow",
        enabled: setting?.shadow_mode_enabled ?? true,
        startedAt: iso(setting?.shadow_started_at || null),
        lastSyncedAt: iso(setting?.shadow_last_synced_at || null),
        trackedOrders: Number(shadowRow?.tracked_orders || 0),
        trackedSales: money(shadowRow?.tracked_sales),
        trackedCommission,
        reservedOrders: Number(shadowRow?.reserved_orders || 0),
        pendingOrders: Number(shadowRow?.pending_orders || 0),
        approvedOrders: Number(shadowRow?.approved_orders || 0),
        reversedOrders: Number(shadowRow?.reversed_orders || 0),
        pluginOrderDelta: Number(pluginRow?.plugin_order_delta || 0),
        pluginSalesDelta: money(pluginRow?.plugin_sales_delta),
        pluginCommissionDelta,
        commissionVariance,
        commissionVariancePercent: pluginCommissionDelta > 0
          ? Math.round((commissionVariance / pluginCommissionDelta) * 10_000) / 100
          : null,
        status: shadowStatus,
      },
      management: {
        couponProvisioningEnabled: false,
      },
      affiliates,
      commissions: commissions.map((row) => this.mapCommission(row)),
      payouts: payoutSummaries,
      applications: applications.rows.map((row) => this.mapApplication(row)),
    };
  }

  async findActiveByEmail(email: string): Promise<{ id: string; email: string; displayName: string; status: string; passwordHash: string | null; authVersion: number } | null> {
    const result = await this.database.query<{
      id: string; email: string; display_name: string; status: string; password_hash: string | null; auth_version: number;
    }>("SELECT id, email, display_name, status, password_hash, auth_version FROM affiliate_profiles WHERE lower(email) = lower($1) LIMIT 1", [email]);
    const row = result.rows[0];
    return row ? {
      id: row.id, email: row.email, displayName: row.display_name, status: row.status,
      passwordHash: row.password_hash, authVersion: row.auth_version,
    } : null;
  }

  async getSessionProfile(id: string): Promise<{ id: string; email: string; displayName: string; status: string; authVersion: number } | null> {
    const result = await this.database.query<{ id: string; email: string; display_name: string; status: string; auth_version: number }>(
      "SELECT id, email, display_name, status, auth_version FROM affiliate_profiles WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, displayName: row.display_name, status: row.status, authVersion: row.auth_version } : null;
  }

  async linkVerifiedStorefrontAccount(input: {
    email: string;
    wpUserId?: number | null;
    displayName?: string;
  }): Promise<{ id: string; email: string; displayName: string; status: string } | null> {
    const email = input.email.trim().toLowerCase();
    const wpUserId = input.wpUserId && Number.isSafeInteger(input.wpUserId) && input.wpUserId > 0
      ? input.wpUserId
      : null;
    if (!email) return null;

    return this.database.transaction(async (client) => {
      const result = await client.query<{
        id: string;
        email: string;
        display_name: string;
        status: string;
        wp_user_id: string | null;
        source: string;
      }>(`
        SELECT id, email, display_name, status, wp_user_id, source
        FROM affiliate_profiles
        WHERE ($1::bigint IS NOT NULL AND wp_user_id = $1)
           OR lower(email) = lower($2)
        ORDER BY CASE WHEN $1::bigint IS NOT NULL AND wp_user_id = $1 THEN 0 ELSE 1 END
        LIMIT 1
        FOR UPDATE
      `, [wpUserId, email]);
      const profile = result.rows[0];
      if (!profile) return null;
      if (profile.status === "suspended" || profile.status === "closed") {
        return {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          status: profile.status,
        };
      }

      const displayName = input.displayName?.trim() || profile.display_name;
      const wasPending = profile.status === "pending_invite";
      if (wasPending && profile.source === "dashboard_invitation") {
        return {
          id: profile.id,
          email: profile.email,
          displayName: profile.display_name,
          status: profile.status,
        };
      }
      const updated = await client.query<{
        id: string;
        email: string;
        display_name: string;
        status: string;
      }>(`
        UPDATE affiliate_profiles
        SET wp_user_id = COALESCE(wp_user_id, $2),
            email = $3,
            display_name = $4,
            status = 'active',
            last_login_at = now(),
            updated_at = now()
        WHERE id = $1
        RETURNING id, email, display_name, status
      `, [profile.id, wpUserId, email, displayName]);
      if (wasPending) {
        await this.audit(client, profile.id, null, "storefront_account_linked", "affiliate", profile.id, {
          wpUserId,
          identityProvider: "phaseonelabz_storefront",
        });
      }
      const row = updated.rows[0]!;
      return { id: row.id, email: row.email, displayName: row.display_name, status: row.status };
    });
  }

  async portalDashboardForStorefrontIdentity(input: {
    email: string;
    wpUserId?: number | null;
    displayName?: string;
  }): Promise<AffiliatePortalDashboard | null> {
    const profile = await this.linkVerifiedStorefrontAccount(input);
    if (!profile || profile.status !== "active") return null;
    return this.portalDashboard(profile.id);
  }

  async portalDashboard(affiliateId: string): Promise<AffiliatePortalDashboard | null> {
    const directory = await this.adminDirectory();
    const affiliate = directory.affiliates.find((item) => item.id === affiliateId);
    if (!affiliate) return null;
    const commissions = await this.database.query<{ id: string; wc_order_number: string; commission_amount: string; currency: string; status: string; created_at: Date }>(`
      SELECT id, wc_order_number, commission_amount, currency, status, created_at
      FROM affiliate_commissions WHERE affiliate_id = $1 ORDER BY created_at DESC LIMIT 20
    `, [affiliateId]);
    return {
      affiliate,
      settings: directory.settings,
      payouts: directory.payouts.filter((item) => item.affiliateId === affiliateId),
      recentCommissions: commissions.rows.map((row) => ({
        id: row.id, orderNumber: row.wc_order_number, amount: money(row.commission_amount),
        currency: row.currency, status: row.status, createdAt: row.created_at.toISOString(),
      })),
    };
  }

  async commissionForOrder(orderId: number): Promise<AffiliateCommissionSummary | null> {
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
    const rows = await this.commissionRows(this.database, { orderId, limit: 1 });
    return rows[0] ? this.mapCommission(rows[0]) : null;
  }

  async commissionsForOrders(orderIds: number[]): Promise<AffiliateCommissionSummary[]> {
    const normalizedOrderIds = [...new Set(orderIds)]
      .filter((orderId) => Number.isSafeInteger(orderId) && orderId > 0)
      .slice(0, 1_000);
    if (!normalizedOrderIds.length) return [];
    const rows = await this.commissionRows(this.database, {
      orderIds: normalizedOrderIds,
      limit: normalizedOrderIds.length,
    });
    return rows.map((row) => this.mapCommission(row));
  }

  async affiliateManagementTarget(affiliateId: string): Promise<AffiliateManagementTarget | null> {
    const profile = await this.database.query<{
      id: string;
      wp_user_id: string | null;
      display_name: string;
      email: string;
      status: AffiliateSummary["status"];
    }>(`
      SELECT id, wp_user_id, display_name, email, status
      FROM affiliate_profiles
      WHERE id = $1
    `, [affiliateId]);
    const row = profile.rows[0];
    if (!row) return null;
    const coupons = await this.database.query<{
      id: string;
      wp_coupon_id: string | null;
      code: string;
      status: string;
    }>(`
      SELECT id, wp_coupon_id, code, status
      FROM affiliate_coupons
      WHERE affiliate_id = $1
      ORDER BY created_at ASC
    `, [affiliateId]);
    return {
      id: row.id,
      wpUserId: row.wp_user_id ? Number(row.wp_user_id) : null,
      displayName: row.display_name,
      email: row.email,
      status: row.status,
      coupons: coupons.rows.map((coupon) => ({
        id: coupon.id,
        wpCouponId: coupon.wp_coupon_id ? Number(coupon.wp_coupon_id) : null,
        code: coupon.code,
        status: coupon.status,
      })),
    };
  }

  async linkStorefrontAccountByAdmin(input: {
    affiliateId: string;
    wpUserId: number;
    verifiedEmail: string;
    displayName: string;
    actorId: string;
  }): Promise<void> {
    await this.database.transaction(async (client) => {
      const profile = await client.query<{
        id: string;
        email: string;
        wp_user_id: string | null;
        status: AffiliateSummary["status"];
      }>(`
        SELECT id, email, wp_user_id, status
        FROM affiliate_profiles
        WHERE id = $1
        FOR UPDATE
      `, [input.affiliateId]);
      const affiliate = profile.rows[0];
      if (!affiliate) throw new Error("affiliate_not_found");
      if (affiliate.email.trim().toLowerCase() !== input.verifiedEmail.trim().toLowerCase()) {
        throw new Error("affiliate_identity_mismatch");
      }
      if (affiliate.wp_user_id && Number(affiliate.wp_user_id) !== input.wpUserId) {
        throw new Error("affiliate_identity_conflict");
      }
      const duplicate = await client.query<{ id: string }>(`
        SELECT id FROM affiliate_profiles
        WHERE wp_user_id = $1 AND id <> $2
        LIMIT 1
      `, [input.wpUserId, input.affiliateId]);
      if (duplicate.rows[0]) throw new Error("affiliate_identity_conflict");
      await client.query(`
        UPDATE affiliate_profiles
        SET wp_user_id = $2,
            display_name = COALESCE(NULLIF(display_name, ''), NULLIF($3, ''), display_name),
            status = 'active',
            joined_at = COALESCE(joined_at, now()),
            updated_at = now()
        WHERE id = $1
      `, [input.affiliateId, input.wpUserId, input.displayName.trim()]);
      await client.query(`
        UPDATE affiliate_invitations
        SET used_at = now()
        WHERE affiliate_id = $1 AND used_at IS NULL
      `, [input.affiliateId]);
      await this.audit(client, input.affiliateId, null, "storefront_account_linked_by_admin", "admin", input.actorId, {
        wpUserId: input.wpUserId,
        verifiedEmail: input.verifiedEmail.trim().toLowerCase(),
      });
    });
  }

  async saveManagedCoupon(input: {
    affiliateId: string;
    couponId: string | null;
    wpCouponId: number;
    code: string;
    discountValue: number;
    commissionValue: number;
    referralUrl: string;
    actorId: string;
  }): Promise<string> {
    return this.database.transaction(async (client) => {
      const profile = await client.query<{
        id: string;
        wp_user_id: string | null;
        status: AffiliateSummary["status"];
      }>(`
        SELECT id, wp_user_id, status
        FROM affiliate_profiles
        WHERE id = $1
        FOR UPDATE
      `, [input.affiliateId]);
      const affiliate = profile.rows[0];
      if (!affiliate) throw new Error("affiliate_not_found");
      if (!affiliate.wp_user_id) throw new Error("affiliate_storefront_account_required");
      if (affiliate.status !== "active") throw new Error("affiliate_inactive");

      const codeOwner = await client.query<{ id: string; affiliate_id: string }>(`
        SELECT id, affiliate_id
        FROM affiliate_coupons
        WHERE lower(code) = lower($1)
        LIMIT 1
        FOR UPDATE
      `, [input.code]);
      if (codeOwner.rows[0] && codeOwner.rows[0].affiliate_id !== input.affiliateId) {
        throw new Error("affiliate_coupon_code_conflict");
      }
      let couponId = input.couponId || codeOwner.rows[0]?.id || null;
      if (couponId) {
        const updated = await client.query<{ id: string }>(`
          UPDATE affiliate_coupons
          SET wp_coupon_id = $3,
              code = $4,
              discount_type = 'percent',
              discount_value = $5,
              commission_type = 'percent',
              commission_value = $6,
              status = 'active',
              referral_url = $7,
              updated_at = now()
          WHERE id = $1 AND affiliate_id = $2
          RETURNING id
        `, [couponId, input.affiliateId, input.wpCouponId, input.code, input.discountValue, input.commissionValue, input.referralUrl]);
        if (!updated.rows[0]) throw new Error("affiliate_coupon_not_found");
      } else {
        couponId = randomUUID();
        await client.query(`
          INSERT INTO affiliate_coupons (
            id, affiliate_id, wp_coupon_id, code, discount_type, discount_value,
            commission_type, commission_value, status, referral_url, usage_count,
            shadow_baseline_usage_count, shadow_baseline_sales, shadow_baseline_commission,
            legacy_snapshot, legacy_synced_at
          ) VALUES (
            $1, $2, $3, $4, 'percent', $5,
            'percent', $6, 'active', $7, 0,
            0, 0, 0, '{}'::jsonb, now()
          )
        `, [couponId, input.affiliateId, input.wpCouponId, input.code, input.discountValue, input.commissionValue, input.referralUrl]);
      }
      await this.audit(client, input.affiliateId, null, input.couponId ? "coupon_updated" : "coupon_assigned", "admin", input.actorId, {
        couponId,
        wpCouponId: input.wpCouponId,
        code: input.code,
        discountValue: input.discountValue,
        commissionValue: input.commissionValue,
      });
      return couponId;
    });
  }

  async setAffiliateStatus(input: {
    affiliateId: string;
    status: Extract<AffiliateSummary["status"], "active" | "suspended">;
    actorId: string;
  }): Promise<void> {
    await this.database.transaction(async (client) => {
      const profile = await client.query<{
        id: string;
        status: AffiliateSummary["status"];
        wp_user_id: string | null;
      }>(`
        SELECT id, status, wp_user_id
        FROM affiliate_profiles
        WHERE id = $1
        FOR UPDATE
      `, [input.affiliateId]);
      const affiliate = profile.rows[0];
      if (!affiliate) throw new Error("affiliate_not_found");
      if (affiliate.status === "closed") throw new Error("affiliate_closed");
      if (input.status === "active" && !affiliate.wp_user_id) {
        throw new Error("affiliate_storefront_account_required");
      }
      if (affiliate.status === input.status) return;
      await client.query(`
        UPDATE affiliate_profiles
        SET status = $2, auth_version = auth_version + 1, updated_at = now()
        WHERE id = $1
      `, [input.affiliateId, input.status]);
      await client.query(`
        UPDATE affiliate_coupons
        SET status = $2, updated_at = now()
        WHERE affiliate_id = $1 AND status <> 'archived'
      `, [input.affiliateId, input.status === "active" ? "active" : "paused"]);
      await this.audit(client, input.affiliateId, null, input.status === "active" ? "affiliate_reactivated" : "affiliate_suspended", "admin", input.actorId, {
        previousStatus: affiliate.status,
      });
    });
  }

  async createInvitation(affiliateId: string, token: string, actorId: string): Promise<Date> {
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000);
    await this.database.transaction(async (client) => {
      const profile = await client.query<{ id: string }>("SELECT id FROM affiliate_profiles WHERE id = $1 FOR UPDATE", [affiliateId]);
      if (!profile.rows[0]) throw new Error("affiliate_not_found");
      await client.query("UPDATE affiliate_invitations SET used_at = now() WHERE affiliate_id = $1 AND used_at IS NULL", [affiliateId]);
      await client.query(`
        INSERT INTO affiliate_invitations (id, affiliate_id, token_digest, expires_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
      `, [randomUUID(), affiliateId, tokenDigest(token), expiresAt, actorId]);
      await this.audit(client, affiliateId, null, "invitation_created", "admin", actorId, { expiresAt: expiresAt.toISOString() });
    });
    return expiresAt;
  }

  async createDirectInvitation(input: {
    email: string;
    displayName: string;
    token: string;
    actorId: string;
  }): Promise<{ affiliateId: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000);
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM affiliate_profiles WHERE lower(email) = lower($1) FOR UPDATE",
        [email],
      );
      let affiliateId = existing.rows[0]?.id;
      if (existing.rows[0] && ["suspended", "closed"].includes(existing.rows[0].status)) {
        throw new Error("affiliate_ineligible");
      }
      if (!affiliateId) {
        affiliateId = randomUUID();
        await client.query(`
          INSERT INTO affiliate_profiles (id, email, display_name, status, source)
          VALUES ($1, $2, $3, 'pending_invite', 'dashboard_invitation')
        `, [affiliateId, email, displayName]);
      } else {
        await client.query(`
          UPDATE affiliate_profiles
          SET display_name = CASE WHEN display_name = '' THEN $2 ELSE display_name END,
              updated_at = now()
          WHERE id = $1
        `, [affiliateId, displayName]);
      }
      await client.query(
        "UPDATE affiliate_invitations SET used_at = now() WHERE affiliate_id = $1 AND used_at IS NULL",
        [affiliateId],
      );
      await client.query(`
        INSERT INTO affiliate_invitations (id, affiliate_id, token_digest, expires_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
      `, [randomUUID(), affiliateId, tokenDigest(input.token), expiresAt, input.actorId]);
      await this.audit(client, affiliateId, null, "invitation_created", "admin", input.actorId, {
        expiresAt: expiresAt.toISOString(),
        direct: true,
      });
      return { affiliateId, expiresAt };
    });
  }

  async acceptStorefrontInvitation(input: {
    token: string;
    email: string;
    wpUserId: number;
    displayName: string;
  }): Promise<{ id: string; email: string; displayName: string; status: string }> {
    return this.database.transaction(async (client) => {
      const invitation = await client.query<{
        id: string;
        affiliate_id: string;
        expires_at: Date;
        used_at: Date | null;
        email: string;
      }>(`
        SELECT i.id, i.affiliate_id, i.expires_at, i.used_at, p.email
        FROM affiliate_invitations i
        JOIN affiliate_profiles p ON p.id = i.affiliate_id
        WHERE i.token_digest = $1
        FOR UPDATE OF i, p
      `, [tokenDigest(input.token)]);
      const invite = invitation.rows[0];
      if (!invite || invite.used_at || invite.expires_at.getTime() <= Date.now()) {
        throw new Error("invitation_invalid");
      }
      if (invite.email.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
        throw new Error("invitation_identity_mismatch");
      }
      const duplicateIdentity = await client.query<{ id: string }>(`
        SELECT id FROM affiliate_profiles
        WHERE wp_user_id = $1 AND id <> $2
        LIMIT 1
      `, [input.wpUserId, invite.affiliate_id]);
      if (duplicateIdentity.rows[0]) throw new Error("affiliate_identity_conflict");
      const updated = await client.query<{
        id: string;
        email: string;
        display_name: string;
        status: string;
      }>(`
        UPDATE affiliate_profiles
        SET wp_user_id = $2, display_name = COALESCE(NULLIF($3, ''), display_name),
            status = 'active', joined_at = COALESCE(joined_at, now()), last_login_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING id, email, display_name, status
      `, [invite.affiliate_id, input.wpUserId, input.displayName.trim()]);
      await client.query("UPDATE affiliate_invitations SET used_at = now() WHERE id = $1", [invite.id]);
      await this.audit(client, invite.affiliate_id, null, "storefront_invitation_accepted", "affiliate", invite.affiliate_id, {
        wpUserId: input.wpUserId,
        identityProvider: "phaseonelabz_storefront",
      });
      const row = updated.rows[0]!;
      return { id: row.id, email: row.email, displayName: row.display_name, status: row.status };
    });
  }

  async submitApplication(input: {
    clientEventId: string;
    wpUserId?: number | null;
    email: string;
    displayName: string;
    preferredCoupon: string;
    platform: string;
    socialHandle: string;
    audienceSize: string;
    promotionNotes: string;
    source: AffiliateApplicationSummary["source"];
    confirmations: Record<string, boolean>;
  }): Promise<AffiliateApplicationSummary> {
    const email = input.email.trim().toLowerCase();
    return this.database.transaction(async (client) => {
      const active = await client.query<{ id: string }>(`
        SELECT id FROM affiliate_profiles
        WHERE lower(email) = lower($1) OR ($2::bigint IS NOT NULL AND wp_user_id = $2)
        LIMIT 1
      `, [email, input.wpUserId || null]);
      if (active.rows[0]) throw new Error("affiliate_already_exists");
      const existing = await client.query<ApplicationRow>(`
        SELECT id, wp_user_id, email, display_name, preferred_coupon, platform,
          social_handle, audience_size, promotion_notes, source, status, created_at, reviewed_at
        FROM affiliate_applications
        WHERE client_event_id = $1 OR (status = 'pending' AND lower(email) = lower($2))
        ORDER BY CASE WHEN client_event_id = $1 THEN 0 ELSE 1 END
        LIMIT 1
        FOR UPDATE
      `, [input.clientEventId, email]);
      if (existing.rows[0]) return this.mapApplication(existing.rows[0]);
      const created = await client.query<ApplicationRow>(`
        INSERT INTO affiliate_applications (
          id, client_event_id, wp_user_id, email, display_name, preferred_coupon,
          platform, social_handle, audience_size, promotion_notes, source, confirmations
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        RETURNING id, wp_user_id, email, display_name, preferred_coupon, platform,
          social_handle, audience_size, promotion_notes, source, status, created_at, reviewed_at
      `, [
        randomUUID(), input.clientEventId, input.wpUserId || null, email, input.displayName.trim(),
        input.preferredCoupon.trim().toUpperCase(), input.platform.trim(), input.socialHandle.trim(),
        input.audienceSize.trim(), input.promotionNotes.trim(), input.source, JSON.stringify(input.confirmations),
      ]);
      return this.mapApplication(created.rows[0]!);
    });
  }

  async applicationStatusForStorefrontIdentity(input: {
    email: string;
    wpUserId: number;
  }): Promise<AffiliateApplicationSummary | { id: string; status: "active"; preferredCoupon: string } | null> {
    const profile = await this.database.query<{ id: string; status: string; code: string | null }>(`
      SELECT p.id, p.status, (
        SELECT code FROM affiliate_coupons c WHERE c.affiliate_id = p.id ORDER BY c.created_at LIMIT 1
      ) AS code
      FROM affiliate_profiles p
      WHERE lower(p.email) = lower($1) OR p.wp_user_id = $2
      ORDER BY CASE WHEN p.wp_user_id = $2 THEN 0 ELSE 1 END
      LIMIT 1
    `, [input.email.trim().toLowerCase(), input.wpUserId]);
    if (profile.rows[0]?.status === "active") {
      return { id: profile.rows[0].id, status: "active", preferredCoupon: profile.rows[0].code || "" };
    }
    const application = await this.database.query<ApplicationRow>(`
      SELECT id, wp_user_id, email, display_name, preferred_coupon, platform,
        social_handle, audience_size, promotion_notes, source, status, created_at, reviewed_at
      FROM affiliate_applications
      WHERE lower(email) = lower($1) OR wp_user_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [input.email.trim().toLowerCase(), input.wpUserId]);
    return application.rows[0] ? this.mapApplication(application.rows[0]) : null;
  }

  async activate(token: string, password: string): Promise<{ id: string; email: string; displayName: string; authVersion: number }> {
    const passwordHash = await hashPassword(password);
    return this.database.transaction(async (client) => {
      const invitation = await client.query<{ id: string; affiliate_id: string; expires_at: Date; used_at: Date | null }>(`
        SELECT id, affiliate_id, expires_at, used_at FROM affiliate_invitations
        WHERE token_digest = $1 FOR UPDATE
      `, [tokenDigest(token)]);
      const invite = invitation.rows[0];
      if (!invite || invite.used_at || invite.expires_at.getTime() <= Date.now()) throw new Error("invitation_invalid");
      const updated = await client.query<{ id: string; email: string; display_name: string; auth_version: number }>(`
        UPDATE affiliate_profiles SET password_hash = $2, status = 'active', auth_version = auth_version + 1,
          updated_at = now() WHERE id = $1 RETURNING id, email, display_name, auth_version
      `, [invite.affiliate_id, passwordHash]);
      await client.query("UPDATE affiliate_invitations SET used_at = now() WHERE id = $1", [invite.id]);
      const profile = updated.rows[0]!;
      await this.audit(client, profile.id, null, "account_activated", "affiliate", profile.id, {});
      return { id: profile.id, email: profile.email, displayName: profile.display_name, authVersion: profile.auth_version };
    });
  }

  async recordLogin(affiliateId: string): Promise<void> {
    await this.database.query("UPDATE affiliate_profiles SET last_login_at = now(), updated_at = now() WHERE id = $1", [affiliateId]);
  }

  async requestPayout(input: { affiliateId: string; clientEventId: string; amount: number; payoutMethod: string; payoutDestination: string; note: string }): Promise<AffiliatePayoutSummary> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<PayoutRow>(`
        SELECT pr.*, p.display_name, p.email FROM affiliate_payout_requests pr
        JOIN affiliate_profiles p ON p.id = pr.affiliate_id WHERE pr.client_event_id = $1
      `, [input.clientEventId]);
      if (existing.rows[0]) {
        const payout = existing.rows[0];
        if (
          payout.affiliate_id !== input.affiliateId ||
          money(payout.amount) !== money(input.amount) ||
          payout.payout_method !== input.payoutMethod ||
          payout.payout_destination !== input.payoutDestination
        ) throw new Error("payout_idempotency_conflict");
        return this.mapPayout(payout);
      }
      const settings = await client.query<SettingsRow>("SELECT default_commission_rate, minimum_payout, approval_hold_days, currency FROM affiliate_program_settings WHERE singleton = true");
      const profile = await client.query<AffiliateRow>(`
        SELECT p.*, 0::numeric AS paid_payouts,
          COALESCE((SELECT sum(amount) FROM affiliate_payout_requests pr WHERE pr.affiliate_id = p.id AND pr.status IN ('requested','approved','processing')), 0) AS open_payouts
        FROM affiliate_profiles p WHERE p.id = $1 FOR UPDATE
      `, [input.affiliateId]);
      const affiliate = profile.rows[0];
      if (!affiliate || affiliate.status !== "active") throw new Error("affiliate_ineligible");
      const minimum = money(settings.rows[0]?.minimum_payout || 50);
      const available = Math.max(0, money(affiliate.legacy_available) - money(affiliate.open_payouts));
      const amount = money(input.amount);
      if (amount < minimum) throw new Error("payout_below_minimum");
      if (amount > available) throw new Error("payout_exceeds_balance");
      const id = randomUUID();
      await client.query(`
        INSERT INTO affiliate_payout_requests (
          id, affiliate_id, client_event_id, amount, currency, payout_method, payout_destination, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [id, input.affiliateId, input.clientEventId, amount, settings.rows[0]?.currency || "USD", input.payoutMethod, input.payoutDestination, input.note]);
      await this.audit(client, input.affiliateId, id, "payout_requested", "affiliate", input.affiliateId, { amount });
      const created = await client.query<PayoutRow>(`
        SELECT pr.*, p.display_name, p.email FROM affiliate_payout_requests pr
        JOIN affiliate_profiles p ON p.id = pr.affiliate_id WHERE pr.id = $1
      `, [id]);
      return this.mapPayout(created.rows[0]!);
    });
  }

  async updatePayoutStatus(input: { payoutId: string; status: AffiliatePayoutStatus; actorId: string; reference?: string }): Promise<AffiliatePayoutSummary> {
    const transitions: Record<AffiliatePayoutStatus, AffiliatePayoutStatus[]> = {
      requested: ["approved", "rejected", "cancelled"], approved: ["processing", "paid", "rejected"],
      processing: ["paid", "rejected"], paid: [], rejected: [], cancelled: [],
    };
    return this.database.transaction(async (client) => {
      const current = await client.query<PayoutRow>(`
        SELECT pr.*, p.display_name, p.email FROM affiliate_payout_requests pr
        JOIN affiliate_profiles p ON p.id = pr.affiliate_id WHERE pr.id = $1 FOR UPDATE OF pr
      `, [input.payoutId]);
      const payout = current.rows[0];
      if (!payout) throw new Error("payout_not_found");
      if (!transitions[payout.status].includes(input.status)) throw new Error("payout_invalid_transition");
      const updated = await client.query<PayoutRow>(`
        UPDATE affiliate_payout_requests SET status = $2, external_reference = COALESCE(NULLIF($3, ''), external_reference),
          reviewed_at = CASE WHEN $2 IN ('approved','rejected','processing','paid') THEN now() ELSE reviewed_at END,
          paid_at = CASE WHEN $2 = 'paid' THEN now() ELSE paid_at END,
          reviewed_by = $4, updated_at = now() WHERE id = $1
        RETURNING *, $5::varchar AS display_name, $6::varchar AS email
      `, [payout.id, input.status, input.reference || "", input.actorId, payout.display_name, payout.email]);
      await this.audit(client, payout.affiliate_id, payout.id, `payout_${input.status}`, "admin", input.actorId, { from: payout.status, reference: input.reference || null });
      return this.mapPayout(updated.rows[0]!);
    });
  }

  private async payoutRows(executor: SqlExecutor): Promise<PayoutRow[]> {
    const result = await executor.query<PayoutRow>(`
      SELECT pr.*, p.display_name, p.email FROM affiliate_payout_requests pr
      JOIN affiliate_profiles p ON p.id = pr.affiliate_id ORDER BY pr.requested_at DESC LIMIT 500
    `);
    return result.rows;
  }

  private async commissionRows(
    executor: SqlExecutor,
    options: { orderId?: number; orderIds?: number[]; limit?: number } = {},
  ): Promise<CommissionRow[]> {
    const limit = Math.min(1_000, Math.max(1, Math.floor(options.limit || 500)));
    const orderId = Number.isSafeInteger(options.orderId) && Number(options.orderId) > 0
      ? Number(options.orderId)
      : null;
    const orderIds = options.orderIds?.length ? options.orderIds : null;
    const result = await executor.query<CommissionRow>(`
      SELECT ac.id, ac.affiliate_id, p.display_name, p.email, c.code AS coupon_code,
        ac.wc_order_id, ac.wc_order_number, ac.currency, ac.order_total,
        ac.eligible_amount,
        CASE WHEN ac.source_snapshot->>'commissionType' = 'fixed' THEN 'fixed' ELSE 'percent' END AS commission_type,
        ac.commission_rate, ac.commission_amount, ac.status,
        ac.order_status, ac.held_until, ac.approved_at, ac.reversed_at,
        COALESCE(NULLIF(ac.source_snapshot->>'paidAt', '')::timestamptz, ac.created_at) AS attributed_at,
        ac.updated_at
      FROM affiliate_commissions ac
      JOIN affiliate_profiles p ON p.id = ac.affiliate_id
      JOIN affiliate_coupons c ON c.id = ac.coupon_id
      WHERE ($1::bigint IS NULL OR ac.wc_order_id = $1)
        AND ($2::bigint[] IS NULL OR ac.wc_order_id = ANY($2::bigint[]))
      ORDER BY attributed_at DESC, ac.created_at DESC
      LIMIT $3
    `, [orderId, orderIds, limit]);
    return result.rows;
  }

  private mapAffiliate(row: AffiliateRow, coupons: CouponRow[]): AffiliateSummary {
    const paid = money(row.paid_payouts);
    const ownOpen = money(row.open_payouts);
    return {
      id: row.id,
      wpUserId: row.wp_user_id ? Number(row.wp_user_id) : null,
      displayName: row.display_name,
      username: row.username,
      email: row.email,
      status: row.status,
      source: row.source,
      grossSales: money(row.legacy_sales),
      totalCommission: money(row.legacy_commission),
      availableBalance: Math.max(0, money(row.legacy_available) - ownOpen),
      pendingPayout: money(row.legacy_pending_payout) + ownOpen,
      paidPayouts: paid,
      shadowOrders: Number(row.shadow_orders || 0),
      shadowSales: money(row.shadow_sales),
      shadowCommission: money(row.shadow_commission),
      coupons: coupons.map((coupon) => ({
        id: coupon.id, wpCouponId: coupon.wp_coupon_id ? Number(coupon.wp_coupon_id) : null,
        code: coupon.code, status: coupon.status,
        discountValue: money(coupon.discount_value), commissionValue: Number(coupon.commission_value),
        usageCount: coupon.usage_count, referralUrl: coupon.referral_url,
      })),
      joinedAt: iso(row.joined_at),
      lastLoginAt: iso(row.last_login_at),
    };
  }

  private mapPayout(row: PayoutRow): AffiliatePayoutSummary {
    return {
      id: row.id, affiliateId: row.affiliate_id, affiliateName: row.display_name,
      affiliateEmail: row.email, amount: money(row.amount), currency: row.currency,
      status: row.status, payoutMethod: row.payout_method, payoutDestination: row.payout_destination,
      note: row.note, externalReference: row.external_reference, requestedAt: row.requested_at.toISOString(),
      reviewedAt: iso(row.reviewed_at), paidAt: iso(row.paid_at),
    };
  }

  private mapCommission(row: CommissionRow): AffiliateCommissionSummary {
    return {
      id: row.id,
      affiliateId: row.affiliate_id,
      affiliateName: row.display_name,
      affiliateEmail: row.email,
      couponCode: row.coupon_code,
      orderId: Number(row.wc_order_id),
      orderNumber: row.wc_order_number,
      currency: row.currency,
      orderTotal: money(row.order_total),
      eligibleAmount: money(row.eligible_amount),
      commissionType: row.commission_type,
      commissionRate: Number(row.commission_rate || 0),
      commissionAmount: money(row.commission_amount),
      status: row.status,
      orderStatus: row.order_status,
      heldUntil: iso(row.held_until),
      approvedAt: iso(row.approved_at),
      reversedAt: iso(row.reversed_at),
      attributedAt: row.attributed_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapApplication(row: ApplicationRow): AffiliateApplicationSummary {
    return {
      id: row.id,
      wpUserId: row.wp_user_id ? Number(row.wp_user_id) : null,
      displayName: row.display_name,
      email: row.email,
      preferredCoupon: row.preferred_coupon,
      platform: row.platform,
      socialHandle: row.social_handle,
      audienceSize: row.audience_size,
      promotionNotes: row.promotion_notes,
      source: row.source,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      reviewedAt: iso(row.reviewed_at),
    };
  }

  private async audit(executor: SqlExecutor, affiliateId: string | null, payoutId: string | null, eventType: string, actorType: "system" | "admin" | "affiliate", actorId: string, details: Record<string, unknown>): Promise<void> {
    await executor.query(`
      INSERT INTO affiliate_audit_events (id, affiliate_id, payout_id, event_type, actor_type, actor_id, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `, [randomUUID(), affiliateId, payoutId, eventType, actorType, actorId, JSON.stringify(details)]);
  }
}

export { tokenDigest as affiliateInvitationDigest };
