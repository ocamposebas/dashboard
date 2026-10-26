import { randomBytes } from "node:crypto";

import type { LegacyAffiliateCoupon } from "../shared/affiliates.js";
import { productSkuBase, skuCandidate } from "../shared/productSku.js";

const REQUEST_TIMEOUT_MS = 30_000;

export interface CommerceImage {
  id: number;
  name: string;
  alt: string;
  src: string;
  thumbnailUrl: string;
}

export interface CommerceProductAttribute {
  id: number;
  name: string;
  options: string[];
  variation: boolean;
}

export interface CommerceProduct {
  id: number;
  name: string;
  slug?: string;
  permalink?: string;
  sku: string;
  type: string;
  status: string;
  catalogVisibility: string;
  visibility: "public" | "hidden" | "private" | "draft";
  price: number;
  regularPrice: number;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  stockQuantity: number | null;
  stockStatus: string;
  category: string;
  categoryId: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  images: CommerceImage[];
  variationIds: number[];
  attributes: CommerceProductAttribute[];
  modifiedAt: string | null;
}

export interface CommerceVariation {
  id: number;
  sku: string;
  price: number;
  regularPrice: number;
  stockQuantity: number | null;
  stockStatus: string;
  image: CommerceImage | null;
  attributes: Array<{ id: number; name: string; option: string }>;
}

export interface CommerceProductWrite {
  name: string;
  sku: string;
  regularPrice: number;
  stockQuantity: number;
  categoryId: number;
  visibility: "public" | "hidden" | "private" | "draft";
  images: Array<{ id?: number; src?: string }>;
  attributeName?: string;
  variants?: Array<{
    id?: number;
    option: string;
    sku: string;
    price: number;
    stock: number;
    imageId?: number;
  }>;
}

export interface CommerceProductCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
  parentId: number;
}

export class CommerceServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly serviceMessage: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`Commerce service returned ${status}${code ? ` (${code})` : ""}: ${serviceMessage}`);
    this.name = "CommerceServiceError";
  }
}

export interface CommerceProductSaleWrite {
  salePrice: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface CommerceOrderLineItem {
  id: number;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  quantity: number;
  price: number;
  subtotal: number;
  subtotalTax: number;
  total: number;
  totalTax: number;
  imageUrl: string | null;
}

export interface CommerceAddress {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email: string;
  phone: string;
}

export interface CommerceCustomerOrderSummary {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: number;
  refundedTotal: number;
  netTotal: number;
  createdAt: string | null;
  paymentMethod: string;
  pointsEarned: number;
  items: Array<{
    productId: number;
    variationId: number;
    name: string;
    sku: string;
    quantity: number;
    total: number;
    imageUrl: string | null;
  }>;
  coupons: string[];
}

export interface CommerceRewardActivity {
  id: string;
  change: number;
  balanceBefore: number;
  balanceAfter: number;
  type: string;
  reason: string;
  createdAt: string | null;
  orderId: number;
}

export interface CommerceCustomerProfile {
  key: string;
  id: number | null;
  accountType: "registered" | "guest";
  username: string;
  role: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  phone: string;
  avatarUrl: string;
  registeredAt: string | null;
  modifiedAt: string | null;
  isPayingCustomer: boolean;
  billing: CommerceAddress;
  shipping: CommerceAddress;
  orderCount: number;
  successfulOrderCount: number;
  grossSpent: number;
  netSpent: number;
  averageOrderValue: number;
  totalItems: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  pointsBalance: number | null;
  pointsEarned: number;
  storeCredit: number | null;
  rewardHistory: CommerceRewardActivity[];
  redemptions: Array<{
    points: number;
    credit: number;
    createdAt: string | null;
  }>;
  topProducts: Array<{
    productId: number;
    name: string;
    sku: string;
    quantity: number;
    spent: number;
    imageUrl: string | null;
  }>;
  orders: CommerceCustomerOrderSummary[];
}

export interface CommerceCustomerDirectory {
  connected: true;
  rewardsLive: boolean;
  customers: CommerceCustomerProfile[];
  totals: {
    profiles: number;
    registeredCustomers: number;
    guestBuyers: number;
    payingCustomers: number;
    lifetimeRevenue: number;
    pointsOutstanding: number | null;
    recordedPointsEarned: number;
    storeCreditOutstanding: number | null;
    orders: number;
  };
  currency: string;
  syncedAt: string;
}

export interface CommerceOrder {
  id: number;
  customerId: number;
  number: string;
  status: string;
  currency: string;
  total: number;
  totalTax: number;
  cartTax: number;
  shippingTotal: number;
  shippingTax: number;
  discountTotal: number;
  discountTax: number;
  paymentMethod: string;
  paymentMethodId: string;
  transactionId: string;
  customer: string;
  location: string;
  customerNote: string;
  createdAt: string | null;
  modifiedAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  billing: CommerceAddress;
  shipping: CommerceAddress;
  lineItems: CommerceOrderLineItem[];
  feeLines: Array<{ id: number; name: string; taxStatus: string; total: number; totalTax: number }>;
  couponLines: Array<{ id: number; code: string; discount: number; discountTax: number }>;
  refunds: Array<{ id: number; reason: string; total: number }>;
  refundedTotal: number;
  refundableTotal: number;
  pointsEarned: number;
  pointsAwarded: boolean;
  storeCreditApplied: boolean;
  storeCreditAmount: number;
  paymentOperations: {
    kind: "manual" | "card" | "bank" | "other";
    reference: string;
    verification: string;
    expiresAt: string | null;
    processingFee: number;
    processingFeeRate: number;
    approvalState: "pending" | "approved" | "rejected" | "not_required";
  };
  agreement: {
    status: "sealed" | "accepted" | "missing";
    acceptedAt: string | null;
    sealedAt: string | null;
    signer: string;
    version: string;
    emailStatus: string;
    emailSentAt: string | null;
    fileName: string;
    downloadAvailable: boolean;
  };
  shippingOperations: {
    carrier: string;
    service: string;
    exported: boolean;
    shippedItemCount: number;
    shipmentIds: string[];
    protectionSelected: boolean;
    protectionFee: number;
    protectionValue: number;
    protectionProvider: string;
    trackingNumber: string;
  };
  repeatOperations: {
    operationalRepeat: boolean;
    sourceOrderId: number;
    requestId: string;
  };
}

export interface CommerceOrderEvidence {
  id: string;
  label: string;
  capturedAt: string | null;
  customerVisible: boolean;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface CommerceOrderEvidenceWorkspace {
  orderId: number;
  items: CommerceOrderEvidence[];
}

export interface CommerceOrderCoaAssignment {
  assignmentId: string;
  coaId: string;
  lot: string;
  quantity: number;
  assignedAt: string | null;
  source: string;
  hasSnapshot: boolean;
}

export interface CommerceOrderCoaCandidate {
  id: string;
  number: string;
  productName: string;
  strength: string;
  lot: string;
  testingDate: string | null;
  laboratory: string;
  currentShippingLot: boolean;
}

export interface CommerceOrderCoaLine {
  itemId: number;
  name: string;
  sku: string;
  quantity: number;
  remainingQuantity: number;
  assignments: CommerceOrderCoaAssignment[];
  candidates: CommerceOrderCoaCandidate[];
}

export interface CommerceOrderCoaWorkspace {
  orderId: number;
  items: CommerceOrderCoaLine[];
}

export interface CommerceOrderNote {
  id: number;
  note: string;
  customerNote: boolean;
  createdAt: string | null;
  author: string;
}

export interface CommerceRestockItem {
  id: number;
  productId: number;
  productName: string;
  status: string;
  expectedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  waitlistCount: number | null;
}

export interface CommerceWaitlistSubscriber {
  id: string;
  productId: number;
  variationId: number;
  name: string;
  email: string;
  phone: string;
  status: string;
  subscribedAt: string | null;
  notifiedAt: string | null;
}

export interface CommerceCoa {
  id: string;
  wpPostId: number;
  matchedProductId: number;
  matchedVariationId: number;
  coaNumber: string;
  productName: string;
  compound: string;
  familyName: string;
  familyKey: string;
  skus: string[];
  strength: string;
  batch: string;
  lot: string;
  date: string;
  status: string;
  purity: string;
  laboratory: string;
  method: string;
  tested: string;
  testingCostTotal?: number;
  batchUnitCount?: number;
  testingCostPerUnit?: number;
  currentShippingLot: boolean;
  fileUrl: string;
  externalFileUrl?: string;
  verifyUrl: string;
  fileAttachmentId: number;
  aliases: string[];
  keywords: string[];
  panelTypes: string[];
  currentCoa: {
    version: string;
    label: string;
    date: string;
    purity: string;
    method: string;
    tested: string;
    verifyUrl: string;
    fileUrl: string;
    fileAttachmentId: number;
    currentShippingLot: boolean;
  };
  history: Array<{
    version: string;
    label: string;
    date: string;
    purity: string;
    method: string;
    tested: string;
    verifyUrl: string;
    fileUrl: string;
  }>;
  historyCount: number;
}

export interface CommerceCoaWrite {
  wpPostId: number;
  coaNumber: string;
  productName: string;
  compound: string;
  familyName: string;
  familyKey: string;
  strength: string;
  batch: string;
  lot: string;
  date: string;
  status: string;
  purity: string;
  laboratory: string;
  method: string;
  tested: string;
  testingCostTotal?: number;
  batchUnitCount?: number;
  currentShippingLot: boolean;
  fileUrl: string;
  verifyUrl: string;
  fileAttachmentId: number;
  matchedProductId: number;
  matchedVariationId: number;
  skus: string[];
  aliases: string[];
  keywords: string[];
  panelTypes: string[];
}

export interface CommerceSiteControls {
  version: string;
  promo: {
    enabled: boolean;
    type: string;
    durationMinutes: number;
    eyebrow: string;
    title: string;
    info: string;
    endsAt: string | null;
    ctaLabel: string;
    ctaUrl: string;
    product: {
      id: number;
      name: string;
      sku: string;
      image: string;
      originalPrice: number;
      promoPrice: number;
      salePriceActive: boolean;
    } | null;
  };
  maintenance: {
    enabled: boolean;
    title: string;
    message: string;
    supportEmail: string;
    updatedAt: string | null;
  };
}

export interface CommerceSiteControlsWrite {
  promo: {
    enabled: boolean;
    type: "general" | "product" | "simple_gifts";
    productId: number;
    salePrice: number;
    sitewideLabel: string;
    eyebrow: string;
    title: string;
    info: string;
    ctaLabel: string;
    ctaUrl: string;
    durationDays: number;
    durationHours: number;
    durationMinutes: number;
    restart: boolean;
  };
  maintenance: {
    enabled: boolean;
    title: string;
    message: string;
    supportEmail: string;
  };
}

export interface CommerceRewardSettings {
  earningEnabled: boolean;
  redemptionEnabled: boolean;
  pointsPerCurrency: number;
  redemptionBlockPoints: number;
  redemptionBlockCredit: number;
  minimumOrderAmount: number;
  maximumPointsPerOrder: number;
  includeShipping: boolean;
  includeTax: boolean;
  rounding: "floor" | "round" | "ceil";
  awardStatuses: Array<"processing" | "completed">;
}

export interface CommerceRewardControl {
  version: string;
  settings: CommerceRewardSettings;
  metrics: {
    customers: number;
    membersWithPoints: number;
    pointsOutstanding: number;
    storeCreditOutstanding: number;
    redeemableCreditLiability: number;
  };
  audit: Array<{
    id: string;
    createdAt: string | null;
    actorName: string;
    reason: string;
    before: CommerceRewardSettings;
    after: CommerceRewardSettings;
  }>;
}

export interface CommerceRewardSettingsWrite {
  settings: CommerceRewardSettings;
  reason: string;
  confirmLiabilityChange: boolean;
}

export interface CommerceRewardAdjustmentWrite {
  operation: "add" | "subtract" | "set";
  amount: number;
  reason: string;
  notifyCustomer: boolean;
}

export interface CommerceRewardAdjustment {
  customerId: number;
  customerName: string;
  customerEmail: string;
  operation: CommerceRewardAdjustmentWrite["operation"];
  change: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  emailSent: boolean | null;
}

interface GatewayConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface PackagingEvidenceEmailAttachment {
  kind: "contents" | "sealed_label";
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: Uint8Array;
}

export interface PackagingEvidenceEmailResult {
  state: "sent" | "uncertain";
  sentAt: string | null;
  replayed: boolean;
  message: string;
}

function multipartField(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    "utf8",
  );
}

function multipartFile(boundary: string, attachment: PackagingEvidenceEmailAttachment): Buffer {
  const extension = attachment.mime === "image/png" ? "png" : attachment.mime === "image/webp" ? "webp" : "jpg";
  const filename = attachment.kind === "contents"
    ? `packed-contents.${extension}`
    : `sealed-package-label.${extension}`;
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${attachment.kind}"; filename="${filename}"\r\nContent-Type: ${attachment.mime}\r\n\r\n`,
      "utf8",
    ),
    Buffer.from(attachment.bytes),
    Buffer.from("\r\n", "utf8"),
  ]);
}

