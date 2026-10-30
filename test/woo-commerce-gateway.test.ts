import assert from "node:assert/strict";
import test from "node:test";
import { CommerceServiceError, WooCommerceGateway } from "../src/server/wooCommerceGateway.js";

test("maps WooCommerce products and orders without exposing credentials", async () => {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization") });
    const payload = url.pathname.endsWith("/products")
      ? [{
          id: 22,
          name: "Hoodie",
          sku: "PH-22",
          status: "publish",
          price: "89.00",
          regular_price: "89.00",
          sale_price: "",
          stock_quantity: 4,
          stock_status: "instock",
          categories: [{ name: "Apparel" }],
          images: [{ id: 44, src: "https://shop.example/hoodie.jpg", thumbnail: "https://shop.example/hoodie-450.jpg" }],
          date_modified_gmt: "2026-10-12T15:30:00",
        }]
      : [{
          id: 108,
          number: "108",
          status: "processing",
          currency: "USD",
          total: "101.00",
          shipping_total: "12.00",
          discount_total: "0.00",
          payment_method_title: "Card",
          date_created_gmt: "2026-10-13T10:00:00",
          billing: { first_name: "Ana", last_name: "L.", city: "Bogotá", country: "CO" },
          line_items: [{ product_id: 22, name: "Hoodie", quantity: 1, total: "89.00" }],
        }];
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const [products, orders] = await Promise.all([
    gateway.listProducts(),
    gateway.listOrders(),
  ]);

  assert.equal(products[0]?.price, 89);
  assert.equal(products[0]?.stockQuantity, 4);
  assert.equal(products[0]?.thumbnailUrl, "https://shop.example/hoodie-450.jpg");
  assert.equal(orders[0]?.customer, "Ana L.");
  assert.equal(orders[0]?.lineItems[0]?.total, 89);
  assert.equal(requests.length, 3);
  assert.ok(requests.filter((request) => request.url.pathname.includes("/wc/v3/")).every((request) => request.authorization?.startsWith("Basic ")));
  assert.equal(requests.find((request) => request.url.pathname.includes("/wc/store/"))?.authorization, null);
  assert.ok(requests.every((request) => !request.url.search.includes("ck_test")));
});

test("loads every catalog page so older products remain available for exact COA mapping", async () => {
  const product = (id: number, name = `Product ${id}`) => ({
    id,
    name,
    sku: name === "PL-TZ" ? "PL-TZ" : `SKU-${id}`,
    type: name === "PL-TZ" ? "variable" : "simple",
    status: "publish",
    catalog_visibility: "visible",
    price: "50.00",
    regular_price: "50.00",
    stock_status: "instock",
    categories: [],
    images: [],
    variations: [],
    attributes: [],
  });
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/wc/store/")) return new Response("[]", { status: 200 });
    const page = Number(url.searchParams.get("page") || 1);
    const payload = page === 1
      ? Array.from({ length: 100 }, (_, index) => product(index + 1))
      : [product(533, "PL-TZ")];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "x-wp-totalpages": "2" },
    });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const products = await gateway.listProducts();

  assert.equal(products.length, 101);
  assert.equal(products.find((item) => item.id === 533)?.name, "PL-TZ");
});

test("finds the next available SKU across products and variations", async () => {
  const requestedSkus: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const sku = url.searchParams.get("sku") || "";
    requestedSkus.push(sku);
    const payload = sku === "PL-TZ" ? [{
      id: 653,
      name: "PL-TZ - 10 MG",
      sku: "PL-TZ",
      type: "variation",
      status: "publish",
      catalog_visibility: "visible",
      price: "50.00",
      regular_price: "50.00",
      stock_quantity: 4,
      stock_status: "instock",
      categories: [{ id: 16, name: "Research Peptides" }],
      images: [],
      variations: [],
      attributes: [],
    }] : [];
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const sku = await gateway.suggestAvailableProductSku("PL TZ");

  assert.equal(sku, "PL-TZ-1");
  assert.deepEqual(requestedSkus, ["PL-TZ", "PL-TZ-1"]);
});

