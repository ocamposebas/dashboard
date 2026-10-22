import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before, beforeEach } from "node:test";

import { CoaRepository } from "../src/server/coaRepository.js";
import { Database } from "../src/server/database.js";
import type { CommerceCoa } from "../src/server/wooCommerceGateway.js";

const testDatabaseUrl = process.env.TEST_COA_DATABASE_URL?.trim() || "";
let database: Database | undefined;
let repository: CoaRepository | undefined;

function legacy(overrides: Partial<CommerceCoa> = {}): CommerceCoa {
  return {
    id: "legacy-coa-1", wpPostId: 501, matchedProductId: 700, matchedVariationId: 701,
    coaNumber: "COA-LEGACY-1", productName: "BPC-157 10mg", compound: "BPC-157",
    familyName: "BPC-157", familyKey: "bpc-157", skus: ["P1-BPC-10"], strength: "10mg",
    batch: "LOT-LEGACY-1", lot: "LOT-LEGACY-1", date: "2026-10-01", status: "Available",
    purity: "99.4%", laboratory: "ILS Labs", method: "HPLC", tested: "Identity and purity",
    currentShippingLot: true, fileUrl: "https://portal.ils-lab.com/verify/legacy-1",
    verifyUrl: "https://portal.ils-lab.com/verify/legacy-1", fileAttachmentId: 0,
    aliases: [], keywords: [], panelTypes: ["standard"],
    currentCoa: { version: "2", label: "Current", date: "2026-10-01", purity: "99.4%", method: "HPLC", tested: "Identity and purity", verifyUrl: "https://portal.ils-lab.com/verify/legacy-1", fileUrl: "https://portal.ils-lab.com/verify/legacy-1", fileAttachmentId: 0, currentShippingLot: true },
    history: [{ version: "1", label: "Previous", date: "2026-09-01", purity: "99.1%", method: "HPLC", tested: "Identity", verifyUrl: "https://portal.ils-lab.com/verify/old", fileUrl: "https://portal.ils-lab.com/verify/old" }],
    historyCount: 1,
    ...overrides,
  };
}

before(async () => {
  if (!testDatabaseUrl) return;
  const parsed = new URL(testDatabaseUrl);
  if (!parsed.pathname.toLocaleLowerCase("en").includes("test")) throw new Error("TEST_COA_DATABASE_URL must name an isolated test database");
  database = new Database({ connectionString: testDatabaseUrl, ssl: false, maxConnections: 4, connectionTimeoutMs: 5_000, idleTimeoutMs: 5_000 });
  const exists = await database.query<{ table_name: string | null }>("SELECT to_regclass('public.coa_certificates') AS table_name");
  if (!exists.rows[0]?.table_name) {
    await database.query(await readFile(new URL("../migrations/013_custom_coa_library.up.sql", import.meta.url), "utf8"));
  }
  const intakeColumn = await database.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='coa_certificates' AND column_name='intake_analysis') AS exists",
  );
  if (!intakeColumn.rows[0]?.exists) {
    await database.query(await readFile(new URL("../migrations/014_coa_intake_review.up.sql", import.meta.url), "utf8"));
  }
  repository = new CoaRepository(database, "https://coas.phaseone.test");
});

beforeEach(async () => {
  if (database) await database.query("TRUNCATE coa_certificate_events, coa_documents, coa_certificates CASCADE");
});

after(async () => { await database?.close(); });

test("WordPress history imports once and remains publicly readable", { skip: !testDatabaseUrl }, async () => {
  const first = await repository!.importLegacy([legacy()], "import-test");
  const replay = await repository!.importLegacy([legacy()], "import-test");
  assert.deepEqual(first, { imported: 1, existing: 0, total: 1 });
  assert.deepEqual(replay, { imported: 0, existing: 1, total: 1 });
  const publicRecords = await repository!.list({ publishedOnly: true });
  assert.equal(publicRecords.length, 1);
  assert.equal(publicRecords[0]?.historyCount, 1);
  assert.equal(publicRecords[0]?.source, "wordpress_import");
  const [legacyLinkReplay] = await repository!.stageLinks([legacy().verifyUrl], false, "operator-test");
  assert.equal(legacyLinkReplay?.duplicate, true);
  assert.equal(legacyLinkReplay?.coa.id, legacy().id);
});