function packagingEvidenceMultipart(input: {
  eventId: string;
  confirmedAt: string;
  attachments: PackagingEvidenceEmailAttachment[];
}): { body: Uint8Array; contentType: string } {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.eventId)) {
    throw new Error("Packaging evidence email requires a stable UUID event id");
  }
  const kinds = new Set(input.attachments.map((attachment) => attachment.kind));
  if (
    input.attachments.length < 1 || input.attachments.length > 2 ||
    kinds.size !== input.attachments.length ||
    input.attachments.some((attachment) => attachment.kind !== "contents" && attachment.kind !== "sealed_label")
  ) {
    throw new Error("One or two unique packaging evidence photos are required for customer email");
  }
  const totalBytes = input.attachments.reduce((total, attachment) => {
    if (attachment.bytes.byteLength <= 0 || attachment.bytes.byteLength > 6 * 1024 * 1024) {
      throw new Error("Packaging evidence email photos must be 6 MB or smaller each");
    }
    return total + attachment.bytes.byteLength;
  }, 0);
  if (totalBytes > 10 * 1024 * 1024) {
    throw new Error("Packaging evidence email attachments must be 10 MB or smaller in total");
  }
  const boundary = `phaseone-evidence-${randomBytes(12).toString("hex")}`;
  const body = Buffer.concat([
    multipartField(boundary, "event_id", input.eventId),
    multipartField(boundary, "confirmed_at", input.confirmedAt),
    ...input.attachments.map((attachment) => multipartFile(boundary, attachment)),
    Buffer.from(`--${boundary}--\r\n`, "utf8"),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export interface ManagedAffiliateCouponWrite {
  wpCouponId?: number | null;
  wpUserId: number;
  code: string;
  discountValue: number;
  commissionValue: number;
  referralUrl: string;
}

export interface ManagedAffiliateCouponResult {
  wpCouponId: number;
  code: string;
  status: "active" | "paused";
}

export interface CommerceCustomerIdentity {
  id: number;
  email: string;
  displayName: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function decodedText(value: unknown): string {
  return text(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (match, code: string) => {
      const point = Number(code);
      return Number.isSafeInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    });
}

function commerceServiceError(status: number, body: string): CommerceServiceError {
  try {
    const payload: unknown = JSON.parse(body);
    const value = record(payload);
    const code = text(value.code).slice(0, 100);
    const message = decodedText(value.message)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return new CommerceServiceError(
      status,
      code,
      message || "The catalog rejected the request.",
      record(value.data),
    );
  } catch {
    const message = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    return new CommerceServiceError(status, "", message || "The catalog rejected the request.");
  }
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown): string | null {
  const supplied = text(value);
  if (!supplied) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(supplied) ? supplied : `${supplied}Z`;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function mapImage(value: unknown, thumbnailOverrides = new Map<number, string>()): CommerceImage | null {
  const image = record(value);
  const src = text(image.src);
  if (!src) return null;
  const id = number(image.id);
  return {
    id,
    name: decodedText(image.name) || decodedText(image.alt) || `Media ${id || "item"}`,
    alt: decodedText(image.alt),
    src,
    thumbnailUrl: thumbnailOverrides.get(id) || text(image.thumbnail) || src,
  };
}

function visibilityFor(status: string, catalogVisibility: string): CommerceProduct["visibility"] {
  if (status === "private") return "private";
  if (status !== "publish") return "draft";
  return catalogVisibility === "hidden" ? "hidden" : "public";
}

function mapProduct(value: unknown, thumbnails = new Map<number, string>()): CommerceProduct {
  const product = record(value);
  const id = number(product.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Commerce product response did not contain a valid id");
  const categories = Array.isArray(product.categories) ? product.categories : [];
  const images = (Array.isArray(product.images) ? product.images : []).flatMap((item) => {
    const mapped = mapImage(item, thumbnails);
    return mapped ? [mapped] : [];
  });
  const attributes = (Array.isArray(product.attributes) ? product.attributes : []).map((item) => {
    const attribute = record(item);
    return {
      id: number(attribute.id), name: decodedText(attribute.name) || "Option",
      options: Array.isArray(attribute.options) ? attribute.options.map(decodedText).filter(Boolean) : [],
      variation: Boolean(attribute.variation),
    };
  });
  const status = text(product.status) || "draft";
  const catalogVisibility = text(product.catalog_visibility) || "visible";
  return {
    id, name: decodedText(product.name) || `Product #${id}`, sku: text(product.sku), type: text(product.type) || "simple",
    slug: text(product.slug), permalink: text(product.permalink),
    status, catalogVisibility, visibility: visibilityFor(status, catalogVisibility), price: number(product.price),
    regularPrice: number(product.regular_price), salePrice: text(product.sale_price) ? number(product.sale_price) : null,
    saleStartsAt: isoDate(product.date_on_sale_from_gmt), saleEndsAt: isoDate(product.date_on_sale_to_gmt),
    stockQuantity: nullableNumber(product.stock_quantity), stockStatus: text(product.stock_status) || "instock",
    category: decodedText(record(categories[0]).name) || "Uncategorized",
    categoryId: Math.max(0, Math.trunc(number(record(categories[0]).id))), imageUrl: images[0]?.src || null,
    thumbnailUrl: images[0]?.thumbnailUrl || null, images,
    variationIds: Array.isArray(product.variations) ? product.variations.map(number).filter((value) => value > 0) : [],
    attributes, modifiedAt: isoDate(product.date_modified_gmt),
  };
}

function mapVariation(value: unknown): CommerceVariation {
  const variation = record(value);
  const id = number(variation.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid product variant id");
  return {
    id, sku: text(variation.sku), price: number(variation.price), regularPrice: number(variation.regular_price),
    stockQuantity: nullableNumber(variation.stock_quantity), stockStatus: text(variation.stock_status) || "instock",
    image: mapImage(variation.image),
    attributes: (Array.isArray(variation.attributes) ? variation.attributes : []).map((item) => {
      const attribute = record(item);
      return { id: number(attribute.id), name: decodedText(attribute.name) || "Option", option: decodedText(attribute.option) };
    }),
  };
}

function mapAddress(value: unknown): CommerceAddress {
  const address = record(value);
  return {
    firstName: text(address.first_name), lastName: text(address.last_name), company: text(address.company),
    address1: text(address.address_1), address2: text(address.address_2), city: text(address.city),
    state: text(address.state), postcode: text(address.postcode), country: text(address.country),
    email: text(address.email), phone: text(address.phone),
  };
}

function mapLineItem(value: unknown): CommerceOrderLineItem | null {
  const item = record(value);
  const productId = number(item.product_id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return null;
  const image = record(item.image);
  return {
    id: number(item.id), productId, variationId: number(item.variation_id), name: text(item.name) || `Product #${productId}`,
    sku: text(item.sku), quantity: Math.max(0, number(item.quantity)), price: number(item.price), subtotal: number(item.subtotal),
    subtotalTax: number(item.subtotal_tax), total: number(item.total), totalTax: number(item.total_tax), imageUrl: text(image.src) || null,
  };
}

function metadataValue(value: unknown, key: string): unknown {
  const source = record(value);
  const metadata = Array.isArray(source.meta_data) ? source.meta_data : [];
  const entry = metadata.find((item) => text(record(item).key) === key);
  return record(entry).value;
}

function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return ["1", "yes", "true", "applied", "complete", "completed"]
    .includes(text(value).trim().toLocaleLowerCase("en"));
}

function metadataText(value: unknown, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = metadataValue(value, key);
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return "";
}

function metadataNumber(value: unknown, ...keys: string[]): number {
  for (const key of keys) {
    const candidate = metadataValue(value, key);
    if (candidate === "" || candidate === null || candidate === undefined) continue;
    const parsed = number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item) || String(number(item))).filter(Boolean);
  const valueText = text(value).trim();
  if (!valueText) return [];
  try {
    const parsed: unknown = JSON.parse(valueText);
    if (Array.isArray(parsed)) return parsed.map((item) => text(item) || String(number(item))).filter(Boolean);
  } catch { /* Some extensions store a single shipment id. */ }
  return [valueText];
}

function paymentKind(methodId: string, methodTitle: string): CommerceOrder["paymentOperations"]["kind"] {
  const method = `${methodId} ${methodTitle}`.toLocaleLowerCase("en");
  if (method.includes("zelle") || method.includes("venmo") || method.includes("manual")) return "manual";
  if (method.includes("prism") || method.includes("card") || method.includes("stripe")) return "card";
  if (method.includes("yodlee") || method.includes("edebit") || method.includes("bank")) return "bank";
  return "other";
}

function mapOrder(value: unknown): CommerceOrder {
  const order = record(value);
  const id = number(order.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Commerce order response did not contain a valid id");
  const billing = mapAddress(order.billing);
  const shipping = mapAddress(order.shipping);
  const name = [billing.firstName, billing.lastName].filter(Boolean).join(" ");
  const location = [billing.city, billing.country].filter(Boolean).join(", ");
  const lineItems = (Array.isArray(order.line_items) ? order.line_items : []).flatMap((item) => {
    const mapped = mapLineItem(item);
    return mapped ? [mapped] : [];
  });
  const feeLines = (Array.isArray(order.fee_lines) ? order.fee_lines : []).map((value) => {
    const fee = record(value);
    return { id: number(fee.id), name: text(fee.name) || "Additional fee", taxStatus: text(fee.tax_status), total: number(fee.total), totalTax: number(fee.total_tax) };
  });
  const couponLines = (Array.isArray(order.coupon_lines) ? order.coupon_lines : []).map((value) => {
    const coupon = record(value);
    return { id: number(coupon.id), code: text(coupon.code), discount: number(coupon.discount), discountTax: number(coupon.discount_tax) };
  });
  const refunds = (Array.isArray(order.refunds) ? order.refunds : []).map((value) => {
    const refund = record(value);
    return { id: number(refund.id), reason: text(refund.reason), total: number(refund.total) };
  });
  const total = number(order.total);
  const refundedTotal = refunds.reduce((sum, refund) => sum + Math.abs(refund.total), 0);
  const methodId = text(order.payment_method);
  const methodTitle = text(order.payment_method_title) || "Not specified";
  const kind = paymentKind(methodId, methodTitle);
  const reference = metadataText(order, "_phaseone_payment_reference", "_phaseone_manual_payment_reference", "payment_reference") || text(order.transaction_id);
  const manualPaymentStatus = metadataText(
    order,
    "_phaseone_manual_payment_status",
    "_phaseone_payment_verification",
  ).toLocaleLowerCase("en");
  const agreementStatus = metadataText(order, "_phaseone_contract_archive_status").toLocaleLowerCase("en");
  const acceptedAt = isoDate(metadataValue(order, "_phaseone_contract_accepted_at"));
  const fileName = metadataText(order, "_phaseone_contract_pdf_filename");
  const rawShipmentIds = metadataValue(order, "_shipstation_processed_shipments");
  const protectionFeeLine = feeLines.find((fee) => /(?:shipping|package)\s+protection|insurance/i.test(fee.name));
  const protectionFee = Math.max(
    0,
    metadataNumber(order, "_phaseone_shipping_protection_fee"),
    protectionFeeLine ? protectionFeeLine.total + protectionFeeLine.totalTax : 0,
  );
  return {
    id, customerId: Math.max(0, number(order.customer_id)), number: text(order.number) || String(id), status: text(order.status) || "pending", currency: text(order.currency) || "USD",
    total, totalTax: number(order.total_tax), cartTax: number(order.cart_tax), shippingTotal: number(order.shipping_total),
    shippingTax: number(order.shipping_tax), discountTotal: number(order.discount_total), discountTax: number(order.discount_tax),
    paymentMethod: methodTitle, paymentMethodId: methodId, transactionId: text(order.transaction_id),
    customer: name || "Guest customer", location: location || "Location unavailable", customerNote: text(order.customer_note),
    createdAt: isoDate(order.date_created_gmt), modifiedAt: isoDate(order.date_modified_gmt), paidAt: isoDate(order.date_paid_gmt || order.date_paid),
    completedAt: isoDate(order.date_completed_gmt), billing, shipping, lineItems, feeLines, couponLines, refunds,
    refundedTotal, refundableTotal: Math.max(0, total - refundedTotal),
    pointsEarned: Math.max(0, number(metadataValue(order, "_lab_points_earned"))),
    pointsAwarded: truthy(metadataValue(order, "_lab_points_awarded")),
    storeCreditApplied: truthy(metadataValue(order, "_lab_store_credit_applied")),
    storeCreditAmount: Math.max(0, number(metadataValue(order, "_lab_store_credit_amount"))),
    paymentOperations: {
      kind,
      reference,
      verification: metadataText(order, "_phaseone_processing_fee_verification", "_phaseone_payment_verification", "_phaseone_manual_payment_status"),
      expiresAt: isoDate(metadataValue(order, "_phaseone_manual_payment_expiration_iso")),
      processingFee: Math.max(0, metadataNumber(order, "_phaseone_processing_fee_amount", "_phaseone_card_processing_fee")),
      processingFeeRate: Math.max(0, metadataNumber(order, "_phaseone_processing_fee_rate")),
      approvalState: kind !== "manual"
        ? "not_required"
        : ["approved", "verified", "paid", "complete", "completed"].includes(manualPaymentStatus) ||
            ["processing", "completed"].includes(text(order.status))
          ? "approved"
          : ["rejected", "declined", "failed"].includes(manualPaymentStatus) ||
              ["cancelled", "failed", "refunded"].includes(text(order.status))
            ? "rejected"
            : "pending",
    },
    agreement: {
      status: agreementStatus === "sealed" ? "sealed" : acceptedAt ? "accepted" : "missing",
      acceptedAt,
      sealedAt: isoDate(metadataValue(order, "_phaseone_contract_archived_at")),
      signer: metadataText(order, "_phaseone_contract_signer"),
      version: metadataText(order, "_phaseone_contract_version"),
      emailStatus: metadataText(order, "_phaseone_contract_email_status"),
      emailSentAt: isoDate(metadataValue(order, "_phaseone_contract_email_sent_at")),
      fileName,
      downloadAvailable: Boolean(fileName || metadataText(order, "_phaseone_contract_pdf_chunk_1")),
    },
    shippingOperations: {
      carrier: metadataText(order, "_phaseone_shipping_carrier", "_shipping_carrier"),
      service: metadataText(order, "_phaseone_shipping_service", "_shipping_service"),
      exported: truthy(metadataValue(order, "_shipstation_exported")),
      shippedItemCount: Math.max(0, Math.round(metadataNumber(order, "_shipstation_shipped_item_count"))),
      shipmentIds: textArray(rawShipmentIds),
      protectionSelected: protectionFee > 0 || truthy(metadataValue(order, "_phaseone_shipping_protection_selected")) || truthy(metadataValue(order, "_phaseone_shipstation_insurance")),
      protectionFee,
      protectionValue: Math.max(0, metadataNumber(order, "_phaseone_shipping_protection_value")),
      protectionProvider: metadataText(order, "_phaseone_shipping_protection_provider"),
      trackingNumber: metadataText(order, "_phaseone_shipping_tracking_number", "_tracking_number", "_shipstation_tracking_number", "tracking_number"),
    },
    repeatOperations: {
      operationalRepeat: truthy(metadataValue(order, "_phaseone_operational_repeat")),
      sourceOrderId: Math.max(0, Math.trunc(metadataNumber(order, "_phaseone_repeated_from_order_id"))),
      requestId: metadataText(order, "_phaseone_repeat_request_id"),
    },
  };
}

function listFromPayload(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const payload = record(value);
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  return [];
}

function mapEvidenceWorkspace(value: unknown, orderId: number): CommerceOrderEvidenceWorkspace {
  const values = listFromPayload(value, "evidence", "items", "records");
  return {
    orderId,
    items: values.flatMap((item) => {
      const evidence = record(item);
      const id = text(evidence.id || evidence.evidence_id);
      if (!id) return [];
      return [{
        id,
        label: decodedText(evidence.label || evidence.title) || "Order evidence",
        capturedAt: isoDate(evidence.captured_at || evidence.created_at || evidence.date),
        customerVisible: Boolean(evidence.customer_visible),
        mime: text(evidence.mime || evidence.mime_type) || "application/octet-stream",
        width: Math.max(0, Math.round(number(evidence.width))),
        height: Math.max(0, Math.round(number(evidence.height))),
        bytes: Math.max(0, Math.round(number(evidence.bytes || evidence.file_size))),
        url: text(evidence.url || evidence.file_url || evidence.download_url || evidence.preview_url),
      }];
    }),
  };
}

function mapCoaWorkspace(value: unknown, orderId: number): CommerceOrderCoaWorkspace {
  const items = listFromPayload(value, "items", "line_items");
  return {
    orderId,
    items: items.flatMap((item) => {
      const line = record(item);
      const itemId = Math.round(number(line.item_id || line.id));
      if (itemId <= 0) return [];
      const assignments = (Array.isArray(line.assignments) ? line.assignments : []).flatMap((value) => {
        const assignment = record(value);
        const assignmentId = text(assignment.assignment_id || assignment.id);
        return assignmentId ? [{
          assignmentId,
          coaId: text(assignment.coa_id),
          lot: decodedText(assignment.lot),
          quantity: Math.max(0, number(assignment.quantity)),
          assignedAt: isoDate(assignment.assigned_at),
          source: text(assignment.source),
          hasSnapshot: Boolean(assignment.has_snapshot),
        }] : [];
      });
      const candidates = (Array.isArray(line.candidates) ? line.candidates : []).flatMap((value) => {
        const candidate = record(value);
        const id = text(candidate.id || candidate.coa_id);
        return id ? [{
          id,
          number: decodedText(candidate.number || candidate.coa_number),
          productName: decodedText(candidate.product_name),
          strength: decodedText(candidate.strength),
          lot: decodedText(candidate.lot || candidate.batch),
          testingDate: isoDate(candidate.testing_date || candidate.date),
          laboratory: decodedText(candidate.laboratory),
          currentShippingLot: Boolean(candidate.current_shipping_lot),
        }] : [];
      });
      return [{
        itemId,
        name: decodedText(line.name) || `Line item ${itemId}`,
        sku: text(line.sku),
        quantity: Math.max(0, number(line.quantity)),
        remainingQuantity: Math.max(0, number(line.remaining_quantity)),
        assignments,
        candidates,
      }];
    }),
  };
}

function mapOrderNotes(value: unknown): CommerceOrderNote[] {
  return listFromPayload(value, "notes", "items").flatMap((item) => {
    const note = record(item);
    const id = Math.round(number(note.id));
    if (id <= 0) return [];
    return [{
      id,
      note: decodedText(note.note),
      customerNote: Boolean(note.customer_note),
      createdAt: isoDate(note.date_created_gmt || note.date_created),
      author: decodedText(note.author) || "System",
    }];
  });
}

function mapRestocks(value: unknown): CommerceRestockItem[] {
  return listFromPayload(value, "restocks", "items", "data").flatMap((item) => {
    const restock = record(item);
    const id = Math.round(number(restock.id || restock.restock_id));
    if (id <= 0) return [];
    return [{
      id,
      productId: Math.max(0, Math.round(number(restock.product_id || restock.productId))),
      productName: decodedText(restock.product_name || restock.name || restock.title) || `Restock #${id}`,
      status: decodedText(restock.status) || "Active",
      expectedAt: isoDate(restock.expected_at || restock.expected_date || restock.eta),
      createdAt: isoDate(restock.created_at || restock.date_created),
      updatedAt: isoDate(restock.updated_at || restock.date_modified),
      waitlistCount: restock.waitlist_count === null || restock.waitlist_count === undefined
        ? null
        : Math.max(0, Math.round(number(restock.waitlist_count))),
    }];
  });
}

export function mapWaitlistSubscribers(value: unknown): CommerceWaitlistSubscriber[] {
  const payload = record(value);
  const direct = listFromPayload(value, "subscribers", "subscriber", "items", "data", "results");
  const nested = direct.length ? direct : listFromPayload(payload.data, "subscribers", "subscriber", "items", "results", "records");
  const fragments = nested.every((item) => Object.keys(record(item)).length <= 1) &&
    nested.some((item) => Object.prototype.hasOwnProperty.call(record(item), "meta_data"));
  const records = fragments
    ? nested.reduce<Record<string, unknown>[]>((result, item) => {
        const part = record(item);
        if (Object.prototype.hasOwnProperty.call(part, "id") || result.length === 0) result.push({});
        Object.assign(result[result.length - 1]!, part);
        return result;
      }, [])
    : nested.map(record);
  return records.flatMap((rawSubscriber, index) => {
    const metadata = record(rawSubscriber.meta_data);
    const metaValue = (...keys: string[]): unknown => {
      for (const key of keys) {
        const value = metadata[key];
        if (Array.isArray(value) && value.length) return value[0];
        if (value !== undefined && value !== null && value !== "") return value;
      }
      return undefined;
    };
    const subscriber: Record<string, unknown> = {
      ...rawSubscriber,
      product_id: rawSubscriber.product_id || metaValue("cwginstock_product_id", "cwginstock_pid"),
      variation_id: rawSubscriber.variation_id || metaValue("cwginstock_variation_id"),
      email: rawSubscriber.email || metaValue("cwginstock_subscriber_email"),
      subscriber_name: rawSubscriber.subscriber_name || metaValue("cwginstock_subscriber_name"),
      subscriber_phone: rawSubscriber.subscriber_phone || metaValue("cwginstock_subscriber_phone"),
    };
    const email = text(subscriber.email || subscriber.subscriber_email || subscriber.user_email).trim();
    const idValue = subscriber.id || subscriber.subscriber_id || subscriber.ID;
    const rawId = (typeof idValue === "number" ? String(idValue) : text(idValue)).trim() || `${email}-${index + 1}`;
    if (!email && !rawId) return [];
    const firstName = decodedText(subscriber.first_name || subscriber.firstName);
    const lastName = decodedText(subscriber.last_name || subscriber.lastName);
    const name = decodedText(subscriber.name || subscriber.subscriber_name || subscriber.display_name) ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      (email ? email.split("@")[0] || "Subscriber" : "Subscriber");
    return [{
      id: rawId || `${email}-${index + 1}`,
      productId: Math.max(0, Math.round(number(subscriber.product_id || subscriber.productId || subscriber.product))),
      variationId: Math.max(0, Math.round(number(subscriber.variation_id || subscriber.variationId || subscriber.variant_id))),
      name,
      email,
      phone: text(subscriber.phone || subscriber.billing_phone || subscriber.subscriber_phone),
      status: decodedText(subscriber.status || subscriber.subscriber_status || subscriber.state) || "Subscribed",
      subscribedAt: isoDate(subscriber.subscribed_at || subscriber.created_at || subscriber.date_created || subscriber.created),
      notifiedAt: isoDate(subscriber.notified_at || subscriber.sent_at || subscriber.date_notified || subscriber.updated_at),
    }];
  });
}

interface RegisteredCustomer {
  id: number;
  username: string;
  role: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  registeredAt: string | null;
  modifiedAt: string | null;
  isPayingCustomer: boolean;
  billing: CommerceAddress;
  shipping: CommerceAddress;
  pointsBalance: number | null;
  storeCredit: number | null;
}

interface CustomerRewardsRecord {
  pointsBalance: number | null;
  storeCredit: number | null;
  history: CommerceRewardActivity[];
  redemptions: CommerceCustomerProfile["redemptions"];
}

function nullableMetadataNumber(value: unknown, keys: string[]): number | null {
  for (const key of keys) {
    const candidate = metadataValue(value, key);
    if (candidate === "" || candidate === null || candidate === undefined) continue;
    const parsed = Number.parseFloat(typeof candidate === "number" ? String(candidate) : text(candidate));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function mapCustomer(value: unknown): RegisteredCustomer | null {
  const customer = record(value);
  const id = number(customer.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const firstName = decodedText(customer.first_name);
  const lastName = decodedText(customer.last_name);
  const email = text(customer.email).trim().toLocaleLowerCase("en");
  return {
    id,
    username: text(customer.username),
    role: text(customer.role) || "customer",
    firstName,
    lastName,
    displayName: [firstName, lastName].filter(Boolean).join(" ") || text(customer.username) || email || `Customer #${id}`,
    email,
    avatarUrl: text(customer.avatar_url),
    registeredAt: isoDate(customer.date_created_gmt),
    modifiedAt: isoDate(customer.date_modified_gmt),
    isPayingCustomer: Boolean(customer.is_paying_customer),
    billing: mapAddress(customer.billing),
    shipping: mapAddress(customer.shipping),
    pointsBalance: nullableMetadataNumber(customer, ["_lab_points_balance", "lab_points_balance", "points_balance"]),
    storeCredit: nullableMetadataNumber(customer, ["_lab_store_credit_balance", "lab_store_credit_balance", "store_credit"]),
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeRewardHistory(value: unknown): CommerceRewardActivity[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    const activity = record(item);
    const change = number(activity.change);
    const orderId = number(record(activity.context).order_id || activity.order_id);
    return [{
      id: text(activity.id),
      change,
      balanceBefore: Math.max(0, number(activity.balance_before)),
      balanceAfter: Math.max(0, number(activity.balance_after)),
      type: text(activity.type),
      reason: decodedText(activity.reason),
      createdAt: isoDate(activity.created_at),
      orderId: Math.max(0, orderId),
    }];
  });
}

function safeRedemptions(value: unknown): CommerceCustomerProfile["redemptions"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => {
    const redemption = record(item);
    return {
      points: Math.max(0, number(redemption.points || redemption.points_redeemed)),
      credit: Math.max(0, number(redemption.credit || redemption.credit_amount)),
      createdAt: isoDate(redemption.created_at || redemption.date),
    };
  });
}

function mapRewardsPayload(value: unknown): Map<number, CustomerRewardsRecord> {
  const payload = record(value);
  const rewards = record(payload.rewards);
  const result = new Map<number, CustomerRewardsRecord>();
  for (const [rawId, rawValue] of Object.entries(rewards)) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const entry = record(rawValue);
    result.set(id, {
      pointsBalance: nullableNumber(entry.points_balance),
      storeCredit: nullableNumber(entry.store_credit),
      history: safeRewardHistory(entry.history),
      redemptions: safeRedemptions(entry.redemptions),
    });
  }
  return result;
}

function blankCustomerProfile(customer: RegisteredCustomer): CommerceCustomerProfile {
  return {
    key: `customer:${customer.id}`,
    id: customer.id,
    accountType: "registered",
    username: customer.username,
    role: customer.role,
    firstName: customer.firstName,
    lastName: customer.lastName,
    displayName: customer.displayName,
    email: customer.email || normalizeEmail(customer.billing.email),
    phone: customer.billing.phone,
    avatarUrl: customer.avatarUrl,
    registeredAt: customer.registeredAt,
    modifiedAt: customer.modifiedAt,
    isPayingCustomer: customer.isPayingCustomer,
    billing: customer.billing,
    shipping: customer.shipping,
    orderCount: 0,
    successfulOrderCount: 0,
    grossSpent: 0,
    netSpent: 0,
    averageOrderValue: 0,
    totalItems: 0,
    firstOrderAt: null,
    lastOrderAt: null,
    pointsBalance: customer.pointsBalance,
    pointsEarned: 0,
    storeCredit: customer.storeCredit,
    rewardHistory: [],
    redemptions: [],
    topProducts: [],
    orders: [],
  };
}

function guestCustomerProfile(order: CommerceOrder, identity: string): CommerceCustomerProfile {
  const email = normalizeEmail(order.billing.email);
  const firstName = order.billing.firstName;
  const lastName = order.billing.lastName;
  return {
    key: `guest:${identity}`,
    id: null,
    accountType: "guest",
    username: "",
    role: "guest",
    firstName,
    lastName,
    displayName: [firstName, lastName].filter(Boolean).join(" ") || order.customer || email || "Guest customer",
    email,
    phone: order.billing.phone,
    avatarUrl: "",
    registeredAt: null,
    modifiedAt: null,
    isPayingCustomer: true,
    billing: order.billing,
    shipping: order.shipping,
    orderCount: 0,
    successfulOrderCount: 0,
    grossSpent: 0,
    netSpent: 0,
    averageOrderValue: 0,
    totalItems: 0,
    firstOrderAt: null,
    lastOrderAt: null,
    pointsBalance: null,
    pointsEarned: 0,
    storeCredit: null,
    rewardHistory: [],
    redemptions: [],
    topProducts: [],
    orders: [],
  };
}

function appendCustomerOrder(profile: CommerceCustomerProfile, order: CommerceOrder): void {
  const excludedFromRevenue = ["cancelled", "failed", "trash", "checkout-draft"].includes(order.status);
  const successful = ["processing", "completed"].includes(order.status);
  profile.orderCount += 1;
  if (successful) profile.successfulOrderCount += 1;
  if (!excludedFromRevenue) {
    profile.grossSpent += order.total;
    profile.netSpent += Math.max(0, order.total - order.refundedTotal);
  }
  profile.totalItems += order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
  if (order.pointsAwarded || order.pointsEarned > 0) profile.pointsEarned += order.pointsEarned;
  if (!profile.firstOrderAt || timestamp(order.createdAt) < timestamp(profile.firstOrderAt)) profile.firstOrderAt = order.createdAt;
  if (!profile.lastOrderAt || timestamp(order.createdAt) > timestamp(profile.lastOrderAt)) {
    profile.lastOrderAt = order.createdAt;
    profile.billing = order.billing;
    profile.shipping = order.shipping;
    profile.phone = order.billing.phone || profile.phone;
  }
  profile.orders.push({
    id: order.id,
    number: order.number,
    status: order.status,
    currency: order.currency,
    total: order.total,
    refundedTotal: order.refundedTotal,
    netTotal: Math.max(0, order.total - order.refundedTotal),
    createdAt: order.createdAt,
    paymentMethod: order.paymentMethod,
    pointsEarned: order.pointsEarned,
    items: order.lineItems.map((item) => ({
      productId: item.productId,
      variationId: item.variationId,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      total: item.total,
      imageUrl: item.imageUrl,
    })),
    coupons: order.couponLines.map((coupon) => coupon.code).filter(Boolean),
  });
}

function finalizeCustomerProfile(profile: CommerceCustomerProfile): void {
  profile.averageOrderValue = profile.successfulOrderCount > 0
    ? profile.netSpent / profile.successfulOrderCount
    : 0;
  profile.orders.sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
  const products = new Map<number, CommerceCustomerProfile["topProducts"][number]>();
  for (const order of profile.orders) {
    for (const item of order.items) {
      const current = products.get(item.productId);
      if (current) {
        current.quantity += item.quantity;
        current.spent += item.total;
      } else {
        products.set(item.productId, {
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          spent: item.total,
          imageUrl: item.imageUrl,
        });
      }
    }
  }
  profile.topProducts = [...products.values()]
    .sort((left, right) => right.quantity - left.quantity || right.spent - left.spent)
    .slice(0, 12);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function mapCoa(value: unknown): CommerceCoa | null {
  const coa = record(value);
  const id = text(coa.id) || String(number(coa.wpPostId));
  if (!id || id === "0") return null;
  const history = Array.isArray(coa.history) ? coa.history : [];
  const currentCoa = record(coa.currentCoa);
  return {
    id,
    wpPostId: number(coa.wpPostId),
    matchedProductId: number(coa.matchedProductId),
    matchedVariationId: number(coa.matchedVariationId),
    coaNumber: decodedText(coa.coaNumber),
    productName: decodedText(coa.productName),
    compound: decodedText(coa.compound),
    familyName: decodedText(coa.familyName),
    familyKey: text(coa.familyKey),
    skus: stringList(coa.skus),
    strength: decodedText(coa.strength),
    batch: decodedText(coa.batch),
    lot: decodedText(coa.lot),
    date: text(coa.date),
    status: text(coa.status) || "published",
    purity: decodedText(coa.purity),
    laboratory: decodedText(coa.laboratory),
    method: decodedText(coa.method),
    tested: decodedText(coa.tested),
    currentShippingLot: Boolean(coa.currentShippingLot),
    fileUrl: text(coa.fileUrl),
    verifyUrl: text(coa.verifyUrl),
    fileAttachmentId: number(coa.fileAttachmentId),
    aliases: stringList(coa.aliases),
    keywords: stringList(coa.keywords),
    panelTypes: stringList(coa.panelTypes),
    currentCoa: {
      version: decodedText(currentCoa.version), label: decodedText(currentCoa.label), date: text(currentCoa.date),
      purity: decodedText(currentCoa.purity), method: decodedText(currentCoa.method), tested: decodedText(currentCoa.tested),
      verifyUrl: text(currentCoa.verifyUrl), fileUrl: text(currentCoa.fileUrl),
      fileAttachmentId: number(currentCoa.fileAttachmentId), currentShippingLot: Boolean(currentCoa.currentShippingLot),
    },
    history: history.map((item) => {
      const entry = record(item);
      return {
        version: decodedText(entry.version), label: decodedText(entry.label), date: text(entry.date),
        purity: decodedText(entry.purity), method: decodedText(entry.method), tested: decodedText(entry.tested),
        verifyUrl: text(entry.verifyUrl), fileUrl: text(entry.fileUrl),
      };
    }),
    historyCount: history.length,
  };
}

function mapSiteControls(value: unknown): CommerceSiteControls {
  const controls = record(value);
  const promo = record(controls.promo);
  const maintenance = record(controls.maintenance);
  const productValue = record(promo.product);
  const productId = number(productValue.id);
  return {
    version: text(controls.version),
    promo: {
      enabled: Boolean(promo.enabled),
      type: text(promo.type) || "announcement",
      durationMinutes: Math.max(1, number(promo.duration_minutes) || number(promo.hours) * 60 || 1_440),
      eyebrow: decodedText(promo.eyebrow),
      title: decodedText(promo.title),
      info: decodedText(promo.info),
      endsAt: isoDate(promo.ends_at),
      ctaLabel: decodedText(promo.cta_label),
      ctaUrl: text(promo.cta_url),
      product: productId > 0 ? {
        id: productId,
        name: decodedText(productValue.name),
        sku: text(productValue.sku),
        image: text(productValue.image),
        originalPrice: number(productValue.original_price),
        promoPrice: number(productValue.promo_price),
        salePriceActive: Boolean(productValue.sale_price_active),
      } : null,
    },
    maintenance: {
      enabled: Boolean(maintenance.enabled),
      title: decodedText(maintenance.title),
      message: decodedText(maintenance.message),
      supportEmail: text(maintenance.support_email),
      updatedAt: isoDate(maintenance.updated_at),
    },
  };
}

function mapRewardSettings(value: unknown): CommerceRewardSettings {
  const settings = record(value);
  const roundingValue = text(settings.rounding);
  const awardStatuses = stringList(settings.award_statuses)
    .filter((status): status is "processing" | "completed" => status === "processing" || status === "completed");
  return {
    earningEnabled: Boolean(settings.earning_enabled),
    redemptionEnabled: Boolean(settings.redemption_enabled),
    pointsPerCurrency: Math.max(0.01, number(settings.points_per_currency) || 1),
    redemptionBlockPoints: Math.max(1, Math.round(number(settings.redemption_block_points) || 500)),
    redemptionBlockCredit: Math.max(0.01, number(settings.redemption_block_credit) || 5),
    minimumOrderAmount: Math.max(0, number(settings.minimum_order_amount)),
    maximumPointsPerOrder: Math.max(0, Math.round(number(settings.maximum_points_per_order))),
    includeShipping: Boolean(settings.include_shipping),
    includeTax: Boolean(settings.include_tax),
    rounding: roundingValue === "round" || roundingValue === "ceil" ? roundingValue : "floor",
    awardStatuses: awardStatuses.length ? awardStatuses : ["completed"],
  };
}

function rewardSettingsPayload(settings: CommerceRewardSettings): Record<string, unknown> {
  return {
    earning_enabled: settings.earningEnabled,
    redemption_enabled: settings.redemptionEnabled,
    points_per_currency: settings.pointsPerCurrency,
    redemption_block_points: settings.redemptionBlockPoints,
    redemption_block_credit: settings.redemptionBlockCredit,
    minimum_order_amount: settings.minimumOrderAmount,
    maximum_points_per_order: settings.maximumPointsPerOrder,
    include_shipping: settings.includeShipping,
    include_tax: settings.includeTax,
    rounding: settings.rounding,
    award_statuses: settings.awardStatuses,
  };
}

function mapRewardControl(value: unknown): CommerceRewardControl {
  const payload = record(value);
  const metrics = record(payload.metrics);
  return {
    version: text(payload.version),
    settings: mapRewardSettings(payload.settings),
    metrics: {
      customers: Math.max(0, Math.round(number(metrics.customers))),
      membersWithPoints: Math.max(0, Math.round(number(metrics.members_with_points))),
      pointsOutstanding: Math.max(0, Math.round(number(metrics.points_outstanding))),
      storeCreditOutstanding: Math.max(0, number(metrics.store_credit_outstanding)),
      redeemableCreditLiability: Math.max(0, number(metrics.redeemable_credit_liability)),
    },
    audit: (Array.isArray(payload.audit) ? payload.audit : []).slice(0, 25).map((value) => {
      const entry = record(value);
      return {
        id: text(entry.id),
        createdAt: isoDate(entry.created_at),
        actorName: decodedText(entry.actor_name) || "Operations administrator",
        reason: decodedText(entry.reason),
        before: mapRewardSettings(entry.before),
        after: mapRewardSettings(entry.after),
      };
    }),
  };
}

function visibilityPayload(visibility: CommerceProductWrite["visibility"]): Record<string, unknown> {
  if (visibility === "public") return { status: "publish", catalog_visibility: "visible" };
  if (visibility === "hidden") return { status: "publish", catalog_visibility: "hidden" };
  if (visibility === "private") return { status: "private", catalog_visibility: "hidden" };
  return { status: "draft", catalog_visibility: "hidden" };
}

export class WooCommerceGateway {
  constructor(private readonly config: GatewayConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async listLegacyAffiliateCoupons(): Promise<LegacyAffiliateCoupon[]> {
    const payload = await this.requestAllPages("coupons", {
      orderby: "date",
      order: "desc",
      _fields: "id,code,amount,status,date_expires_gmt,discount_type,usage_count,meta_data",
    });
    const candidates = payload.flatMap((value) => {
      const coupon = record(value);
      const metadata = new Map<string, unknown>();
      for (const item of Array.isArray(coupon.meta_data) ? coupon.meta_data : []) {
        const meta = record(item);
        const key = text(meta.key);
        if (key) metadata.set(key, meta.value);
      }
      const wpUserId = Math.trunc(number(
        metadata.get("wcu_select_coupon_user_id") || metadata.get("wcu_select_coupon_user"),
      ));
      const managed = text(metadata.get("_phaseone_affiliate_coupon_managed")) === "yes";
      if (wpUserId <= 0 && !managed) return [];
      return [{ coupon, metadata, wpUserId }];
    });

    const userIds = [...new Set(candidates.map((item) => item.wpUserId).filter((id) => id > 0))];
    const customerMap = new Map<number, Record<string, unknown>>();
    for (let offset = 0; offset < userIds.length; offset += 100) {
      const batch = userIds.slice(offset, offset + 100);
      const customers = await this.request("customers", {
        parameters: {
          include: batch.join(","),
          role: "all",
          per_page: "100",
          _fields: "id,email,username,first_name,last_name",
        },
      }).catch(() => []);
      if (!Array.isArray(customers)) continue;
      for (const value of customers) {
        const customer = record(value);
        const id = Math.trunc(number(customer.id));
        if (id > 0) customerMap.set(id, customer);
      }
    }

    return candidates.flatMap(({ coupon, metadata, wpUserId }): LegacyAffiliateCoupon[] => {
      const id = Math.trunc(number(coupon.id));
      const code = text(coupon.code).trim();
      if (id <= 0 || wpUserId <= 0 || !code) return [];
      const customer = customerMap.get(wpUserId) || {};
      const stats = record(metadata.get("wcu_alltime_stats"));
      const commissionValue = number(
        metadata.get("_phaseone_affiliate_commission_percent") ||
        metadata.get("wcu_commission_percent") ||
        metadata.get("wcu_commission") ||
        0,
      );
      const expiresAt = isoDate(coupon.date_expires_gmt);
      const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : false;
      const status = expired ? "expired" : text(coupon.status) === "publish" ? "active" : "paused";
      const firstName = decodedText(customer.first_name);
      const lastName = decodedText(customer.last_name);
      return [{
        wpCouponId: id,
        wpUserId,
        code,
        status,
        discountType: ["fixed_cart", "fixed_product"].includes(text(coupon.discount_type))
          ? text(coupon.discount_type) as "fixed_cart" | "fixed_product"
          : "percent",
        discountValue: number(coupon.amount),
        commissionType: text(metadata.get("wcu_commission_type")) === "fixed" ? "fixed" : "percent",
        commissionValue,
        usageCount: Math.max(0, Math.trunc(number(coupon.usage_count))),
        grossSales: number(stats.total_orders),
        totalDiscount: number(stats.full_discount),
        totalCommission: number(stats.total_commission),
        availableCommission: number(metadata.get("wcu_text_unpaid_commission")),
        pendingPayout: number(metadata.get("wcu_text_pending_payment_commission")),
        referralUrl: text(metadata.get("_phaseone_affiliate_public_referral_url")) ||
          text(metadata.get("_phaseone_affiliate_referral_url")) ||
          `${this.config.baseUrl}/?coupon=${encodeURIComponent(code.toUpperCase())}`,
        displayName: [firstName, lastName].filter(Boolean).join(" ") || decodedText(customer.username) || `Affiliate ${wpUserId}`,
        username: decodedText(customer.username),
        email: text(customer.email),
      }];
    });
  }

  async saveManagedAffiliateCoupon(input: ManagedAffiliateCouponWrite): Promise<ManagedAffiliateCouponResult> {
    let wpCouponId = input.wpCouponId && input.wpCouponId > 0 ? Math.trunc(input.wpCouponId) : null;
    if (!wpCouponId) {
      const matches = await this.request("coupons", {
        parameters: { code: input.code.toLowerCase(), per_page: "100", page: "1" },
      });
      if (Array.isArray(matches)) {
        for (const value of matches) {
          const coupon = record(value);
          if (text(coupon.code).trim().toLowerCase() !== input.code.toLowerCase()) continue;
          const metadata = new Map<string, unknown>();
          for (const item of Array.isArray(coupon.meta_data) ? coupon.meta_data : []) {
            const meta = record(item);
            if (text(meta.key)) metadata.set(text(meta.key), meta.value);
          }
          const ownerId = Math.trunc(number(
            metadata.get("wcu_select_coupon_user_id") || metadata.get("wcu_select_coupon_user"),
          ));
          const managed = text(metadata.get("_phaseone_affiliate_coupon_managed")) === "yes";
          if (!managed || ownerId !== input.wpUserId) throw new Error("affiliate_coupon_code_conflict");
          wpCouponId = Math.trunc(number(coupon.id));
          break;
        }
      }
    }

    const body = {
      code: input.code.toLowerCase(),
      status: "publish",
      discount_type: "percent",
      amount: input.discountValue.toFixed(2),
      meta_data: [
        { key: "wcu_select_coupon_user", value: String(input.wpUserId) },
        { key: "wcu_select_coupon_user_id", value: String(input.wpUserId) },
        { key: "wcu_custom_commission", value: "yes" },
        { key: "wcu_enable_custom_commission", value: "yes" },
        { key: "wcu_commission_type", value: "percent" },
        { key: "wcu_custom_commission_type", value: "percent" },
        { key: "wcu_commission_percent", value: String(input.commissionValue) },
        { key: "wcu_commission_percentage", value: String(input.commissionValue) },
        { key: "wcu_commission_rate", value: String(input.commissionValue) },
        { key: "wcu_custom_commission_percent", value: String(input.commissionValue) },
        { key: "wcu_custom_percent", value: String(input.commissionValue) },
        { key: "wcu_commission", value: String(input.commissionValue) },
        { key: "_phaseone_affiliate_coupon_managed", value: "yes" },
        { key: "_phaseone_affiliate_discount_percent", value: String(input.discountValue) },
        { key: "_phaseone_affiliate_commission_percent", value: String(input.commissionValue) },
        { key: "_phaseone_affiliate_referral_url", value: input.referralUrl },
        { key: "_phaseone_affiliate_public_referral_url", value: input.referralUrl },
        { key: "_phaseone_affiliate_referral_base_url", value: "https://phaseonelabz.com/" },
      ],
    };
    const saved = record(await this.request(wpCouponId ? `coupons/${wpCouponId}` : "coupons", {
      method: wpCouponId ? "PUT" : "POST",
      body,
    }));
    const savedId = Math.trunc(number(saved.id));
    if (savedId <= 0) throw new Error("affiliate_coupon_save_failed");
    return {
      wpCouponId: savedId,
      code: text(saved.code) || input.code,
      status: text(saved.status) === "publish" ? "active" : "paused",
    };
  }

  async findCustomerIdentityByEmail(email: string): Promise<CommerceCustomerIdentity | null> {
    const payload = await this.request("customers", {
      parameters: {
        email: email.trim().toLowerCase(),
        role: "all",
        per_page: "10",
        page: "1",
        _fields: "id,email,first_name,last_name,username",
      },
    });
    if (!Array.isArray(payload)) return null;
    const expected = email.trim().toLowerCase();
    for (const value of payload) {
      const customer = record(value);
      const customerEmail = text(customer.email).trim().toLowerCase();
      const id = Math.trunc(number(customer.id));
      if (id <= 0 || customerEmail !== expected) continue;
      const displayName = [decodedText(customer.first_name), decodedText(customer.last_name)]
        .filter(Boolean)
        .join(" ") || decodedText(customer.username) || customerEmail;
      return { id, email: customerEmail, displayName };
    }
    return null;
  }

  async setManagedAffiliateCouponsActive(wpCouponIds: number[], active: boolean): Promise<void> {
    const ids = [...new Set(wpCouponIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
    for (let offset = 0; offset < ids.length; offset += 10) {
      await Promise.all(ids.slice(offset, offset + 10).map((id) =>
        this.request(`coupons/${id}`, {
          method: "PUT",
          body: { status: active ? "publish" : "draft" },
        }),
      ));
    }
  }

  async listProducts(): Promise<CommerceProduct[]> {
    const [payload, thumbnails] = await Promise.all([
      this.requestAllPages("products", {
        orderby: "modified", order: "desc", status: "any",
        _fields: "id,name,slug,permalink,sku,type,status,catalog_visibility,price,regular_price,sale_price,date_on_sale_from_gmt,date_on_sale_to_gmt,stock_quantity,stock_status,categories,images,variations,attributes,date_modified_gmt",
      }),
      this.listPublicThumbnails().catch(() => new Map<number, string>()),
    ]);
    if (!Array.isArray(payload)) throw new Error("Commerce products response was not an array");
    return payload
      .flatMap((value) => { try { return [mapProduct(value, thumbnails)]; } catch { return []; } })
      .filter((product) => product.status !== "trash");
  }

  async listProductCategories(): Promise<CommerceProductCategory[]> {
    const payload = await this.requestAllPages("products/categories", {
      hide_empty: "false",
      orderby: "name",
      order: "asc",
      _fields: "id,name,slug,count,parent",
    });
    return payload.flatMap((value) => {
      const category = record(value);
      const id = Math.trunc(number(category.id));
      if (id <= 0) return [];
      return [{
        id,
        name: decodedText(category.name) || `Category ${id}`,
        slug: text(category.slug),
        count: Math.max(0, Math.trunc(number(category.count))),
        parentId: Math.max(0, Math.trunc(number(category.parent))),
      }];
    });
  }

  async findProductsBySku(sku: string): Promise<CommerceProduct[]> {
    const normalized = sku.trim();
    if (!normalized) return [];
    const payload = await this.request("products", {
      parameters: {
        sku: normalized,
        per_page: "100",
        status: "any",
        _fields: "id,name,slug,permalink,sku,type,status,catalog_visibility,price,regular_price,sale_price,date_on_sale_from_gmt,date_on_sale_to_gmt,stock_quantity,stock_status,categories,images,variations,attributes,date_modified_gmt",
      },
    });
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((value) => {
      try { return [mapProduct(value)]; } catch { return []; }
    });
  }

  async suggestAvailableProductSku(
    nameOrSku: string,
    excludedIds: number[] = [],
    reservedSkus: string[] = [],
  ): Promise<string> {
    const base = productSkuBase(nameOrSku);
    const excluded = new Set(excludedIds.filter((id) => Number.isSafeInteger(id) && id > 0));
    const reserved = new Set(reservedSkus.map((sku) => sku.trim().toLocaleUpperCase("en")).filter(Boolean));
    for (let suffix = 0; suffix <= 99; suffix += 1) {
      const candidate = skuCandidate(base, suffix);
      if (reserved.has(candidate.toLocaleUpperCase("en"))) continue;
      const matches = await this.findProductsBySku(candidate);
      if (matches.every((product) => excluded.has(product.id))) return candidate;
    }
    throw new Error("No available SKU could be generated for this product name");
  }

  async getProduct(productId: number): Promise<CommerceProduct> {
    return mapProduct(await this.request(`products/${productId}`));
  }

  async listProductVariations(productId: number): Promise<CommerceVariation[]> {
    const payload = await this.request(`products/${productId}/variations`, { parameters: { per_page: "100", page: "1" } });
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((value) => { try { return [mapVariation(value)]; } catch { return []; } });
  }

  async saveProduct(productId: number | null, input: CommerceProductWrite): Promise<CommerceProduct> {
    const variants = input.variants || [];
    const body: Record<string, unknown> = {
      name: input.name, sku: input.sku, regular_price: input.regularPrice.toFixed(2), images: input.images,
      categories: input.categoryId > 0 ? [{ id: input.categoryId }] : [],
      ...visibilityPayload(input.visibility),
    };
    if (variants.length) {
      body.type = "variable";
      body.manage_stock = false;
      body.stock_status = variants.some((variant) => variant.stock > 0) ? "instock" : "outofstock";
      body.attributes = [{ name: input.attributeName || "Option", visible: true, variation: true, options: variants.map((item) => item.option) }];
    } else {
      body.manage_stock = true;
      body.stock_quantity = Math.max(0, Math.floor(input.stockQuantity));
    }
    const saved = mapProduct(await this.request(productId ? `products/${productId}` : "products", {
      method: productId ? "PUT" : "POST", body,
    }));
    for (const variant of variants) {
      const variationBody: Record<string, unknown> = {
        sku: variant.sku, regular_price: variant.price.toFixed(2), manage_stock: true,
        stock_quantity: Math.max(0, Math.floor(variant.stock)),
        attributes: [{ name: input.attributeName || "Option", option: variant.option }],
        ...(variant.imageId ? { image: { id: variant.imageId } } : {}),
      };
      await this.request(`products/${saved.id}/variations${variant.id ? `/${variant.id}` : ""}`, {
        method: variant.id ? "PUT" : "POST", body: variationBody,
      });
    }
    if (!variants.length) return saved;

    // WooCommerce occasionally keeps an old parent stock flag after child
    // variations are edited. Reassert the aggregate state after all children
    // have been saved and return that final canonical product to the caller.
    return mapProduct(await this.request(`products/${saved.id}`, {
      method: "PUT",
      body: {
        manage_stock: false,
        stock_status: variants.some((variant) => variant.stock > 0) ? "instock" : "outofstock",
      },
    }));
  }

  async setProductSale(productId: number, input: CommerceProductSaleWrite): Promise<CommerceProduct> {
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error("A valid product id is required");
    const salePrice = input.salePrice;
    if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0)) {
      throw new Error("A valid promotional price is required");
    }
    const commerceDate = (value: string | null) => {
      if (!value) return "";
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) throw new Error("A valid promotion schedule is required");
      return parsed.toISOString().replace(/\.\d{3}Z$/, "");
    };
    return mapProduct(await this.request(`products/${productId}`, {
      method: "PUT",
      body: {
        sale_price: salePrice === null ? "" : salePrice.toFixed(2),
        date_on_sale_from_gmt: salePrice === null ? "" : commerceDate(input.startsAt),
        date_on_sale_to_gmt: salePrice === null ? "" : commerceDate(input.endsAt),
      },
    }));
  }

  async trashProduct(productId: number): Promise<CommerceProduct> {
    return mapProduct(await this.request(`products/${productId}`, {
      method: "DELETE",
      parameters: { force: "false" },
    }));
  }

  async listOrders(limit = 100): Promise<CommerceOrder[]> {
    const pageSize = Math.max(1, Math.min(100, Math.trunc(limit) || 100));
    const payload = await this.request("orders", { parameters: {
      per_page: String(pageSize), page: "1", orderby: "date", order: "desc", status: "any",
      _fields: "id,customer_id,number,status,currency,total,total_tax,cart_tax,shipping_total,shipping_tax,discount_total,discount_tax,payment_method,payment_method_title,transaction_id,customer_note,date_created_gmt,date_modified_gmt,date_paid_gmt,date_completed_gmt,billing,shipping,line_items,fee_lines,coupon_lines,refunds,meta_data",
    } });
    if (!Array.isArray(payload)) throw new Error("Commerce orders response was not an array");
    return payload.flatMap((value) => { try { return [mapOrder(value)]; } catch { return []; } });
  }

  async listOrdersForPeriod(after: string, before: string): Promise<CommerceOrder[]> {
    const fields = "id,customer_id,number,status,currency,total,total_tax,cart_tax,shipping_total,shipping_tax,discount_total,discount_tax,payment_method,payment_method_title,transaction_id,customer_note,date_created_gmt,date_modified_gmt,date_paid_gmt,date_completed_gmt,billing,shipping,line_items,fee_lines,coupon_lines,refunds,meta_data";
    const payload = await this.requestAllPages("orders", {
      after,
      before,
      dates_are_gmt: "true",
      orderby: "date",
      order: "desc",
      status: "any",
      _fields: fields,
    });
    return payload.flatMap((value) => {
      try { return [mapOrder(value)]; } catch { return []; }
    });
  }

  async listOrdersModifiedSince(after: string, _before: string): Promise<CommerceOrder[]> {
    const fields = "id,customer_id,number,status,currency,total,total_tax,cart_tax,shipping_total,shipping_tax,discount_total,discount_tax,payment_method,payment_method_title,transaction_id,customer_note,date_created_gmt,date_modified_gmt,date_paid_gmt,date_completed_gmt,billing,shipping,line_items,fee_lines,coupon_lines,refunds,meta_data";
    // WooCommerce applies the store offset twice to modified_before on some sites
    // when dates_are_gmt is present. That can exclude the newest orders from an
    // incremental scan. The durable cursor already overlaps by two days, so an
    // open upper bound is both safe and idempotent and cannot lose recent sales.
    const payload = await this.requestAllPages("orders", {
      modified_after: after,
      orderby: "modified",
      order: "asc",
      status: "any",
      _fields: fields,
    });
    return payload.flatMap((value) => {
      try { return [mapOrder(value)]; } catch { return []; }
    });
  }

  async listFulfillmentOrders(): Promise<CommerceOrder[]> {
    const fields = "id,customer_id,number,status,currency,total,total_tax,cart_tax,shipping_total,shipping_tax,discount_total,discount_tax,payment_method,payment_method_title,transaction_id,customer_note,date_created_gmt,date_modified_gmt,date_paid_gmt,date_completed_gmt,billing,shipping,line_items,fee_lines,coupon_lines,refunds,meta_data";
    const pages = await Promise.all(["processing", "on-hold", "pending"].map((status) =>
      this.requestAllPages("orders", {
        status,
        orderby: "date",
        order: "desc",
        _fields: fields,
      })));
    const orders = pages.flat().flatMap((value) => {
      try { return [mapOrder(value)]; } catch { return []; }
    });
    return [...new Map(orders.map((order) => [order.id, order])).values()]
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
  }

  async getCustomerDirectory(): Promise<CommerceCustomerDirectory> {
    const customerFields = "id,date_created_gmt,date_modified_gmt,email,first_name,last_name,role,username,billing,shipping,is_paying_customer,avatar_url,meta_data";
    const orderFields = "id,customer_id,number,status,currency,total,total_tax,cart_tax,shipping_total,shipping_tax,discount_total,discount_tax,payment_method,payment_method_title,transaction_id,customer_note,date_created_gmt,date_modified_gmt,date_paid_gmt,date_completed_gmt,billing,shipping,line_items,fee_lines,coupon_lines,refunds,meta_data";
    const [customerPayload, orderPayload, rewardsResult] = await Promise.all([
      this.requestAllPages("customers", {
        orderby: "registered_date", order: "desc", _fields: customerFields,
      }),
      this.requestAllPages("orders", {
        orderby: "date", order: "desc", status: "any", _fields: orderFields,
      }),
      this.requestRoute("/wp-json/phaseone-ops/v1/customers/rewards", {
        headers: {
          "X-PhaseOne-Consumer-Key": this.config.consumerKey,
          "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
        },
      }, false).then((payload) => ({ live: true, rewards: mapRewardsPayload(payload) }))
        .catch(() => ({ live: false, rewards: new Map<number, CustomerRewardsRecord>() })),
    ]);

    const registered = customerPayload.flatMap((value) => {
      const mapped = mapCustomer(value);
      return mapped ? [mapped] : [];
    });
    const orders = orderPayload.flatMap((value) => {
      try { return [mapOrder(value)]; } catch { return []; }
    });
    const profiles = registered.map(blankCustomerProfile);
    const byId = new Map<number, CommerceCustomerProfile>();
    const byEmail = new Map<string, CommerceCustomerProfile>();
    for (const profile of profiles) {
      if (profile.id) byId.set(profile.id, profile);
      if (profile.email) byEmail.set(normalizeEmail(profile.email), profile);
    }

    for (const order of orders) {
      const email = normalizeEmail(order.billing.email);
      let profile = order.customerId > 0 ? byId.get(order.customerId) : undefined;
      if (!profile && email) profile = byEmail.get(email);
      if (!profile) {
        const identity = email || `${normalizeEmail(order.customer)}:${order.billing.phone || order.id}`;
        profile = guestCustomerProfile(order, identity);
        profiles.push(profile);
        if (email) byEmail.set(email, profile);
      }
      appendCustomerOrder(profile, order);
    }

    for (const profile of profiles) {
      if (profile.id) {
        const rewards = rewardsResult.rewards.get(profile.id);
        if (rewards) {
          profile.pointsBalance = rewards.pointsBalance ?? profile.pointsEarned;
          profile.storeCredit = rewards.storeCredit ?? 0;
          profile.rewardHistory = rewards.history;
          profile.redemptions = rewards.redemptions;
        } else if (rewardsResult.live) {
          profile.pointsBalance = profile.pointsEarned;
          profile.storeCredit = 0;
        }
      }
      finalizeCustomerProfile(profile);
    }
    profiles.sort((left, right) =>
      timestamp(right.lastOrderAt) - timestamp(left.lastOrderAt) ||
      timestamp(right.registeredAt) - timestamp(left.registeredAt) ||
      left.displayName.localeCompare(right.displayName, "en"),
    );

    const currency = orders.find((order) => order.currency)?.currency || "USD";
    const knownBalances = profiles.filter((profile) => profile.pointsBalance !== null);
    const knownCredits = profiles.filter((profile) => profile.storeCredit !== null);
    return {
      connected: true,
      rewardsLive: rewardsResult.live,
      customers: profiles,
      totals: {
        profiles: profiles.length,
        registeredCustomers: registered.length,
        guestBuyers: profiles.filter((profile) => profile.accountType === "guest").length,
        payingCustomers: profiles.filter((profile) => profile.orderCount > 0).length,
        lifetimeRevenue: profiles.reduce((sum, profile) => sum + profile.netSpent, 0),
        pointsOutstanding: rewardsResult.live
          ? knownBalances.reduce((sum, profile) => sum + (profile.pointsBalance || 0), 0)
          : null,
        recordedPointsEarned: profiles.reduce((sum, profile) => sum + profile.pointsEarned, 0),
        storeCreditOutstanding: rewardsResult.live
          ? knownCredits.reduce((sum, profile) => sum + (profile.storeCredit || 0), 0)
          : null,
        orders: orders.length,
      },
      currency,
      syncedAt: new Date().toISOString(),
    };
  }

  async listCoas(): Promise<CommerceCoa[]> {
    const payload = await this.requestRoute("/wp-json/phaseone/v1/coas", {}, false);
    if (!Array.isArray(payload)) throw new Error("COA service response was not an array");
    return payload.flatMap((value) => {
      const mapped = mapCoa(value);
      return mapped ? [mapped] : [];
    });
  }

  async getOperationsBridgeStatus(): Promise<{ connected: boolean; version: string; capabilities: string[] }> {
    const payload = record(await this.requestRoute("/wp-json/phaseone-ops/v1/status", {
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false));
    return {
      connected: Boolean(payload.connected),
      version: text(payload.version),
      capabilities: stringList(payload.capabilities),
    };
  }

  async saveCoa(input: CommerceCoaWrite): Promise<CommerceCoa> {
    const payload = await this.requestRoute(`/wp-json/phaseone-ops/v1/coas/${input.wpPostId}`, {
      method: "PUT",
      body: { ...input },
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false);
    const mapped = mapCoa(payload);
    if (!mapped) throw new Error("COA service did not return the updated certificate");
    return mapped;
  }

  async getSiteControls(): Promise<CommerceSiteControls> {
    return mapSiteControls(await this.requestRoute("/wp-json/phaseone/v1/site-control", {}, false));
  }

  async saveSiteControls(input: CommerceSiteControlsWrite): Promise<CommerceSiteControls> {
    return mapSiteControls(await this.requestRoute("/wp-json/phaseone-ops/v1/site-controls", {
      method: "PUT",
      body: { ...input },
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false));
  }

  async getRewardControl(): Promise<CommerceRewardControl> {
    return mapRewardControl(await this.requestRoute("/wp-json/phaseone-ops/v1/rewards/settings", {
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false));
  }

  async saveRewardSettings(input: CommerceRewardSettingsWrite): Promise<CommerceRewardControl> {
    return mapRewardControl(await this.requestRoute("/wp-json/phaseone-ops/v1/rewards/settings", {
      method: "PUT",
      body: {
        settings: rewardSettingsPayload(input.settings),
        reason: input.reason,
        confirm_liability_change: input.confirmLiabilityChange,
      },
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false));
  }

  async adjustCustomerPoints(customerId: number, input: CommerceRewardAdjustmentWrite): Promise<CommerceRewardAdjustment> {
    const payload = record(await this.requestRoute(`/wp-json/phaseone-ops/v1/customers/${customerId}/points`, {
      method: "POST",
      body: {
        operation: input.operation,
        amount: input.amount,
        reason: input.reason,
        notify_customer: input.notifyCustomer,
      },
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false));
    const customer = record(payload.customer);
    const adjustment = record(payload.adjustment);
    return {
      customerId: Math.max(0, Math.round(number(customer.id))),
      customerName: decodedText(customer.name),
      customerEmail: text(customer.email),
      operation: input.operation,
      change: number(adjustment.change),
      balanceBefore: Math.max(0, number(adjustment.balance_before)),
      balanceAfter: Math.max(0, number(adjustment.balance_after)),
      reason: decodedText(adjustment.reason),
      emailSent: adjustment.email_sent === null || adjustment.email_sent === undefined ? null : Boolean(adjustment.email_sent),
    };
  }

  private operationsHeaders(): Record<string, string> {
    return {
      "X-PhaseOne-Consumer-Key": this.config.consumerKey,
      "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
    };
  }

  async getOrderEvidence(orderId: number): Promise<CommerceOrderEvidenceWorkspace> {
    const payload = await this.requestRoute(`/wp-json/phaseone-ops/v1/orders/${orderId}/evidence`, {
      headers: this.operationsHeaders(),
    }, false);
    return mapEvidenceWorkspace(payload, orderId);
  }

  async uploadOrderEvidence(orderId: number, body: Uint8Array, contentType: string): Promise<CommerceOrderEvidenceWorkspace> {
    await this.requestRoute(`/wp-json/phaseone-ops/v1/orders/${orderId}/evidence/upload`, {
      method: "POST",
      body,
      contentType,
      headers: this.operationsHeaders(),
    }, false);
    return this.getOrderEvidence(orderId);
  }

  async deleteOrderEvidence(orderId: number, evidenceId: string): Promise<CommerceOrderEvidenceWorkspace> {
    await this.requestRoute(`/wp-json/phaseone-ops/v1/orders/${orderId}/evidence/${encodeURIComponent(evidenceId)}`, {
      method: "DELETE",
      headers: this.operationsHeaders(),
    }, false);
    return this.getOrderEvidence(orderId);
  }

  async emailPackagingEvidence(input: {
    orderId: number;
    eventId: string;
    confirmedAt: string;
    attachments: PackagingEvidenceEmailAttachment[];
  }): Promise<PackagingEvidenceEmailResult> {
    const multipart = packagingEvidenceMultipart(input);
    const payload = record(await this.requestRoute(
      `/wp-json/phaseone-ops/v1/orders/${input.orderId}/evidence/email`,
      {
        method: "POST",
        body: multipart.body,
        contentType: multipart.contentType,
        headers: this.operationsHeaders(),
      },
      false,
    ));
    const state = text(payload.state);
    if (state !== "sent" && state !== "uncertain") {
      throw new Error("WordPress returned an invalid packaging evidence email state");
    }
    return {
      state,
      sentAt: isoDate(payload.sent_at),
      replayed: Boolean(payload.replayed),
      message: decodedText(payload.message),
    };
  }

  async saveNativeShippingLabel(input: {
    orderId: number;
    eventId: string;
    labelId: string;
    shipmentId: string | null;
    trackingNumber: string;
    carrier: string;
    service: string;
    amount: number;
    currency: string;
    purchasedAt: string;
  }): Promise<{ replayed: boolean; message: string }> {
    const payload = record(await this.requestRoute(
      `/wp-json/phaseone-ops/v1/orders/${input.orderId}/shipping-label`,
      {
        method: "POST",
        body: {
          event_id: input.eventId,
          label_id: input.labelId,
          shipment_id: input.shipmentId,
          tracking_number: input.trackingNumber,
          carrier: input.carrier,
          service: input.service,
          amount: input.amount,
          currency: input.currency,
          purchased_at: input.purchasedAt,
        },
        headers: this.operationsHeaders(),
      },
      false,
    ));
    return {
      replayed: Boolean(payload.replayed),
      message: decodedText(payload.message) || "Tracking saved to the source order.",
    };
  }

  async voidNativeShippingLabel(input: {
    orderId: number;
    eventId: string;
    labelId: string;
  }): Promise<{ replayed: boolean; message: string }> {
    const payload = record(await this.requestRoute(
      `/wp-json/phaseone-ops/v1/orders/${input.orderId}/shipping-label/void`,
      {
        method: "POST",
        body: { event_id: input.eventId, label_id: input.labelId },
        headers: this.operationsHeaders(),
      },
      false,
    ));
    return {
      replayed: Boolean(payload.replayed),
      message: decodedText(payload.message) || "Voided tracking removed from the source order.",
    };
  }

  async getOrderCoas(orderId: number): Promise<CommerceOrderCoaWorkspace> {
    const payload = await this.requestRoute(`/wp-json/phaseone-ops/v1/orders/${orderId}/coas`, {
      headers: this.operationsHeaders(),
    }, false);
    return mapCoaWorkspace(payload, orderId);
  }

  async assignOrderCoa(
    orderId: number,
    itemId: number,
    coaId: string,
    quantity: number,
    eventId?: string,
  ): Promise<CommerceOrderCoaWorkspace> {
    await this.requestRoute(`/wp-json/phaseone-ops/v1/orders/${orderId}/items/${itemId}/coas`, {
      method: "POST",
      body: {
        coa_id: coaId,
        quantity,
        ...(eventId ? { event_id: eventId } : {}),
      },
      headers: this.operationsHeaders(),
    }, false);
    return this.getOrderCoas(orderId);
  }

  async removeOrderCoa(orderId: number, itemId: number, assignmentId: string): Promise<CommerceOrderCoaWorkspace> {
    await this.requestRoute(`/wp-json/phaseone-ops/v1/orders/${orderId}/items/${itemId}/coas/${encodeURIComponent(assignmentId)}`, {
      method: "DELETE",
      headers: this.operationsHeaders(),
    }, false);
    return this.getOrderCoas(orderId);
  }

  async listOrderNotes(orderId: number): Promise<CommerceOrderNote[]> {
    return mapOrderNotes(await this.request(`orders/${orderId}/notes`, {
      parameters: { per_page: "100", order: "desc" },
    }));
  }

  async listRestocks(): Promise<CommerceRestockItem[]> {
    return mapRestocks(await this.requestRoute("/wp-json/phaseone-ops/v1/restocks", {
      headers: this.operationsHeaders(),
    }, false));
  }

  async listWaitlistSubscribers(productId: number): Promise<CommerceWaitlistSubscriber[]> {
    const fromBridge = await this.requestRoute("/wp-json/phaseone-ops/v1/waitlist", {
      method: "POST",
      body: { product_id: productId, productId, product: productId, per_page: 100 },
      headers: this.operationsHeaders(),
    }, false).then(mapWaitlistSubscribers).catch(() => []);
    const subscribers = fromBridge.length ? fromBridge : mapWaitlistSubscribers(await this.requestRoute(
      "/wp-json/wc-instocknotifier/v3/list_subscriber",
      {
        method: "POST",
        body: { p_ids: [productId], status: ["cwg_subscribed"] },
      },
    ));
    return subscribers.filter((subscriber) => !subscriber.productId || subscriber.productId === productId);
  }

  async notifyWaitlist(productId: number): Promise<unknown> {
    return this.requestRoute("/wp-json/phaseone-ops/v1/waitlist/notify", {
      method: "POST",
      body: { product_id: productId },
      headers: this.operationsHeaders(),
    }, false);
  }

  async getAgreementPdf(orderId: number): Promise<{ body: Buffer; fileName: string }> {
    const raw = record(await this.request(`orders/${orderId}`, { parameters: { _fields: "id,number,meta_data" } }));
    const chunks = (Array.isArray(raw.meta_data) ? raw.meta_data : []).flatMap((item) => {
      const entry = record(item);
      const match = text(entry.key).match(/^_phaseone_contract_pdf_chunk_(\d+)$/);
      return match ? [{ index: Number(match[1]), value: text(entry.value) }] : [];
    }).sort((left, right) => left.index - right.index);
    if (!chunks.length) throw new Error("No signed agreement is stored for this order");
    const encoded = chunks.map((chunk) => chunk.value).join("").replace(/^data:application\/pdf;base64,/, "");
    const body = Buffer.from(encoded, "base64");
    if (body.length < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("The stored signed agreement is not a valid PDF");
    }
    const suppliedName = metadataText(raw, "_phaseone_contract_pdf_filename").replace(/[^a-zA-Z0-9._-]/g, "-");
    return { body, fileName: suppliedName || `order-${text(raw.number) || orderId}-agreement.pdf` };
  }

  async getOrder(orderId: number): Promise<CommerceOrder> { return mapOrder(await this.request(`orders/${orderId}`)); }
  async repeatOrder(orderId: number, requestId: string, actorName: string): Promise<CommerceOrder> {
    const payload = record(await this.requestRoute(`/wp-json/phaseone-ops/v1/orders/${orderId}/repeat`, {
      method: "POST",
      body: { request_id: requestId, actor_name: actorName },
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false));
    const repeatedOrderId = Math.trunc(number(payload.order_id));
    if (repeatedOrderId <= 0) throw new Error("WordPress did not return the repeated order identifier");
    return this.getOrder(repeatedOrderId);
  }
  async generateCustomerPasswordResetLink(customerId: number): Promise<{ url: string; expiresAt: string | null }> {
    const payload = record(await this.requestRoute(`/wp-json/phaseone-ops/v1/customers/${customerId}/password-reset-link`, {
      method: "POST",
      body: {},
      headers: {
        "X-PhaseOne-Consumer-Key": this.config.consumerKey,
        "X-PhaseOne-Consumer-Secret": this.config.consumerSecret,
      },
    }, false));
    const sourceUrl = text(payload.url);
    if (!sourceUrl) throw new Error("WordPress did not return a password recovery link");
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new Error("WordPress returned an invalid password recovery link");
    }
    const key = parsed.searchParams.get("key")?.trim() || "";
    const login = parsed.searchParams.get("login")?.trim() || "";
    if (!key || !login) throw new Error("WordPress returned an incomplete password recovery link");
    const publicUrl = new URL("/set-password/", "https://phaseonelabz.com");
    publicUrl.searchParams.set("key", key);
    publicUrl.searchParams.set("login", login);
    return { url: publicUrl.toString(), expiresAt: isoDate(payload.expires_at) };
  }
  async approveOrderPayment(orderId: number): Promise<CommerceOrder> {
    const approvedAt = new Date().toISOString();
    return mapOrder(await this.request(`orders/${orderId}`, {
      method: "PUT",
      body: {
        status: "processing",
        date_paid: approvedAt,
        meta_data: [
          { key: "_phaseone_manual_payment_status", value: "approved" },
          { key: "_phaseone_manual_payment_approved_at", value: approvedAt },
        ],
      },
    }));
  }
  async updateOrderStatus(orderId: number, status: "processing" | "completed" | "cancelled"): Promise<CommerceOrder> {
    return mapOrder(await this.request(`orders/${orderId}`, { method: "PUT", body: { status } }));
  }
  async createRefund(orderId: number, amount: number, reason: string): Promise<unknown> {
    return this.request(`orders/${orderId}/refunds`, { method: "POST", body: { amount: amount.toFixed(2), reason, api_refund: true } });
  }

  private async listPublicThumbnails(): Promise<Map<number, string>> {
    const url = new URL("/wp-json/wc/store/v1/products", `${this.config.baseUrl}/`);
    url.searchParams.set("per_page", "100");
    const response = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Public product media returned ${response.status}`);
    const payload: unknown = await response.json();
    const result = new Map<number, string>();
    if (!Array.isArray(payload)) return result;
    for (const value of payload) {
      const product = record(value);
      for (const item of Array.isArray(product.images) ? product.images : []) {
        const image = record(item);
        const imageId = number(image.id);
        const thumbnail = text(image.thumbnail);
        if (imageId > 0 && thumbnail) result.set(imageId, thumbnail);
      }
    }
    return result;
  }

  private async request(resource: string, options: { method?: "GET" | "POST" | "PUT" | "DELETE"; parameters?: Record<string, string>; body?: Record<string, unknown> | Uint8Array; contentType?: string } = {}): Promise<unknown> {
    return this.requestRoute(`/wp-json/wc/v3/${resource}`, options);
  }

  private async requestAllPages(resource: string, parameters: Record<string, string>): Promise<unknown[]> {
    const pageSize = 100;
    const firstResponse = await this.requestRouteResponse(`/wp-json/wc/v3/${resource}`, {
      parameters: { ...parameters, per_page: String(pageSize), page: "1" },
    });
    const firstPayload: unknown = await firstResponse.json();
    const firstPage = Array.isArray(firstPayload) ? firstPayload : [];
    const result: unknown[] = [...firstPage];
    if (firstPage.length < pageSize) return result;

    const totalPages = Number(firstResponse.headers.get("x-wp-totalpages"));
    if (Number.isSafeInteger(totalPages) && totalPages > 1 && totalPages <= 200) {
      const remaining = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
      const batchSize = 20;
      for (let offset = 0; offset < remaining.length; offset += batchSize) {
        const pages = await Promise.all(remaining.slice(offset, offset + batchSize).map((page) =>
          this.request(resource, {
            parameters: { ...parameters, per_page: String(pageSize), page: String(page) },
          }).then((payload) => Array.isArray(payload) ? payload : []),
        ));
        for (const values of pages) result.push(...values);
      }
      return result;
    }

    const fallbackBatchSize = 10;
    for (let page = 2; page <= 200; page += fallbackBatchSize) {
      const pages = await Promise.all(Array.from({ length: fallbackBatchSize }, (_, index) => {
        const currentPage = page + index;
        return this.request(resource, {
          parameters: { ...parameters, per_page: String(pageSize), page: String(currentPage) },
        }).then((payload) => Array.isArray(payload) ? payload : [])
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("rest_post_invalid_page_number")) return [];
            throw error;
          });
      }));
      for (const values of pages) result.push(...values);
      if (pages.some((values) => values.length < pageSize)) break;
    }
    return result;
  }

  private async requestRouteResponse(route: string, options: { method?: "GET" | "POST" | "PUT" | "DELETE"; parameters?: Record<string, string>; body?: Record<string, unknown> | Uint8Array; contentType?: string; headers?: Record<string, string> } = {}, authenticated = true): Promise<Response> {
    const url = new URL(route, `${this.config.baseUrl}/`);
    for (const [key, value] of Object.entries(options.parameters || {})) url.searchParams.set(key, value);
    const rawBody = options.body instanceof Uint8Array;
    const requestBody = options.body
      ? rawBody ? Buffer.from(options.body as Uint8Array) : JSON.stringify(options.body)
      : undefined;
    const response = await this.fetchImpl(url, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json", ...(options.body ? { "Content-Type": options.contentType || "application/json" } : {}),
        ...(authenticated ? { Authorization: "Basic " + Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString("base64") } : {}),
        ...(options.headers || {}),
      },
      ...(requestBody ? { body: requestBody } : {}), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 10_000);
      throw commerceServiceError(response.status, body);
    }
    return response;
  }

  private async requestRoute(route: string, options: { method?: "GET" | "POST" | "PUT" | "DELETE"; parameters?: Record<string, string>; body?: Record<string, unknown> | Uint8Array; contentType?: string; headers?: Record<string, string> } = {}, authenticated = true): Promise<unknown> {
    return (await this.requestRouteResponse(route, options, authenticated)).json() as Promise<unknown>;
  }
}
