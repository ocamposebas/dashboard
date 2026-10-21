import assert from "node:assert/strict";
import test from "node:test";

import type { CommerceCoa } from "../src/server/wooCommerceGateway.js";
import {
  canonicalizeCoaScanValue,
  coaScanProvider,
  coaScanIdentity,
  resolveCoaQrScan,
} from "../src/server/coaScanResolver.js";

function coa(overrides: Partial<CommerceCoa> = {}): CommerceCoa {
  return {
    id: "coa-2026-gi8-sm",
    wpPostId: 100,
    matchedProductId: 534,
    matchedVariationId: 650,
    coaNumber: "COA-2026-GI8-SM",
    productName: "Retatrutide 10mg",
    compound: "Retatrutide",
    familyName: "Retatrutide",
    familyKey: "retatrutide",
    skus: ["P1-RT10"],
    strength: "10mg",
    batch: "P1-10RT06",
    lot: "P1-10RT06",
    date: "2026-10-13",
    status: "Available",
    purity: "99%",
    laboratory: "ILS",
    method: "HPLC",
    tested: "Identity and purity",
    currentShippingLot: true,
    fileUrl: "https://files.ils-lab.com/coa-pdfs/current.pdf",
    verifyUrl: "https://files.ils-lab.com/coa-pdfs/current.pdf",
    fileAttachmentId: 0,
    aliases: [],
    keywords: [],
    panelTypes: [],
    currentCoa: {
      version: "1",
      label: "Current",
      date: "2026-10-13",
      purity: "99%",
      method: "HPLC",
      tested: "Identity and purity",
      verifyUrl: "https://files.ils-lab.com/coa-pdfs/current.pdf",
      fileUrl: "https://files.ils-lab.com/coa-pdfs/current.pdf",
      fileAttachmentId: 0,
      currentShippingLot: true,
    },
    history: [],
    historyCount: 0,
    ...overrides,
  };
}

test("canonicalizes known lab redirects without losing QR identity", () => {
  assert.equal(
    canonicalizeCoaScanValue(" http://portal.ils-lab.com/verify/MkH533f-jOUYkKsp/ "),
    "https://portal.ils-lab.com/verify/MkH533f-jOUYkKsp",
  );
  assert.equal(
    canonicalizeCoaScanValue("https://koveralabs.com/#/verify?t=50b6901a3b56c532f05f2c1a"),
    "https://koveralabs.com/#/verify?t=50b6901a3b56c532f05f2c1a",
  );
  assert.equal(coaScanProvider("https://coas.freedomdiagnosticstesting.com/test.pdf"), "freedom-diagnostics");
  assert.equal(
    canonicalizeCoaScanValue("https://www.coas.freedomdiagnosticstesting.com/Phas2610050320.PDF?utm_source=qr"),
    "https://coas.freedomdiagnosticstesting.com/Phas2610050320.PDF",
  );
  assert.equal(
    coaScanIdentity("https://www.koveralabs.com/#/verify?code=50b6901a3b56c532f05f2c1a"),
    "kovera:50b6901a3b56c532f05f2c1a",
  );
  assert.notEqual(
    coaScanIdentity("https://unknown.example/Phas2610050320.pdf"),
    coaScanIdentity("https://coas.freedomdiagnosticstesting.com/Phas2610050320.pdf"),
  );
});

test("resolves a current COA URL directly from governed catalog data", () => {
  const koveraUrl = "https://koveralabs.com/#/verify?t=50b6901a3b56c532f05f2c1a";
  const result = resolveCoaQrScan({
    rawValue: koveraUrl,
    coas: [coa({
      id: "kovera-coa",
      coaNumber: "CP10-03262026",
      matchedProductId: 700,
      matchedVariationId: 701,
      lot: "CP10-03262026",
      batch: "CP10-03262026",
      verifyUrl: koveraUrl,
      currentCoa: { ...coa().currentCoa, verifyUrl: koveraUrl },
    })],
  });
  assert.equal(result?.type, "batch");
  assert.equal(result?.productId, 700);
  assert.equal(result?.variationId, 701);
  assert.equal(result?.lot, "CP10-03262026");
});

