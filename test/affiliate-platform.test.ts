import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAffiliateSessionCookie,
  createAffiliateSessionCookie,
  readAffiliateSession,
} from "../src/server/affiliateAuth.js";
import { loadAffiliateServiceSecret } from "../src/server/config.js";
import { affiliateCouponInput, affiliateProgramSettingsInput, affiliateStatusInput } from "../src/server/affiliateManagement.js";
import { WooCommerceGateway } from "../src/server/wooCommerceGateway.js";

test("affiliate session cookies are scoped, signed and reject tampering", () => {
  const secret = "affiliate-session-secret-that-is-longer-than-thirty-two-characters";
  const cookie = createAffiliateSessionCookie({
    affiliateId: "8af89730-3a76-4c04-b58e-62f5f319cc4f",
    email: "partner@example.com",
    authVersion: 3,
    sessionSecret: secret,
    cookieSecure: true,
    ttlMs: 60_000,
  });
  const header = cookie.split(";")[0];
  const session = readAffiliateSession(header, secret);
  assert.equal(session?.sub, "8af89730-3a76-4c04-b58e-62f5f319cc4f");
  assert.equal(session?.email, "partner@example.com");
  assert.equal(session?.authVersion, 3);
  assert.equal(readAffiliateSession(`${header}x`, secret), null);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(clearAffiliateSessionCookie(true), /Max-Age=0/);
});

