export const BULK_KIT_UNITS = 10;

export type BulkCatalogOverride = "inherit" | "include" | "exclude";
export type BulkAvailabilityOverride = "inherit" | "available" | "unavailable";
export type BulkPricingMode = "inherit" | "discount" | "fixed" | "tiered";

export interface BulkPricingTier {
  minimum: number;
  unitPrice: number;
}

export interface BulkOrderSettings {
  revision: number;
  globalDiscount: number;
  defaultMinimum: number;
  sessionDays: number;
  intentMinutes: number;
  publicTitle: string;
  publicIntro: string;
  catalogMode: "include_all" | "legacy_explicit";
  excludedCategoryIds: number[];
  excludedProductIds: number[];
  updatedBy: string;
  updatedAt: string;
}

export interface BulkProductRule {
  purchasableId: number;
  productId: number;
  variationId: number;
  catalogOverride: BulkCatalogOverride;
  availabilityOverride: BulkAvailabilityOverride;
  minimumQuantity: number | null;
  maximumQuantity: number;
  pricingMode: BulkPricingMode;
  discountPercent: number;
  fixedUnitPrice: number;
  tiers: BulkPricingTier[];
  revision: string;
  source: "operations" | "wordpress_import";
  updatedBy: string;
  updatedAt: string;
}

export interface BulkCatalogItem {
  productId: number;
  variationId: number;
  purchasableId: number;
  parentName: string;
  name: string;
  sku: string;
  image: string;
  attributes: Array<{ name: string; value: string }>;
  categories: string[];
  categoryId: number;
  quantity: number;
  kitUnits: number;
  kitQuantity: number;
  minimum: number;
  minimumKits: number;
  maximum: number;
  pricingMode: Exclude<BulkPricingMode, "inherit">;
  pricingSource: "variation" | "product" | "global";
  tiers: Array<BulkPricingTier & { kits: number; kitPrice: number }>;
  retailUnitPrice: number;
  unitPrice: number;
  kitPrice: number;
  savingsPercent: number;
  maxSavingsPercent: number;
  tier: string;
  lineTotal: number;
  ruleRevision: string;
  available: boolean;
  availability: "available" | "unavailable";
  availabilitySource: "variation" | "product" | "default";
  availabilityReason: string;
  backorders: boolean;
  stockQuantity: number | null;
}

export interface BulkQuote {
  context: "bulk";
  currency: string;
  lines: BulkCatalogItem[];
  lineCount: number;
  itemCount: number;
  kitCount: number;
  subtotal: number;
  fingerprint: string;
  quotedAt: string;
}

export interface BulkCustomerIdentity {
  customerId: number;
  email: string;
  displayName: string;
  completedOrders: number;
}

export interface BulkAccessRequest {
  id: number;
  customerId: number;
  customerName: string;
  customerEmail: string;
  completedOrders: number;
  eligible: boolean;
  status: "pending" | "approved" | "rejected" | "archived";
  customerNote: string;
  internalNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  source: "operations" | "wordpress_import";
  createdAt: string;
  updatedAt: string;
}

export interface BulkAccessCode {
  id: number;
  codeSuffix: string;
  status: "active" | "paused" | "revoked" | "expired" | "legacy";
  expiresAt: string | null;
  usageLimit: number | null;
  uses: number;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface BulkCustomerTier {
  customerId: number;
  customerEmail: string;
  customerName: string;
  status: "active" | "revoked";
  note: string;
  grantedBy: string;
  grantedAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

export interface BulkAdminWorkspace {
  configured: boolean;
  settings: BulkOrderSettings;
  rules: BulkProductRule[];
  requests: BulkAccessRequest[];
  codes: BulkAccessCode[];
  tiers: BulkCustomerTier[];
  stats: {
    visibleProducts: number;
    availableProducts: number;
    activeCodes: number;
    pendingRequests: number;
    openCheckouts: number;
    completedBulkOrders: number;
  };
  recentEvents: Array<{
    id: number;
    eventType: string;
    actor: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  migration: {
    imported: boolean;
    sourceVersion: string;
    importedAt: string | null;
    summary: Record<string, unknown>;
  };
}
