import assert from "node:assert/strict";
import test from "node:test";

import { resolveExternalCoaQr } from "../src/server/coaExternalQrResolver.js";
import type { CommerceCoa } from "../src/server/wooCommerceGateway.js";

function coa(overrides: Partial<CommerceCoa> = {}): CommerceCoa {
  return {
    id: "coa-2026-gi8-sm",
    wpPostId: 100,
    matchedProductId: 534,
    matchedVariationId: 650,
    coaNumber: "COA-2026-GI8-SM",
    productName: "PL-RT - 10MG",
    compound: "PL-RT",
    familyName: "PL-RT",
    familyKey: "pl-rt",
    skus: ["R3TA-10MG"],
    strength: "10 mg",
    batch: "P1-10RT06",
    lot: "P1-10RT06",
    date: "2026-07-17",
    status: "Available",
    purity: "99.58%",
    laboratory: "ILS Labs",
    method: "HPLC",
    tested: "Full QC Panel",
    currentShippingLot: false,
    fileUrl: "https://files.ils-lab.com/coa-pdfs/phase-one-labz-P1-10RT06-o_b3Th.pdf",
    externalFileUrl: "",
    verifyUrl: "https://files.ils-lab.com/coa-pdfs/phase-one-labz-P1-10RT06-o_b3Th.pdf",
    fileAttachmentId: 0,
    aliases: [],
    keywords: [],
    panelTypes: [],
    currentCoa: {
      version: "1", label: "Current", date: "2026-07-17", purity: "99.58%",
      method: "HPLC", tested: "Full QC Panel", verifyUrl: "", fileUrl: "", fileAttachmentId: 0,
      currentShippingLot: false,
    },
    history: [],
    historyCount: 0,
    ...overrides,
  };
}

function ilsResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    result: {
      data: {
        json: {
          product: "Retatrutide",
          lotNumber: "P1-10RT06",
          concentration: "10mg",
          coaNumber: "COA-2026-GI8-SM",
          pdfUrl: "https://files.ils-lab.com/coa-pdfs/phase-one-labz-P1-10RT06-o_b3Th.pdf",
          ...overrides,
        },
      },
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("resolves a new ILS vial QR only after the public result matches a governed COA", async () => {
  let requestedUrl = "";
  const result = await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/OvcWN_fh0ANZIlJe",
    coas: [coa()],
    fetchImpl: (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return ilsResponse();
    }) as typeof fetch,
  });
  assert.match(requestedUrl, /publicCoa\.getByQrCode/);
  assert.match(decodeURIComponent(requestedUrl), /OvcWN_fh0ANZIlJe/);
  assert.deepEqual(result, {
    coaReference: "COA-2026-GI8-SM",
    provider: "ils",
    coaNumber: "COA-2026-GI8-SM",
    pdfUrl: "https://files.ils-lab.com/coa-pdfs/phase-one-labz-P1-10RT06-o_b3Th.pdf",
  });
});

test("never trusts an external ILS response that is absent or ambiguous locally", async () => {
  const fetchImpl = (async () => ilsResponse()) as typeof fetch;
  assert.equal(await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/new-token",
    coas: [coa({ id: "other", coaNumber: "OTHER", fileUrl: "https://files.ils-lab.com/other.pdf", verifyUrl: "" })],
    fetchImpl,
  }), null);
  assert.equal(await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/new-token",
    coas: [coa(), coa({ id: "duplicate" })],
    fetchImpl,
  }), null);
});

test("does not make network requests for unapproved QR hosts", async () => {
  let called = false;
  const result = await resolveExternalCoaQr({
    rawValue: "https://evil.example/verify/OvcWN_fh0ANZIlJe",
    coas: [coa()],
    fetchImpl: (async () => { called = true; return ilsResponse(); }) as typeof fetch,
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test("Reta 20 resolves by exact lot, product and concentration when ILS changes its references", async () => {
  const reta20 = coa({
    id: "coa-2026-g3bydj",
    matchedVariationId: 649,
    coaNumber: "COA-2026-G3BYDJ",
    productName: "PL-RT - 20MG",
    compound: "Retatrutide",
    familyName: "Retatrutide",
    strength: "20 mg",
    batch: "P1-20RT06",
    lot: "P1-20RT06",
    fileUrl: "https://phaseonelabz.is/api/public/v1/coas/coa-2026-g3bydj/document",
    externalFileUrl: "https://staging.phaseonelabz.com/legacy/reta-20.pdf",
    verifyUrl: "https://files.ils-lab.com/coa-pdfs/legacy-reta-20.pdf",
  });
  const result = await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/reta20-token",
    coas: [coa(), reta20],
    fetchImpl: (async () => ilsResponse({
      coaNumber: "",
      pdfUrl: "https://files.ils-lab.com/coa-pdfs/new-provider-name.pdf",
      product: "Retatrutide",
      lotNumber: "P1-20RT06",
      concentration: "20mg",
    })) as typeof fetch,
  });
  assert.equal(result?.coaReference, "COA-2026-G3BYDJ");
});

test("Reta 20 can never fall through to another strength with a shared product family", async () => {
  const result = await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/reta20-token",
    coas: [coa()],
    fetchImpl: (async () => ilsResponse({
      coaNumber: "",
      pdfUrl: "",
      product: "Retatrutide",
      lotNumber: "P1-10RT06",
      concentration: "20mg",
    })) as typeof fetch,
  });
  assert.equal(result, null);
});

test("ILS transient failures retry once before rejecting a new vial QR", async () => {
  let calls = 0;
  const result = await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/OvcWN_fh0ANZIlJe",
    coas: [coa()],
    fetchImpl: (async () => {
      calls += 1;
      return calls === 1 ? new Response("temporarily unavailable", { status: 503 }) : ilsResponse();
    }) as typeof fetch,
  });
  assert.equal(calls, 2);
  assert.equal(result?.coaReference, "COA-2026-GI8-SM");
});

test("ILS connection interruptions retry once before rejecting a new vial QR", async () => {
  let calls = 0;
  const result = await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/OvcWN_fh0ANZIlJe",
    coas: [coa()],
    fetchImpl: (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("temporary network interruption");
      return ilsResponse();
    }) as typeof fetch,
  });
  assert.equal(calls, 2);
  assert.equal(result?.coaReference, "COA-2026-GI8-SM");
});
