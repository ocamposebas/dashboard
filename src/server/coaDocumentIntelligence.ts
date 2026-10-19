import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface CoaDetectedFields {
  coaNumber: string;
  productName: string;
  compound: string;
  strength: string;
  batch: string;
  lot: string;
  date: string;
  purity: string;
  laboratory: string;
  method: string;
  tested: string;
}

export interface CoaDetectedAssay {
  name: string;
  result: string;
  unit: string;
  status: "pass" | "attention" | "reported";
}

export type CoaDateSource = "test" | "analysis" | "reported" | "certificate" | "received" | "unknown";

export interface CoaDateDetection {
  value: string;
  source: CoaDateSource;
  label: string;
  confidence: "explicit" | "fallback" | "missing";
}

export interface CoaDocumentAnalysis {
  status: "complete" | "limited" | "failed";
  fields: CoaDetectedFields;
  assays: CoaDetectedAssay[];
  dateDetection: CoaDateDetection;
  detectedFieldCount: number;
  pageCount: number;
  warnings: string[];
}

const emptyFields = (): CoaDetectedFields => ({
  coaNumber: "",
  productName: "",
  compound: "",
  strength: "",
  batch: "",
  lot: "",
  date: "",
  purity: "",
  laboratory: "",
  method: "",
  tested: "",
});

function clean(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[\s:–—-]+|[\s:–—-]+$/g, "").trim();
}

function labeled(text: string, labels: string[], maximum = 100): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:#-]?\\s*([^\\n]{1,${maximum}})`, "im"));
    if (match?.[1]) {
      const columns = clean(match[1]).replace(/^\|\s*/, "").split(/\s*\|\s*/);
      if (columns[0]) return clean(columns[0]);
    }
  }
  return "";
}

function isoDate(value: string): string {
  const trimmed = clean(value);
  const iso = trimmed.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const us = trimmed.match(/\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](20\d{2})\b/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}

/** Resolves the laboratory testing date without silently substituting an
 * administrative date. Reported/certificate/received dates remain visible
 * fallbacks that the operator must confirm during review. */
export function detectCoaDate(rawText: string): CoaDateDetection {
  const text = rawText.replace(/\r/g, "\n").replace(/[ \t]+/g, " ");
  const groups: Array<{
    source: CoaDateSource;
    label: string;
    confidence: CoaDateDetection["confidence"];
    patterns: string[];
  }> = [
    {
      source: "test",
      label: "Test date",
      confidence: "explicit",
      patterns: ["test date", "testing date", "date tested", "tested on", "date of testing", "sample test date"],
    },
    {
      source: "analysis",
      label: "Analysis date",
      confidence: "explicit",
      patterns: ["analysis date", "date of analysis", "analytical date", "analysis performed(?: on)?", "date analyzed", "analysed on"],
    },
    {
      source: "reported",
      label: "Reported date",
      confidence: "fallback",
      patterns: ["report date", "reported(?: on)?", "date reported"],
    },
    {
      source: "certificate",
      label: "Certificate date",
      confidence: "fallback",
      patterns: ["certificate date", "date issued", "issue date"],
    },
    {
      source: "received",
      label: "Received date",
      confidence: "fallback",
      patterns: ["date received", "received(?: on)?", "sample received"],
    },
  ];
  for (const group of groups) {
    for (const pattern of group.patterns) {
      const value = isoDate(labeled(text, [pattern], 80));
      if (value) return { value, source: group.source, label: group.label, confidence: group.confidence };
    }
  }
  return { value: "", source: "unknown", label: "Not detected", confidence: "missing" };
}

function firstPercent(text: string): string {
  const analytical = text.match(/\bpurity\s*\([^\n)]{1,40}\)[^\n%]{0,40}?\b((?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)\s*%)/i);
  const nearby = text.match(/\b(?:hplc\s+)?(?:purity|assay)\b[^\n%]{0,80}?\b((?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)\s*%)/i);
  return clean(analytical?.[1] || nearby?.[1] || "");
}

function identifyLaboratory(text: string): string {
  if (/freedom\s*diagnostics/i.test(text)) return "Freedom Diagnostics";
  if (/\bILS(?:\s+Labs?|\s+Laborator(?:y|ies))\b/i.test(text)) return "ILS Labs";
  if (/kovera\s+labs?/i.test(text)) return "Kovera Labs";
  return labeled(text, ["laboratory", "testing laboratory", "lab(?:oratory)? name"], 100);
}

