import assert from "node:assert/strict";
import test from "node:test";

import {
  coaLaboratoryFromLink,
  coaSourceFingerprint,
  draftCoaNumber,
  importedCoaId,
  normalizedCoaLink,
  normalizeCoaStatus,
  safePdfFileName,
  uniqueTextList,
} from "../src/server/coaLibrary.js";
import type { CommerceCoa } from "../src/server/wooCommerceGateway.js";

test("known vial QR URLs normalize to one secure identity", () => {
  assert.equal(
    normalizedCoaLink(" http://portal.ils-lab.com/verify/MkH533f-jOUYkKsp/ "),
    "https://portal.ils-lab.com/verify/MkH533f-jOUYkKsp",
  );
  assert.equal(
    normalizedCoaLink("https://koveralabs.com/#/verify?t=50b6901a3b56c532f05f2c1a"),
    "https://koveralabs.com/#/verify?t=50b6901a3b56c532f05f2c1a",
  );
  assert.throws(() => normalizedCoaLink("http://untrusted.example/report"), /HTTPS/);
  assert.throws(() => normalizedCoaLink("not-a-link"), /valid/);
});

test("laboratory names are inferred without fetching untrusted pages", () => {
  assert.equal(coaLaboratoryFromLink("https://portal.ils-lab.com/verify/abc"), "ILS Labs");
  assert.equal(coaLaboratoryFromLink("https://coas.freedomdiagnosticstesting.com/a.pdf"), "Freedom Diagnostics");
  assert.equal(coaLaboratoryFromLink("https://koveralabs.com/#/verify?t=abc"), "Kovera Labs");
  assert.equal(coaLaboratoryFromLink("https://reports.example.org/report.pdf"), "reports.example.org");
});

test("draft identities and fingerprints are deterministic and tamper sensitive", () => {
  const link = "https://portal.ils-lab.com/verify/abc";
  assert.equal(coaSourceFingerprint(link), coaSourceFingerprint(link));
  assert.notEqual(coaSourceFingerprint(link), coaSourceFingerprint(`${link}2`));
  assert.match(draftCoaNumber(link), /^DRAFT-[A-F0-9]{12}$/);
});

test("legacy identities remain stable so history imports are idempotent", () => {
  const legacy = { id: "coa-existing-49", wpPostId: 49 } as CommerceCoa;
  assert.equal(importedCoaId(legacy), "coa-existing-49");
  assert.equal(importedCoaId({ ...legacy, id: "" }), "wp-49");
});

test("status and list inputs are normalized for the public publication gate", () => {
  assert.equal(normalizeCoaStatus("publish"), "Available");
  assert.equal(normalizeCoaStatus("ARCHIVED"), "Archived");
  assert.equal(normalizeCoaStatus("draft"), "Review");
  assert.deepEqual(uniqueTextList([" P1-10 ", "P1-10", "", 1, "P1-20"]), ["P1-10", "P1-20"]);
});

test("uploaded PDF names cannot inject paths or response headers", () => {
  assert.equal(safePdfFileName("../lot\r\ncertificate"), "..-lot-certificate.pdf");
  assert.equal(safePdfFileName("report.PDF"), "report.PDF");
});