test("laboratory links stay private until reviewed and duplicate intake is idempotent", { skip: !testDatabaseUrl }, async () => {
  const link = "https://portal.ils-lab.com/verify/custom-test-1";
  const [first] = await repository!.stageLinks([link], true, "operator-test");
  const [replay] = await repository!.stageLinks([link], true, "operator-test");
  assert.equal(first?.duplicate, false);
  assert.equal(replay?.duplicate, true);
  assert.equal((await repository!.list({ publishedOnly: true })).length, 0);

  const draft = first!.coa;
  assert.equal(draft.currentShippingLot, false);
  assert.equal(draft.intakeAnalysis?.suggestCurrent, true);
  await repository!.update({
    id: draft.id, expectedRevision: draft.revision, coaNumber: "COA-CUSTOM-1",
    productName: "Retatrutide 10mg", compound: "Retatrutide", familyName: "Retatrutide",
    familyKey: "retatrutide", strength: "10mg", batch: "LOT-CUSTOM-1", lot: "LOT-CUSTOM-1",
    date: "2026-10-18", status: "Available", purity: "99%", laboratory: "ILS Labs",
    method: "HPLC", tested: "Identity and purity", currentShippingLot: true,
    fileUrl: link, verifyUrl: link, fileAttachmentId: 0, matchedProductId: 900,
    matchedVariationId: 901, skus: ["P1-RT-10"], aliases: [], keywords: [], panelTypes: ["standard"],
  }, "operator-test");
  assert.equal((await repository!.list({ productId: 900, publishedOnly: true })).length, 1);
  assert.equal((await repository!.list({ sku: "p1-rt-10", publishedOnly: true })).length, 1);
});

test("PDF bytes are durable, validated and gated by publication", { skip: !testDatabaseUrl }, async () => {
  const content = Buffer.from("%PDF-1.7\n% isolated integration test\n%%EOF");
  const staged = await repository!.stagePdf({ fileName: "lot-test.pdf", content, suggestCurrent: false, actorId: "operator-test" });
  assert.equal(await repository!.document(staged.coa.id), null);
  await repository!.update({
    id: staged.coa.id, expectedRevision: staged.coa.revision, coaNumber: "COA-PDF-1",
    productName: "CJC-1295 5mg", compound: "CJC-1295", familyName: "CJC-1295",
    familyKey: "cjc-1295", strength: "5mg", batch: "LOT-PDF-1", lot: "LOT-PDF-1",
    date: "2026-10-18", status: "Available", purity: "99.2%", laboratory: "Kovera Labs",
    method: "HPLC", tested: "Identity and purity", currentShippingLot: false,
    fileUrl: "", verifyUrl: "", fileAttachmentId: 0, matchedProductId: 800,
    matchedVariationId: 0, skus: ["P1-CJC-5"], aliases: [], keywords: [], panelTypes: [],
  }, "operator-test");
  const document = await repository!.document(staged.coa.id);
  assert.deepEqual(document?.content, content);
  assert.equal(document?.mimeType, "application/pdf");
  const replay = await repository!.stagePdf({ fileName: "renamed.pdf", content, suggestCurrent: false, actorId: "operator-test" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.coa.id, staged.coa.id);
});

test("operators can discard only unpublished custom review drafts", { skip: !testDatabaseUrl }, async () => {
  const [draft] = await repository!.stageLinks(["https://portal.ils-lab.com/verify/delete-me"], false, "operator-test");
  await repository!.deleteDraft(draft!.coa.id, "operator-test");
  assert.equal(await repository!.get(draft!.coa.id), null);

  await repository!.importLegacy([legacy()], "import-test");
  await assert.rejects(
    repository!.deleteDraft(legacy().id, "operator-test"),
    /Only unpublished custom drafts can be deleted/,
  );
});

test("publication is blocked until the laboratory test or analysis date is confirmed", { skip: !testDatabaseUrl }, async () => {
  const [draft] = await repository!.stageLinks(["https://portal.ils-lab.com/verify/date-required"], false, "operator-test");
  await assert.rejects(
    repository!.update({
      id: draft!.coa.id, expectedRevision: draft!.coa.revision, coaNumber: "COA-DATE-REQUIRED",
      productName: "Tesamorelin 10mg", compound: "Tesamorelin", familyName: "Tesamorelin",
      familyKey: "tesamorelin", strength: "10mg", batch: "LOT-DATE-1", lot: "LOT-DATE-1",
      date: "", status: "Available", purity: "99%", laboratory: "ILS Labs",
      method: "HPLC", tested: "Identity and purity", currentShippingLot: false,
      fileUrl: "https://portal.ils-lab.com/verify/date-required", verifyUrl: "https://portal.ils-lab.com/verify/date-required",
      fileAttachmentId: 0, matchedProductId: 901, matchedVariationId: 0,
      skus: ["P1-TESA-10"], aliases: [], keywords: [], panelTypes: ["standard"],
    }, "operator-test"),
    /test or analysis date/i,
  );
});