test("keeps generated variant SKUs unique inside one unsaved product", async () => {
  const requestedSkus: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requestedSkus.push(url.searchParams.get("sku") || "");
    return new Response("[]", { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const sku = await gateway.suggestAvailableProductSku("KPV-10-MG", [], ["KPV-10-MG"]);

  assert.equal(sku, "KPV-10-MG-1");
  assert.deepEqual(requestedSkus, ["KPV-10-MG-1"]);
});

test("saves the selected catalog category with the generated product SKU", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 701,
      name: "KPV 30 MG",
      sku: "KPV-30-MG",
      type: "simple",
      status: "publish",
      catalog_visibility: "visible",
      price: "55.00",
      regular_price: "55.00",
      stock_quantity: 12,
      stock_status: "instock",
      categories: [{ id: 16, name: "Research Peptides" }],
      images: [],
      variations: [],
      attributes: [],
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const saved = await gateway.saveProduct(null, {
    name: "KPV 30 MG",
    sku: "KPV-30-MG",
    regularPrice: 55,
    stockQuantity: 12,
    categoryId: 16,
    visibility: "public",
    images: [],
    variants: [],
  });

  assert.equal(saved.categoryId, 16);
  assert.deepEqual(requestBody?.categories, [{ id: 16 }]);
  assert.equal(requestBody?.sku, "KPV-30-MG");
});

test("derives variable parent availability from its saved child stock", async () => {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const productResponse = (stockStatus: string) => ({
    id: 534,
    name: "PL-RT",
    sku: "PL-RT",
    type: "variable",
    status: "publish",
    catalog_visibility: "visible",
    price: "35.00",
    regular_price: "35.00",
    stock_quantity: null,
    stock_status: stockStatus,
    categories: [{ id: 16, name: "Research Peptides" }],
    images: [],
    variations: [648, 649],
    attributes: [{ name: "MG", options: ["20MG", "30MG"] }],
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    requests.push({ path: url.pathname, method: init?.method || "GET", body });
    if (url.pathname.includes("/variations/")) {
      return new Response(JSON.stringify({ id: Number(url.pathname.split("/").at(-1)), ...body }), { status: 200 });
    }
    return new Response(JSON.stringify(productResponse(String(body.stock_status || "instock"))), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const saved = await gateway.saveProduct(534, {
    name: "PL-RT",
    sku: "PL-RT",
    regularPrice: 35,
    stockQuantity: 0,
    categoryId: 16,
    visibility: "public",
    images: [],
    attributeName: "MG",
    variants: [
      { id: 648, option: "20MG", sku: "R3TA-20MG", price: 55, stock: 0 },
      { id: 649, option: "30MG", sku: "R3TA-30MG", price: 65, stock: 75 },
    ],
  });

  assert.equal(requests.length, 4);
  assert.equal(requests[0]?.body.manage_stock, false);
  assert.equal(requests[0]?.body.stock_status, "instock");
  assert.equal(requests[0]?.body.stock_quantity, undefined);
  assert.deepEqual(requests.at(-1)?.body, { manage_stock: false, stock_status: "instock" });
  assert.equal(saved.stockStatus, "instock");
});

test("preserves WooCommerce duplicate-SKU details as a safe catalog error", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    code: "product_invalid_sku",
    message: "Invalid or duplicated SKU.",
    data: { status: 400, resource_id: 533, unique_sku: "PL-TZ-1" },
  }), { status: 400 });
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  await assert.rejects(
    gateway.saveProduct(null, {
      name: "PL TZ",
      sku: "PL-TZ",
      regularPrice: 50,
      stockQuantity: 1,
      categoryId: 16,
      visibility: "public",
      images: [],
      variants: [],
    }),
    (error: unknown) => error instanceof CommerceServiceError
      && error.code === "product_invalid_sku"
      && error.details.unique_sku === "PL-TZ-1",
  );
});

