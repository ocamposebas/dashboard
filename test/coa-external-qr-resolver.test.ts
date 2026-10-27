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

test("resolves a Bitly vial QR only through an approved lab redirect and an exact governed COA", async () => {
  const freedom = coa({
    id: "phas2610050320",
    coaNumber: "Phas2610050320",
    productName: "KPV - 30MG",
    matchedProductId: 548,
    matchedVariationId: 0,
    strength: "30 mg",
    batch: "P1-30KPV06",
    lot: "P1-30KPV06",
    fileUrl: "https://coas.freedomdiagnosticstesting.com/Phas2610050320.pdf",
    verifyUrl: "",
  });
  const result = await resolveExternalCoaQr({
    rawValue: "http://bit.ly/4i91CFV?utm_source=printed-label",
    coas: [freedom],
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.method, "HEAD");
      assert.equal(init?.redirect, "manual");
      assert.equal(String(url), "https://bit.ly/4i91CFV");
      return new Response(null, {
        status: 301,
        headers: { location: "https://coas.freedomdiagnosticstesting.com/Phas2610050320.pdf" },
      });
    }) as typeof fetch,
  });
  assert.deepEqual(result, {
    coaReference: "Phas2610050320",
    provider: "bitly-freedom-diagnostics",
    coaNumber: "Phas2610050320",
    pdfUrl: "https://coas.freedomdiagnosticstesting.com/Phas2610050320.pdf",
  });
});

test("resolves a Bitly Freedom QR by exact COA number when the governed file is a WordPress mirror", async () => {
  const freedom = coa({
    id: "phas2607280192",
    coaNumber: "Phas2607280192",
    productName: "GHK-Cu + KPV Blend",
    matchedProductId: 956,
    matchedVariationId: 0,
    strength: "60 mg",
    batch: "P1-BTY06",
    lot: "P1-BTY06",
    fileUrl: "https://staging.phaseonelabz.com/wp-content/uploads/GHkkpv-blendpdf.pdf",
    externalFileUrl: "https://staging.phaseonelabz.com/wp-content/uploads/GHkkpv-blendpdf.pdf",
    verifyUrl: "",
  });
  const result = await resolveExternalCoaQr({
    rawValue: "https://bit.ly/GhkKpv1",
    coas: [freedom],
    fetchImpl: (async () => new Response(null, {
      status: 301,
      headers: { location: "https://coas.freedomdiagnosticstesting.com/Phas2607280192.pdf" },
    })) as typeof fetch,
  });
  assert.equal(result?.coaReference, "Phas2607280192");
  assert.equal(result?.provider, "bitly-freedom-diagnostics");
});

