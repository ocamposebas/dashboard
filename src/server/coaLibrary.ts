import { createHash, randomUUID } from "node:crypto";

import type { CommerceCoa } from "./wooCommerceGateway.js";
import { canonicalizeCoaScanValue, coaScanProvider } from "./coaScanResolver.js";

export const COA_STATUSES = ["Review", "Available", "Archived"] as const;
export type CoaStatus = (typeof COA_STATUSES)[number];

export function normalizeCoaStatus(value: unknown): CoaStatus {
  const normalized = String(value || "").trim().toLocaleLowerCase("en");
  if (normalized === "available" || normalized === "publish" || normalized === "published") return "Available";
  if (normalized === "archived" || normalized === "archive") return "Archived";
  return "Review";
}

export function coaSourceFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizedCoaLink(rawValue: string): string {
  const canonical = canonicalizeCoaScanValue(rawValue);
  if (!canonical) throw new Error("Enter a valid HTTP or HTTPS laboratory link");
  const parsed = new URL(canonical);
  if (parsed.protocol !== "https:") throw new Error("Certificate links must use HTTPS");
  return canonical;
}

export function coaLaboratoryFromLink(link: string): string {
  const provider = coaScanProvider(link);
  if (provider === "ils") return "ILS Labs";
  if (provider === "kovera") return "Kovera Labs";
  if (provider === "freedom-diagnostics") return "Freedom Diagnostics";
  return new URL(link).hostname.replace(/^www\./, "");
}

export function draftCoaNumber(value: string): string {
  return `DRAFT-${coaSourceFingerprint(value).slice(0, 12).toUpperCase()}`;
}

export function customCoaId(): string {
  return `coa-${randomUUID()}`;
}

export function importedCoaId(coa: CommerceCoa): string {
  const candidate = String(coa.id || "").trim();
  if (candidate && candidate.length <= 120) return candidate;
  if (coa.wpPostId > 0) return `wp-${coa.wpPostId}`;
  return `legacy-${coaSourceFingerprint(`${coa.coaNumber}:${coa.productName}:${coa.batch}`).slice(0, 24)}`;
}

export function uniqueTextList(value: unknown, maximum = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 240)))]
    .slice(0, maximum);
}

export function safePdfFileName(value: string): string {
  const base = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ");
  const withExtension = /\.pdf$/i.test(base) ? base : `${base || "certificate"}.pdf`;
  return withExtension.slice(0, 240);
}