test("loads a complete bounded sales period on demand", async () => {
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return new Response(JSON.stringify([{
      id: 210,
      number: "210",
      status: "completed",
      currency: "USD",
      total: "75.00",
      payment_method_title: "Card",
      date_created_gmt: "2026-10-16T12:00:00",
      date_paid_gmt: "2026-10-16T12:01:00",
      billing: { first_name: "Sam", last_name: "R." },
      line_items: [{ product_id: 42, variation_id: 43, name: "BPC-157 10 mg", sku: "BPC-10", quantity: 2, total: "75.00" }],
    }]), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const orders = await gateway.listOrdersForPeriod("2026-10-01T05:00:00.000Z", "2026-10-17T05:00:00.000Z");

  assert.equal(orders.length, 1);
  assert.equal(orders[0]?.lineItems[0]?.sku, "BPC-10");
  assert.equal(requests[0]?.searchParams.get("after"), "2026-10-01T05:00:00.000Z");
  assert.equal(requests[0]?.searchParams.get("before"), "2026-10-17T05:00:00.000Z");
  assert.equal(requests[0]?.searchParams.get("dates_are_gmt"), "true");
  assert.equal(requests[0]?.searchParams.get("per_page"), "100");
});

test("moves products to recoverable Trash instead of permanently deleting them", async () => {
  let request: { method: string; force: string | null } | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    request = { method: init?.method || "GET", force: url.searchParams.get("force") };
    return new Response(JSON.stringify({
      id: 22,
      name: "Legacy accessory",
      sku: "ACC-22",
      type: "simple",
      status: "trash",
      catalog_visibility: "hidden",
      price: "10.00",
      regular_price: "10.00",
      stock_quantity: 0,
      stock_status: "outofstock",
      categories: [],
      images: [],
      variations: [],
      attributes: [],
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const removed = await gateway.trashProduct(22);
  assert.equal(removed.status, "trash");
  assert.deepEqual(request, { method: "DELETE", force: "false" });
});

test("synchronizes a scheduled product promotion with WooCommerce checkout pricing", async () => {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({ method: init?.method || "GET", path: url.pathname, body });
    return new Response(JSON.stringify({
      id: 22,
      name: "Eloralintide + PL-RT Blend",
      sku: "ELORALINTIDE-AND-PL-RT-BLEND",
      type: "simple",
      status: "publish",
      catalog_visibility: "visible",
      price: body?.sale_price || "65.00",
      regular_price: "65.00",
      sale_price: body?.sale_price || "",
      date_on_sale_from_gmt: body?.date_on_sale_from_gmt || null,
      date_on_sale_to_gmt: body?.date_on_sale_to_gmt || null,
      stock_quantity: 10,
      stock_status: "instock",
      categories: [],
      images: [],
      variations: [],
      attributes: [],
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const saved = await gateway.setProductSale(22, {
    salePrice: 40,
    startsAt: "2026-10-21T18:00:00.000Z",
    endsAt: "2026-10-22T18:00:00.000Z",
  });

  assert.equal(saved.salePrice, 40);
  assert.equal(requests[0]?.method, "PUT");
  assert.equal(requests[0]?.path, "/wp-json/wc/v3/products/22");
  assert.deepEqual(requests[0]?.body, {
    sale_price: "40.00",
    date_on_sale_from_gmt: "2026-10-21T18:00:00",
    date_on_sale_to_gmt: "2026-10-22T18:00:00",
  });
});

test("approving a manual payment records both the paid time and approval metadata", async () => {
  let body: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 3154,
      number: "3154",
      status: "processing",
      currency: "USD",
      total: "382.36",
      payment_method: "zelle",
      payment_method_title: "Zelle",
      date_paid: body.date_paid,
      billing: { first_name: "Sebastian", last_name: "Garcia" },
      line_items: [{ id: 1, product_id: 22, name: "KPV", sku: "KPV", quantity: 1, total: "50.00" }],
      meta_data: body.meta_data,
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const approved = await gateway.approveOrderPayment(3154);
  assert.equal(approved.status, "processing");
  assert.equal(approved.paymentOperations.approvalState, "approved");
  assert.ok(approved.paidAt);
  assert.equal(body?.status, "processing");
  assert.ok(Array.isArray(body?.meta_data));
});

test("waitlist lookup falls back to the installed notifier when the older bridge returns no people", async () => {
  const paths: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.endsWith("/phaseone-ops/v1/waitlist")) {
      return new Response(JSON.stringify({ subscribers: [] }), { status: 200 });
    }
    return new Response(JSON.stringify([
      { id: 801 },
      { last_modified_date: "2026-10-21T15:00:00" },
      { status: "cwg_subscribed" },
      {
        meta_data: {
          cwginstock_product_id: ["528"],
          cwginstock_variation_id: ["0"],
          cwginstock_subscriber_email: ["stock@example.com"],
        },
      },
    ]), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const subscribers = await gateway.listWaitlistSubscribers(528);
  assert.equal(subscribers.length, 1);
  assert.equal(subscribers[0]?.email, "stock@example.com");
  assert.deepEqual(paths, [
    "/wp-json/phaseone-ops/v1/waitlist",
    "/wp-json/wc-instocknotifier/v3/list_subscriber",
  ]);
});

test("affiliate incremental scans keep the newest WooCommerce orders inside the window", async () => {
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requests.push(new URL(String(input)));
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", "x-wp-totalpages": "1" },
    });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  await gateway.listOrdersModifiedSince(
    "2026-10-17T18:57:57.667Z",
    "2026-10-19T02:02:00.000Z",
  );

  assert.equal(requests[0]?.searchParams.get("modified_after"), "2026-10-17T18:57:57.667Z");
  assert.equal(requests[0]?.searchParams.has("modified_before"), false);
  assert.equal(requests[0]?.searchParams.has("dates_are_gmt"), false);
  assert.equal(requests[0]?.searchParams.get("orderby"), "modified");
});

test("loads order financial detail and sends protected order operations", async () => {
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const order = {
    id: 108,
    number: "108",
    status: "processing",
    currency: "USD",
    total: "112.50",
    total_tax: "3.50",
    cart_tax: "3.00",
    shipping_total: "12.00",
    shipping_tax: "0.50",
    discount_total: "2.00",
    discount_tax: "0.00",
    payment_method: "card",
    payment_method_title: "Card",
    transaction_id: "txn_108",
    date_created_gmt: "2026-10-13T10:00:00",
    date_paid_gmt: "2026-10-13T10:01:00",
    billing: {
      first_name: "Ana",
      last_name: "L.",
      address_1: "Main Street",
      city: "Bogotá",
      country: "CO",
      email: "ana@example.test",
    },
    shipping: { first_name: "Ana", last_name: "L.", city: "Bogotá", country: "CO" },
    line_items: [{
      id: 55,
      product_id: 22,
      name: "Hoodie",
      sku: "PH-22",
      quantity: 1,
      price: 99,
      subtotal: "99.00",
      total: "99.00",
      total_tax: "3.00",
      image: { src: "https://shop.example/hoodie.jpg" },
    }],
    fee_lines: [{ id: 7, name: "Handling", total: "1.00", total_tax: "0.00" }],
    coupon_lines: [{ id: 8, code: "SAVE2", discount: "2.00", discount_tax: "0" }],
    refunds: [{ id: 9, reason: "Adjustment", total: "-10.00" }],
    meta_data: [
      { key: "_phaseone_payment_reference", value: "ZL-108" },
      { key: "_phaseone_processing_fee_amount", value: "3.25" },
      { key: "_phaseone_processing_fee_rate", value: "2.9" },
      { key: "_phaseone_contract_archive_status", value: "sealed" },
      { key: "_phaseone_contract_accepted_at", value: "2026-10-13T10:02:00" },
      { key: "_phaseone_contract_signer", value: "Ana L." },
      { key: "_phaseone_contract_pdf_filename", value: "agreement-108.pdf" },
      { key: "_shipstation_exported", value: "yes" },
      { key: "_phaseone_shipping_protection_selected", value: "yes" },
      { key: "_phaseone_shipping_protection_value", value: "112.50" },
    ],
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
    requests.push({ method, path: url.pathname, body });
    return new Response(JSON.stringify(
      url.pathname.endsWith("/refunds") ? { id: 11, amount: "20.00" } : {
        ...order,
        ...(method === "PUT" && body && typeof body === "object" ? body : {}),
      },
    ), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const detail = await gateway.getOrder(108);
  assert.equal(detail.totalTax, 3.5);
  assert.equal(detail.feeLines[0]?.name, "Handling");
  assert.equal(detail.lineItems[0]?.sku, "PH-22");
  assert.equal(detail.refundedTotal, 10);
  assert.equal(detail.refundableTotal, 102.5);
  assert.equal(detail.paymentOperations.reference, "ZL-108");
  assert.equal(detail.paymentOperations.processingFee, 3.25);
  assert.equal(detail.agreement.status, "sealed");
  assert.equal(detail.agreement.downloadAvailable, true);
  assert.equal(detail.shippingOperations.exported, true);
  assert.equal(detail.shippingOperations.protectionValue, 112.5);

  const updated = await gateway.updateOrderStatus(108, "completed");
  assert.equal(updated.status, "completed");
  await gateway.createRefund(108, 20, "Customer request");
  assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT", "POST"]);
  assert.deepEqual(requests[1]?.body, { status: "completed" });
  assert.deepEqual(requests[2]?.body, {
    amount: "20.00",
    reason: "Customer request",
    api_refund: true,
  });
});

test("loads protected evidence, COA, timeline and restock operations", async () => {
  const requests: Array<{ path: string; method: string; key: string | null; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as unknown : null;
    requests.push({ path: url.pathname, method: init?.method || "GET", key: headers.get("x-phaseone-consumer-key"), body });
    if (url.pathname.endsWith("/evidence")) return new Response(JSON.stringify({ evidence: [{ id: "01234567-89ab-cdef-0123-456789abcdef", label: "Zelle proof", captured_at: "2026-10-15T10:00:00", mime: "image/png", bytes: 2048, customer_visible: false }] }), { status: 200 });
    if (url.pathname.endsWith("/coas")) return new Response(JSON.stringify({ items: [{ item_id: 55, name: "Research Vial", sku: "RV-10", quantity: 2, remaining_quantity: 1, assignments: [{ assignment_id: "a-1", coa_id: "coa-1", lot: "L-22", quantity: 1 }], candidates: [{ id: "coa-2", number: "P1-22", product_name: "Research Vial", lot: "L-23", current_shipping_lot: true }] }] }), { status: 200 });
    if (url.pathname.endsWith("/notes")) return new Response(JSON.stringify([{ id: 8, note: "Payment reviewed", customer_note: false, date_created_gmt: "2026-10-15T11:00:00", author: "Operations" }]), { status: 200 });
    if (url.pathname.endsWith("/restocks")) return new Response(JSON.stringify([{ id: 3035, product_id: 528, product_name: "Wolverine", status: "In Review", expected_date: "2026-10-20" }]), { status: 200 });
    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({ baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test" }, fetchImpl);

  const [evidence, coas, notes, restocks] = await Promise.all([
    gateway.getOrderEvidence(108), gateway.getOrderCoas(108), gateway.listOrderNotes(108), gateway.listRestocks(),
  ]);
  await gateway.assignOrderCoa(108, 55, "coa-2", 1, undefined, true);
  await gateway.notifyWaitlist(528);

  assert.equal(evidence.items[0]?.label, "Zelle proof");
  assert.equal(coas.items[0]?.remainingQuantity, 1);
  assert.equal(coas.items[0]?.candidates[0]?.currentShippingLot, true);
  assert.equal(notes[0]?.note, "Payment reviewed");
  assert.equal(restocks[0]?.productName, "Wolverine");
  assert.ok(requests.filter((request) => request.path.includes("/phaseone-ops/")).every((request) => request.key === "ck_test"));
  const assignment = requests.find((request) => request.path.endsWith("/items/55/coas") && request.method === "POST");
  assert.deepEqual(assignment?.body, { coa_id: "coa-2", quantity: 1, confirmed: true });
  assert.equal(requests.some((request) => request.path.endsWith("/waitlist/notify")), true);
});

test("sends both packaging photos to the protected WordPress mail bridge as multipart attachments", async () => {
  let captured: { path: string; contentType: string; key: string; body: Buffer } | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    captured = {
      path: new URL(String(input)).pathname,
      contentType: headers.get("content-type") || "",
      key: headers.get("x-phaseone-consumer-key") || "",
      body: Buffer.from(init?.body as Uint8Array),
    };
    return new Response(JSON.stringify({
      state: "sent",
      sent_at: "2026-10-17T18:00:00Z",
      replayed: false,
      message: "Customer email sent through WordPress SMTP with both photos attached.",
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const result = await gateway.emailPackagingEvidence({
    orderId: 108,
    eventId: "01234567-89ab-4def-8123-456789abcdef",
    confirmedAt: "2026-10-17T17:59:00Z",
    attachments: [
      { kind: "contents", mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { kind: "sealed_label", mime: "image/png", bytes: Buffer.from([137, 80, 78, 71]) },
    ],
  });

  assert.equal(result.state, "sent");
  assert.equal(captured?.path, "/wp-json/phaseone-ops/v1/orders/108/evidence/email");
  assert.equal(captured?.key, "ck_test");
  assert.match(captured?.contentType || "", /^multipart\/form-data; boundary=phaseone-evidence-/);
  const multipart = captured?.body.toString("latin1") || "";
  assert.match(multipart, /name="event_id"/);
  assert.match(multipart, /name="contents"; filename="packed-contents\.jpg"/);
  assert.match(multipart, /name="sealed_label"; filename="sealed-package-label\.png"/);
  assert.equal(multipart.includes("cs_test"), false);
});

test("sends a single packaging photo when the worker skips the optional second photo", async () => {
  let multipart = "";
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, async (_input, init) => {
    multipart = Buffer.from(init?.body as Uint8Array).toString("latin1");
    return new Response(JSON.stringify({
      state: "sent",
      sent_at: "2026-10-17T18:00:00Z",
      replayed: false,
      message: "Customer email sent with one evidence photo.",
    }), { status: 200 });
  });

  const result = await gateway.emailPackagingEvidence({
    orderId: 109,
    eventId: "11234567-89ab-4def-8123-456789abcdef",
    confirmedAt: "2026-10-17T17:59:00Z",
    attachments: [
      { kind: "contents", mime: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    ],
  });

  assert.equal(result.state, "sent");
  assert.match(multipart, /name="contents"; filename="packed-contents\.jpg"/);
  assert.equal(multipart.includes('name="sealed_label"'), false);
});

test("loads public COA and site-control modules without leaking catalog credentials", async () => {
  const requests: Array<{ path: string; authorization: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({ path: url.pathname, authorization: headers.get("authorization") });
    const payload = url.pathname.endsWith("/coas") ? [{
      id: "coa-1",
      wpPostId: 11,
      coaNumber: "P1-2401",
      productName: "Test Compound",
      familyName: "Test Family",
      familyKey: "test-family",
      skus: ["P1-TEST"],
      batch: "B-01",
      purity: "99.1%",
      currentShippingLot: true,
      fileUrl: "https://shop.example/coa.pdf",
      externalFileUrl: "https://lab.example/original-coa.pdf",
      history: [{ id: 1 }],
    }] : {
      version: "1.7.0",
      promo: {
        enabled: true,
        type: "product",
        title: "Flash Sale",
        ends_at: "2026-10-17T19:46:51+00:00",
        product: { id: 22, name: "Test Compound", original_price: "65", promo_price: "55", sale_price_active: true },
      },
      maintenance: { enabled: false, title: "Precision work in progress.", support_email: "support@example.test" },
    };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const [coas, controls] = await Promise.all([gateway.listCoas(), gateway.getSiteControls()]);

  assert.equal(coas[0]?.familyName, "Test Family");
  assert.equal(coas[0]?.externalFileUrl, "https://lab.example/original-coa.pdf");
  assert.equal(coas[0]?.historyCount, 1);
  assert.equal(controls.promo.product?.promoPrice, 55);
  assert.equal(controls.maintenance.enabled, false);
  assert.deepEqual(requests.map((request) => request.authorization), [null, null]);
});

test("uses the protected operations bridge to update an existing COA", async () => {
  const requests: Array<{ path: string; method: string; key: string | null; secret: string | null; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({
      path: url.pathname,
      method: init?.method || "GET",
      key: headers.get("x-phaseone-consumer-key"),
      secret: headers.get("x-phaseone-consumer-secret"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.pathname.endsWith("/status")) {
      return new Response(JSON.stringify({ connected: true, version: "1.0.0", capabilities: ["edit_coa"] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: "coa-1", wpPostId: 11, coaNumber: "P1-2401", productName: "Updated Compound",
      familyName: "Test Family", familyKey: "test-family", skus: ["P1-TEST"], batch: "B-02",
      purity: "99.4%", currentShippingLot: true, fileUrl: "https://shop.example/coa.pdf", history: [],
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const status = await gateway.getOperationsBridgeStatus();
  const updated = await gateway.saveCoa({
    wpPostId: 11, coaNumber: "P1-2401", productName: "Updated Compound", compound: "Compound",
    familyName: "Test Family", familyKey: "test-family", strength: "10 mg", batch: "B-02", lot: "B-02",
    date: "2026-10-14", status: "Available", purity: "99.4%", laboratory: "ILS Labs", method: "HPLC",
    tested: "HPLC / MS", currentShippingLot: true, fileUrl: "https://shop.example/coa.pdf", verifyUrl: "",
    fileAttachmentId: 40, matchedProductId: 22, matchedVariationId: 23, skus: ["P1-TEST"],
    aliases: ["Test"], keywords: ["batch"], panelTypes: ["full"],
  });

  assert.equal(status.connected, true);
  assert.equal(updated.productName, "Updated Compound");
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.path, "/wp-json/phaseone-ops/v1/coas/11");
  assert.equal(requests[1]?.key, "ck_test");
  assert.equal(requests[1]?.secret, "cs_test");
  assert.equal((requests[1]?.body as Record<string, unknown>).batch, "B-02");
});

test("writes and voids native shipping metadata through the protected bridge", async () => {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown>; key: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({
      path: url.pathname,
      method: init?.method || "GET",
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
      key: headers.get("x-phaseone-consumer-key"),
    });
    return new Response(JSON.stringify({ replayed: false, message: "Saved safely" }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);
  const eventId = "11111111-1111-4111-8111-111111111111";
  await gateway.saveNativeShippingLabel({
    orderId: 3112, eventId, labelId: "se-label-1", shipmentId: "se-shipment-1",
    trackingNumber: "1ZSAFE", carrier: "UPS", service: "UPS Ground",
    amount: 12.45, currency: "USD", purchasedAt: "2026-10-19T15:00:00.000Z",
  });
  await gateway.voidNativeShippingLabel({ orderId: 3112, eventId, labelId: "se-label-1" });

  assert.deepEqual(requests.map((request) => request.path), [
    "/wp-json/phaseone-ops/v1/orders/3112/shipping-label",
    "/wp-json/phaseone-ops/v1/orders/3112/shipping-label/void",
  ]);
  assert.ok(requests.every((request) => request.method === "POST" && request.key === "ck_test"));
  assert.equal(requests[0]?.body.tracking_number, "1ZSAFE");
  assert.equal(requests[1]?.body.label_id, "se-label-1");
});

test("sends marketing email only through the protected WordPress SMTP bridge", async () => {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown>; key: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({
      path: url.pathname,
      method: init?.method || "GET",
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
      key: headers.get("x-phaseone-consumer-key"),
    });
    return new Response(JSON.stringify({
      state: "sent", sentAt: "2026-10-26T15:00:00Z", replayed: false,
      message: "Accepted by WordPress SMTP",
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const result = await gateway.sendMarketingEmail({
    eventId: "11111111-1111-4111-8111-111111111111",
    recipient: "subscriber@example.test",
    subject: "Phase One update",
    html: "<p>Safe email</p>",
    text: "Safe email",
    unsubscribeUrl: "https://phaseonelabz.is/api/public/marketing/unsubscribe?token=safe",
  });

  assert.equal(result.state, "sent");
  assert.equal(result.sentAt, "2026-10-26T15:00:00.000Z");
  assert.equal(requests[0]?.path, "/wp-json/phaseone-ops/v1/marketing/email");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.key, "ck_test");
  assert.equal(requests[0]?.body.eventId, "11111111-1111-4111-8111-111111111111");
  assert.equal(requests[0]?.body.recipient, "subscriber@example.test");
  assert.equal(requests[0]?.body.unsubscribeUrl, "https://phaseonelabz.is/api/public/marketing/unsubscribe?token=safe");
});

test("repeats an order idempotently and generates a customer recovery link through the protected bridge", async () => {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown>; key: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({
      path: url.pathname,
      method: init?.method || "GET",
      body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
      key: headers.get("x-phaseone-consumer-key"),
    });
    if (url.pathname.endsWith("/repeat")) {
      return new Response(JSON.stringify({ created: true, order_id: 4100 }), { status: 201 });
    }
    if (url.pathname.endsWith("/password-reset-link")) {
      return new Response(JSON.stringify({
        url: "https://staging.phaseonelabz.com/wp-login.php?action=rp&key=one-use&login=customer",
        expires_at: "2026-10-27T10:00:00Z",
      }), { status: 201 });
    }
    return new Response(JSON.stringify({
      id: 4100,
      customer_id: 22,
      number: "4100",
      status: "processing",
      currency: "USD",
      total: "0.00",
      payment_method: "phaseone_operational_repeat",
      payment_method_title: "Operational repeat · no new charge",
      date_created_gmt: "2026-10-26T10:00:00Z",
      date_paid_gmt: "2026-10-26T10:00:00Z",
      billing: { first_name: "Ana", last_name: "Test", email: "ana@example.test" },
      shipping: { first_name: "Ana", last_name: "Test" },
      line_items: [{ id: 1, product_id: 20, variation_id: 0, name: "KPV", sku: "KPV", quantity: 1, total: "0.00" }],
      meta_data: [
        { key: "_phaseone_operational_repeat", value: "yes" },
        { key: "_phaseone_repeated_from_order_id", value: "3180" },
      ],
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);
  const requestId = "11111111-1111-4111-8111-111111111111";

  const repeated = await gateway.repeatOrder(3180, requestId, "Administrator");
  const recovery = await gateway.generateCustomerPasswordResetLink(22);

  assert.equal(repeated.id, 4100);
  assert.equal(repeated.repeatOperations.operationalRepeat, true);
  assert.equal(repeated.repeatOperations.sourceOrderId, 3180);
  assert.equal(recovery.url, "https://phaseonelabz.com/set-password/?key=one-use&login=customer");
  assert.equal(recovery.expiresAt, "2026-10-27T10:00:00.000Z");
  assert.deepEqual(requests.map((request) => request.path), [
    "/wp-json/phaseone-ops/v1/orders/3180/repeat",
    "/wp-json/wc/v3/orders/4100",
    "/wp-json/phaseone-ops/v1/customers/22/password-reset-link",
  ]);
  assert.equal(requests[0]?.body.request_id, requestId);
  assert.equal(requests[0]?.key, "ck_test");
  assert.equal(requests[2]?.key, "ck_test");
});

test("publishes Site Controls through the protected operations bridge", async () => {
  const requests: Array<{ path: string; method: string; key: string | null; secret: string | null; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({
      path: url.pathname,
      method: init?.method || "GET",
      key: headers.get("x-phaseone-consumer-key"),
      secret: headers.get("x-phaseone-consumer-secret"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      version: "1.7.0",
      promo: {
        enabled: true, type: "general", duration_minutes: 1_440, eyebrow: "NOTICE",
        title: "Operational update", info: "Storewide announcement", cta_label: "View details", cta_url: "/shop", product: null,
      },
      maintenance: { enabled: false, title: "Precision work in progress.", message: "We will be back shortly.", support_email: "support@example.test" },
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const controls = await gateway.saveSiteControls({
    promo: {
      enabled: true, type: "general", productId: 0, salePrice: 0, discountPercent: 0, sitewideLabel: "10% SITEWIDE",
      eyebrow: "NOTICE", title: "Operational update", info: "Storewide announcement", ctaLabel: "View details",
      ctaUrl: "/shop", durationDays: 1, durationHours: 0, durationMinutes: 0, restart: true,
    },
    maintenance: {
      enabled: false, title: "Precision work in progress.", message: "We will be back shortly.", supportEmail: "support@example.test",
    },
  });

  assert.equal(controls.promo.type, "general");
  assert.equal(controls.promo.durationMinutes, 1_440);
  assert.equal(requests[0]?.path, "/wp-json/phaseone-ops/v1/site-controls");
  assert.equal(requests[0]?.method, "PUT");
  assert.equal(requests[0]?.key, "ck_test");
  assert.equal(requests[0]?.secret, "cs_test");
  assert.equal(((requests[0]?.body as Record<string, unknown>).promo as Record<string, unknown>).restart, true);
});

test("loads and publishes governed loyalty economics through the protected bridge", async () => {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null; key: string | null }> = [];
  const responsePayload = {
    version: "1.3.0",
    settings: {
      earning_enabled: true, redemption_enabled: true, points_per_currency: 2,
      redemption_block_points: 400, redemption_block_credit: 5,
      minimum_order_amount: 25, maximum_points_per_order: 500,
      include_shipping: false, include_tax: false, rounding: "floor",
      award_statuses: ["processing", "completed"],
    },
    metrics: {
      customers: 1855, members_with_points: 532, points_outstanding: 101107,
      store_credit_outstanding: 15, redeemable_credit_liability: 1260,
    },
    audit: [{
      id: "audit-1", created_at: "2026-10-15T10:00:00", actor_name: "Administrator",
      reason: "Improve retention", before: { earning_enabled: true, redemption_enabled: true, points_per_currency: 1, redemption_block_points: 500, redemption_block_credit: 5, award_statuses: ["completed"] },
      after: { earning_enabled: true, redemption_enabled: true, points_per_currency: 2, redemption_block_points: 400, redemption_block_credit: 5, award_statuses: ["processing", "completed"] },
    }],
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({
      path: url.pathname,
      method: init?.method || "GET",
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
      key: headers.get("x-phaseone-consumer-key"),
    });
    return new Response(JSON.stringify(responsePayload), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const loaded = await gateway.getRewardControl();
  assert.equal(loaded.settings.pointsPerCurrency, 2);
  assert.equal(loaded.metrics.redeemableCreditLiability, 1260);
  assert.equal(loaded.audit[0]?.reason, "Improve retention");

  await gateway.saveRewardSettings({
    settings: loaded.settings,
    reason: "Improve retention",
    confirmLiabilityChange: true,
  });
  assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT"]);
  assert.ok(requests.every((request) => request.path === "/wp-json/phaseone-ops/v1/rewards/settings"));
  assert.ok(requests.every((request) => request.key === "ck_test"));
  assert.equal(requests[1]?.body?.confirm_liability_change, true);
  assert.equal((requests[1]?.body?.settings as Record<string, unknown>).points_per_currency, 2);
});

test("sends audited customer point adjustments through the protected bridge", async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({
      customer: { id: 7, name: "Ana Lopez", email: "ana@example.test", points_balance: 425 },
      adjustment: { operation: "add", change: 100, balance_before: 325, balance_after: 425, reason: "Service recovery", email_sent: true },
    }), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example", consumerKey: "ck_test", consumerSecret: "cs_test",
  }, fetchImpl);

  const adjustment = await gateway.adjustCustomerPoints(7, {
    operation: "add", amount: 100, reason: "Service recovery", notifyCustomer: true,
  });

  assert.equal(adjustment.balanceAfter, 425);
  assert.equal(adjustment.emailSent, true);
  assert.equal(requests[0]?.path, "/wp-json/phaseone-ops/v1/customers/7/points");
  assert.equal(requests[0]?.body.notify_customer, true);
});

test("builds a complete customer directory with guests, orders and live rewards", async () => {
  const requestedPages: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname.endsWith("/customers/rewards")) {
      assert.equal(headers.get("x-phaseone-consumer-key"), "ck_test");
      return new Response(JSON.stringify({
        rewards: {
          7: {
            points_balance: 325,
            store_credit: 10,
            history: [{
              id: "event-1", change: 125, balance_before: 200, balance_after: 325,
              type: "order_earned", reason: "Points earned", created_at: "2026-10-14T10:00:00",
              context: { order_id: 501 },
            }],
            redemptions: [{ points: 500, credit: 5, created_at: "2026-10-01T09:00:00" }],
          },
        },
      }), { status: 200 });
    }
    const page = url.searchParams.get("page") || "1";
    requestedPages.push(`${url.pathname}:${page}`);
    if (page !== "1") return new Response("[]", { status: 200 });
    if (url.pathname.endsWith("/customers")) {
      return new Response(JSON.stringify([{
        id: 7,
        username: "ana",
        role: "customer",
        first_name: "Ana",
        last_name: "López",
        email: "ana@example.test",
        date_created_gmt: "2026-01-05T10:00:00",
        is_paying_customer: true,
        billing: { first_name: "Ana", last_name: "López", email: "ana@example.test", phone: "+1 555 0100", city: "Miami", country: "US" },
        shipping: { first_name: "Ana", last_name: "López", city: "Miami", country: "US" },
      }]), { status: 200 });
    }
    return new Response(JSON.stringify([{
      id: 501, customer_id: 7, number: "501", status: "completed", currency: "USD", total: "80",
      date_created_gmt: "2026-10-14T10:00:00", payment_method_title: "Card",
      billing: { first_name: "Ana", last_name: "López", email: "ana@example.test", phone: "+1 555 0100", city: "Miami", country: "US" },
      line_items: [{ product_id: 22, name: "Research Vial", sku: "RV-10", quantity: 2, total: "80" }],
      meta_data: [{ key: "_lab_points_awarded", value: "yes" }, { key: "_lab_points_earned", value: "125" }],
    }, {
      id: 502, customer_id: 0, number: "502", status: "processing", currency: "USD", total: "50",
      date_created_gmt: "2026-10-13T10:00:00", payment_method_title: "Zelle",
      billing: { first_name: "Guest", last_name: "Buyer", email: "guest@example.test", city: "Orlando", country: "US" },
      line_items: [{ product_id: 23, name: "Research Kit", sku: "RK-1", quantity: 1, total: "50" }],
      meta_data: [{ key: "_lab_points_earned", value: "50" }],
    }]), { status: 200 });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const directory = await gateway.getCustomerDirectory();

  assert.equal(directory.customers.length, 2);
  assert.equal(directory.totals.registeredCustomers, 1);
  assert.equal(directory.totals.guestBuyers, 1);
  assert.equal(directory.totals.orders, 2);
  assert.equal(directory.totals.lifetimeRevenue, 130);
  const registered = directory.customers.find((customer) => customer.id === 7);
  assert.equal(registered?.orderCount, 1);
  assert.equal(registered?.pointsEarned, 125);
  assert.equal(registered?.pointsBalance, 325);
  assert.equal(registered?.storeCredit, 10);
  assert.equal(registered?.rewardHistory[0]?.orderId, 501);
  assert.equal(directory.customers.find((customer) => customer.accountType === "guest")?.email, "guest@example.test");
  assert.ok(requestedPages.some((value) => value.endsWith("/customers:1")));
  assert.ok(requestedPages.some((value) => value.endsWith("/orders:1")));
  assert.equal(requestedPages.some((value) => value.endsWith(":2")), false);
});

test("uses WordPress pagination headers without probing nonexistent customer pages", async () => {
  const customerPages: number[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/customers/rewards")) {
      return new Response(JSON.stringify({ rewards: {} }), { status: 200 });
    }
    if (url.pathname.endsWith("/orders")) {
      return new Response("[]", { status: 200, headers: { "X-WP-TotalPages": "0" } });
    }
    const page = Number(url.searchParams.get("page") || "1");
    customerPages.push(page);
    const count = page < 3 ? 100 : 50;
    const offset = (page - 1) * 100;
    const customers = Array.from({ length: count }, (_, index) => ({
      id: offset + index + 1,
      username: `customer-${offset + index + 1}`,
      role: "customer",
      first_name: "Customer",
      last_name: String(offset + index + 1),
      email: `customer-${offset + index + 1}@example.test`,
      date_created_gmt: "2026-01-05T10:00:00",
      billing: {},
      shipping: {},
    }));
    return new Response(JSON.stringify(customers), {
      status: 200,
      headers: { "X-WP-TotalPages": "3" },
    });
  };
  const gateway = new WooCommerceGateway({
    baseUrl: "https://shop.example",
    consumerKey: "ck_test",
    consumerSecret: "cs_test",
  }, fetchImpl);

  const directory = await gateway.getCustomerDirectory();

  assert.equal(directory.customers.length, 250);
  assert.deepEqual(customerPages.sort((left, right) => left - right), [1, 2, 3]);
});
