import { createHash, randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";

import type { Database, SqlExecutor } from "./database.js";
import type { CommerceCoa, CommerceCoaWrite } from "./wooCommerceGateway.js";
import { analyzeCoaPdf, type CoaDocumentAnalysis } from "./coaDocumentAnalysis.js";
import {
  coaLaboratoryFromLink,
  coaSourceFingerprint,
  customCoaId,
  draftCoaNumber,
  importedCoaId,
  normalizedCoaLink,
  normalizeCoaStatus,
  safePdfFileName,
  uniqueTextList,
} from "./coaLibrary.js";

interface CoaRow extends QueryResultRow {
  id: string;
  legacy_wp_post_id: string | number | null;
  coa_number: string;
  product_name: string;
  compound: string;
  family_name: string;
  family_key: string;
  strength: string;
  batch: string;
  lot: string;
  certificate_date: string | null;
  status: string;
  purity: string;
  laboratory: string;
  method: string;
  tested: string;
  current_shipping_lot: boolean;
  external_file_url: string;
  verify_url: string;
  file_attachment_id: string | number;
  matched_product_id: string | number;
  matched_variation_id: string | number;
  skus: unknown;
  aliases: unknown;
  keywords: unknown;
  panel_types: unknown;
  current_coa: unknown;
  history: unknown;
  source: string;
  document_id: string | null;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
  intake_analysis: unknown;
}

interface DocumentRow extends QueryResultRow {
  id: string;
  file_name: string;
  mime_type: string;
  byte_size: string | number;
  sha256: string;
  content: Buffer;
}

const DIRECT_PDF_HOSTS = new Set(["coas.freedomdiagnosticstesting.com"]);

function coaNumberFromPdfName(value: string): string {
  const stem = decodeURIComponent(value.split("/").pop() || "").replace(/\.pdf$/i, "").trim();
  return /^[a-z][a-z0-9_-]{5,80}$/i.test(stem) && /\d{6}/.test(stem) ? stem : "";
}

function addFilenameIdentity(analysis: CoaDocumentAnalysis | null, value: string): CoaDocumentAnalysis | null {
  if (!analysis || analysis.fields.coaNumber) return analysis;
  const coaNumber = coaNumberFromPdfName(value);
  if (!coaNumber) return analysis;
  analysis.fields.coaNumber = coaNumber;
  analysis.detectedFieldCount += 1;
  analysis.warnings = analysis.warnings.filter((warning) => !/certificate number was not detected/i.test(warning));
  return analysis;
}

async function downloadTrustedDirectPdf(link: string): Promise<Buffer | null> {
  const parsed = new URL(link);
  if (!DIRECT_PDF_HOSTS.has(parsed.hostname.toLocaleLowerCase("en")) || !/\.pdf$/i.test(parsed.pathname)) return null;
  try {
    const response = await fetch(parsed, {
      headers: { Accept: "application/pdf", "User-Agent": "Phase-One-COA-Intake/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !String(response.headers.get("content-type") || "").toLocaleLowerCase("en").includes("application/pdf")) return null;
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 12 * 1024 * 1024) return null;
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length || content.length > 12 * 1024 * 1024 || !content.subarray(0, 5).equals(Buffer.from("%PDF-"))) return null;
    return content;
  } catch {
    return null;
  }
}

export interface CustomCoa extends CommerceCoa {
  recordId: string;
  source: "custom" | "wordpress_import";
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  intakeAnalysis: CoaDocumentAnalysis | null;
}

export interface CoaDocument {
  id: string;
  fileName: string;
  mimeType: "application/pdf";
  byteSize: number;
  sha256: string;
  content: Buffer;
}

export interface CoaListFilters {
  productId?: number;
  variationId?: number;
  sku?: string;
  search?: string;
  currentOnly?: boolean;
  publishedOnly?: boolean;
  limit?: number;
}

export interface CoaUpdateInput extends Omit<CommerceCoaWrite, "wpPostId"> {
  id: string;
  expectedRevision?: number;
}

export interface StageResult {
  coa: CustomCoa;
  duplicate: boolean;
}

const SELECT_COA = `
  SELECT id, legacy_wp_post_id, coa_number, product_name, compound,
         family_name, family_key, strength, batch, lot,
         certificate_date::text, status, purity, laboratory, method, tested,
         current_shipping_lot, external_file_url, verify_url, file_attachment_id,
         matched_product_id, matched_variation_id, skus, aliases, keywords,
         panel_types, current_coa, history, source, document_id, revision,
         created_at, updated_at, published_at, intake_analysis
  FROM coa_certificates`;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function history(value: unknown): CommerceCoa["history"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const source = record(item);
    if (!Object.keys(source).length) return [];
    return [{
      version: String(source.version || ""),
      label: String(source.label || ""),
      date: String(source.date || ""),
      purity: String(source.purity || ""),
      method: String(source.method || ""),
      tested: String(source.tested || ""),
      verifyUrl: String(source.verifyUrl || ""),
      fileUrl: String(source.fileUrl || ""),
    }];
  });
}

function asIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function rowToCoa(row: CoaRow, publicOrigin: string): CustomCoa {
  const current = record(row.current_coa);
  const storedHistory = history(row.history);
  const documentUrl = row.document_id
    ? `${publicOrigin}/api/public/v1/coas/${encodeURIComponent(row.id)}/document`
    : row.external_file_url;
  return {
    id: row.id,
    recordId: row.id,
    wpPostId: Math.max(0, Number(row.legacy_wp_post_id || 0)),
    matchedProductId: Math.max(0, Number(row.matched_product_id || 0)),
    matchedVariationId: Math.max(0, Number(row.matched_variation_id || 0)),
    coaNumber: row.coa_number,
    productName: row.product_name,
    compound: row.compound,
    familyName: row.family_name,
    familyKey: row.family_key,
    skus: uniqueTextList(row.skus),
    strength: row.strength,
    batch: row.batch,
    lot: row.lot,
    date: row.certificate_date || "",
    status: row.status,
    purity: row.purity,
    laboratory: row.laboratory,
    method: row.method,
    tested: row.tested,
    currentShippingLot: row.status === "Available" && row.current_shipping_lot,
    fileUrl: documentUrl,
    externalFileUrl: row.external_file_url,
    verifyUrl: row.verify_url,
    fileAttachmentId: Math.max(0, Number(row.file_attachment_id || 0)),
    aliases: uniqueTextList(row.aliases),
    keywords: uniqueTextList(row.keywords),
    panelTypes: uniqueTextList(row.panel_types),
    currentCoa: {
      version: String(current.version || ""),
      label: String(current.label || ""),
      date: String(current.date || row.certificate_date || ""),
      purity: String(current.purity || row.purity),
      method: String(current.method || row.method),
      tested: String(current.tested || row.tested),
      verifyUrl: String(current.verifyUrl || row.verify_url),
      fileUrl: documentUrl || String(current.fileUrl || ""),
      fileAttachmentId: Math.max(0, Number(current.fileAttachmentId || row.file_attachment_id || 0)),
      currentShippingLot: row.status === "Available" && row.current_shipping_lot,
    },
    history: storedHistory,
    historyCount: storedHistory.length,
    source: row.source === "wordpress_import" ? "wordpress_import" : "custom",
    revision: Number(row.revision),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    publishedAt: row.published_at ? asIso(row.published_at) : null,
    intakeAnalysis: Object.keys(record(row.intake_analysis)).length
      ? record(row.intake_analysis) as unknown as CoaDocumentAnalysis
      : null,
  };
}