const ASSAY_LABELS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Fentanyl", pattern: /\bfentanyl(?:\s+screen(?:ing)?)?\b/i },
  { name: "Peptide purity", pattern: /\b(?:peptide\s+)?(?:hplc\s+)?purity\b/i },
  { name: "Identity", pattern: /\b(?:peptide\s+)?identity\b/i },
  { name: "Peptide content", pattern: /\b(?:(?:peptide|net)\s+)?content\b/i },
  { name: "Bacterial endotoxins", pattern: /\b(?:bacterial\s+)?endotoxins?\b/i },
  { name: "Sterility", pattern: /\bsterility\b/i },
  { name: "Bioburden", pattern: /\bbioburden\b/i },
  { name: "Total aerobic microbial count", pattern: /\b(?:total\s+aerobic\s+microbial\s+count|tamc)\b/i },
  { name: "Total yeast and mold count", pattern: /\b(?:total\s+yeast\s+(?:and|&)\s+mold\s+count|tymc)\b/i },
  { name: "Heavy metals", pattern: /\bheavy\s+metals?\b/i },
  { name: "Elemental impurities", pattern: /\belemental\s+impurities\b/i },
  { name: "Microbial analysis", pattern: /\bmicrobial\s+(?:analysis|detection)\b/i },
  { name: "Arsenic", pattern: /\barsenic\b/i },
  { name: "Cadmium", pattern: /\bcadmium\b/i },
  { name: "Lead", pattern: /\blead\b/i },
  { name: "Mercury", pattern: /\bmercury\b/i },
  { name: "Residual solvents", pattern: /\bresidual\s+solvents?\b/i },
  { name: "Water content", pattern: /\b(?:water\s+content|moisture)\b/i },
  { name: "Acetate content", pattern: /\bacetate\s+content\b/i },
  { name: "Trifluoroacetate", pattern: /\b(?:trifluoroacetate|tfa)\b/i },
  { name: "Molecular mass", pattern: /\b(?:molecular\s+(?:mass|weight)|mass\s+spectrometry)\b/i },
  { name: "pH", pattern: /(?:^|\s)pH(?:\s|$|:)/i },
  { name: "Appearance", pattern: /\bappearance\b/i },
  { name: "Solubility", pattern: /\bsolubility\b/i },
  { name: "E. coli", pattern: /\b(?:e\.?\s*coli|escherichia\s+coli)\b/i },
  { name: "Salmonella", pattern: /\bsalmonella\b/i },
  { name: "Pseudomonas aeruginosa", pattern: /\bpseudomonas(?:\s+aeruginosa)?\b/i },
  { name: "Staphylococcus aureus", pattern: /\bstaphylococcus(?:\s+aureus)?\b/i },
];

const RESULT_PATTERN = /(?:[<>≤≥]\s*)?\d+(?:\.\d+)?\s*(?:%|ppm|ppb|ppt|ng\s*\/\s*(?:mg|g|mL)|[µu]g\s*\/\s*(?:mg|g|mL)|mg\s*\/\s*(?:g|mL|vial)|EU\s*\/\s*(?:mg|mL|vial)|CFU\s*\/\s*(?:g|mL)|CFU|EU|mg|[µu]g|ng)(?=\s|$|[;,.)])|\b(?:no\s+detectable\s+(?:microbial\s+dna|growth|organisms?)|no\s+(?:detectable\s+)?(?:[a-z]+\s+){0,2}detected|not\s+detected|none\s+detected|negative|positive|confirm(?:ed)?|pass(?:ed)?|fail(?:ed)?|complies|conforms|meets\s+(?:specification|requirements?)|absent|present|nd|n\/a)\b/i;

function assayStatus(result: string): CoaDetectedAssay["status"] {
  if (/\b(?:no\s+detectable\s+(?:microbial\s+dna|growth|organisms?)|no\s+(?:detectable\s+)?(?:[a-z]+\s+){0,2}detected|not\s+detected|none\s+detected|negative|confirm(?:ed)?|pass(?:ed)?|complies|conforms|meets\s+(?:specification|requirements?)|absent|nd)\b/i.test(result)) return "pass";
  if (/\b(?:positive|fail(?:ed)?|out\s+of\s+spec(?:ification)?|present)\b/i.test(result)) return "attention";
  return "reported";
}

function assayUnit(result: string): string {
  return clean(result.match(/(?:%|ppm|ppb|ppt|ng\s*\/\s*(?:mg|g|mL)|[µu]g\s*\/\s*(?:mg|g|mL)|mg\s*\/\s*(?:g|mL|vial)|EU\s*\/\s*(?:mg|mL|vial)|CFU\s*\/\s*(?:g|mL)|CFU|EU|mg|[µu]g|ng)(?=\s|$|[;,.)])/i)?.[0] || "");
}

