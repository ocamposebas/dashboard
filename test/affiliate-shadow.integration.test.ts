import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { AffiliateRepository } from "../src/server/affiliateRepository.js";
import { Database } from "../src/server/database.js";
import type { CommerceOrder } from "../src/server/wooCommerceGateway.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || "";
let database: Database | undefined;
let repository: AffiliateRepository | undefined;

before(async () => {
  if (!testDatabaseUrl) return;
  const parsed = new URL(testDatabaseUrl);
  if (!parsed.pathname.toLowerCase().includes("test")) {
    throw new Error("TEST_DATABASE_URL must name an isolated test database");
  }
  database = new Database({
    connectionString: testDatabaseUrl,
    ssl: false,
    maxConnections: 3,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 5_000,
  });
  repository = new AffiliateRepository(database);
  await repository.initializeShadowMode(new Date());
});

after(async () => {
  await database?.close();
});

test("shadow commissions persist once per Woo order and ignore pre-baseline history", {
  skip: !testDatabaseUrl,
}, async () => {
  assert.ok(database && repository);
  const profileId = randomUUID();
  const couponId = randomUUID();
  const orderId = 99_000_001;
  const historicalOrderId = 99_000_002;
  try {
    await database.query(`
      INSERT INTO affiliate_profiles (id, email, display_name, status, source)
      VALUES ($1, $2, $3, 'active', 'shadow_test')
    `, [profileId, `${profileId}@invalid.local`, "Shadow Test"]);
    await database.query(`
      INSERT INTO affiliate_coupons (
        id, affiliate_id, code, discount_type, discount_value, commission_type,
        commission_value, status, referral_url, usage_count,
        shadow_baseline_usage_count, shadow_baseline_sales, shadow_baseline_commission
      ) VALUES ($1, $2, $3, 'percent', 10, 'percent', 10, 'active', '', 0, 0, 0, 0)
    `, [couponId, profileId, "SHADOWTEST"]);

    const started = await database.query<{ shadow_started_at: Date }>(
      "SELECT shadow_started_at FROM affiliate_program_settings WHERE singleton = true",
    );
    const startedAt = started.rows[0]!.shadow_started_at;
    const currentDate = new Date(startedAt.getTime() + 60_000);
    const order = {
      id: orderId,
      number: "SHADOW-TEST",
      status: "processing",
      currency: "USD",
      total: 114,
      totalTax: 0,
      shippingTotal: 14,
      paidAt: currentDate.toISOString(),
      createdAt: currentDate.toISOString(),
      modifiedAt: currentDate.toISOString(),
      lineItems: [{ total: 100 }],
      feeLines: [],
      couponLines: [{ code: "SHADOWTEST" }],
      refundedTotal: 0,
    } as CommerceOrder;
    const historicalOrder = {
      ...order,
      id: historicalOrderId,
      number: "SHADOW-HISTORICAL",
      paidAt: new Date(startedAt.getTime() - 60_000).toISOString(),
      createdAt: new Date(startedAt.getTime() - 120_000).toISOString(),
    };

    await repository.reconcileShadowOrders([order, historicalOrder], currentDate);
    await repository.reconcileShadowOrders([order], currentDate);
    const rows = await database.query<{
      wc_order_id: string;
      eligible_amount: string;
      commission_amount: string;
    }>(`
      SELECT wc_order_id, eligible_amount, commission_amount
      FROM affiliate_commissions
      WHERE coupon_id = $1
    `, [couponId]);
    assert.equal(rows.rows.length, 1);
    assert.equal(Number(rows.rows[0]!.wc_order_id), orderId);
    assert.equal(Number(rows.rows[0]!.eligible_amount), 100);
    assert.equal(Number(rows.rows[0]!.commission_amount), 10);
    const attribution = await repository.commissionForOrder(orderId);
    assert.equal(attribution?.affiliateId, profileId);
    assert.equal(attribution?.affiliateName, "Shadow Test");
    assert.equal(attribution?.couponCode, "SHADOWTEST");
    assert.equal(attribution?.commissionType, "percent");
    assert.equal(attribution?.eligibleAmount, 100);
    assert.equal(attribution?.commissionAmount, 10);
    const orderSummaries = await repository.commissionsForOrders([orderId, 99_999_999, orderId]);
    assert.equal(orderSummaries.length, 1);
    assert.equal(orderSummaries[0]?.orderId, orderId);
    assert.equal(orderSummaries[0]?.affiliateName, "Shadow Test");
    assert.equal(orderSummaries[0]?.commissionAmount, 10);
    const directory = await repository.adminDirectory();
    assert.equal(directory.commissions.some((commission) => commission.orderId === orderId), true);
  } finally {
    await database.query("DELETE FROM affiliate_commissions WHERE coupon_id = $1", [couponId]);
    await database.query("DELETE FROM affiliate_coupons WHERE id = $1", [couponId]);
    await database.query("DELETE FROM affiliate_profiles WHERE id = $1", [profileId]);
  }
});

test("affiliate coupons and access status are managed without deleting history", {
  skip: !testDatabaseUrl,
}, async () => {
  assert.ok(database && repository);
  const profileId = randomUUID();
  let couponId = "";
  try {
    await database.query(`
      INSERT INTO affiliate_profiles (id, email, display_name, status, source)
      VALUES ($1, $2, $3, 'pending_invite', 'management_test')
    `, [profileId, `${profileId}@invalid.local`, "Managed Affiliate"]);
    await repository.linkStorefrontAccountByAdmin({
      affiliateId: profileId,
      wpUserId: 99000001,
      verifiedEmail: `${profileId}@invalid.local`,
      displayName: "Managed Affiliate",
      actorId: "integration-test",
    });
    couponId = await repository.saveManagedCoupon({
      affiliateId: profileId,
      couponId: null,
      wpCouponId: 99000002,
      code: "MANAGED10",
      discountValue: 10,
      commissionValue: 12,
      referralUrl: "https://phaseonelabz.com/?coupon=MANAGED10",
      actorId: "integration-test",
    });
    await repository.setAffiliateStatus({ affiliateId: profileId, status: "suspended", actorId: "integration-test" });
    const paused = await repository.affiliateManagementTarget(profileId);
    assert.equal(paused?.status, "suspended");
    assert.equal(paused?.coupons[0]?.status, "paused");
    assert.equal(paused?.coupons[0]?.wpCouponId, 99000002);

    await repository.setAffiliateStatus({ affiliateId: profileId, status: "active", actorId: "integration-test" });
    const active = await repository.affiliateManagementTarget(profileId);
    assert.equal(active?.status, "active");
    assert.equal(active?.coupons[0]?.status, "active");
  } finally {
    await database.query("DELETE FROM affiliate_audit_events WHERE affiliate_id = $1", [profileId]);
    if (couponId) await database.query("DELETE FROM affiliate_coupons WHERE id = $1", [couponId]);
    await database.query("DELETE FROM affiliate_profiles WHERE id = $1", [profileId]);
  }
});