function legacyValues(coa: CommerceCoa, actorId: string): unknown[] {
  const status = normalizeCoaStatus(coa.status);
  const sourceValue = [coa.fileUrl, coa.verifyUrl].filter(Boolean).join("|");
  return [
    importedCoaId(coa), coa.wpPostId > 0 ? coa.wpPostId : null,
    coa.coaNumber || `LEGACY-${coa.wpPostId || coaSourceFingerprint(sourceValue).slice(0, 12)}`,
    coa.productName || coa.familyName || "Imported COA", coa.compound || "",
    coa.familyName || coa.productName || "Imported COA", coa.familyKey || "",
    coa.strength || "", coa.batch || coa.lot || "", coa.lot || coa.batch || "",
    /^\d{4}-\d{2}-\d{2}$/.test(coa.date || "") ? coa.date : null,
    status, coa.purity || "", coa.laboratory || "", coa.method || "", coa.tested || "",
    Boolean(coa.currentShippingLot), coa.fileUrl || "", coa.verifyUrl || "",
    Math.max(0, coa.fileAttachmentId || 0), Math.max(0, coa.matchedProductId || 0),
    Math.max(0, coa.matchedVariationId || 0), JSON.stringify(uniqueTextList(coa.skus)),
    JSON.stringify(uniqueTextList(coa.aliases)), JSON.stringify(uniqueTextList(coa.keywords)),
    JSON.stringify(uniqueTextList(coa.panelTypes)), JSON.stringify(coa.currentCoa || {}),
    JSON.stringify(coa.history || []), sourceValue ? coaSourceFingerprint(sourceValue) : null,
    actorId, status === "Available" ? new Date() : null,
  ];
}

export class CoaRepository {
  constructor(
    private readonly database: Database,
    private readonly publicOrigin: string,
  ) {}

  async count(): Promise<number> {
    const result = await this.database.query<{ count: string }>("SELECT count(*)::text AS count FROM coa_certificates");
    return Number(result.rows[0]?.count || 0);
  }

  async importLegacy(coas: CommerceCoa[], actorId: string): Promise<{ imported: number; existing: number; total: number }> {
    let imported = 0;
    await this.database.transaction(async (client) => {
      for (const coa of coas) {
        const result = await client.query(
          `INSERT INTO coa_certificates (
             id, legacy_wp_post_id, coa_number, product_name, compound, family_name,
             family_key, strength, batch, lot, certificate_date, status, purity,
             laboratory, method, tested, current_shipping_lot, external_file_url,
             verify_url, file_attachment_id, matched_product_id, matched_variation_id,
             skus, aliases, keywords, panel_types, current_coa, history,
             source, source_fingerprint, created_by, updated_by, published_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb,
             $27::jsonb,$28::jsonb,'wordpress_import',$29,$30,$30,$31
           ) ON CONFLICT DO NOTHING`,
          legacyValues(coa, actorId),
        );
        if (result.rowCount) {
          imported += 1;
          await this.event(client, importedCoaId(coa), "wordpress_imported", actorId, {
            legacyWpPostId: coa.wpPostId,
            historyVersions: coa.history?.length || 0,
          });
        }
      }
    });
    const total = await this.count();
    return { imported, existing: coas.length - imported, total };
  }