test("recovers one incorrect Bitly letter case only when the approved destination is unique", async () => {
  const reta20 = coa({
    id: "coa-2026-g3bydj",
    coaNumber: "COA-2026-G3BYDJ",
    matchedVariationId: 649,
    productName: "PL-RT - 20MG",
    strength: "20 mg",
    batch: "P1-20RT06",
    lot: "P1-20RT06",
    fileUrl: "https://files.ils-lab.com/coa-pdfs/phase-one-labz-P1-20RT06-tbQ2t3.pdf",
    verifyUrl: "",
  });
  const requested: string[] = [];
  const result = await resolveExternalCoaQr({
    rawValue: "https://bit.ly/4xaRDcr",
    coas: [reta20],
    fetchImpl: (async (url: string | URL | Request) => {
      const value = String(url);
      requested.push(value);
      if (value === "https://bit.ly/4xarDcr") {
        return new Response(null, {
          status: 302,
          headers: { location: reta20.fileUrl },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch,
  });
  assert.ok(requested.includes("https://bit.ly/4xaRDcr"));
  assert.ok(requested.includes("https://bit.ly/4xarDcr"));
  assert.equal(result?.coaReference, "COA-2026-G3BYDJ");
  assert.equal(result?.provider, "bitly-external-lab");
});

test("fails closed when Bitly case recovery finds more than one approved destination", async () => {
  const result = await resolveExternalCoaQr({
    rawValue: "https://bit.ly/Abcd",
    coas: [coa()],
    fetchImpl: (async (url: string | URL | Request) => {
      const value = String(url);
      if (value === "https://bit.ly/abcd") {
        return new Response(null, { status: 302, headers: { location: coa().fileUrl } });
      }
      if (value === "https://bit.ly/ABcd") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://coas.freedomdiagnosticstesting.com/another.pdf" },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch,
  });
  assert.equal(result, null);
});

test("never follows a Bitly redirect outside the approved laboratory allowlist", async () => {
  let calls = 0;
  const result = await resolveExternalCoaQr({
    rawValue: "https://bit.ly/unsafe1",
    coas: [coa()],
    fetchImpl: (async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/phase-one.pdf" },
      });
    }) as typeof fetch,
  });
  assert.equal(calls, 1);
  assert.equal(result, null);
});

test("a Bitly redirect to an ILS portal QR still requires the ILS public record to match locally", async () => {
  const result = await resolveExternalCoaQr({
    rawValue: "https://bit.ly/KlowQr1",
    coas: [coa()],
    fetchImpl: (async (url: string | URL | Request) => {
      if (String(url).startsWith("https://bit.ly/")) {
        return new Response(null, {
          status: 301,
          headers: { location: "https://portal.ils-lab.com/verify/OvcWN_fh0ANZIlJe" },
        });
      }
      return ilsResponse();
    }) as typeof fetch,
  });
  assert.equal(result?.coaReference, "COA-2026-GI8-SM");
  assert.equal(result?.provider, "bitly-ils");
});

test("KLOW resolves by exact ILS certificate even when the provider reports concentration without units", async () => {
  const klow = coa({
    id: "coa-2026-_-jbhe",
    coaNumber: "COA-2026-_-JBHE",
    productName: "KLOW",
    compound: "KLOW",
    familyName: "KLOW",
    matchedProductId: 543,
    matchedVariationId: 0,
    strength: "82.65 mg",
    batch: "P1-80KLW06",
    lot: "P1-80KLW06",
    fileUrl: "https://files.ils-lab.com/coa-pdfs/phase-one-labz-P1-80KLW06-2PlSXg.pdf",
    verifyUrl: "",
  });
  const result = await resolveExternalCoaQr({
    rawValue: "https://portal.ils-lab.com/verify/DNTX5qKve5zHiJcA",
    coas: [coa(), klow],
    fetchImpl: (async () => ilsResponse({
      product: "KLOW",
      lotNumber: "P1-80KLW06",
      concentration: "80",
      coaNumber: "COA-2026-_-JBHE",
      pdfUrl: klow.fileUrl,
    })) as typeof fetch,
  });
  assert.equal(result?.coaReference, "COA-2026-_-JBHE");
});

test("SS-31 resolves the scanned lot and never another available SS-31 certificate", async () => {
  const freedom = coa({
    id: "phas2607310133",
    coaNumber: "Phas2607310133",
    productName: "SS-31",
    compound: "SS-31",
    familyName: "SS-31",
    matchedProductId: 586,
    matchedVariationId: 0,
    strength: "10 mg",
    batch: "P1-10SS07",
    lot: "P1-10SS07",
    fileUrl: "https://coas.freedomdiagnosticstesting.com/Phas2607310133.pdf",
    verifyUrl: "",
  });
  const ils = coa({
    id: "coa-2026-2dvylr",
    coaNumber: "COA-2026-2DVYLR",
    productName: "SS-31",
    compound: "SS-31",
    familyName: "SS-31",
    matchedProductId: 586,
    matchedVariationId: 0,
    strength: "10 mg",
    batch: "P1-SS-26",
    lot: "P1-SS-26",
    fileUrl: "https://files.ils-lab.com/coa-pdfs/phase-one-labz-P1-SS-26-y1Gmnq.pdf",
    verifyUrl: "",
  });
  const result = await resolveExternalCoaQr({
    rawValue: "https://bit.ly/Ss31Qr",
    coas: [freedom, ils],
    fetchImpl: (async () => new Response(null, {
      status: 302,
      headers: { location: freedom.fileUrl },
    })) as typeof fetch,
  });
  assert.equal(result?.coaReference, "Phas2607310133");
  assert.notEqual(result?.coaReference, "COA-2026-2DVYLR");
});