test("resolves a printed ILS portal QR through its registered COA alias", () => {
  const rawValue = "http://portal.ils-lab.com/verify/MkH533f-jOUYkKsp";
  const result = resolveCoaQrScan({
    rawValue,
    coas: [coa()],
    registeredIdentifier: {
      canonicalValue: "https://portal.ils-lab.com/verify/MkH533f-jOUYkKsp",
      rawValue,
      coaReference: "COA-2026-GI8-SM",
      provider: "ils",
      active: true,
      createdBy: "test",
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    },
  });
  assert.equal(result?.coaId, "coa-2026-gi8-sm");
  assert.equal(result?.lot, "P1-10RT06");
  assert.equal(result?.barcodeValue, rawValue);
});

test("resolves the original laboratory URL after the COA document is copied into the custom library", () => {
  const rawValue = "https://coas.freedomdiagnosticstesting.com/Phas2610050320.pdf";
  const result = resolveCoaQrScan({
    rawValue,
    coas: [coa({
      id: "phas2610050320",
      matchedProductId: 539,
      matchedVariationId: 2847,
      coaNumber: "Phas2610050320",
      productName: "KPV - 30MG",
      lot: "P1KPV30",
      batch: "P1KPV30",
      fileUrl: "https://phaseonelabz.is/api/public/v1/coas/phas2610050320/document",
      externalFileUrl: rawValue,
      verifyUrl: "",
      currentShippingLot: false,
    })],
  });

  assert.equal(result?.coaId, "phas2610050320");
  assert.equal(result?.variationId, 2847);
  assert.equal(result?.lot, "P1KPV30");
});

test("accepts safe Freedom URL variants and ignores a stale alias when the governed URL is unique", () => {
  const stored = "https://coas.freedomdiagnosticstesting.com/Phas2610050320.pdf";
  const scanned = "http://www.coas.freedomdiagnosticstesting.com/Phas2610050320.PDF?source=vial";
  const result = resolveCoaQrScan({
    rawValue: scanned,
    coas: [coa({
      id: "phas2610050320",
      coaNumber: "Phas2610050320",
      matchedProductId: 539,
      matchedVariationId: 2847,
      lot: "P1KPV30",
      batch: "P1KPV30",
      externalFileUrl: stored,
      verifyUrl: stored,
    })],
    registeredIdentifier: {
      canonicalValue: canonicalizeCoaScanValue(scanned)!,
      rawValue: scanned,
      coaReference: "a-stale-reference",
      provider: "freedom-diagnostics",
      active: true,
      createdBy: "test",
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    },
  });
  assert.equal(result?.coaId, "phas2610050320");
  assert.equal(result?.variationId, 2847);
});

test("fails closed when a registered alias conflicts with a different governed COA", () => {
  const rawValue = "https://coas.freedomdiagnosticstesting.com/Phas2610050320.pdf";
  const direct = coa({ id: "direct", coaNumber: "Phas2610050320", verifyUrl: rawValue });
  const registered = coa({ id: "registered", coaNumber: "OTHER-COA", verifyUrl: "https://lab.example/other" });
  assert.equal(resolveCoaQrScan({
    rawValue,
    coas: [direct, registered],
    registeredIdentifier: {
      canonicalValue: rawValue,
      rawValue,
      coaReference: registered.coaNumber,
      provider: "freedom-diagnostics",
      active: true,
      createdBy: "test",
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-17T00:00:00.000Z",
    },
  }), null);
});

test("unknown, ambiguous and historical URLs fail closed", () => {
  assert.equal(resolveCoaQrScan({ rawValue: "https://unknown.example/coa/1", coas: [coa()] }), null);
  const repeated = coa({ verifyUrl: "https://lab.example/duplicate" });
  assert.equal(resolveCoaQrScan({
    rawValue: "https://lab.example/duplicate",
    coas: [repeated, coa({ id: "duplicate", verifyUrl: repeated.verifyUrl })],
  }), null);
  assert.equal(resolveCoaQrScan({
    rawValue: "https://lab.example/old",
    coas: [coa({ history: [{
      version: "old", label: "Old", date: "", purity: "", method: "", tested: "",
      verifyUrl: "https://lab.example/old", fileUrl: "",
    }] })],
  }), null);
});