  async list(filters: CoaListFilters = {}): Promise<CustomCoa[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const value = (item: unknown) => { values.push(item); return `$${values.length}`; };
    if (filters.publishedOnly) conditions.push("status = 'Available' AND published_at IS NOT NULL");
    if (filters.currentOnly) conditions.push("current_shipping_lot = true");
    if (filters.productId && filters.productId > 0) conditions.push(`matched_product_id = ${value(filters.productId)}`);
    if (filters.variationId && filters.variationId > 0) conditions.push(`matched_variation_id = ${value(filters.variationId)}`);
    if (filters.sku) conditions.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(skus) sku WHERE lower(sku) = lower(${value(filters.sku)}))`);
    if (filters.search) {
      const pattern = `%${filters.search.slice(0, 160)}%`;
      const placeholder = value(pattern);
      conditions.push(`concat_ws(' ', coa_number, product_name, compound, family_name, family_key, strength, batch, lot, laboratory, skus::text, aliases::text, keywords::text) ILIKE ${placeholder}`);
    }
    const limit = Math.min(500, Math.max(1, filters.limit || 200));
    const result = await this.database.query<CoaRow>(
      `${SELECT_COA}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY current_shipping_lot DESC, certificate_date DESC NULLS LAST, updated_at DESC
       LIMIT ${value(limit)}`,
      values,
    );
    return result.rows.map((row) => rowToCoa(row, this.publicOrigin));
  }

  async get(id: string): Promise<CustomCoa | null> {
    const result = await this.database.query<CoaRow>(`${SELECT_COA} WHERE id = $1`, [id]);
    return result.rows[0] ? rowToCoa(result.rows[0], this.publicOrigin) : null;
  }

  async stageLinks(links: string[], suggestCurrent: boolean, actorId: string): Promise<StageResult[]> {
    const normalized = [...new Set(links.map(normalizedCoaLink))].slice(0, 40);
    const results: StageResult[] = [];
    const governed = await this.list({ limit: 500 });
    for (const link of normalized) {
      const fingerprint = coaSourceFingerprint(link);
      const existing = await this.database.query<CoaRow>(`${SELECT_COA} WHERE source_fingerprint = $1`, [fingerprint]);
      if (existing.rows[0]?.document_id) {
        results.push({ coa: rowToCoa(existing.rows[0], this.publicOrigin), duplicate: true });
        continue;
      }
      const existingByUrl = governed.find((coa) => [coa.fileUrl, coa.verifyUrl]
        .filter(Boolean)
        .some((value) => {
          try { return normalizedCoaLink(value) === link; } catch { return false; }
        }));
      if (existingByUrl && !existing.rows[0]) {
        results.push({ coa: existingByUrl, duplicate: true });
        continue;
      }
      const directPdf = await downloadTrustedDirectPdf(link);
      const analysis = directPdf ? addFilenameIdentity(await analyzeCoaPdf(directPdf), new URL(link).pathname) : null;
      if (analysis?.fields.coaNumber) {
        const sameCertificate = await this.database.query<CoaRow>(
          `${SELECT_COA} WHERE lower(coa_number) = lower($1) LIMIT 1`,
          [analysis.fields.coaNumber],
        );
        if (sameCertificate.rows[0]) {
          results.push({ coa: rowToCoa(sameCertificate.rows[0], this.publicOrigin), duplicate: true });
          continue;
        }
      }
      if (existing.rows[0]) {
        const enriched = directPdf && analysis && !existing.rows[0].document_id
          ? await this.enrichLinkDraft(existing.rows[0], link, directPdf, analysis, actorId)
          : rowToCoa(existing.rows[0], this.publicOrigin);
        results.push({ coa: enriched, duplicate: true });
        continue;
      }
      const id = customCoaId();
      const detected = analysis?.fields;
      const coaNumber = detected?.coaNumber || draftCoaNumber(link);
      const laboratory = detected?.laboratory || coaLaboratoryFromLink(link);
      const productName = detected?.productName || detected?.compound || "Needs product review";
      const familyName = detected?.compound || detected?.productName || "Needs product review";
      const documentId = directPdf ? `doc-${randomUUID()}` : null;
      const sha256 = directPdf ? createHash("sha256").update(directPdf).digest("hex") : null;
      await this.database.transaction(async (client) => {
        await client.query(
          `INSERT INTO coa_certificates (
             id, coa_number, product_name, compound, family_name, strength, batch,
             lot, certificate_date, status, purity, laboratory, method, tested,
             current_shipping_lot, external_file_url, verify_url, source,
             source_fingerprint, created_by, updated_by, intake_analysis
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Review',$10,$11,$12,$13,false,$14,$14,'custom',$15,$16,$16,$17::jsonb)`,
          [id, coaNumber, productName, detected?.compound || "", familyName,
            detected?.strength || "", detected?.batch || "", detected?.lot || detected?.batch || "",
            detected?.date || null, detected?.purity || "", laboratory, detected?.method || "",
            detected?.tested || "", link, fingerprint, actorId,
            JSON.stringify({ ...(analysis || {}), suggestCurrent })],
        );
        if (directPdf && documentId && sha256) {
          await client.query(
            `INSERT INTO coa_documents (id, certificate_id, file_name, mime_type, byte_size, sha256, content, created_by)
             VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7)`,
            [documentId, id, safePdfFileName(new URL(link).pathname.split("/").pop() || "certificate.pdf"), directPdf.length, sha256, directPdf, actorId],
          );
          await client.query("UPDATE coa_certificates SET document_id = $2 WHERE id = $1", [id, documentId]);
        }
        await this.event(client, id, "link_staged", actorId, {
          link,
          suggestCurrent,
          extractionStatus: analysis?.status || "link_only",
          detectedFieldCount: analysis?.detectedFieldCount || 0,
        });
      });
      const staged = await this.get(id);
      if (staged) results.push({ coa: staged, duplicate: false });
    }
    return results;
  }

  private async enrichLinkDraft(row: CoaRow, link: string, content: Buffer, analysis: CoaDocumentAnalysis, actorId: string): Promise<CustomCoa> {
    const sha256 = createHash("sha256").update(content).digest("hex");
    const duplicateDocument = await this.database.query<CoaRow>(
      `${SELECT_COA} WHERE document_id = (SELECT id FROM coa_documents WHERE sha256 = $1) LIMIT 1`,
      [sha256],
    );
    if (duplicateDocument.rows[0]) return rowToCoa(duplicateDocument.rows[0], this.publicOrigin);
    const fields = analysis.fields;
    const documentId = `doc-${randomUUID()}`;
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO coa_documents (id, certificate_id, file_name, mime_type, byte_size, sha256, content, created_by)
         VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7)`,
        [documentId, row.id, safePdfFileName(new URL(link).pathname.split("/").pop() || "certificate.pdf"), content.length, sha256, content, actorId],
      );
      await client.query(
        `UPDATE coa_certificates SET
           coa_number=CASE WHEN coa_number LIKE 'DRAFT-%' AND $2 <> '' THEN $2 ELSE coa_number END,
           product_name=CASE WHEN product_name='Needs product review' AND $3 <> '' THEN $3 ELSE product_name END,
           compound=CASE WHEN compound='' THEN $4 ELSE compound END,
           family_name=CASE WHEN family_name='Needs product review' AND $5 <> '' THEN $5 ELSE family_name END,
           strength=CASE WHEN strength='' THEN $6 ELSE strength END,
           batch=CASE WHEN batch='' THEN $7 ELSE batch END,
           lot=CASE WHEN lot='' THEN $8 ELSE lot END,
           certificate_date=COALESCE(certificate_date,$9),
           purity=CASE WHEN purity='' THEN $10 ELSE purity END,
           laboratory=CASE WHEN laboratory='' THEN $11 ELSE laboratory END,
           method=CASE WHEN method='' THEN $12 ELSE method END,
           tested=CASE WHEN tested='' THEN $13 ELSE tested END,
           document_id=$14, intake_analysis=COALESCE(intake_analysis, '{}'::jsonb) || $15::jsonb, revision=revision+1,
           updated_by=$16, updated_at=now()
         WHERE id=$1`,
        [row.id, fields.coaNumber, fields.productName || fields.compound, fields.compound,
          fields.compound || fields.productName, fields.strength, fields.batch,
          fields.lot || fields.batch, fields.date || null, fields.purity,
          fields.laboratory, fields.method, fields.tested, documentId,
          JSON.stringify(analysis), actorId],
      );
      await this.event(client, row.id, "link_pdf_analyzed", actorId, {
        link,
        extractionStatus: analysis.status,
        detectedFieldCount: analysis.detectedFieldCount,
      });
    });
    return (await this.get(row.id))!;
  }

  async stagePdf(input: { fileName: string; content: Buffer; suggestCurrent: boolean; actorId: string }): Promise<StageResult> {
    if (!input.content.length || input.content.length > 12 * 1024 * 1024) throw new Error("PDF files must be between 1 byte and 12 MB");
    if (!input.content.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The uploaded file is not a valid PDF document");
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    const duplicate = await this.database.query<CoaRow>(
      `${SELECT_COA} WHERE document_id = (SELECT id FROM coa_documents WHERE sha256 = $1)`,
      [sha256],
    );
    if (duplicate.rows[0]) return { coa: rowToCoa(duplicate.rows[0], this.publicOrigin), duplicate: true };
    const id = customCoaId();
    const documentId = `doc-${randomUUID()}`;
    const fileName = safePdfFileName(input.fileName);
    const analysis = addFilenameIdentity(await analyzeCoaPdf(input.content), input.fileName)!;
    const detected = analysis.fields;
    const coaNumber = detected.coaNumber || draftCoaNumber(sha256);
    const productName = detected.productName || detected.compound || "Needs product review";
    const familyName = detected.compound || detected.productName || "Needs product review";
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO coa_certificates (
           id, coa_number, product_name, compound, family_name, strength, batch, lot,
           certificate_date, status, purity, laboratory, method, tested,
           current_shipping_lot, source, source_fingerprint, created_by, updated_by,
           intake_analysis
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Review',$10,$11,$12,$13,false,'custom',$14,$15,$15,$16::jsonb)`,
        [id, coaNumber, productName, detected.compound, familyName, detected.strength,
          detected.batch, detected.lot || detected.batch, detected.date || null,
          detected.purity, detected.laboratory, detected.method, detected.tested,
          coaSourceFingerprint(`pdf:${sha256}`), input.actorId,
          JSON.stringify({ ...analysis, suggestCurrent: input.suggestCurrent })],
      );
      await client.query(
        `INSERT INTO coa_documents (id, certificate_id, file_name, mime_type, byte_size, sha256, content, created_by)
         VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,$7)`,
        [documentId, id, fileName, input.content.length, sha256, input.content, input.actorId],
      );
      await client.query("UPDATE coa_certificates SET document_id = $2 WHERE id = $1", [id, documentId]);
      await this.event(client, id, "pdf_staged", input.actorId, {
        fileName,
        byteSize: input.content.length,
        sha256,
        extractionStatus: analysis.status,
        detectedFieldCount: analysis.detectedFieldCount,
      });
    });
    const staged = await this.get(id);
    if (!staged) throw new Error("The staged certificate could not be loaded");
    return { coa: staged, duplicate: false };
  }

  async update(input: CoaUpdateInput, actorId: string): Promise<CustomCoa> {
    const status = normalizeCoaStatus(input.status);
    const productName = input.productName.trim();
    const familyName = input.familyName.trim();
    const coaNumber = input.coaNumber.trim();
    const requestedTestDate = input.date.trim();
    const parsedTestDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedTestDate)
      ? new Date(`${requestedTestDate}T00:00:00.000Z`)
      : null;
    const testDate = parsedTestDate && !Number.isNaN(parsedTestDate.getTime()) && parsedTestDate.toISOString().slice(0, 10) === requestedTestDate
      ? requestedTestDate
      : "";
    if (!coaNumber || (!productName && !familyName)) throw new Error("COA number and product or family are required");
    return this.database.transaction(async (client) => {
      const current = await client.query<CoaRow>(`${SELECT_COA} WHERE id = $1 FOR UPDATE`, [input.id]);
      if (!current.rows[0]) throw new Error("COA record not found");
      if (input.expectedRevision && Number(current.rows[0].revision) !== input.expectedRevision) {
        throw new Error("This COA changed in another session. Reload it before saving");
      }
      const lot = input.lot.trim() || input.batch.trim();
      const hasDocument = Boolean(
        current.rows[0].document_id || input.fileUrl.trim() || input.verifyUrl.trim(),
      );
      if (status === "Available" && (
        coaNumber.startsWith("DRAFT-") || productName === "Needs product review" ||
        !lot || !testDate || !hasDocument ||
        (Math.max(0, input.matchedProductId || 0) === 0 && uniqueTextList(input.skus).length === 0)
      )) {
        throw new Error("Publishing requires a final COA number, product, lot, test or analysis date, document and product or SKU mapping");
      }
      if (input.currentShippingLot && status !== "Available") {
        throw new Error("Only an Available certificate can be the current shipping lot");
      }
      if (input.currentShippingLot) {
        await client.query(
          `UPDATE coa_certificates SET current_shipping_lot = false, revision = revision + 1,
             updated_at = now(), updated_by = $4
           WHERE id <> $1 AND lower(family_name) = lower($2) AND lower(strength) = lower($3)
             AND current_shipping_lot = true`,
          [input.id, familyName || productName, input.strength.trim(), actorId],
        );
      }
      const result = await client.query<CoaRow>(
        `UPDATE coa_certificates SET
           coa_number=$2, product_name=$3, compound=$4, family_name=$5,
           family_key=$6, strength=$7, batch=$8, lot=$9, certificate_date=$10,
           status=$11::varchar, purity=$12, laboratory=$13, method=$14, tested=$15,
           current_shipping_lot=$16, external_file_url=$17, verify_url=$18,
           file_attachment_id=$19, matched_product_id=$20, matched_variation_id=$21,
           skus=$22::jsonb, aliases=$23::jsonb, keywords=$24::jsonb,
           panel_types=$25::jsonb, revision=revision+1, updated_by=$26,
           updated_at=now(), published_at=CASE WHEN $11::text='Available' THEN COALESCE(published_at, now()) ELSE published_at END
         WHERE id=$1 RETURNING id, legacy_wp_post_id, coa_number, product_name, compound,
           family_name, family_key, strength, batch, lot, certificate_date::text, status,
           purity, laboratory, method, tested, current_shipping_lot, external_file_url,
           verify_url, file_attachment_id, matched_product_id, matched_variation_id,
           skus, aliases, keywords, panel_types, current_coa, history, source,
           document_id, revision, created_at, updated_at, published_at`,
        [input.id, coaNumber, productName, input.compound.trim(), familyName || productName,
          input.familyKey.trim(), input.strength.trim(), input.batch.trim(), lot,
          testDate || null, status,
          input.purity.trim(), input.laboratory.trim(), input.method.trim(), input.tested.trim(),
          input.currentShippingLot, input.fileUrl.trim(), input.verifyUrl.trim(),
          Math.max(0, input.fileAttachmentId || 0), Math.max(0, input.matchedProductId || 0),
          Math.max(0, input.matchedVariationId || 0), JSON.stringify(uniqueTextList(input.skus)),
          JSON.stringify(uniqueTextList(input.aliases)), JSON.stringify(uniqueTextList(input.keywords)),
          JSON.stringify(uniqueTextList(input.panelTypes)), actorId],
      );
      await this.event(client, input.id, status === "Available" ? "published_or_updated" : "updated", actorId, {
        revision: Number(result.rows[0]?.revision || 0), status,
      });
      return rowToCoa(result.rows[0]!, this.publicOrigin);
    });
  }

  async deleteDraft(id: string, actorId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const current = await client.query<CoaRow>(`${SELECT_COA} WHERE id = $1 FOR UPDATE`, [id]);
      const row = current.rows[0];
      if (!row) throw new Error("COA draft not found");
      if (row.source !== "custom" || row.status !== "Review" || row.published_at) {
        throw new Error("Only unpublished custom drafts can be deleted");
      }
      await client.query("DELETE FROM coa_certificates WHERE id = $1", [id]);
      // The actor is intentionally kept in the server log because certificate-scoped
      // events are removed with the discarded draft by the database cascade.
      console.info("COA review draft discarded", { certificateId: id, actorId });
    });
  }

  async document(certificateId: string, publishedOnly = true): Promise<CoaDocument | null> {
    const result = await this.database.query<DocumentRow>(
      `SELECT d.id, d.file_name, d.mime_type, d.byte_size, d.sha256, d.content
       FROM coa_documents d JOIN coa_certificates c ON c.document_id = d.id
       WHERE c.id = $1${publishedOnly ? " AND c.status = 'Available' AND c.published_at IS NOT NULL" : ""}`,
      [certificateId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, fileName: row.file_name, mimeType: "application/pdf", byteSize: Number(row.byte_size), sha256: row.sha256, content: row.content };
  }

  private async event(client: SqlExecutor, certificateId: string, eventType: string, actorId: string, details: Record<string, unknown>): Promise<void> {
    await client.query(
      "INSERT INTO coa_certificate_events (id, certificate_id, event_type, actor_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [`evt-${randomUUID()}`, certificateId, eventType, actorId, JSON.stringify(details)],
    );
  }
}
