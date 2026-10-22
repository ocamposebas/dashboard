import assert from "node:assert/strict";
import test from "node:test";

import { ShipStationGateway } from "../src/server/shipStationGateway.js";

test("ShipStation V2 uses a server-side API-Key header for read-only account discovery", async () => {
  const secret = "server-only-shipstation-key";
  const requests: Array<{ url: string; method: string; apiKey: string | null; body: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      method: init?.method || "GET",
      apiKey: headers.get("api-key"),
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (url.includes("/carriers")) {
      return new Response(JSON.stringify({
        carriers: [{
          carrier_id: "se-ups",
          carrier_code: "ups",
          friendly_name: "UPS",
          nickname: "Main account",
          services: [{ service_code: "ups_ground", name: "UPS Ground", domestic: true }],
        }],
      }), { status: 200 });
    }
    if (url.includes("/warehouses")) {
      return new Response(JSON.stringify({
        warehouses: [{
          warehouse_id: "se-origin",
          name: "Main warehouse",
          origin_address: {
            city_locality: "Miami",
            state_province: "FL",
            postal_code: "33101",
            country_code: "US",
          },
        }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      shipment_id: "se-shipment-rate-10",
      rate_response: { rates: [{
        rate_id: "se-rate-10",
        rate_type: "shipment",
        carrier_id: "se-ups",
        carrier_code: "ups",
        carrier_friendly_name: "UPS",
        service_code: "ups_ground",
        service_type: "UPS Ground",
        shipping_amount: { amount: 10.25, currency: "USD" },
        insurance_amount: { amount: 0, currency: "USD" },
        confirmation_amount: { amount: 0, currency: "USD" },
        other_amount: { amount: 1.5, currency: "USD" },
        delivery_days: 4,
        guaranteed_service: false,
        estimated_delivery_date: "2026-10-20T00:00:00.000Z",
      }] },
    }), { status: 200 });
  };
  const gateway = new ShipStationGateway(
    { apiKey: secret, rateMode: "live", warehouseId: "se-origin", labelPurchaseEnabled: false },
    fetchImpl,
    "https://shipstation.example/v2",
  );

  const capabilities = await gateway.capabilities();
  const rates = await gateway.rates({
    carrierIds: ["se-ups"],
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    destination: {
      name: "Test Customer", company: "", address1: "100 Test Street", address2: "",
      city: "Orlando", state: "FL", postalCode: "32801", countryCode: "US", phone: "",
    },
    externalShipmentId: "p1-11111111-1111-4111-8111-111111111111",
    orderNumber: "3112",
  });

  assert.equal(capabilities.connected, true);
  assert.equal(capabilities.carriers[0]?.services[0]?.code, "ups_ground");
  assert.equal(capabilities.originName, "Main warehouse");
  assert.equal(rates[0]?.amount, 11.75);
  assert.equal(rates[0]?.shipmentId, "se-shipment-rate-10");
  assert.equal(rates[0]?.isEstimate, false);
  assert.ok(requests.every((request) => request.apiKey === secret));
  assert.ok(requests.every((request) => !request.url.includes(secret) && !request.body.includes(secret)));
  const rateRequest = requests.find((request) => request.url.endsWith("/rates"));
  assert.equal(rateRequest?.method, "POST");
  const rateBody = JSON.parse(rateRequest?.body || "{}");
  assert.equal(rateBody.rate_options.rate_type, "shipment");
  assert.equal(rateBody.shipment.warehouse_id, "se-origin");
  assert.equal(rateBody.shipment.external_shipment_id, "p1-11111111-1111-4111-8111-111111111111");
  assert.equal(rateBody.shipment.ship_to.address_line1, "100 Test Street");
});

test("real label creation is fail-closed behind the server flag", async () => {
  let requested = false;
  const gateway = new ShipStationGateway({
    apiKey: "server-only-key",
    rateMode: "live",
    labelPurchaseEnabled: false,
  }, async () => {
    requested = true;
    return new Response("{}", { status: 200 });
  }, "https://shipstation.example/v2");

  await assert.rejects(
    gateway.purchaseLabelFromRate("se-rate-10"),
    (error: unknown) => error instanceof Error && /disabled/.test(error.message),
  );
  assert.equal(requested, false);
});

test("prepared label creation and reconciliation use only the documented endpoints with mocked fetch", async () => {
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const labelResponse = {
    label_id: "se-label-20",
    shipment_id: "se-shipment-20",
    status: "completed",
    tracking_number: "1ZTEST20",
    carrier_id: "se-ups",
    carrier_code: "ups",
    service_code: "ups_ground",
    shipment_cost: { amount: 11.75, currency: "usd" },
    label_download: { pdf: "https://api.shipstation.com/v2/downloads/test/label.pdf" },
  };
  const gateway = new ShipStationGateway({
    apiKey: "server-only-key",
    rateMode: "live",
    labelPurchaseEnabled: true,
  }, async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method || "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (String(input).endsWith("/void")) {
      return new Response(JSON.stringify({ approved: true, message: "Refund requested" }), { status: 200 });
    }
    return String(input).includes("?rate_id=")
      ? new Response(JSON.stringify({ labels: [labelResponse] }), { status: 200 })
      : new Response(JSON.stringify(labelResponse), { status: 200 });
  }, "https://shipstation.example/v2");

  const created = await gateway.purchaseLabelFromRate("se-rate-20");
  const reconciled = await gateway.findLabelsByRateId("se-rate-20");
  const current = await gateway.getLabelById("se-label-20");
  const voided = await gateway.voidLabel("se-label-20");

  assert.equal(created.labelId, "se-label-20");
  assert.equal(reconciled[0]?.trackingNumber, "1ZTEST20");
  assert.equal(current.labelId, "se-label-20");
  assert.equal(voided.approved, true);
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.url || "", /\/labels\/rates\/se-rate-20$/);
  assert.deepEqual(JSON.parse(requests[0]?.body || "{}"), {
    label_format: "pdf",
    label_layout: "4x6",
    label_download_type: "url",
  });
  assert.equal(requests[1]?.method, "GET");
  assert.match(requests[1]?.url || "", /\/labels\?rate_id=se-rate-20/);
  assert.match(requests[2]?.url || "", /\/labels\/se-label-20$/);
  assert.equal(requests[3]?.method, "PUT");
  assert.match(requests[3]?.url || "", /\/labels\/se-label-20\/void$/);
});

