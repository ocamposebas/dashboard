import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { analyzeCoaPdf, detectCoaAssays, detectCoaDate, detectCoaFields } from "../src/server/coaDocumentIntelligence.js";

test("detects the operational fields used to review a certificate", () => {
  const fields = detectCoaFields(`
Freedom Diagnostics
Certificate of Analysis Number: Phas2610130018
Product Name: Tesamorelin
Strength: 10 mg
Lot Number: TESA-2610-A
Report Date: 10/13/2026
Purity: 99.42%
Method: RP-HPLC and LC-MS
`);
  assert.equal(fields.coaNumber, "Phas2610130018");
  assert.equal(fields.productName, "Tesamorelin");
  assert.equal(fields.strength, "10 mg");
  assert.equal(fields.batch, "TESA-2610-A");
  assert.equal(fields.lot, "TESA-2610-A");
  assert.equal(fields.date, "2026-10-13");
  assert.equal(fields.purity, "99.42%");
  assert.equal(fields.laboratory, "Freedom Diagnostics");
  assert.match(fields.method, /HPLC/);
});

test("prefers the actual testing date over report and received dates", () => {
  const detection = detectCoaDate(`
Received: 10/10/2026
Reported: 10/13/2026
Test Date: 10/12/2026
`);
  assert.deepEqual(detection, {
    value: "2026-10-12",
    source: "test",
    label: "Test date",
    confidence: "explicit",
  });
});

test("marks a reported date as a review-only fallback", () => {
  assert.deepEqual(detectCoaDate("Reported: 10/13/2026\nReceived: 10/10/2026"), {
    value: "2026-10-13",
    source: "reported",
    label: "Reported date",
    confidence: "fallback",
  });
});

test("extracts text from a real PDF and never publishes it automatically", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText([
    "Kovera Labs",
    "COA Number: KOV-2026-0088",
    "Product: BPC-157",
    "Batch: BPC-A88",
    "Purity: 99.81%",
  ].join("\n"), { x: 48, y: 720, size: 12, font, lineHeight: 20 });
  const analysis = await analyzeCoaPdf(Buffer.from(await pdf.save()));
  assert.notEqual(analysis.status, "failed");
  assert.equal(analysis.fields.coaNumber, "KOV-2026-0088");
  assert.equal(analysis.fields.productName, "BPC-157");
  assert.equal(analysis.fields.batch, "BPC-A88");
  assert.equal(analysis.fields.purity, "99.81%");
  assert.equal(analysis.fields.laboratory, "Kovera Labs");
});

test("detects a structured laboratory testing panel and reported values", () => {
  const assays = detectCoaAssays(`
Fentanyl: Not Detected
Peptide Purity: 99.86%
Bacterial Endotoxin < 0.50 EU/mg
Heavy Metals: Pass
Sterility: Complies
Lead 0.02 ppm
`);
  assert.deepEqual(assays.find((assay) => assay.name === "Fentanyl"), {
    name: "Fentanyl", result: "Not Detected", unit: "", status: "pass",
  });
  assert.equal(assays.find((assay) => assay.name === "Peptide purity")?.result, "99.86%");
  assert.equal(assays.find((assay) => assay.name === "Bacterial endotoxins")?.result, "< 0.50 EU/mg");
  assert.equal(assays.find((assay) => assay.name === "Heavy metals")?.status, "pass");
  assert.equal(assays.find((assay) => assay.name === "Lead")?.unit, "ppm");
  const fields = detectCoaFields("Fentanyl: Not Detected\nPeptide Purity: 99.86%");
  assert.match(fields.tested, /Fentanyl: Not Detected/);
  assert.match(fields.tested, /Peptide purity: 99.86%/);
});

test("reconstructs multi-column Freedom Diagnostics certificate rows", () => {
  const text = `
FreedomDiagnosticsTesting.com
Search Code: | Phas2610130018
Reported: | 10/13/2026
Lot: | P1RT60
Product: | PL-RT 60mg | Purity: | Sample 2: 99.87%
Identity: | Confirmed | Net Content: | Sample 1: 58.66 mg
Appearance: | White Lyophilized Powder | Sample 3: 59.00 mg
Fentanyl | No Fentanyl Detected
Identity (LC-MS) | GLP RT
Purity (HPLC-UV) | 99.88%
Net Content | 58.96 mg
Microbial Analysis (PCR) | No Detectable Microbial DNA
`;
  const fields = detectCoaFields(text);
  assert.equal(fields.coaNumber, "Phas2610130018");
  assert.equal(fields.productName, "PL-RT 60mg");
  assert.equal(fields.date, "2026-10-13");
  assert.equal(detectCoaDate(text).confidence, "fallback");
  assert.equal(fields.purity, "99.88%");
  assert.equal(fields.laboratory, "Freedom Diagnostics");
  const assays = detectCoaAssays(text);
  assert.equal(assays.find((assay) => assay.name === "Identity")?.result, "Confirmed");
  assert.equal(assays.find((assay) => assay.name === "Peptide content")?.result, "58.96 mg");
  assert.equal(assays.find((assay) => assay.name === "Appearance")?.result, "White Lyophilized Powder");
  assert.equal(assays.find((assay) => assay.name === "Fentanyl")?.result, "No Fentanyl Detected");
});

test("keeps unreadable PDFs in a safe manual-review state", async () => {
  const analysis = await analyzeCoaPdf(Buffer.from("%PDF-1.7 unreadable test fixture"));
  assert.equal(analysis.status, "failed");
  assert.equal(analysis.detectedFieldCount, 0);
  assert.match(analysis.warnings[0] || "", /review every field manually/i);
});