function resultNearLabel(line: string, pattern: RegExp): string {
  const label = line.match(pattern)?.[0] || "";
  const afterLabel = label ? line.slice((line.search(pattern) || 0) + label.length) : line;
  const columns = afterLabel.replace(/^[\s:#–—-]*\|?\s*/, "").split(/\s*\|\s*/).filter(Boolean);
  const direct = columns.map((column) => column.match(RESULT_PATTERN)?.[0] || "").find(Boolean) ||
    afterLabel.match(RESULT_PATTERN)?.[0] || line.match(RESULT_PATTERN)?.[0] || "";
  return clean(direct).replace(/\s*\/\s*/g, "/");
}

/** Detects the individual laboratory tests and their reported results without
 * treating the values as approved until a human reviews the certificate. */
export function detectCoaAssays(rawText: string): CoaDetectedAssay[] {
  const lines = rawText.replace(/\r/g, "\n").split(/\n+/).map(clean).filter(Boolean);
  const assays = new Map<string, CoaDetectedAssay>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const definition of ASSAY_LABELS) {
      if (!definition.pattern.test(line)) continue;
      let result = definition.name === "Appearance"
        ? clean(line.replace(definition.pattern, "").replace(/^[\s:#–—-]*\|?\s*/, "").split(/\s*\|\s*/)[0] || "").slice(0, 100)
        : resultNearLabel(line, definition.pattern);
      if (!result && !line.includes("|")) {
        const next = lines[index + 1] || "";
        if (next.length <= 100) result = clean(next.match(RESULT_PATTERN)?.[0] || "");
      }
      if (!result) continue;
      const key = definition.name.toLocaleLowerCase("en");
      assays.set(key, {
        name: definition.name,
        result,
        unit: assayUnit(result),
        status: assayStatus(result),
      });
    }
  }
  return [...assays.values()];
}

export function detectCoaFields(rawText: string): CoaDetectedFields {
  const text = rawText.replace(/\r/g, "\n").replace(/[ \t]+/g, " ");
  const fields = emptyFields();
  fields.coaNumber = labeled(text, ["search code", "certificate(?: of analysis)? (?:number|no\\.?|id)", "coa (?:number|no\\.?|id)", "report (?:number|no\\.?|id)", "accession (?:number|no\\.?|#)?", "sample id"], 90);
  fields.productName = labeled(text, ["product(?: name)?", "sample name", "material name", "peptide"], 120);
  fields.compound = labeled(text, ["compound(?: name)?", "analyte"], 120) || fields.productName;
  fields.strength = labeled(text, ["strength", "concentration", "fill(?: weight)?"], 60);
  if (!fields.strength) fields.strength = clean(text.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg)\b/i)?.[0] || "");
  fields.batch = labeled(text, ["batch(?: number| no\\.?)?", "lot(?: number| no\\.?)?"], 90);
  fields.lot = labeled(text, ["lot(?: number| no\\.?)?", "batch(?: number| no\\.?)?"], 90) || fields.batch;
  fields.date = detectCoaDate(text).value;
  fields.purity = firstPercent(text);
  fields.laboratory = identifyLaboratory(text);
  const methods = [...new Set((text.match(/\b(?:RP-?HPLC|HPLC|UPLC|LC[–—-]?MS|MS\/MS|MASS SPECTROMETRY)\b/gi) || []).map((item) => item.toUpperCase()))];
  fields.method = methods.slice(0, 3).join(" · ");
  const assays = detectCoaAssays(text);
  fields.tested = assays.map((assay) => `${assay.name}: ${assay.result}`).join(" · ") ||
    labeled(text, ["test(?:ed)? for", "tests? performed", "analysis performed"], 180) || fields.method;
  return fields;
}

function textLines(items: unknown): string {
  const source = items as { items?: Array<{ str?: string; transform?: number[] }> };
  const positioned = (source.items || []).flatMap((item) => {
    const value = clean(item.str || "");
    if (!value) return [];
    return [{ value, x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0) }];
  });
  const rows: Array<{ y: number; items: typeof positioned }> = [];
  for (const item of positioned.sort((left, right) => right.y - left.y || left.x - right.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.value).join(" | "))
    .join("\n");
}

export async function analyzeCoaPdf(content: Buffer): Promise<CoaDocumentAnalysis> {
  try {
    const loadingTask = getDocument({
      data: new Uint8Array(content),
      disableFontFace: true,
      useWorkerFetch: false,
    });
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 12); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const contentItems = await page.getTextContent();
      pages.push(textLines(contentItems));
    }
    const text = pages.join("\n");
    const fields = detectCoaFields(text);
    const assays = detectCoaAssays(text);
    const dateDetection = detectCoaDate(text);
    const detectedFieldCount = Object.values(fields).filter(Boolean).length;
    const warnings: string[] = [];
    if (!text.trim()) warnings.push("This PDF has no selectable text. Review every field manually or upload a text-based report.");
    if (!fields.productName) warnings.push("Product was not detected.");
    if (!fields.batch) warnings.push("Batch or lot was not detected.");
    if (!fields.coaNumber) warnings.push("Certificate number was not detected.");
    if (dateDetection.confidence === "fallback") {
      warnings.push(`A specific test or analysis date was not found. ${dateDetection.label} was suggested only as a fallback; confirm the actual testing date before publication.`);
    }
    if (dateDetection.confidence === "missing") {
      warnings.push("Test or analysis date was not detected. Enter and confirm the actual laboratory testing date before publication.");
    }
    return {
      status: detectedFieldCount >= 3 && dateDetection.confidence === "explicit" ? "complete" : "limited",
      fields,
      assays,
      dateDetection,
      detectedFieldCount,
      pageCount: document.numPages,
      warnings,
    };
  } catch {
    return {
      status: "failed",
      fields: emptyFields(),
      assays: [],
      dateDetection: { value: "", source: "unknown", label: "Not detected", confidence: "missing" },
      detectedFieldCount: 0,
      pageCount: 0,
      warnings: ["The PDF was stored, but its text could not be read automatically. Review every field manually."],
    };
  }
}
