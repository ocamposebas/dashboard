import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  BulkAccessRequest,
  BulkAdminWorkspace,
  BulkCatalogItem,
  BulkCustomerIdentity,
  BulkOrderSettings,
  BulkPricingMode,
  BulkProductRule,
  BulkQuote,
} from "../shared/bulkOrders.js";
import { BULK_KIT_UNITS } from "../shared/bulkOrders.js";
import type { CommerceProduct, CommerceVariation, WooCommerceGateway } from "./wooCommerceGateway.js";
import { BulkOrderRepository, type BulkIntentRecord, type BulkSessionRecord } from "./bulkOrderRepository.js";

export class BulkOrderServiceError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "bulk_invalid_request") {
    super(message);
    this.name = "BulkOrderServiceError";
  }
}

interface CatalogSource {
  product: CommerceProduct;
  variation: CommerceVariation | null;
  purchasableId: number;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  regularPrice: number;
  stockQuantity: number | null;
  stockStatus: string;
  image: string;
  attributes: Array<{ name: string; value: string }>;
}

interface AccessContext {
  token: string;
  session: BulkSessionRecord;
}

function money(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function percentage(value: number): number {
  return Math.round(Math.max(0, Math.min(99.99, value)) * 100) / 100;
}

function normalizeMultiple(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(BULK_KIT_UNITS, Math.ceil(value / BULK_KIT_UNITS) * BULK_KIT_UNITS);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class BulkOrderService {
  private sourceCache: { expiresAt: number; values: CatalogSource[] } | undefined;

  constructor(
    private readonly repository: BulkOrderRepository,
    private readonly commerce: WooCommerceGateway,
    private readonly signingSecret: string,
  ) {}

  private keyed(value: string): string {
    return createHmac("sha256", this.signingSecret).update(value).digest("hex");
  }

  private async sources(force = false): Promise<CatalogSource[]> {
    if (!force && this.sourceCache && this.sourceCache.expiresAt > Date.now()) return this.sourceCache.values;
    const products = await this.commerce.listProducts();
    const values: CatalogSource[] = [];
    for (const product of products) {
      if (!["publish", "private"].includes(product.status)) continue;
      if (product.type === "variable") {
        const variations = await this.commerce.listProductVariations(product.id).catch(() => []);
        for (const variation of variations) {
          if (!variation.sku.trim()) continue;
          values.push({
            product, variation, purchasableId: variation.id, productId: product.id, variationId: variation.id,
            name: `${product.name}${variation.attributes.length ? ` — ${variation.attributes.map((item) => item.option).join(" / ")}` : ""}`,
            sku: variation.sku, regularPrice: variation.regularPrice || variation.price,
            stockQuantity: variation.stockQuantity, stockStatus: variation.stockStatus,
            image: variation.image?.thumbnailUrl || variation.image?.src || product.thumbnailUrl || product.imageUrl || "",
            attributes: variation.attributes.map((item) => ({ name: item.name, value: item.option })),
          });
        }
      } else if (product.type === "simple" && product.sku.trim()) {
        values.push({
          product, variation: null, purchasableId: product.id, productId: product.id, variationId: 0,
          name: product.name, sku: product.sku, regularPrice: product.regularPrice || product.price,
          stockQuantity: product.stockQuantity, stockStatus: product.stockStatus,
          image: product.thumbnailUrl || product.imageUrl || "", attributes: [],
        });
      }
    }
    this.sourceCache = { values, expiresAt: Date.now() + 30_000 };
    return values;
  }

  private effectiveRule(source: CatalogSource, settings: BulkOrderSettings, rules: Map<number, BulkProductRule>): {
    included: boolean;
    available: boolean;
    availabilitySource: "variation" | "product" | "default";
    minimum: number;
    maximum: number;
    mode: Exclude<BulkPricingMode, "inherit">;
    discount: number;
    fixedUnitPrice: number;
    tiers: BulkProductRule["tiers"];
    pricingSource: "variation" | "product" | "global";
    revision: string;
  } {
    const direct = rules.get(source.purchasableId);
    const parent = source.variationId ? rules.get(source.productId) : direct;
    const catalogOverride = direct?.catalogOverride !== "inherit" ? direct?.catalogOverride : parent?.catalogOverride;
    const excludedGlobally = settings.excludedProductIds.includes(source.purchasableId) || settings.excludedProductIds.includes(source.productId) || settings.excludedCategoryIds.includes(source.product.categoryId);
    const included = catalogOverride === "include" || (catalogOverride !== "exclude" && !excludedGlobally && settings.catalogMode === "include_all");

    const availabilityRule = direct?.availabilityOverride !== "inherit" ? direct : parent?.availabilityOverride !== "inherit" ? parent : null;
    const available = availabilityRule?.availabilityOverride !== "unavailable";
    const availabilitySource = availabilityRule ? (availabilityRule.purchasableId === source.purchasableId && source.variationId ? "variation" : "product") : "default";

    const minimum = direct?.minimumQuantity ?? parent?.minimumQuantity ?? settings.defaultMinimum;
    const maximum = direct?.maximumQuantity || parent?.maximumQuantity || 0;
    const pricing = direct?.pricingMode !== "inherit" ? direct : parent?.pricingMode !== "inherit" ? parent : null;
    const mode = pricing ? pricing.pricingMode as Exclude<BulkPricingMode, "inherit"> : "discount";
    const pricingSource = pricing ? (pricing.purchasableId === source.purchasableId && source.variationId ? "variation" : "product") : "global";
    return {
      included, available, availabilitySource, minimum: normalizeMultiple(minimum, settings.defaultMinimum), maximum,
      mode, discount: pricing ? pricing.discountPercent : settings.globalDiscount,
      fixedUnitPrice: pricing?.fixedUnitPrice || 0, tiers: pricing?.tiers || [], pricingSource,
      revision: createHash("sha256").update(`${settings.revision}|${direct?.revision || ""}|${parent?.revision || ""}`).digest("hex"),
    };
  }

  private price(rule: ReturnType<BulkOrderService["effectiveRule"]>, retail: number, quantity: number): { unitPrice: number; tier: string } {
    if (rule.mode === "discount") return { unitPrice: money(retail * (1 - rule.discount / 100)), tier: `${percentage(rule.discount)}%` };
    if (rule.mode === "fixed") return { unitPrice: money(rule.fixedUnitPrice), tier: "fixed" };
    const tier = [...rule.tiers].sort((a, b) => a.minimum - b.minimum).filter((item) => quantity >= item.minimum).at(-1);
    if (!tier) throw new BulkOrderServiceError("This quantity does not unlock a configured Bulk tier.", 400, "bulk_tier_unavailable");
    return { unitPrice: money(tier.unitPrice), tier: `${tier.minimum}+` };
  }

  private line(source: CatalogSource, settings: BulkOrderSettings, rules: Map<number, BulkProductRule>, quantity?: number): BulkCatalogItem | null {
    const rule = this.effectiveRule(source, settings, rules);
    if (!rule.included || source.regularPrice <= 0) return null;
    const maximumFromStock = source.stockQuantity === null ? 0 : Math.max(0, source.stockQuantity);
    const maximum = rule.maximum > 0 && maximumFromStock > 0 ? Math.min(rule.maximum, maximumFromStock) : rule.maximum || maximumFromStock;
    const requested = quantity ?? rule.minimum;
    const priced = this.price(rule, source.regularPrice, requested);
    if (priced.unitPrice <= 0) return null;
    const available = rule.available && source.stockStatus === "instock" && (maximum === 0 || maximum >= rule.minimum);
    const saving = source.regularPrice > 0 ? percentage(((source.regularPrice - priced.unitPrice) / source.regularPrice) * 100) : 0;
    const tiers = rule.tiers.filter((tier) => maximum <= 0 || tier.minimum <= maximum).map((tier) => ({ ...tier, kits: tier.minimum / BULK_KIT_UNITS, kitPrice: money(tier.unitPrice * BULK_KIT_UNITS) }));
    const maximumSaving = tiers.reduce((best, tier) => Math.max(best, source.regularPrice > 0 ? percentage(((source.regularPrice - tier.unitPrice) / source.regularPrice) * 100) : 0), saving);
    return {
      productId: source.productId, variationId: source.variationId, purchasableId: source.purchasableId,
      parentName: source.product.name, name: source.name, sku: source.sku, image: source.image,
      attributes: source.attributes, categories: source.product.category ? [source.product.category] : [], categoryId: source.product.categoryId,
      quantity: requested, kitUnits: BULK_KIT_UNITS, kitQuantity: requested / BULK_KIT_UNITS,
      minimum: rule.minimum, minimumKits: rule.minimum / BULK_KIT_UNITS, maximum,
      pricingMode: rule.mode, pricingSource: rule.pricingSource, tiers,
      retailUnitPrice: money(source.regularPrice), unitPrice: priced.unitPrice, kitPrice: money(priced.unitPrice * BULK_KIT_UNITS),
      savingsPercent: saving, maxSavingsPercent: maximumSaving, tier: priced.tier,
      lineTotal: money(priced.unitPrice * requested), ruleRevision: rule.revision,
      available, availability: rule.available ? "available" : "unavailable", availabilitySource: rule.availabilitySource,
      availabilityReason: available ? "" : !rule.available ? "This SKU is temporarily unavailable for Bulk ordering." : "WooCommerce inventory cannot fill a complete Bulk kit.",
      backorders: false, stockQuantity: source.stockQuantity,
    };
  }

  async settings(): Promise<BulkOrderSettings> { return this.repository.settings(); }

  async saveSettings(raw: Partial<BulkOrderSettings>, actor: string, expectedRevision?: number): Promise<BulkOrderSettings> {
    const current = await this.repository.settings();
    const globalDiscount = percentage(Number(raw.globalDiscount ?? current.globalDiscount));
    const defaultMinimum = normalizeMultiple(Number(raw.defaultMinimum ?? current.defaultMinimum), current.defaultMinimum);
    const sessionDays = Math.min(3650, Math.max(1, Math.floor(Number(raw.sessionDays ?? current.sessionDays))));
    const intentMinutes = Math.min(1440, Math.max(5, Math.floor(Number(raw.intentMinutes ?? current.intentMinutes))));
    const publicTitle = String(raw.publicTitle ?? current.publicTitle).trim().slice(0, 160) || "Bulk Orders";
    const publicIntro = String(raw.publicIntro ?? current.publicIntro).trim().slice(0, 2000);
    const catalogMode = raw.catalogMode === "legacy_explicit" ? "legacy_explicit" : "include_all";
    const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0))] : [];
    const saved = await this.repository.saveSettings({
      ...current, globalDiscount, defaultMinimum, sessionDays, intentMinutes, publicTitle, publicIntro, catalogMode,
      excludedCategoryIds: raw.excludedCategoryIds ? ids(raw.excludedCategoryIds) : current.excludedCategoryIds,
      excludedProductIds: raw.excludedProductIds ? ids(raw.excludedProductIds) : current.excludedProductIds,
      updatedBy: actor,
    }, expectedRevision);
    this.sourceCache = undefined;
    return saved;
  }

  async saveRule(raw: Partial<BulkProductRule>, actor: string): Promise<BulkProductRule> {
    const purchasableId = Math.floor(Number(raw.purchasableId));
    const productId = Math.floor(Number(raw.productId));
    const variationId = Math.floor(Number(raw.variationId || 0));
    const source = (await this.sources(true)).find((item) => item.purchasableId === purchasableId);
    const parent = (await this.commerce.listProducts()).find((item) => item.id === purchasableId && item.type === "variable");
    if (!source && !parent) throw new BulkOrderServiceError("Choose a valid product or variation.", 404, "bulk_product_missing");
    if (source && (source.productId !== productId || source.variationId !== variationId)) throw new BulkOrderServiceError("The selected variation does not belong to this product.");
    const catalogOverride = ["inherit", "include", "exclude"].includes(String(raw.catalogOverride)) ? raw.catalogOverride! : "inherit";
    const availabilityOverride = ["inherit", "available", "unavailable"].includes(String(raw.availabilityOverride)) ? raw.availabilityOverride! : "inherit";
    const pricingMode = ["inherit", "discount", "fixed", "tiered"].includes(String(raw.pricingMode)) ? raw.pricingMode! : "inherit";
    const minimumQuantity = raw.minimumQuantity === null || raw.minimumQuantity === undefined ? null : normalizeMultiple(Number(raw.minimumQuantity), BULK_KIT_UNITS);
    let maximumQuantity = Number(raw.maximumQuantity || 0);
    maximumQuantity = maximumQuantity > 0 ? Math.floor(maximumQuantity / BULK_KIT_UNITS) * BULK_KIT_UNITS : 0;
    if (minimumQuantity && maximumQuantity && maximumQuantity < minimumQuantity) throw new BulkOrderServiceError("Maximum quantity cannot be lower than the minimum.");
    const tiers = Array.isArray(raw.tiers) ? raw.tiers.map((tier) => ({ minimum: normalizeMultiple(Number(tier.minimum), BULK_KIT_UNITS), unitPrice: money(Number(tier.unitPrice)) })).filter((tier) => tier.unitPrice > 0).sort((a, b) => a.minimum - b.minimum) : [];
    const discountPercent = percentage(Number(raw.discountPercent || 0));
    const fixedUnitPrice = money(Number(raw.fixedUnitPrice || 0));
    if (pricingMode === "fixed" && fixedUnitPrice <= 0) throw new BulkOrderServiceError("Enter a positive fixed unit price.");
    if (pricingMode === "tiered" && !tiers.length) throw new BulkOrderServiceError("Add at least one valid pricing tier.");
    const revision = createHash("sha256").update(stableJson({ catalogOverride, availabilityOverride, minimumQuantity, maximumQuantity, pricingMode, discountPercent, fixedUnitPrice, tiers })).digest("hex");
    return this.repository.saveRule({
      purchasableId, productId, variationId, catalogOverride, availabilityOverride, minimumQuantity, maximumQuantity,
      pricingMode, discountPercent, fixedUnitPrice, tiers, revision, source: "operations", updatedBy: actor, updatedAt: new Date().toISOString(),
    }, actor);
  }

  async deleteRule(id: number, actor: string): Promise<boolean> { return this.repository.deleteRule(id, actor); }

  async catalog(): Promise<{ context: "bulk"; currency: "USD"; items: BulkCatalogItem[]; count: number; kitUnits: number; globalDiscount: number; catalogMode: string }> {
    const [settings, storedRules, sources] = await Promise.all([this.repository.settings(), this.repository.listRules(), this.sources()]);
    const rules = new Map(storedRules.map((rule) => [rule.purchasableId, rule]));
    const items = sources.map((source) => this.line(source, settings, rules)).filter((item): item is BulkCatalogItem => Boolean(item));
    return { context: "bulk", currency: "USD", items, count: items.length, kitUnits: BULK_KIT_UNITS, globalDiscount: settings.globalDiscount, catalogMode: settings.catalogMode };
  }

  async adminCatalog(): Promise<Array<{ productId: number; variationId: number; purchasableId: number; name: string; sku: string; image: string; type: string; price: number; stockQuantity: number | null; stockStatus: string; rule: BulkProductRule | null }>> {
    const [sources, rules] = await Promise.all([this.sources(), this.repository.listRules()]);
    const byId = new Map(rules.map((rule) => [rule.purchasableId, rule]));
    return sources.map((source) => ({ productId: source.productId, variationId: source.variationId, purchasableId: source.purchasableId, name: source.name, sku: source.sku, image: source.image, type: source.variationId ? "variation" : "simple", price: source.regularPrice, stockQuantity: source.stockQuantity, stockStatus: source.stockStatus, rule: byId.get(source.purchasableId) || null }));
  }

  async quote(rawItems: unknown): Promise<BulkQuote> {
    if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 100) throw new BulkOrderServiceError("The Bulk cart is empty or too large.");
    const merged = new Map<number, { productId: number; variationId: number; quantity: number }>();
    for (const value of rawItems) {
      if (!value || typeof value !== "object") throw new BulkOrderServiceError("A Bulk cart line is invalid.");
      const item = value as Record<string, unknown>;
      const productId = Math.floor(Number(item.product_id ?? item.productId));
      const variationId = Math.floor(Number(item.variation_id ?? item.variationId ?? 0));
      const quantity = Math.floor(Number(item.quantity));
      const purchasableId = variationId || productId;
      if (productId <= 0 || quantity <= 0 || quantity > 100_000 || quantity % BULK_KIT_UNITS !== 0) throw new BulkOrderServiceError("Each Bulk SKU must be ordered in complete kits of 10 units.");
      const previous = merged.get(purchasableId);
      if (previous && previous.productId !== productId) throw new BulkOrderServiceError("A variation does not belong to the submitted product.");
      merged.set(purchasableId, { productId, variationId, quantity: quantity + (previous?.quantity || 0) });
    }
    const [settings, storedRules, sources] = await Promise.all([this.repository.settings(), this.repository.listRules(), this.sources(true)]);
    const rules = new Map(storedRules.map((rule) => [rule.purchasableId, rule]));
    const sourceMap = new Map(sources.map((source) => [source.purchasableId, source]));
    const lines: BulkCatalogItem[] = [];
    for (const item of merged.values()) {
      const source = sourceMap.get(item.variationId || item.productId);
      if (!source || source.productId !== item.productId || source.variationId !== item.variationId) throw new BulkOrderServiceError("One or more selected SKUs are not available for Bulk ordering.", 400, "bulk_product_missing");
      const line = this.line(source, settings, rules, item.quantity);
      if (!line) throw new BulkOrderServiceError("One or more selected SKUs are not available for Bulk ordering.");
      if (!line.available) throw new BulkOrderServiceError(`${line.name} is currently unavailable for Bulk ordering.`, 409, "bulk_unavailable");
      if (item.quantity < line.minimum) throw new BulkOrderServiceError(`${line.name} requires a minimum of ${line.minimum} units.`);
      if (line.maximum > 0 && item.quantity > line.maximum) throw new BulkOrderServiceError(`${line.name} currently allows a maximum of ${line.maximum} units.`, 409, "bulk_stock");
      lines.push(line);
    }
    const subtotal = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
    const fingerprint = createHash("sha256").update(stableJson(lines.map((line) => ({ id: line.purchasableId, quantity: line.quantity, price: line.unitPrice, tier: line.tier, revision: line.ruleRevision })))).digest("hex");
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    return { context: "bulk", currency: "USD", lines, lineCount: lines.length, itemCount, kitCount: itemCount / BULK_KIT_UNITS, subtotal, fingerprint, quotedAt: new Date().toISOString() };
  }

  async program(): Promise<{ title: string; intro: string; maxSavingsPercent: number; globalDiscount: number; kitUnits: number; defaultMinimum: number; sessionDays: number }> {
    const [settings, catalog] = await Promise.all([this.repository.settings(), this.catalog()]);
    return { title: settings.publicTitle, intro: settings.publicIntro, maxSavingsPercent: catalog.items.filter((item) => item.available).reduce((value, item) => Math.max(value, item.maxSavingsPercent), 0), globalDiscount: settings.globalDiscount, kitUnits: BULK_KIT_UNITS, defaultMinimum: settings.defaultMinimum, sessionDays: settings.sessionDays };
  }

  async createAccessCode(input: { expiresAt?: string | null; usageLimit?: number | null; notes?: string }, actor: string): Promise<{ code: string; record: Awaited<ReturnType<BulkOrderRepository["insertCode"]>> }> {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(24);
    const raw = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
    const code = `P1B-${raw.match(/.{1,6}/g)!.join("-")}`;
    const normalized = code.replace(/[^A-Z0-9]/g, "");
    const expiresAt = input.expiresAt && Number.isFinite(Date.parse(input.expiresAt)) ? new Date(input.expiresAt).toISOString() : null;
    const usageLimit = Number(input.usageLimit) > 0 ? Math.floor(Number(input.usageLimit)) : null;
    const record = await this.repository.insertCode({ lookup: this.keyed(normalized), suffix: normalized.slice(-6), expiresAt, usageLimit, notes: String(input.notes || "").trim().slice(0, 1000), actor });
    return { code, record };
  }

  async setAccessCodeStatus(id: number, status: "active" | "paused" | "revoked", actor: string) {
    return this.repository.setCodeStatus(id, status, actor);
  }

  async access(code: string, identity: Partial<BulkCustomerIdentity>, ip: string, userAgent: string): Promise<{ token: string; maxAge: number; expiresAt: string; source: "code" }> {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized.length < 20) throw new BulkOrderServiceError("This access code is invalid or no longer available.", 403, "bulk_access_denied");
    const accessCode = await this.repository.consumeCode(this.keyed(normalized));
    if (!accessCode) throw new BulkOrderServiceError("This access code is invalid or no longer available.", 403, "bulk_access_denied");
    const settings = await this.repository.settings();
    const expiresAt = new Date(Math.min(Date.now() + settings.sessionDays * 86_400_000, accessCode.expiresAt ? Date.parse(accessCode.expiresAt) : Infinity)).toISOString();
    const token = randomBytes(32).toString("hex");
    await this.repository.createSession({ tokenLookup: this.keyed(token), accessCodeId: accessCode.id, customerId: Math.max(0, Number(identity.customerId || 0)), source: "code", expiresAt, ipHash: this.keyed(ip), userAgentHash: this.keyed(userAgent.slice(0, 500)) });
    return { token, maxAge: Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)), expiresAt, source: "code" };
  }

  async ensureSession(token: string, identity: Partial<BulkCustomerIdentity>, ip: string, userAgent: string): Promise<{ token: string; maxAge: number; expiresAt: string; source: "code" | "tier" }> {
    const customerId = Math.max(0, Number(identity.customerId || 0));
    if (customerId > 0) {
      const tier = await this.repository.tier(customerId);
      if (tier?.status === "active") {
        const current = await this.context(token, customerId).catch(() => null);
        if (current?.session.source === "tier") return { token, maxAge: Math.max(1, Math.floor((Date.parse(String(current.session.expires_at)) - Date.now()) / 1000)), expiresAt: new Date(current.session.expires_at).toISOString(), source: "tier" };
        const settings = await this.repository.settings();
        const next = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + settings.sessionDays * 86_400_000).toISOString();
        await this.repository.createSession({ tokenLookup: this.keyed(next), accessCodeId: null, customerId, source: "tier", expiresAt, ipHash: this.keyed(ip), userAgentHash: this.keyed(userAgent.slice(0, 500)) });
        return { token: next, maxAge: settings.sessionDays * 86_400, expiresAt, source: "tier" };
      }
    }
    const context = await this.context(token, customerId);
    return { token, maxAge: Math.max(1, Math.floor((Date.parse(String(context.session.expires_at)) - Date.now()) / 1000)), expiresAt: new Date(context.session.expires_at).toISOString(), source: context.session.source };
  }

  async context(token: string, customerId = 0): Promise<AccessContext> {
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new BulkOrderServiceError("Your Bulk access session has expired.", 401, "bulk_session_invalid");
    const session = await this.repository.session(this.keyed(token));
    if (!session) throw new BulkOrderServiceError("Your Bulk access session has expired.", 401, "bulk_session_invalid");
    if (customerId > 0 && number(session.customer_id) > 0 && number(session.customer_id) !== customerId) throw new BulkOrderServiceError("This Bulk session belongs to another account.", 403, "bulk_customer_mismatch");
    if (session.source === "tier") {
      const tier = await this.repository.tier(number(session.customer_id));
      if (!tier || tier.status !== "active" || customerId !== tier.customerId) throw new BulkOrderServiceError("Your Bulk access session has expired.", 401, "bulk_session_invalid");
    }
    return { token, session };
  }

  async logout(token: string): Promise<void> { if (/^[a-f0-9]{64}$/i.test(token)) await this.repository.revokeSession(this.keyed(token)); }

  async customerAccess(identity: BulkCustomerIdentity): Promise<{ authenticated: true; customer: { customerId: number; name: string; email: string; completedOrders: number; eligible: boolean; tier: "special" | "standard" }; request: BulkAccessRequest | null }> {
    const [tier, request] = await Promise.all([this.repository.tier(identity.customerId), this.repository.currentRequest(identity.customerId)]);
    return { authenticated: true, customer: { customerId: identity.customerId, name: identity.displayName, email: identity.email, completedOrders: identity.completedOrders, eligible: identity.completedOrders > 0, tier: tier?.status === "active" ? "special" : "standard" }, request };
  }

  async submitAccessRequest(identity: BulkCustomerIdentity, note: string): Promise<BulkAccessRequest> {
    if (identity.completedOrders < 1) throw new BulkOrderServiceError("At least one completed order is required before requesting Bulk access.", 409, "bulk_not_eligible");
    const tier = await this.repository.tier(identity.customerId);
    if (tier?.status === "active") throw new BulkOrderServiceError("This account already has Special Bulk Tier.", 409, "bulk_already_approved");
    return this.repository.submitRequest(identity, note.trim().slice(0, 1000));
  }

  async createIntent(sessionToken: string, identity: Partial<BulkCustomerIdentity>, rawItems: unknown): Promise<{ token: string; intentId: number; expiresAt: string; maxAge: number; quote: BulkQuote }> {
    const context = await this.context(sessionToken, Number(identity.customerId || 0));
    const quote = await this.quote(rawItems);
    const settings = await this.repository.settings();
    const expiresAt = new Date(Math.min(Date.now() + settings.intentMinutes * 60_000, Date.parse(String(context.session.expires_at)))).toISOString();
    const token = randomBytes(32).toString("hex");
    const items = quote.lines.map((line) => ({ productId: line.productId, variationId: line.variationId, quantity: line.quantity }));
    const intentId = await this.repository.createIntent({ tokenLookup: this.keyed(token), session: context.session, items, quote, expiresAt });
    return { token, intentId, expiresAt, maxAge: Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)), quote };
  }

  async resolveIntent(sessionToken: string, intentToken: string, identity: Partial<BulkCustomerIdentity>): Promise<{ intent: BulkIntentRecord; quote: BulkQuote }> {
    const context = await this.context(sessionToken, Number(identity.customerId || 0));
    if (!/^[a-f0-9]{64}$/i.test(intentToken)) throw new BulkOrderServiceError("This Bulk checkout session is invalid or expired.", 401, "bulk_intent_invalid");
    const intent = await this.repository.intent(this.keyed(intentToken));
    if (!intent || number(intent.session_id) !== number(context.session.id) || Date.parse(String(intent.expires_at)) <= Date.now() || !["open", "processing", "ordered"].includes(intent.status)) throw new BulkOrderServiceError("This Bulk checkout session is invalid or expired.", 401, "bulk_intent_invalid");
    const quote = await this.quote(intent.cart_payload);
    if (!safeEquals(quote.fingerprint, intent.quote_fingerprint)) throw new BulkOrderServiceError("Bulk pricing changed after this checkout was prepared. Return to the Bulk catalog and continue again.", 409, "bulk_quote_changed");
    return { intent, quote };
  }

  async claimCheckout(sessionToken: string, intentToken: string, identity: BulkCustomerIdentity): Promise<{ isBulk: true; isIdempotent: boolean; orderId: number; intentId: number; accessSource: "code" | "tier"; accessId: number; quote: BulkQuote }> {
    const { intent, quote } = await this.resolveIntent(sessionToken, intentToken, identity);
    if (intent.status === "ordered" && number(intent.order_id) > 0) return { isBulk: true, isIdempotent: true, orderId: number(intent.order_id), intentId: number(intent.id), accessSource: intent.access_code_id ? "code" : "tier", accessId: number(intent.access_code_id), quote };
    if (intent.status !== "open" || !await this.repository.bindAndClaimIntent(number(intent.id), identity.customerId)) throw new BulkOrderServiceError("This Bulk checkout is already being processed.", 409, "bulk_intent_processing");
    const context = await this.context(sessionToken, identity.customerId);
    return { isBulk: true, isIdempotent: false, orderId: 0, intentId: number(intent.id), accessSource: context.session.source, accessId: number(context.session.access_code_id), quote };
  }

  async completeCheckout(intentId: number, orderId: number): Promise<boolean> { return this.repository.completeIntent(intentId, orderId); }
  async releaseCheckout(intentId: number): Promise<void> { await this.repository.releaseIntent(intentId); }

  async adminWorkspace(): Promise<BulkAdminWorkspace> {
    const [settings, rules, requests, codes, tiers, stats, events, migration, catalog] = await Promise.all([
      this.repository.settings(), this.repository.listRules(), this.repository.listRequests(), this.repository.listCodes(), this.repository.listTiers(),
      this.repository.stats(), this.repository.recentEvents(), this.repository.migrationState(), this.catalog(),
    ]);
    return { configured: true, settings, rules, requests, codes, tiers, stats: { ...stats, visibleProducts: catalog.items.length, availableProducts: catalog.items.filter((item) => item.available).length }, recentEvents: events, migration };
  }

  async reviewRequest(id: number, operation: "approve" | "reject" | "archive", note: string, actor: string): Promise<BulkAccessRequest> {
    const request = (await this.repository.listRequests()).find((item) => item.id === id);
    if (!request) throw new BulkOrderServiceError("Bulk access request not found.", 404);
    if (operation === "approve") await this.repository.grantTier({ customerId: request.customerId, email: request.customerEmail, name: request.customerName, note, actor });
    const updated = await this.repository.reviewRequest(id, operation === "approve" ? "approved" : operation === "reject" ? "rejected" : "archived", note, actor);
    if (!updated) throw new BulkOrderServiceError("Bulk access request not found.", 404);
    return updated;
  }

  async grantTier(identity: BulkCustomerIdentity, note: string, actor: string) {
    if (identity.completedOrders < 1) throw new BulkOrderServiceError("This customer needs at least one completed order before Special Tier can be granted.", 409);
    return this.repository.grantTier({ customerId: identity.customerId, email: identity.email, name: identity.displayName, note: note.slice(0, 1000), actor });
  }

  async revokeTier(customerId: number, actor: string) { return this.repository.revokeTier(customerId, actor); }

  async importWordPress(payload: Record<string, unknown>, actor: string): Promise<Record<string, unknown>> {
    const sourceVersion = String(payload.version || "legacy").slice(0, 32);
    const settings = payload.settings && typeof payload.settings === "object" ? payload.settings as Record<string, unknown> : {};
    const currentSettings = await this.repository.settings();
    const importedNumber = (value: unknown, fallback: number): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    await this.saveSettings({
      globalDiscount: importedNumber(settings.global_discount, currentSettings.globalDiscount),
      defaultMinimum: importedNumber(settings.default_minimum, currentSettings.defaultMinimum),
      sessionDays: importedNumber(settings.session_days, currentSettings.sessionDays),
      intentMinutes: importedNumber(settings.intent_minutes, currentSettings.intentMinutes),
      publicTitle: String(settings.public_title || currentSettings.publicTitle),
      publicIntro: String(settings.public_intro || currentSettings.publicIntro),
      catalogMode: settings.catalog_mode === "legacy_explicit" ? "legacy_explicit" : "include_all",
      excludedCategoryIds: Array.isArray(settings.excluded_category_ids) ? settings.excluded_category_ids.map(Number) : [],
      excludedProductIds: Array.isArray(settings.excluded_product_ids) ? settings.excluded_product_ids.map(Number) : [],
    }, `${actor} · WordPress migration`);
    let importedRules = 0;
    for (const value of Array.isArray(payload.rules) ? payload.rules : []) {
      if (!value || typeof value !== "object") continue;
      const rule = value as Record<string, unknown>;
      try {
        await this.saveRule({
          purchasableId: Number(rule.purchasable_id), productId: Number(rule.product_id), variationId: Number(rule.variation_id),
          catalogOverride: rule.catalog_override as BulkProductRule["catalogOverride"], availabilityOverride: rule.availability_override as BulkProductRule["availabilityOverride"],
          minimumQuantity: rule.minimum_explicit ? Number(rule.minimum) : null, maximumQuantity: Number(rule.maximum),
          pricingMode: rule.mode as BulkProductRule["pricingMode"], discountPercent: Number(rule.discount), fixedUnitPrice: Number(rule.fixed_price),
          tiers: Array.isArray(rule.tiers) ? rule.tiers.map((tier) => ({ minimum: Number((tier as Record<string, unknown>).minimum), unitPrice: Number((tier as Record<string, unknown>).price) })) : [],
        }, `${actor} · WordPress migration`);
        importedRules += 1;
      } catch { /* Preserve the rest of a partially stale catalog export. */ }
    }
    let importedTiers = 0;
    for (const value of Array.isArray(payload.customer_tiers) ? payload.customer_tiers : []) {
      if (!value || typeof value !== "object") continue;
      const tier = value as Record<string, unknown>;
      const customerId = Number(tier.customer_id);
      if (!Number.isSafeInteger(customerId) || customerId <= 0) continue;
      await this.repository.grantTier({ customerId, email: String(tier.email || ""), name: String(tier.name || ""), note: String(tier.note || "Imported from WordPress"), actor });
      importedTiers += 1;
    }
    let legacyCodes = 0;
    for (const value of Array.isArray(payload.access_codes) ? payload.access_codes : []) {
      if (!value || typeof value !== "object") continue;
      const code = value as Record<string, unknown>;
      await this.repository.importLegacyCode({ id: Number(code.id), suffix: String(code.code_suffix || ""), status: "legacy", expiresAt: code.expires_at ? String(code.expires_at) : null, usageLimit: code.usage_limit ? Number(code.usage_limit) : null, uses: Number(code.uses || 0), notes: `${String(code.notes || "")} · Replacement code required`, actor });
      legacyCodes += 1;
    }
    let importedRequests = 0;
    for (const value of Array.isArray(payload.access_requests) ? payload.access_requests : []) {
      if (!value || typeof value !== "object") continue;
      const request = value as Record<string, unknown>;
      const customerId = Number(request.customer_id);
      const status = ["pending", "approved", "rejected", "archived"].includes(String(request.status)) ? String(request.status) as BulkAccessRequest["status"] : "archived";
      if (!Number.isSafeInteger(customerId) || customerId <= 0 || !request.created_at) continue;
      await this.repository.importAccessRequest({
        customerId, customerName: String(request.customer_name || ""), customerEmail: String(request.customer_email || ""),
        completedOrders: Number(request.completed_orders || 0), eligible: Boolean(Number(request.eligible || 0)), status,
        customerNote: String(request.customer_note || ""), internalNote: String(request.internal_note || ""),
        reviewedBy: request.reviewed_by ? `WordPress user ${String(request.reviewed_by)}` : null,
        reviewedAt: request.reviewed_at ? String(request.reviewed_at) : null,
        createdAt: String(request.created_at), updatedAt: String(request.updated_at || request.created_at),
      });
      importedRequests += 1;
    }
    const summary = { importedRules, importedTiers, importedRequests, legacyCodes, replacementCodesRequired: legacyCodes };
    const hash = createHash("sha256").update(stableJson(payload)).digest("hex");
    await this.repository.recordImport({ sourceKey: `wordpress:${sourceVersion}`, version: sourceVersion, hash, actor, summary });
    return summary;
  }
}

function number(value: unknown): number { return Number(value || 0); }