test("exported orders reconcile purchased labels by exact ShipStation order number", async () => {
  const requests: string[] = [];
  const labelResponse = {
    label_id: "se-label-existing",
    shipment_id: "se-shipment-existing",
    status: "completed",
    tracking_number: "TRACK-EXISTING",
    carrier_id: "se-fedex",
    carrier_code: "fedex",
    service_code: "fedex_ground",
    shipment_cost: { amount: 12.5, currency: "usd" },
    label_download: { pdf: "https://api.shipstation.com/v2/downloads/existing.pdf" },
  };
  const gateway = new ShipStationGateway({
    apiKey: "server-only-key", rateMode: "live", labelPurchaseEnabled: true,
  }, async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/shipments?")) {
      return new Response(JSON.stringify({ shipments: [{
        shipment_id: "se-shipment-existing",
        shipment_number: "3145",
        shipment_status: "label_purchased",
      }, {
        shipment_id: "se-other",
        shipment_number: "13145",
        shipment_status: "label_purchased",
      }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ labels: [labelResponse] }), { status: 200 });
  }, "https://shipstation.example/v2");

  const labels = await gateway.findPurchasedLabelsByOrderNumber("#3145");
  assert.equal(labels.length, 1);
  assert.equal(labels[0]?.trackingNumber, "TRACK-EXISTING");
  assert.match(requests[0] || "", /shipment_number=3145/);
  assert.equal(requests.filter((url) => url.includes("/labels?")).length, 1);
});

test("an exported pending shipment does not pretend postage was purchased", async () => {
  const requests: string[] = [];
  const gateway = new ShipStationGateway({
    apiKey: "server-only-key", rateMode: "live", labelPurchaseEnabled: true,
  }, async (input) => {
    const url = String(input);
    requests.push(url);
    return new Response(JSON.stringify({ shipments: [{
      shipment_id: "se-shipment-pending",
      shipment_number: "3145",
      shipment_status: "pending",
    }] }), { status: 200 });
  }, "https://shipstation.example/v2");

  assert.deepEqual(await gateway.findPurchasedLabelsByOrderNumber("3145"), []);
  assert.equal(requests.length, 1);
  assert.equal(requests.some((url) => url.includes("/labels?")), false);
});

test("live label PDFs are proxied only from the trusted ShipStation download host", async () => {
  let requests = 0;
  const gateway = new ShipStationGateway({
    apiKey: "server-only-key", rateMode: "live", labelPurchaseEnabled: true,
  }, async () => {
    requests += 1;
    return new Response(new TextEncoder().encode("%PDF-1.4\nmock label"), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
  });
  const bytes = await gateway.downloadLabelPdf("https://api.shipstation.com/v2/downloads/example/label.pdf");
  assert.equal(new TextDecoder().decode(bytes).startsWith("%PDF-"), true);
  await assert.rejects(
    gateway.downloadLabelPdf("https://example.com/v2/downloads/example/label.pdf"),
    /not trusted/,
  );
  assert.equal(requests, 1);
});

test("a missing or rejected ShipStation credential fails closed without exposing it", async () => {
  let requested = false;
  const missing = new ShipStationGateway({ rateMode: "live", labelPurchaseEnabled: false }, async () => {
    requested = true;
    return new Response("{}", { status: 200 });
  }, "https://shipstation.example/v2");
  const missingStatus = await missing.capabilities();
  assert.equal(missingStatus.connected, false);
  assert.equal(missingStatus.credentialConfigured, false);
  assert.equal(requested, false);

  const secret = "rejected-server-secret";
  const rejected = new ShipStationGateway({ apiKey: secret, rateMode: "live", labelPurchaseEnabled: false }, async () =>
    new Response(JSON.stringify({ message: `bad ${secret}` }), { status: 401 }),
  "https://shipstation.example/v2");
  const rejectedStatus = await rejected.capabilities();
  assert.equal(rejectedStatus.connected, false);
  assert.equal(JSON.stringify(rejectedStatus).includes(secret), false);
  assert.match(rejectedStatus.error || "", /not accepted/);
});

test("local mock rates never call ShipStation and remain clearly identified", async () => {
  let requested = false;
  const gateway = new ShipStationGateway({ rateMode: "mock", labelPurchaseEnabled: false }, async () => {
    requested = true;
    return new Response("{}", { status: 500 });
  });
  const capabilities = await gateway.capabilities();
  const rates = await gateway.rates({
    carrierIds: capabilities.carriers.map((carrier) => carrier.id),
    package: { weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 },
    destination: { city: "Miami", state: "FL", postalCode: "33101", countryCode: "US" },
    externalShipmentId: "p1-11111111-1111-4111-8111-111111111111",
    orderNumber: "3112",
  });
  assert.equal(capabilities.dataMode, "mock");
  assert.equal(capabilities.labelPurchaseMode, "mock_only");
  assert.ok(rates.length >= 3);
  assert.ok(rates.every((rate) => rate.rateId.startsWith("mock-rate-") && rate.isEstimate));
  assert.equal(requested, false);
});

