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