test("legacy coupon data maps into the Phase One affiliate migration model", async () => {
  const fetchImpl = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname.endsWith("/coupons")) {
      return new Response(JSON.stringify([{
        id: 2703,
        code: "sarah10",
        amount: "10.00",
        status: "publish",
        date_expires_gmt: null,
        discount_type: "percent",
        usage_count: 4,
        meta_data: [
          { key: "wcu_select_coupon_user", value: "1615" },
          { key: "wcu_text_unpaid_commission", value: "39.97" },
          { key: "wcu_text_pending_payment_commission", value: "12.50" },
          { key: "wcu_alltime_stats", value: { total_orders: 445.6, full_discount: 46, total_commission: 39.97 } },
          { key: "_phaseone_affiliate_coupon_managed", value: "yes" },
          { key: "_phaseone_affiliate_commission_percent", value: "10" },
          { key: "_phaseone_affiliate_referral_url", value: "https://phaseonelabz.com/?coupon=SARAH10" },
        ],
      }]), { status: 200, headers: { "content-type": "application/json", "x-wp-totalpages": "1" } });
    }
    if (url.pathname.endsWith("/customers")) {
      return new Response(JSON.stringify([{
        id: 1615,
        email: "sarah@example.com",
        username: "sarah",
        first_name: "Sarah",
        last_name: "Partner",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://phaseonelabz.com",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl as typeof fetch);
  const coupons = await gateway.listLegacyAffiliateCoupons();
  assert.equal(coupons.length, 1);
  assert.deepEqual(coupons[0], {
    wpCouponId: 2703,
    wpUserId: 1615,
    code: "sarah10",
    status: "active",
    discountType: "percent",
    discountValue: 10,
    commissionType: "percent",
    commissionValue: 10,
    usageCount: 4,
    grossSales: 445.6,
    totalDiscount: 46,
    totalCommission: 39.97,
    availableCommission: 39.97,
    pendingPayout: 12.5,
    referralUrl: "https://phaseonelabz.com/?coupon=SARAH10",
    displayName: "Sarah Partner",
    username: "sarah",
    email: "sarah@example.com",
  });
});

test("affiliate storefront service credentials remain optional but reject weak values", () => {
  const previous = process.env.AFFILIATE_SERVICE_SECRET;
  try {
    delete process.env.AFFILIATE_SERVICE_SECRET;
    assert.equal(loadAffiliateServiceSecret(), undefined);

    process.env.AFFILIATE_SERVICE_SECRET = "too-short";
    assert.throws(() => loadAffiliateServiceSecret(), /at least 32 characters/);

    const strongSecret = "a-storefront-service-secret-with-more-than-32-characters";
    process.env.AFFILIATE_SERVICE_SECRET = strongSecret;
    assert.equal(loadAffiliateServiceSecret(), strongSecret);
  } finally {
    if (previous === undefined) {
      delete process.env.AFFILIATE_SERVICE_SECRET;
    } else {
      process.env.AFFILIATE_SERVICE_SECRET = previous;
    }
  }
});

test("affiliate coupon administration normalizes safe values and rejects ambiguous input", () => {
  assert.deepEqual(affiliateCouponInput({
    affiliateId: "8af89730-3a76-4c04-b58e-62f5f319cc4f",
    couponId: "",
    code: " partner-10 ",
    discountValue: "10",
    commissionValue: 12.345,
  }), {
    affiliateId: "8af89730-3a76-4c04-b58e-62f5f319cc4f",
    couponId: null,
    code: "PARTNER-10",
    discountValue: 10,
    commissionValue: 12.35,
  });
  assert.deepEqual(affiliateStatusInput({
    affiliateId: "8af89730-3a76-4c04-b58e-62f5f319cc4f",
    status: "suspended",
  }), {
    affiliateId: "8af89730-3a76-4c04-b58e-62f5f319cc4f",
    status: "suspended",
  });
  assert.throws(() => affiliateCouponInput({
    affiliateId: "8af89730-3a76-4c04-b58e-62f5f319cc4f",
    code: "bad code",
    discountValue: 10,
    commissionValue: 10,
  }), /3–40 letters/);
  assert.throws(() => affiliateStatusInput({
    affiliateId: "8af89730-3a76-4c04-b58e-62f5f319cc4f",
    status: "closed",
  }), /status action/);
});

test("affiliate program settings normalize editable values", () => {
  assert.deepEqual(affiliateProgramSettingsInput({
    defaultCommissionRate: "15", minimumPayout: "50", approvalHoldDays: "7", currency: "usd",
  }), { defaultCommissionRate: 15, minimumPayout: 50, approvalHoldDays: 7, currency: "USD" });
  assert.throws(() => affiliateProgramSettingsInput({
    defaultCommissionRate: 15, minimumPayout: -1, approvalHoldDays: 7, currency: "USD",
  }), /Minimum payout/);
});

test("managed coupons are provisioned with the legacy bridge metadata and can be paused", async () => {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ method, path: url.pathname, body });
    if (method === "GET") return new Response("[]", { status: 200 });
    if (method === "POST") return new Response(JSON.stringify({ id: 4401, code: "partner10", status: "publish" }), { status: 201 });
    return new Response(JSON.stringify({ id: 4401, code: "partner10", status: body?.status }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://phaseonelabz.com",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);
  const saved = await gateway.saveManagedAffiliateCoupon({
    wpUserId: 1615,
    code: "PARTNER10",
    discountValue: 10,
    commissionValue: 15,
    referralUrl: "https://phaseonelabz.com/?coupon=PARTNER10",
  });
  await gateway.setManagedAffiliateCouponsActive([4401, 4401], false);

  assert.equal(saved.wpCouponId, 4401);
  const create = requests.find((request) => request.method === "POST")!;
  assert.equal(create.path, "/wp-json/wc/v3/coupons");
  assert.equal(create.body?.code, "partner10");
  assert.equal(create.body?.amount, "10.00");
  const metadata = new Map((create.body?.meta_data as Array<{ key: string; value: string }>).map((item) => [item.key, item.value]));
  assert.equal(metadata.get("wcu_select_coupon_user"), "1615");
  assert.equal(metadata.get("wcu_commission_percent"), "15");
  assert.equal(metadata.get("wcu_enable_custom_commission"), "yes");
  assert.equal(metadata.get("_phaseone_affiliate_coupon_managed"), "yes");
  assert.equal(requests.filter((request) => request.method === "PUT").length, 1);
  assert.equal(requests.at(-1)?.body?.status, "draft");
});

test("affiliate assignment can securely resolve an exact storefront customer identity", async () => {
  const requests: URL[] = [];
  const gateway = new WooCommerceGateway({
    baseUrl: "https://phaseonelabz.com",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, (async (input) => {
    requests.push(new URL(String(input)));
    return new Response(JSON.stringify([
      { id: 77, email: "partner@example.com", first_name: "Pat", last_name: "One" },
      { id: 78, email: "different@example.com", first_name: "Wrong" },
    ]), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(await gateway.findCustomerIdentityByEmail(" Partner@Example.com "), {
    id: 77,
    email: "partner@example.com",
    displayName: "Pat One",
  });
  assert.equal(await gateway.findCustomerIdentityByEmail("missing@example.com"), null);
  assert.ok(requests.every((url) => url.searchParams.get("role") === "all"));
});
