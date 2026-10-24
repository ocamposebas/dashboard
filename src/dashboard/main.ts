import "./styles.css";
import "./premium.css";
import "./labels.css";
import "./fulfillment.css";
import "./clean-ui.css";
import { initAffiliateAdmin, loadAffiliateAdmin } from "./affiliates-admin";
import type { AffiliateCommissionSummary } from "../shared/affiliates";
import { calculateProductProfitability } from "../shared/productProfitability";
import { monthToDateStart, summarizeCompleteMonthToDate } from "../shared/monthlyFinance";
import { suggestedCoaVariationId } from "../shared/coaCatalogMapping";
import { productSkuBase, productVariantSku } from "../shared/productSku";
import {
  initialSiteControlsDraftState,
  markSiteControlsDraftDirty,
  reconcileSiteControlsDraft,
} from "../shared/siteControlsDraft";
import type { DecodeHintType as ZXingDecodeHintType } from "@zxing/library";
import type {
  BarcodeLabel,
  BarcodeEntityType,
  BarcodeRegistryRecord,
  ProductLocation,
} from "../shared/barcodeFulfillment";
import { cameraBarcodeCandidate } from "../shared/cameraBarcode";
import {
  cameraOptimizationLabel,
  cameraOptimizationPlan,
  type CameraTrackCapabilitiesLike,
  type CameraTrackSettingsLike,
} from "../shared/cameraOptimization";
import type {
  FulfillmentQueueEntry,
  FulfillmentQueuePayload,
  FulfillmentPackingPayload,
  FulfillmentPackingSnapshot,
  FulfillmentScanFeedback,
  FulfillmentScanPayload,
} from "../shared/fulfillment";
import {
  PHASE_ONE_SHIPPING_POLICY,
  type ShippingLabel,
  type ShippingCapabilitiesPayload,
  type ShippingPackageInput,
  type ShippingRatesPayload,
} from "../shared/shipping";
import type {
  FulfillmentEvidenceFile,
  FulfillmentEvidenceKind,
  FulfillmentEvidenceWorkspace,
} from "../shared/fulfillmentEvidence";
import {
  PRESENCE_SECTIONS,
  emptyPresenceCounts,
  type PresenceCounts,
  type PresenceSection,
  type PresenceSnapshot,
} from "../shared/protocol";

type BaseAnalytics = PresenceSnapshot["analytics"];
type BaseSession = BaseAnalytics["recentSessions"][number];
type BaseEvent = BaseSession["events"][number];

type DashboardEvent = Omit<BaseEvent, "type"> & {
  type: "pageview" | "click" | "order";
  status?: "paid";
};

type DashboardSession = Omit<BaseSession, "events"> & {
  visitorNumber?: number;
  visitNumber?: number;
  returningVisitor?: boolean;
  orderCompleted?: boolean;
  orderCompletedAt?: string;
  events: DashboardEvent[];
};

type DashboardDailyActivity = BaseAnalytics["dailyActivity"][number] & {
  visitors?: number;
  returningSessions?: number;
  orders?: number;
};

type DashboardAnalytics = Omit<BaseAnalytics, "dailyActivity" | "recentSessions" | "timeZone"> & {
  timeZone?: string;
  returningVisitors?: number;
  returningSessions?: number;
  totalOrders?: number;
  visitorRanges?: {
    today: number;
    last7Days: number;
    last30Days: number;
    all: number;
  };
  dailyVisitors?: Array<{ date: string; visitors: number }>;
  dailyActivity: DashboardDailyActivity[];
  recentSessions: DashboardSession[];
};

type DashboardSnapshot = Omit<PresenceSnapshot, "analytics"> & {
  analytics: DashboardAnalytics;
};

interface CommerceCost {
  unitCost: number;
  packagingCost: number;
  feeRate: number;
  affiliateRate: number;
}

interface CommerceMedia {
  id: number;
  name: string;
  alt: string;
  src: string;
  thumbnailUrl: string;
  productIds?: number[];
  productNames?: string[];
}

interface CommerceVariation {
  id: number;
  sku: string;
  price: number;
  regularPrice: number;
  stockQuantity: number | null;
  stockStatus: string;
  image: CommerceMedia | null;
  attributes: Array<{ id: number; name: string; option: string }>;
  cost?: CommerceCost | null;
  costInherited?: boolean;
  estimatedProfit?: number | null;
  margin?: number | null;
  testingCostPerUnit?: number;
  testingCostTotal?: number;
  testingBatchUnitCount?: number;
  testingLot?: string;
}

interface CommerceProduct {
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
  stockQuantity: number | null;
  stockStatus: string;
  category: string;
  categoryId?: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  images: CommerceMedia[];
  variationIds: number[];
  attributes: Array<{ id: number; name: string; options: string[]; variation: boolean }>;
  cost: CommerceCost | null;
  estimatedProfit: number | null;
  margin: number | null;
  testingCostPerUnit?: number;
  testingCostTotal?: number;
  testingBatchUnitCount?: number;
  testingLot?: string;
  localDraft?: true;
}

interface CommerceProductCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
  parentId: number;
}

interface ProductDraftRecord {
  id: number;
  name: string;
  sku: string;
  stock: number;
  category: string;
  status: string;
  cost: number;
  price: number;
  packaging: number;
  feeRate: number;
  affiliateRate?: number;
}

interface CommerceOrder {
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
  lineItems: Array<{
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
  }>;
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
  profitability: {
    costOfGoods: number;
    operatingCost: number;
    feeCost: number;
    affiliateCost: number;
    testingCost?: number;
    completeCostCoverage: boolean;
    estimatedProfit: number | null;
  };
}

interface OrderEvidence {
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

interface OrderCoaWorkspace {
  orderId: number;
  unavailable?: boolean;
  items: Array<{
    itemId: number;
    name: string;
    sku: string;
    quantity: number;
    remainingQuantity: number;
    assignments: Array<{
      assignmentId: string;
      coaId: string;
      lot: string;
      quantity: number;
      assignedAt: string | null;
      source: string;
      hasSnapshot: boolean;
    }>;
    candidates: Array<{
      id: string;
      number: string;
      productName: string;
      strength: string;
      lot: string;
      testingDate: string | null;
      laboratory: string;
      currentShippingLot: boolean;
    }>;
  }>;
}

interface OrderOperations {
  evidence: { orderId: number; unavailable?: boolean; items: OrderEvidence[] };
  coas: OrderCoaWorkspace;
  notes: Array<{ id: number; note: string; customerNote: boolean; createdAt: string | null; author: string }>;
  affiliateCommission?: AffiliateCommissionSummary | null;
}

interface InventoryOperationsPayload {
  restocks: Array<{
    id: number;
    productId: number;
    productName: string;
    status: string;
    expectedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    waitlistCount: number | null;
  }>;
  products: CommerceProduct[];
  lots: CommerceCoa[];
  waitlistCounts: Record<string, number | null>;
  bridgeAvailable: boolean;
  lotAssignmentsAvailable: boolean;
  syncedAt: string;
}

interface WaitlistSubscriber {
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

interface CustomerOrderSummary {
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

interface CustomerProfile {
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
  rewardHistory: Array<{
    id: string;
    change: number;
    balanceBefore: number;
    balanceAfter: number;
    type: string;
    reason: string;
    createdAt: string | null;
    orderId: number;
  }>;
  redemptions: Array<{ points: number; credit: number; createdAt: string | null }>;
  topProducts: Array<{
    productId: number;
    name: string;
    sku: string;
    quantity: number;
    spent: number;
    imageUrl: string | null;
  }>;
  orders: CustomerOrderSummary[];
}

interface CustomerDirectoryPayload {
  connected: boolean;
  rewardsLive: boolean;
  customers: CustomerProfile[];
  totals?: {
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
  currency?: string;
  syncedAt?: string;
  cacheAgeSeconds?: number;
  stale?: boolean;
  refreshing?: boolean;
  message?: string;
  error?: string;
}

interface LoyaltySettings {
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

interface LoyaltyPayload {
  connected: boolean;
  writeEnabled: boolean;
  canManage: boolean;
  requiresBridgeUpdate?: boolean;
  bridgeVersion?: string | null;
  version?: string;
  settings: LoyaltySettings | null;
  metrics: {
    customers: number;
    membersWithPoints: number;
    pointsOutstanding: number;
    storeCreditOutstanding: number;
    redeemableCreditLiability: number;
  } | null;
  audit: Array<{
    id: string;
    createdAt: string | null;
    actorName: string;
    reason: string;
    before: LoyaltySettings;
    after: LoyaltySettings;
  }>;
  error?: string;
}

interface CommerceAddress {
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

interface CommercePayload {
  connected: boolean;
  mode: "read_only" | "read_write" | "not_configured" | "unavailable";
  store?: string;
  message?: string;
  products: CommerceProduct[];
  categories?: CommerceProductCategory[];
  orders: CommerceOrder[];
  affiliateCommissions?: AffiliateCommissionSummary[];
  media: CommerceMedia[];
  cachedAt?: string;
  cacheAgeSeconds?: number;
  refreshing?: boolean;
}

interface FulfillmentLocationsPayload {
  configured: boolean;
  locations: ProductLocation[];
  registeredLabels: BarcodeRegistryRecord[];
  permissions: {
    read: boolean;
    printLabels: boolean;
    manageLocations: boolean;
  };
  error?: string;
}

interface LabelProductDetail {
  product: CommerceProduct;
  variations: CommerceVariation[];
}

interface CommerceCoa {
  id: string;
  recordId?: string;
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
  source?: "custom" | "wordpress_import";
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
  intakeAnalysis?: {
    status: "complete" | "limited" | "failed";
    detectedFieldCount: number;
    pageCount: number;
    warnings: string[];
    fields: Record<string, string>;
    suggestCurrent?: boolean;
    dateDetection?: {
      value: string;
      source: "test" | "analysis" | "reported" | "certificate" | "received" | "unknown";
      label: string;
      confidence: "explicit" | "fallback" | "missing";
    };
    assays?: Array<{
      name: string;
      result: string;
      unit: string;
      status: "pass" | "attention" | "reported";
    }>;
  } | null;
}

interface SiteControls {
  version: string;
  source?: string;
  revision?: number;
  updatedAt?: string;
  updatedBy?: string;
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
      slug?: string;
      url?: string;
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

interface ExtensionsPayload {
  connected: boolean;
  coas: CommerceCoa[];
  siteControls: SiteControls | null;
  coaWriteEnabled?: boolean;
  siteControlsWriteEnabled?: boolean;
  siteControlsSource?: string;
  siteControlsStorage?: string;
  storefrontDelivery?: string;
  coaBridgeVersion?: string | null;
  cachedAt?: string;
}

type WorkspaceRole = "owner" | "administrator" | "operations" | "analyst";
interface WorkspaceUser {
  id: string; username: string; displayName: string; email: string; role: WorkspaceRole;
  status: "active" | "suspended"; createdAt: string; updatedAt: string; lastLoginAt: string | null;
}
interface WorkspaceSession {
  authenticated: true;
  user: WorkspaceUser;
  permissions: { administer: boolean; operate: boolean };
}
interface WorkspaceNotification {
  id: string; type: "order" | "seo" | "security" | "system";
  severity: "info" | "success" | "warning" | "critical";
  title: string; message: string; createdAt: string; actionView: string; actionEntityId?: number; read: boolean;
}
interface SeoRow { key: string; clicks: number; impressions: number; ctr: number; position: number; }
interface SeoReport {
  connected: true; siteUrl: string; period: { start: string; end: string; days: number };
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  previousTotals: { clicks: number; impressions: number; ctr: number; position: number };
  changes: { clicks: number | null; impressions: number | null; ctr: number | null; position: number | null };
  daily: SeoRow[]; topQueries: SeoRow[]; topPages: SeoRow[]; countries: SeoRow[]; devices: SeoRow[];
  opportunities: Array<SeoRow & { type: string; title: string; message: string; impact: string }>;
  sitemaps: Array<Record<string, unknown>>; syncedAt: string;
}

const sectionLabels: Record<PresenceSection, string> = {
  HOME: "Home",
  SHOP: "Shop",
  PRODUCT: "Product",
  CART: "Cart",
  CHECKOUT: "Checkout",
  OTHER: "Other pages",
};

const sectionDescriptions: Record<PresenceSection, string> = {
  HOME: "Storefront landing page",
  SHOP: "Browsing the catalog",
  PRODUCT: "Viewing a product",
  CART: "Cart is open",
  CHECKOUT: "Checkout journey",
  OTHER: "Additional content",
};

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing dashboard element: ${selector}`);
  return element;
}

type ColorTheme = "light" | "dark";
const THEME_STORAGE_KEY = "phaseone:commerce-theme-v4";

function storedTheme(): ColorTheme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function preferredTheme(): ColorTheme {
  return storedTheme() || "light";
}

function applyTheme(theme: ColorTheme, persist = false): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0a0a0b" : "#f4f4f2");
  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  const label = document.querySelector<HTMLElement>("#theme-toggle-label");
  const icon = toggle?.querySelector<HTMLElement>(".theme-toggle-icon");
  if (toggle) {
    const dark = theme === "dark";
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    if (label) label.textContent = dark ? "Light" : "Dark";
    if (icon) icon.textContent = dark ? "☀" : "☾";
  }
  for (const option of document.querySelectorAll<HTMLButtonElement>("[data-set-theme]")) {
    const active = option.dataset.setTheme === theme;
    option.classList.toggle("is-active", active);
    option.setAttribute("aria-pressed", String(active));
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }
}

applyTheme(preferredTheme());

const greetingHour = new Date().getHours();
const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";
const overviewTitle = document.querySelector<HTMLElement>("#overview-title");
if (overviewTitle) overviewTitle.textContent = `${greeting}, Sebastian.`;

const grid = requiredElement<HTMLElement>("#section-grid");
const totalElement = requiredElement<HTMLElement>("#total");
const updatedElement = requiredElement<HTMLElement>("#updated");
const footerUpdated = requiredElement<HTMLElement>("#footer-updated");
const connectionElement = requiredElement<HTMLElement>("#connection");
const connectionLabel = requiredElement<HTMLElement>("#connection-label");
const monitorConnectionLabel = requiredElement<HTMLElement>("#monitor-connection-label");
const footerConnection = requiredElement<HTMLElement>("#footer-connection");
const announcement = requiredElement<HTMLElement>("#announcement");
const uniqueVisitorsElement = requiredElement<HTMLElement>("#unique-visitors");
const monitorPageRankingElement = requiredElement<HTMLElement>("#monitor-page-ranking");
const financeOrdersElement = requiredElement<HTMLElement>("#finance-orders");
const monitorSourceListElement = requiredElement<HTMLElement>("#monitor-source-list");
const monitorDeviceListElement = requiredElement<HTMLElement>("#monitor-device-list");
const monitorDeviceDonutElement = requiredElement<HTMLElement>("#monitor-device-donut");
const monitorDeviceTotalElement = requiredElement<HTMLElement>("#monitor-device-total");
const sessionListElement = requiredElement<HTMLElement>("#session-list");
const sessionPagination = requiredElement<HTMLElement>("#session-pagination");
const sessionsPrevious = requiredElement<HTMLButtonElement>("#sessions-previous");
const sessionsNext = requiredElement<HTMLButtonElement>("#sessions-next");
const sessionsPage = requiredElement<HTMLElement>("#sessions-page");
const trendChartElement = requiredElement<HTMLElement>("#trend-chart");
const trendTotalElement = requiredElement<HTMLElement>("#trend-total");
const visitors30Element = requiredElement<HTMLElement>("#visitors-30");
const todayVisitorsElement = requiredElement<HTMLElement>("#today-visitors");
const todayVisitsElement = requiredElement<HTMLElement>("#today-visits");
const todayOrdersElement = requiredElement<HTMLElement>("#today-orders");
const activeRangeLabel = requiredElement<HTMLElement>("#active-range-label");
const specificDateInput = requiredElement<HTMLInputElement>("#specific-date");
const specificDateLabel = requiredElement<HTMLElement>("#specific-date-label");
const datePickerControl = requiredElement<HTMLElement>("#date-picker-control");
const sessionDetailElement = requiredElement<HTMLElement>("#session-detail");
const sessionDetailTitle = requiredElement<HTMLElement>("#session-detail-title");
const sessionDetailContent = requiredElement<HTMLElement>("#session-detail-content");
const closeSessionDetailButton = requiredElement<HTMLButtonElement>("#close-session-detail");
const sessionBackdrop = requiredElement<HTMLButtonElement>("#session-backdrop");
const overviewOnlineElement = requiredElement<HTMLElement>("#overview-online");
const navLiveCountElement = requiredElement<HTMLElement>("#nav-live-count");
const monitorVisitors30Element = requiredElement<HTMLElement>("#monitor-visitors-30");
const monitorTotalViewsElement = requiredElement<HTMLElement>("#monitor-total-views");
const monitorTotalSessionsElement = requiredElement<HTMLElement>("#monitor-total-sessions");
const monitorConversionElement = requiredElement<HTMLElement>("#monitor-conversion");
const monitorOnlineMirrorElement = requiredElement<HTMLElement>("#monitor-online-mirror");
const monitorUniqueVisitorsElement = requiredElement<HTMLElement>("#monitor-unique-visitors");
const monitorReturningVisitsElement = requiredElement<HTMLElement>("#monitor-returning-visits");
const monitorTotalOrdersElement = requiredElement<HTMLElement>("#monitor-total-orders");
const monitorTodayVisitorsElement = requiredElement<HTMLElement>("#monitor-today-visitors");
const monitorTodayVisitsElement = requiredElement<HTMLElement>("#monitor-today-visits");
const monitorTodayOrdersElement = requiredElement<HTMLElement>("#monitor-today-orders");
const monitorTrendChartElement = requiredElement<HTMLElement>("#monitor-trend-chart");
const monitorTrendTotalElement = requiredElement<HTMLElement>("#monitor-trend-total");
const monitorActiveRangeLabel = requiredElement<HTMLElement>("#monitor-active-range-label");
const monitorSpecificDateInput = requiredElement<HTMLInputElement>("#monitor-specific-date");
const monitorSpecificDateLabel = requiredElement<HTMLElement>("#monitor-specific-date-label");
const monitorDatePickerControl = requiredElement<HTMLElement>("#monitor-date-picker-control");
const marketingSignalBanner = requiredElement<HTMLElement>("#marketing-signal-banner");
const marketingSignalCopy = requiredElement<HTMLElement>("#marketing-signal-copy");
const marketingSignalStatus = requiredElement<HTMLElement>("#marketing-signal-status");
const marketingActiveCarts = requiredElement<HTMLElement>("#marketing-active-carts");
const marketingAbandonedCarts = requiredElement<HTMLElement>("#marketing-abandoned-carts");
const marketingRecoverableValue = requiredElement<HTMLElement>("#marketing-recoverable-value");
const marketingCapturedValue = requiredElement<HTMLElement>("#marketing-captured-value");
const marketingZeroSearches = requiredElement<HTMLElement>("#marketing-zero-searches");
const marketingCartList = requiredElement<HTMLElement>("#marketing-cart-list");
const marketingSearchList = requiredElement<HTMLElement>("#marketing-search-list");
const marketingSearchTotal = requiredElement<HTMLElement>("#marketing-search-total");
const marketingRecentSearches = requiredElement<HTMLElement>("#marketing-recent-searches");
const monitorIntentKpis = requiredElement<HTMLElement>("#monitor-intent-kpis");
const monitorCartCount = requiredElement<HTMLElement>("#monitor-cart-count");
const monitorCartStream = requiredElement<HTMLElement>("#monitor-cart-stream");
const monitorSearchCount = requiredElement<HTMLElement>("#monitor-search-count");
const monitorSearchStream = requiredElement<HTMLElement>("#monitor-search-stream");
const customerSyncElement = requiredElement<HTMLElement>("#customer-sync");
const customerRecordStatus = requiredElement<HTMLElement>("#customer-record-status");
const customerLoading = requiredElement<HTMLElement>("#customer-loading");
const customerTableWrap = requiredElement<HTMLElement>("#customer-table-wrap");
const customerTableBody = requiredElement<HTMLElement>("#customers-table-body");
const customerDirectoryCount = requiredElement<HTMLElement>("#customer-directory-count");
const customerSearchInput = requiredElement<HTMLInputElement>("#customer-search");
const customerSortInput = requiredElement<HTMLSelectElement>("#customer-sort");
const customerPagination = requiredElement<HTMLElement>("#customer-pagination");
const customerPageSummary = requiredElement<HTMLElement>("#customer-page-summary");
const customerPageNumber = requiredElement<HTMLElement>("#customer-page-number");
const customerPagePrevious = requiredElement<HTMLButtonElement>("#customer-page-previous");
const customerPageNext = requiredElement<HTMLButtonElement>("#customer-page-next");
const customerDrawer = requiredElement<HTMLElement>("#customer-drawer");
const customerBackdrop = requiredElement<HTMLButtonElement>("#customer-backdrop");
const customerDetailContent = requiredElement<HTMLElement>("#customer-detail-content");

for (const section of PRESENCE_SECTIONS) {
  const article = document.createElement("article");
  article.className = `presence-card presence-card--${section.toLowerCase()}`;
  article.dataset.section = section;
  article.innerHTML = `
    <div class="card-heading">
      <div>
        <h2>${sectionLabels[section]}</h2>
        <p>${sectionDescriptions[section]}</p>
      </div>
      <span class="index">${String(PRESENCE_SECTIONS.indexOf(section) + 1).padStart(2, "0")}</span>
    </div>
    <div class="card-reading">
      <strong class="count" data-count>—</strong>
      <div class="change" data-change aria-hidden="true"></div>
    </div>
  `;
  grid.append(article);
}

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
let connectionDeadlineTimer: number | undefined;
let reconnectAttempt = 0;
let connectionStartedAt = 0;
let lastSocketMessageAt = 0;
let lastSuccessfulSnapshotAt = 0;
let fallbackRefreshInFlight = false;
let previousCounts: PresenceCounts | undefined;
let displayedTotal = 0;
let hasSnapshot = false;
let lastUpdatedAt: number | undefined;
let latestSnapshot: DashboardSnapshot | undefined;
let selectedRange: "today" | "7" | "30" | "all" | "date" = "30";
let selectedDate: string | null = null;
let sessionPage = 1;
let sessionDetailTriggerId: string | undefined;
let commerceData: CommercePayload | undefined;
let customerDirectory: CustomerDirectoryPayload | undefined;
let customerDirectoryLoading = false;
let loyaltyData: LoyaltyPayload | undefined;
let loyaltyLoading = false;
let loyaltySelectedCustomerId: number | null = null;
let customerFilter = "all";
let customerSearch = "";
let customerSort = "recent";
let customerPage = 1;
let extensionsData: ExtensionsPayload | undefined;
let selectedPromoType: "general" | "product" | "simple_gifts" = "general";
let siteControlsDraft = initialSiteControlsDraftState();
let orderStatusFilter = "all";
let orderSearch = "";
let orderDateFilter: "today" | "7" | "30" | "all" | "custom" = "today";
let orderSort = "date-desc";
let orderDateFrom = "";
let orderDateTo = "";
let ordersWorkspace: "ledger" | "payments" | "reconciliation" = "ledger";
let knownOrderIds = new Set<number>();
let orderFeedInitialized = false;
let liveOrdersRefreshInFlight = false;
let consecutiveOrderFeedFailures = 0;
let orderNotificationCount = 0;
let latestNotifiedOrderId: number | null = null;
let coaSearch = "";
let coaFilter = "all";
let editingCoa: CommerceCoa | null = null;
let coaIntakeResults: Array<{ coa: CommerceCoa; duplicate: boolean }> = [];
let productSearch = "";
let productFilter = "all";
let productsWorkspace: "catalog" | "inventory" = "catalog";
type SalesInsightRange = "today" | "week" | "month";
let salesInsightRange: SalesInsightRange = "today";
let salesInsightLoading = false;
let salesInsightComplete: { range: SalesInsightRange; orders: CommerceOrder[] } | undefined;
let monthlyFinanceOrders: CommerceOrder[] | undefined;
let monthlyFinanceLoading = false;
let monthlyFinanceUpdatedAt = 0;
let monthlyFinanceError = "";
let skuStockSearch = "";
const skuStockExpanded = new Set<number>();
const skuStockDetails = new Map<number, LabelProductDetail>();
const skuStockLoading = new Set<number>();
let inventoryOperations: InventoryOperationsPayload | undefined;
let inventoryOperationsLoading = false;
let inventoryView: "attention" | "stock" | "restocks" = "attention";
let lotAssignmentTarget: { productId: number; variationId: number; label: string; sku: string; strength: string } | null = null;
let lotAssignmentBusy = false;
const waitlistSubscribers = new Map<number, WaitlistSubscriber[]>();
const waitlistCoverageComplete = new Map<number, boolean>();
let activeWaitlistProductId: number | null = null;
let waitlistLoading = false;
let waitlistNotifyConfirmation = false;
let fulfillmentLocations: FulfillmentLocationsPayload | undefined;
let fulfillmentLocationsLoading = false;
let fulfillmentQueue: FulfillmentQueuePayload | undefined;
let fulfillmentQueueLoading = false;
let fulfillmentQueueFilter: FulfillmentQueueEntry["queueStatus"] = "waiting";
let selectedFulfillmentOrderId: number | null = null;
let fulfillmentScanFeedback: FulfillmentScanFeedback | null = null;
let fulfillmentScanBusy = false;
let fulfillmentScanSound = localStorage.getItem("phaseone-picking-sound") !== "off";
const fulfillmentScanQueue: Array<{ barcode: string; clientEventId: string }> = [];
let fulfillmentScannerBuffer = "";
let fulfillmentScannerLastKeyAt = 0;
let fulfillmentCameraControls: { stop: () => void } | null = null;
let fulfillmentCameraRequest = 0;
let fulfillmentCameraCaptured = false;
let fulfillmentCameraReturnFocus: HTMLElement | null = null;
let fulfillmentCameraSuccessTimer: number | undefined;
let fulfillmentPackingAttempt: { fulfillmentId: string; clientEventId: string } | null = null;
let fulfillmentPackingBusy = false;
let fulfillmentCoaSyncBusy = false;
interface FulfillmentShippingUiState {
  loading: boolean;
  rateLoading: boolean;
  labelBusy: boolean;
  capabilities?: ShippingCapabilitiesPayload;
  rates?: ShippingRatesPayload;
  label: ShippingLabel | null;
  printUrl: string | null;
  selectedCarrierId: string;
  selectedRateIndex: number | null;
  package: ShippingPackageInput;
  labelAttemptId: string | null;
  error: string | null;
}
const fulfillmentShippingStates = new Map<string, FulfillmentShippingUiState>();
let shippingConfirmationAction: "purchase" | "void" | null = null;
interface FulfillmentEvidenceUiState {
  loading: boolean;
  busyKind: FulfillmentEvidenceKind | null;
  confirming: boolean;
  notifying: boolean;
  workspace?: FulfillmentEvidenceWorkspace;
  error: string | null;
}
const fulfillmentEvidenceStates = new Map<string, FulfillmentEvidenceUiState>();
let selectedLabelProductId: number | null = null;
let labelProductDetail: LabelProductDetail | undefined;
let labelProductRequest = 0;
let labelProductSearch = "";
let labelProductCategory = "all";
let labelProductSort: "name" | "stock-low" | "location" = "name";
let labelProductView: "grid" | "list" = localStorage.getItem("phaseone:label-product-view") === "list" ? "list" : "grid";
let selectedLocationProductId: number | null = null;
let locationProductDetail: LabelProductDetail | undefined;
let locationProductRequest = 0;
let locationProductSearch = "";
let labelLocationFilter: "all" | "assigned" | "unassigned" = "all";
let labelHistorySearch = "";
let labelHistoryType: "all" | BarcodeEntityType = "all";
let labelHistorySort: "newest" | "oldest" | "product" = "newest";
let selectedLabelType: BarcodeEntityType = "product";
let selectedLabelVariationId = 0;
let selectedLabelCoaId = "";
let activeBarcodeLabel: BarcodeLabel | null = null;
let labelPrintStep: "product" | "details" | "preview" = "product";
let mediaSearch = "";
let editingProductId: number | null = null;
let activeProductTestingCost = 0;
let activeProductTestingLot = "";
let activeOrder: CommerceOrder | null = null;
let activeOrderOperations: OrderOperations | null = null;
let activeOrderTab: "overview" | "payment" | "documents" | "coas" | "shipping" | "timeline" = "overview";
let pendingOrderAction: "confirm" | "complete" | "cancel" | null = null;
let workspaceSession: WorkspaceSession | undefined;
let workspaceUsers: WorkspaceUser[] = [];
let workspaceNotifications: WorkspaceNotification[] = [];
let catchupOrderNotifications: WorkspaceNotification[] = [];
let notificationFilter = "all";
let marketingCartFilter: "open" | "abandoned" | "all" = "open";
const SESSION_PAGE_SIZE = 5;
const CUSTOMER_PAGE_SIZE = 50;
const ORDER_ALERTS_STORAGE_KEY = "phaseone:order-alerts";
const LEGACY_ANALYTICS_TIME_ZONE = "UTC";
const displayedCounts = emptyPresenceCounts();
const cardTimers = new Map<PresenceSection, number>();
const SOCKET_CONNECT_TIMEOUT_MS = 12_000;
const SOCKET_STALE_AFTER_MS = 70_000;
const SOCKET_WATCHDOG_INTERVAL_MS = 5_000;
const LIVE_SNAPSHOT_VISUAL_GRACE_MS = 120_000;

function hasRecentLiveSnapshot(): boolean {
  return hasSnapshot && lastSuccessfulSnapshotAt > 0 &&
    Date.now() - lastSuccessfulSnapshotAt < LIVE_SNAPSHOT_VISUAL_GRACE_MS;
}

function setConnectionState(
  state: "connecting" | "live" | "reconnecting" | "offline",
  label: string,
): void {
  connectionElement.dataset.state = state;
  connectionLabel.textContent = label;
  footerConnection.textContent = label;
  monitorConnectionLabel.textContent = {
    connecting: "Connecting to live stream",
    live: "Live visitor stream connected",
    reconnecting: "Reconnecting live stream",
    offline: "Live stream interrupted",
  }[state];
  const visitorStream = document.querySelector<HTMLElement>("#monitor-visitor-stream");
  if (visitorStream) {
    visitorStream.textContent = state === "live"
      ? "Production visitor stream live"
      : state === "offline"
        ? "Visitor stream interrupted"
        : "Visitor stream reconnecting";
  }
  const integrationState = document.querySelector<HTMLElement>("#realtime-integration-state");
  if (integrationState) {
    integrationState.textContent = state === "live" ? "Receiver online" : state === "connecting" || state === "reconnecting" ? "Connecting" : "Offline";
    integrationState.className = `integration-state${state === "live" ? " integration-state--connected" : ""}`;
  }
}

function animateInteger(
  element: HTMLElement,
  from: number,
  to: number,
  onValue: (value: number) => void,
): void {
  if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = String(to);
    onValue(to);
    return;
  }
  const startedAt = performance.now();
  const duration = 320;
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(from + (to - from) * eased);
    element.textContent = String(value);
    onValue(value);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function pulseCard(
  section: PresenceSection,
  previous: number,
  current: number,
): void {
  const card = requiredElement<HTMLElement>(`[data-section="${section}"]`);
  const change = requiredElement<HTMLElement>(
    `[data-section="${section}"] [data-change]`,
  );
  const existingTimer = cardTimers.get(section);
  if (existingTimer) window.clearTimeout(existingTimer);

  card.classList.remove("is-entering", "is-entering-checkout", "is-leaving");
  void card.offsetWidth;

  const delta = current - previous;
  change.innerHTML = `<span>${previous} → ${current}</span>${
    delta > 0 ? `<b>+${delta}</b>` : ""
  }`;

  if (delta > 0) {
    card.classList.add(
      section === "CHECKOUT" ? "is-entering-checkout" : "is-entering",
    );
    announcement.textContent = `${sectionLabels[section]} increased from ${previous} to ${current}`;
  } else {
    card.classList.add("is-leaving");
  }

  cardTimers.set(
    section,
    window.setTimeout(() => {
      card.classList.remove("is-entering", "is-entering-checkout", "is-leaving");
      change.replaceChildren();
      cardTimers.delete(section);
    }, delta > 0 ? 2_000 : 1_100),
  );
}

function applySnapshot(snapshot: DashboardSnapshot, transport: "socket" | "http" = "socket"): void {
  const firstSnapshot = !hasSnapshot;
  hasSnapshot = true;
  lastSuccessfulSnapshotAt = Date.now();
  setConnectionState("live", transport === "socket" ? "Live" : "Live backup");
  if (transport === "http") {
    monitorConnectionLabel.textContent = "Live data connected · backup channel";
    const visitorStream = document.querySelector<HTMLElement>("#monitor-visitor-stream");
    if (visitorStream) visitorStream.textContent = "Production data live · backup channel";
  }
  reconnectAttempt = 0;
  lastUpdatedAt = Date.parse(snapshot.serverTime) || Date.now();
  latestSnapshot = snapshot;

  for (const section of PRESENCE_SECTIONS) {
    const target = snapshot.counts[section];
    const countElement = requiredElement<HTMLElement>(
      `[data-section="${section}"] [data-count]`,
    );
    if (!firstSnapshot && previousCounts && target !== previousCounts[section]) {
      pulseCard(section, previousCounts[section], target);
    }
    const from = firstSnapshot ? target : displayedCounts[section];
    animateInteger(countElement, from, target, (value) => {
      displayedCounts[section] = value;
    });
  }

  const totalFrom = firstSnapshot ? snapshot.total : displayedTotal;
  animateInteger(totalElement, totalFrom, snapshot.total, (value) => {
    displayedTotal = value;
    overviewOnlineElement.textContent = formatNumber(value);
    navLiveCountElement.textContent = formatNumber(value);
    navLiveCountElement.hidden = value <= 0;
    monitorOnlineMirrorElement.textContent = formatNumber(value);
  });
  previousCounts = { ...snapshot.counts };
  renderAnalytics(snapshot);
  renderMarketing(snapshot);
  updateRelativeTime();
}

function pageLabel(path: string): string {
  if (path === "/") return "Home";
  const translations: Record<string, string> = {
    shop: "Shop",
    product: "Product",
    checkout: "Checkout",
    cart: "Cart",
    account: "Account",
    "thank you": "Order confirmation",
  };
  return path
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part).replace(/[-_]+/g, " ");
      } catch {
        return part.replace(/[-_]+/g, " ");
      }
    })
    .map((part) => translations[part.toLowerCase()] || part.replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .join(" / ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function displayLabel(value: string): string {
  return value;
}

function dateKey(
  value = new Date(),
  timeZone = LEGACY_ANALYTICS_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDateKey(value: string, days: number): string {
  const parts = value.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(Date.UTC(year, month - 1, day + days, 12))
    .toISOString()
    .slice(0, 10);
}

function formatDateLabel(value: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatShortDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

function rankLabels(values: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 8);
}

function pagesForSessions(
  sessions: DashboardSession[],
  cutoff: string | null,
  timeZone: string,
  exactDate: string | null = null,
): Array<{ path: string; views: number }> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const allPageEvents = (session.events || []).filter(
      (event) => event.type === "pageview",
    );
    const pageEvents = allPageEvents.filter((event) => {
      const eventDate = dateKey(new Date(event.at), timeZone);
      return exactDate ? eventDate === exactDate : !cutoff || eventDate >= cutoff;
    });
    if (pageEvents.length) {
      for (const event of pageEvents) counts.set(event.path, (counts.get(event.path) || 0) + 1);
    } else if (allPageEvents.length === 0 && session.pageViews > 0) {
      const sessionDate = dateKey(new Date(session.startedAt), timeZone);
      const sessionMatches = exactDate
        ? sessionDate === exactDate
        : !cutoff || sessionDate >= cutoff;
      if (sessionMatches) {
        counts.set(session.path, (counts.get(session.path) || 0) + session.pageViews);
      }
    }
  }
  return [...counts.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((left, right) => right.views - left.views || left.path.localeCompare(right.path))
    .slice(0, 8);
}

function visitorCountForRange(
  analytics: DashboardAnalytics,
  sessions: DashboardSession[],
): number {
  if (selectedRange === "date") {
    if (!selectedDate) return 0;
    return dailyVisitorSeries(analytics).find(
      (item) => item.date === selectedDate,
    )?.visitors ?? 0;
  }
  const ranges = analytics.visitorRanges;
  if (ranges) {
    return {
      today: ranges.today,
      "7": ranges.last7Days,
      "30": ranges.last30Days,
      all: ranges.all,
    }[selectedRange];
  }
  if (selectedRange === "all") return analytics.uniqueVisitors;

  // Legacy snapshots did not include server-computed range totals. This is a
  // best-effort fallback over the recent-session window only.
  return new Set(
    sessions.map((session) =>
      session.visitorNumber
        ? `visitor:${session.visitorNumber}`
        : `session:${session.id}`,
    ),
  ).size;
}

function dailyVisitorSeries(
  analytics: DashboardAnalytics,
): Array<{ date: string; visitors: number }> {
  if (analytics.dailyVisitors?.length) return analytics.dailyVisitors;
  return analytics.dailyActivity.map((item) => ({
    date: item.date,
    visitors: item.visitors ?? item.sessions,
  }));
}

function isReturningSession(session: DashboardSession): boolean {
  return session.returningVisitor ?? (session.visitNumber ?? 1) > 1;
}

function sessionHasCompletedOrder(session: DashboardSession): boolean {
  return Boolean(
    session.orderCompleted ||
    session.events?.some((event) => event.type === "order" && event.status === "paid"),
  );
}

function renderSessionRow(session: DashboardSession): string {
  const visitorNumber = session.visitorNumber;
  const visitNumber = session.visitNumber ?? 1;
  const identity = visitorNumber
    ? `Visitor #${visitorNumber} · Visit ${visitNumber}`
    : session.number
      ? `Session #${session.number} · Visit ${visitNumber}`
      : `Anonymous visitor · Visit ${visitNumber}`;
  const returning = isReturningSession(session);
  const completedOrder = sessionHasCompletedOrder(session);
  const sessionCart = latestSnapshot?.analytics.marketing?.carts.find((cart) => cart.sessionId === session.id);
  const sessionSearchCount = latestSnapshot?.analytics.marketing?.recentSearches
    .filter((search) => search.sessionId === session.id).length || 0;
  const badges = [
    returning
      ? '<span class="session-badge session-badge--returning">Returning</span>'
      : "",
    completedOrder
      ? '<span class="session-badge session-badge--order">Purchased</span>'
      : "",
    sessionCart?.itemCount
      ? `<span class="session-badge session-badge--cart">${formatNumber(sessionCart.itemCount)} in cart</span>`
      : "",
    sessionSearchCount
      ? `<span class="session-badge session-badge--search">${formatNumber(sessionSearchCount)} search${sessionSearchCount === 1 ? "" : "es"}</span>`
      : "",
  ].join("");
  const accessibilityStatus = [
    returning ? "returning visitor" : "new visitor",
    completedOrder ? "completed order" : "no completed order",
  ].join(", ");

  return `<button type="button" class="session-row${completedOrder ? " has-order" : ""}" data-session-id="${escapeHtml(session.id)}" aria-haspopup="dialog" aria-controls="session-detail" aria-label="Open ${escapeHtml(identity)}, ${accessibilityStatus}"><span class="session-dot" aria-hidden="true"></span><div class="session-row-main"><div class="session-row-heading"><strong>${escapeHtml(identity)}</strong><span class="session-badges">${badges}</span></div><small>${escapeHtml(displayLabel(session.source))} · ${escapeHtml(displayLabel(session.device))} · ${escapeHtml(pageLabel(session.path))}</small><div class="session-row-meta"><b>${formatNumber(session.pageViews)} page${session.pageViews === 1 ? "" : "s"}</b><small>${formatNumber(session.clicks)} click${session.clicks === 1 ? "" : "s"} · ${relativeDate(session.lastSeenAt)}</small></div></div></button>`;
}

function renderAnalytics(snapshot: DashboardSnapshot): void {
  const { analytics } = snapshot;
  const timeZone = analytics.timeZone || LEGACY_ANALYTICS_TIME_ZONE;
  const currentDate = dateKey(new Date(snapshot.serverTime), timeZone);
  const visitorSeries = dailyVisitorSeries(analytics);
  const earliestDate = visitorSeries[0]?.date ?? currentDate;
  const latestDate = visitorSeries[visitorSeries.length - 1]?.date ?? currentDate;
  specificDateInput.min = earliestDate;
  specificDateInput.max = latestDate;
  specificDateInput.title = `Available from ${formatDateLabel(earliestDate)} to ${formatDateLabel(latestDate)}`;
  monitorSpecificDateInput.min = earliestDate;
  monitorSpecificDateInput.max = latestDate;
  monitorSpecificDateInput.title = specificDateInput.title;
  const exactDate = selectedRange === "date" ? selectedDate : null;
  const cutoffDays = selectedRange === "today"
    ? 0
    : selectedRange === "7"
      ? 6
      : selectedRange === "30"
        ? 29
        : null;
  const cutoff = cutoffDays === null
    ? null
    : shiftDateKey(currentDate, -cutoffDays);
  const activity = analytics.dailyActivity.filter((item) =>
    exactDate ? item.date === exactDate : !cutoff || item.date >= cutoff,
  );
  const sessionsInRange = analytics.recentSessions.filter((session) => {
    const sessionDate = dateKey(new Date(session.startedAt), timeZone);
    return exactDate ? sessionDate === exactDate : !cutoff || sessionDate >= cutoff;
  });
  const sessionsStartedInRange = sessionsInRange;
  const filteredViews = selectedRange === "all"
    ? analytics.totalViews
    : activity.reduce((sum, item) => sum + item.views, 0);
  let filteredSessions = selectedRange === "all"
    ? analytics.totalSessions
    : activity.reduce((sum, item) => sum + item.sessions, 0);
  const recentReturningSessions = sessionsInRange.filter(
    (session) => isReturningSession(session),
  ).length;
  const recentOrders = sessionsInRange.filter(sessionHasCompletedOrder).length;
  const hasDailyReturningSessions = activity.some(
    (item) => typeof item.returningSessions === "number",
  );
  const hasDailyOrders = activity.some((item) => typeof item.orders === "number");
  const filteredReturningSessions = selectedRange === "all"
    ? analytics.returningSessions ?? recentReturningSessions
    : hasDailyReturningSessions
      ? activity.reduce((sum, item) => sum + (item.returningSessions ?? 0), 0)
      : recentReturningSessions;
  const filteredOrders = selectedRange === "all"
    ? analytics.totalOrders ?? recentOrders
    : hasDailyOrders
      ? activity.reduce((sum, item) => sum + (item.orders ?? 0), 0)
      : recentOrders;
  monitorTotalViewsElement.textContent = formatNumber(filteredViews);
  uniqueVisitorsElement.textContent = formatNumber(
    visitorCountForRange(analytics, sessionsInRange),
  );
  monitorUniqueVisitorsElement.textContent = uniqueVisitorsElement.textContent;
  monitorReturningVisitsElement.textContent = formatNumber(filteredReturningSessions);
  monitorTotalSessionsElement.textContent = formatNumber(filteredSessions);
  monitorTotalOrdersElement.textContent = formatNumber(filteredOrders);
  visitors30Element.textContent = formatNumber(analytics.visitorsLast30Minutes);
  monitorVisitors30Element.textContent = visitors30Element.textContent;
  const conversion = filteredSessions > 0
    ? (filteredOrders / filteredSessions) * 100
    : 0;
  monitorConversionElement.textContent = `${conversion.toFixed(1)}%`;
  const today = currentDate;
  const todayActivity = analytics.dailyActivity.find((item) => item.date === today);
  const todayVisitors = visitorSeries.find(
    (item) => item.date === today,
  )?.visitors ?? analytics.visitorRanges?.today ?? 0;
  todayVisitorsElement.textContent = formatNumber(todayVisitors);
  todayVisitsElement.textContent = formatNumber(todayActivity?.sessions ?? 0);
  todayOrdersElement.textContent = formatNumber(todayActivity?.orders ?? 0);
  monitorTodayVisitorsElement.textContent = todayVisitorsElement.textContent;
  monitorTodayVisitsElement.textContent = todayVisitsElement.textContent;
  monitorTodayOrdersElement.textContent = todayOrdersElement.textContent;
  const filteredPages = selectedRange === "all"
    ? analytics.topPages
    : pagesForSessions(analytics.recentSessions, cutoff, timeZone, exactDate);
  const filteredSources = selectedRange === "all"
    ? analytics.topSources
    : rankLabels(sessionsStartedInRange.map((session) => session.source));
  const filteredDevices = selectedRange === "all"
    ? analytics.topDevices
    : rankLabels(sessionsStartedInRange.map((session) => session.device));
  const leader = filteredPages[0];

  if (!leader) {
    monitorPageRankingElement.innerHTML = '<p class="empty-state">No page views are available for this period yet.</p>';
  } else {
    monitorPageRankingElement.innerHTML = filteredPages.map((page, index) => {
      const width = Math.max(4, Math.round((page.views / leader.views) * 100));
      return `<div class="rank-row"><span class="rank-index">${String(index + 1).padStart(2, "0")}</span><div class="rank-data"><div><strong>${escapeHtml(pageLabel(page.path))}</strong><code>${escapeHtml(page.path)}</code><b>${formatNumber(page.views)}</b></div><span class="rank-track"><i style="width:${width}%"></i></span></div></div>`;
    }).join("");
  }

  renderTrafficSources(monitorSourceListElement, filteredSources);
  renderRankList(monitorDeviceListElement, filteredDevices);
  const deviceTotal = filteredDevices.reduce((sum, item) => sum + item.count, 0);
  monitorDeviceTotalElement.textContent = formatNumber(deviceTotal);
  const mobile = filteredDevices.find((item) => item.label === "Mobile")?.count || 0;
  const tablet = filteredDevices.find((item) => item.label === "Tablet")?.count || 0;
  const mobileEnd = deviceTotal ? Math.round((mobile / deviceTotal) * 100) : 0;
  const tabletEnd = deviceTotal ? mobileEnd + Math.round((tablet / deviceTotal) * 100) : 0;
  monitorDeviceDonutElement.style.background = deviceTotal
    ? `conic-gradient(#171719 0 ${mobileEnd}%, #7a7a7f ${mobileEnd}% ${tabletEnd}%, #c9c9cc ${tabletEnd}% 100%)`
    : "rgba(18, 48, 94, .42)";

  const visibleSessions = [...sessionsInRange].sort((left, right) =>
    Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
    (right.number || 0) - (left.number || 0),
  );
  const sessionPageCount = Math.max(1, Math.ceil(visibleSessions.length / SESSION_PAGE_SIZE));
  sessionPage = Math.min(sessionPage, sessionPageCount);
  const pageSessions = visibleSessions.slice(
    (sessionPage - 1) * SESSION_PAGE_SIZE,
    sessionPage * SESSION_PAGE_SIZE,
  );
  sessionListElement.innerHTML = pageSessions.length
    ? pageSessions.map(renderSessionRow).join("")
    : '<p class="empty-state">New sessions will appear here.</p>';
  sessionPagination.hidden = visibleSessions.length <= SESSION_PAGE_SIZE;
  sessionsPage.textContent = `Page ${sessionPage} of ${sessionPageCount}`;
  sessionsPrevious.disabled = sessionPage <= 1;
  sessionsNext.disabled = sessionPage >= sessionPageCount;
  const trendItems = visitorSeries.filter(
    (item) => exactDate ? item.date === exactDate : !cutoff || item.date >= cutoff,
  );
  renderTrend(trendItems);
}

function renderMarketing(snapshot: DashboardSnapshot): void {
  const marketing = snapshot.analytics.marketing;
  if (!marketing) {
    marketingSignalBanner.dataset.state = "waiting";
    marketingSignalCopy.textContent = "Deploy the storefront tracker to begin receiving customer-intent signals.";
    marketingSignalStatus.textContent = "Connection pending";
    marketingActiveCarts.textContent = "0";
    marketingAbandonedCarts.textContent = "0";
    marketingRecoverableValue.textContent = formatCurrency(0);
    marketingCapturedValue.textContent = `${formatCurrency(0)} currently in carts`;
    marketingZeroSearches.textContent = "0";
    renderMonitorIntent(snapshot);
    return;
  }

  const hasSignals = marketing.carts.length > 0 ||
    marketing.topSearches.length > 0 ||
    marketing.recentSearches.length > 0;
  const signalTimes = [
    ...marketing.carts.map((cart) => Date.parse(cart.updatedAt)),
    ...marketing.recentSearches.map((search) => Date.parse(search.searchedAt)),
  ].filter(Number.isFinite);
  const latestSignal = signalTimes.length ? Math.max(...signalTimes) : 0;
  marketingSignalBanner.dataset.state = hasSignals ? "live" : "waiting";
  marketingSignalCopy.textContent = hasSignals
    ? `Cart and search activity is updating automatically${latestSignal ? ` · Last signal ${relativeDate(new Date(latestSignal).toISOString())}` : ""}.`
    : "Waiting for the first search or cart signal from the storefront.";
  marketingSignalStatus.textContent = hasSignals ? "Tracking active" : "Waiting for activity";

  marketingActiveCarts.textContent = formatNumber(marketing.activeCarts);
  marketingAbandonedCarts.textContent = formatNumber(marketing.abandonedCarts);
  marketingRecoverableValue.textContent = formatCurrency(marketing.abandonedValue);
  marketingCapturedValue.textContent = `${formatCurrency(marketing.capturedValue)} currently in carts`;
  marketingZeroSearches.textContent = formatNumber(marketing.zeroResultSearches);

  const visibleCarts = marketing.carts.filter((cart) => {
    if (marketingCartFilter === "all") return true;
    if (marketingCartFilter === "abandoned") return cart.status === "abandoned";
    return cart.status === "active" || cart.status === "abandoned";
  }).slice(0, 20);
  const cartStatusLabels: Record<string, string> = {
    active: "Active",
    abandoned: "Abandoned",
    converted: "Purchased",
    cleared: "Cleared",
  };
  marketingCartList.innerHTML = visibleCarts.length
    ? visibleCarts.map((cart) => {
        const identity = cart.customerName || cart.customerEmail ||
          (cart.visitorNumber ? `Visitor #${cart.visitorNumber}` : "Anonymous visitor");
        const identityDetail = cart.customerEmail && cart.customerName
          ? cart.customerEmail
          : cart.visitorNumber
            ? `Visitor #${cart.visitorNumber}`
            : "Email not captured yet";
        const productSummary = cart.items
          .slice(0, 3)
          .map((item) => `${item.quantity}× ${item.name}`)
          .join(" · ");
        const remainingProducts = Math.max(0, cart.items.length - 3);
        const thumbnails = cart.items.slice(0, 3)
          .map((item) => marketingCartImageMarkup(item, "marketing-cart-thumb"))
          .join("");
        return `<article class="marketing-cart-row"><div class="marketing-cart-main"><div class="marketing-cart-thumbs" aria-hidden="true">${thumbnails}</div><div class="marketing-cart-copy"><div class="marketing-cart-heading"><strong>${escapeHtml(identity)}</strong><span class="marketing-cart-state marketing-cart-state--${cart.status}">${cartStatusLabels[cart.status] || cart.status}</span></div><small>${escapeHtml(identityDetail)}</small><span class="marketing-cart-products">${escapeHtml(productSummary)}${remainingProducts ? ` · +${remainingProducts} more` : ""}</span></div></div><div class="marketing-cart-value"><strong>${formatCurrency(cart.total)}</strong><small>${formatNumber(cart.itemCount)} item${cart.itemCount === 1 ? "" : "s"} · ${relativeDate(cart.updatedAt)}</small></div></article>`;
      }).join("")
    : `<div class="marketing-empty"><i>◇</i><strong>${marketingCartFilter === "abandoned" ? "No abandoned carts" : "No cart activity in this view"}</strong><p>${marketingCartFilter === "abandoned" ? "That is good news. Carts that remain inactive for 30 minutes will appear here." : "As customers add products, their carts will appear here automatically."}</p></div>`;

  const totalSearches = marketing.topSearches.reduce((sum, item) => sum + item.count, 0);
  marketingSearchTotal.textContent = `${formatNumber(totalSearches)} search${totalSearches === 1 ? "" : "es"}`;
  const searchLeader = marketing.topSearches[0]?.count || 0;
  marketingSearchList.innerHTML = marketing.topSearches.length
    ? marketing.topSearches.slice(0, 8).map((search) => {
        const width = searchLeader ? Math.max(5, Math.round((search.count / searchLeader) * 100)) : 0;
        const zeroBadge = search.zeroResults
          ? `<span class="marketing-zero-badge">${formatNumber(search.zeroResults)} no result${search.zeroResults === 1 ? "" : "s"}</span>`
          : "";
        return `<div class="marketing-search-row"><div class="marketing-search-query"><div><strong>${escapeHtml(search.query)}</strong>${zeroBadge}</div><span class="marketing-search-bar"><i style="width:${width}%"></i></span></div><div class="marketing-search-count"><strong>${formatNumber(search.count)}</strong><small>search${search.count === 1 ? "" : "es"}</small></div></div>`;
      }).join("")
    : '<div class="marketing-empty marketing-empty--compact"><strong>No searches recorded</strong><p>Customer queries will rank here as the storefront receives activity.</p></div>';

  marketingRecentSearches.innerHTML = marketing.recentSearches.length
    ? marketing.recentSearches.slice(0, 6).map((search) => {
        const identity = search.visitorNumber ? `Visitor #${search.visitorNumber}` : "Anonymous visitor";
        const resultLabel = search.resultCount === 0
          ? "No results"
          : `${formatNumber(search.resultCount)} result${search.resultCount === 1 ? "" : "s"}`;
        return `<div class="marketing-recent-search${search.resultCount === 0 ? " is-zero" : ""}"><div><strong>${escapeHtml(search.query)}</strong><small>${identity} · ${relativeDate(search.searchedAt)}</small></div><span>${resultLabel}</span></div>`;
      }).join("")
    : '<p class="empty-state">No recent searches yet.</p>';
  renderMonitorIntent(snapshot);
}

function timestampMatchesMonitorRange(value: string, snapshot: DashboardSnapshot): boolean {
  if (selectedRange === "all") return true;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const timeZone = snapshot.analytics.timeZone || LEGACY_ANALYTICS_TIME_ZONE;
  const currentDate = dateKey(new Date(snapshot.serverTime), timeZone);
  const eventDate = dateKey(parsed, timeZone);
  if (selectedRange === "date") return eventDate === selectedDate;
  const days = selectedRange === "today" ? 0 : selectedRange === "7" ? 6 : 29;
  return eventDate >= shiftDateKey(currentDate, -days);
}

function monitorCartIdentity(cart: NonNullable<DashboardAnalytics["marketing"]>["carts"][number]): string {
  return cart.customerName || cart.customerEmail ||
    (cart.visitorNumber ? `Visitor #${cart.visitorNumber}` : "Anonymous visitor");
}

type MarketingCartItem = NonNullable<DashboardAnalytics["marketing"]>["carts"][number]["items"][number];

function marketingCartProduct(item: MarketingCartItem): CommerceProduct | undefined {
  const normalizedSku = item.sku.trim().toLowerCase();
  return commerceData?.products.find((product) =>
    product.id === item.productId ||
    (normalizedSku !== "" && product.sku.trim().toLowerCase() === normalizedSku),
  );
}

function normalizeStorefrontImageUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "";
  try {
    return new URL(candidate, "https://phaseonelabz.com").toString();
  } catch {
    return "";
  }
}

function marketingCartImageUrl(item: MarketingCartItem): string {
  const product = marketingCartProduct(item);
  return normalizeStorefrontImageUrl(
    product?.thumbnailUrl || product?.imageUrl || item.imageUrl,
  );
}

function marketingCartImageMarkup(item: MarketingCartItem, className: string): string {
  const imageUrl = marketingCartImageUrl(item);
  const fallback = escapeHtml((item.name.trim()[0] || "P").toUpperCase());
  return `<span class="${className} cart-product-visual" data-cart-product-visual><i aria-hidden="true">${fallback}</i>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" data-cart-product-image />` : ""}</span>`;
}

function renderMonitorIntent(snapshot: DashboardSnapshot): void {
  const marketing = snapshot.analytics.marketing;
  if (!marketing) {
    monitorIntentKpis.innerHTML = `<article><span>Active carts</span><strong>0</strong><small>Storefront signal not connected</small></article><article><span>Cart value</span><strong>${formatCurrency(0)}</strong><small>No captured cart value</small></article><article><span>Searches</span><strong>0</strong><small>No search signal connected</small></article><article><span>Search gaps</span><strong>0</strong><small>No zero-result searches</small></article>`;
    monitorCartCount.textContent = "0 carts";
    monitorSearchCount.textContent = "0 searches";
    monitorCartStream.innerHTML = '<div class="monitor-intent-empty"><span>◇</span><div><strong>Cart signal is waiting</strong><p>Real product additions will appear here after the storefront tracker sends them.</p></div></div>';
    monitorSearchStream.innerHTML = '<div class="monitor-intent-empty"><span>⌕</span><div><strong>Search signal is waiting</strong><p>Real customer queries will appear here after the storefront tracker sends them.</p></div></div>';
    return;
  }
  const carts = marketing.carts
    .filter((cart) => timestampMatchesMonitorRange(cart.updatedAt, snapshot))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const searches = marketing.recentSearches
    .filter((search) => timestampMatchesMonitorRange(search.searchedAt, snapshot))
    .sort((left, right) => Date.parse(right.searchedAt) - Date.parse(left.searchedAt));
  const activeCarts = carts.filter((cart) => cart.status === "active").length;
  const capturedValue = carts
    .filter((cart) => cart.status === "active" || cart.status === "abandoned")
    .reduce((sum, cart) => sum + cart.total, 0);
  const gaps = searches.filter((search) => search.resultCount === 0).length;
  monitorIntentKpis.innerHTML = `<article><span>Active carts</span><strong>${formatNumber(activeCarts)}</strong><small>Still shopping in this period</small></article><article><span>Cart value</span><strong>${escapeHtml(formatCurrency(capturedValue))}</strong><small>Active and abandoned carts</small></article><article><span>Searches</span><strong>${formatNumber(searches.length)}</strong><small>Latest captured queries</small></article><article class="${gaps ? "has-opportunity" : ""}"><span>Search gaps</span><strong>${formatNumber(gaps)}</strong><small>Queries with no result</small></article>`;
  monitorCartCount.textContent = `${formatNumber(carts.length)} cart${carts.length === 1 ? "" : "s"}`;
  monitorCartStream.innerHTML = carts.length
    ? carts.slice(0, 8).map((cart) => {
        const items = cart.items.slice(0, 4).map((item) => `<li>${marketingCartImageMarkup(item, "monitor-cart-product-image")}<div><strong>${formatNumber(item.quantity)}× ${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku || (item.variationId ? `Variation ${item.variationId}` : `Product ${item.productId}`))}</small></div><b>${escapeHtml(formatCurrency(item.price * item.quantity))}</b></li>`).join("");
        return `<article class="monitor-cart-card"><header><div><strong>${escapeHtml(monitorCartIdentity(cart))}</strong><small>${relativeDate(cart.updatedAt)} · ${escapeHtml(pageLabel(cart.path))}</small></div><span class="marketing-cart-state marketing-cart-state--${cart.status}">${escapeHtml(displayLabel(cart.status))}</span></header><ul>${items}</ul><footer><span>${formatNumber(cart.itemCount)} item${cart.itemCount === 1 ? "" : "s"}</span><strong>${escapeHtml(formatCurrency(cart.total))}</strong></footer></article>`;
      }).join("")
    : '<div class="monitor-intent-empty"><span>◇</span><div><strong>No cart activity in this period</strong><p>Product additions will appear here with their SKU, quantity and value.</p></div></div>';
  monitorSearchCount.textContent = `${formatNumber(searches.length)} search${searches.length === 1 ? "" : "es"}`;
  monitorSearchStream.innerHTML = searches.length
    ? searches.slice(0, 12).map((search) => `<article class="monitor-search-row${search.resultCount === 0 ? " is-zero" : ""}"><span aria-hidden="true">⌕</span><div><strong>${escapeHtml(search.query)}</strong><small>${search.visitorNumber ? `Visitor #${search.visitorNumber}` : "Anonymous visitor"} · ${relativeDate(search.searchedAt)}</small></div><b>${search.resultCount === 0 ? "No results" : `${formatNumber(search.resultCount)} result${search.resultCount === 1 ? "" : "s"}`}</b></article>`).join("")
    : '<div class="monitor-intent-empty"><span>⌕</span><div><strong>No searches in this period</strong><p>The latest real storefront queries will appear here.</p></div></div>';
}

function sessionIntentMarkup(sessionId: string): string {
  const marketing = latestSnapshot?.analytics.marketing;
  if (!marketing) return "";
  const cart = marketing.carts.find((item) => item.sessionId === sessionId);
  const searches = marketing.recentSearches
    .filter((item) => item.sessionId === sessionId)
    .sort((left, right) => Date.parse(right.searchedAt) - Date.parse(left.searchedAt));
  if (!cart && !searches.length) return "";
  const cartMarkup = cart
    ? `<div class="session-intent-card"><span>Cart</span><strong>${formatNumber(cart.itemCount)} item${cart.itemCount === 1 ? "" : "s"} · ${escapeHtml(formatCurrency(cart.total))}</strong><ul>${cart.items.map((item) => `<li>${formatNumber(item.quantity)}× ${escapeHtml(item.name)} <small>${escapeHtml(item.sku || "No SKU")}</small></li>`).join("")}</ul></div>`
    : '<div class="session-intent-card"><span>Cart</span><strong>No cart recorded</strong></div>';
  const searchMarkup = searches.length
    ? `<div class="session-intent-card"><span>Store searches</span><strong>${formatNumber(searches.length)} captured</strong><ul>${searches.slice(0, 8).map((search) => `<li>“${escapeHtml(search.query)}” <small>${search.resultCount ? `${formatNumber(search.resultCount)} results` : "No results"}</small></li>`).join("")}</ul></div>`
    : '<div class="session-intent-card"><span>Store searches</span><strong>No search recorded</strong></div>';
  return `<section class="session-intent-panel"><div class="journey-heading"><span>Customer intent</span><b>Connected to this visit</b></div><div>${cartMarkup}${searchMarkup}</div></section>`;
}

function renderJourneyEvent(event: DashboardEvent, index: number): string {
  const time = new Date(event.at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const paidOrder = event.type === "order" && event.status === "paid";
  const action = event.type === "order"
    ? paidOrder ? "Order completed" : "Order event"
    : event.type === "click"
      ? "Clicked"
      : "Visited";
  const detail = event.type === "order"
    ? paidOrder ? "Payment confirmed" : "Status unavailable"
    : event.type === "click"
      ? event.label || "Interaction"
      : pageLabel(event.path);
  const icon = paidOrder ? "✓" : event.type === "order" ? "•" : String(index + 1);
  const eventClass = paidOrder
    ? "order"
    : event.type === "order"
      ? "summary"
      : event.type;

  return `<div class="journey-event journey-event--${eventClass}"><i>${icon}</i><div><span>${action} · ${time}</span><strong>${escapeHtml(detail)}</strong><code>${escapeHtml(event.path)}</code></div></div>`;
}

function openSessionDetail(sessionId: string): void {
  const session = latestSnapshot?.analytics.recentSessions.find((item) => item.id === sessionId);
  if (!session) return;
  const events = [...(session.events || [])].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const visitorNumber = session.visitorNumber;
  const visitNumber = session.visitNumber ?? 1;
  const returning = isReturningSession(session);
  const completedOrder = sessionHasCompletedOrder(session);
  const detailedOrder = events.find(
    (event) => event.type === "order" && event.status === "paid",
  );
  const orderCompletedAt = session.orderCompletedAt ?? detailedOrder?.at;
  const detailedPageViews = events.filter((event) => event.type === "pageview").length;
  const detailedClicks = events.filter((event) => event.type === "click").length;
  const earlierPageViews = Math.max(0, session.pageViews - detailedPageViews);
  const earlierClicks = Math.max(0, session.clicks - detailedClicks);
  sessionDetailTitle.textContent = visitorNumber
    ? `Visitor #${visitorNumber} · Visit ${visitNumber}`
    : session.number
      ? `Session #${session.number} · Visit ${visitNumber}`
      : `Anonymous visitor · Visit ${visitNumber}`;
  const durationMs = Math.max(0, Date.parse(session.lastSeenAt) - Date.parse(session.startedAt));
  const durationLabel = durationMs < 60_000 ? `${Math.floor(durationMs / 1_000)}s` : `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1_000)}s`;
  const summaryEvents = [
    earlierPageViews
      ? `<div class="journey-event journey-event--summary"><i>↗</i><div><span>Earlier activity</span><strong>${earlierPageViews} page${earlierPageViews === 1 ? "" : "s"}</strong><code>Last page: ${escapeHtml(session.path)}</code></div></div>`
      : "",
    earlierClicks
      ? `<div class="journey-event journey-event--summary"><i>+</i><div><span>Earlier interactions</span><strong>${earlierClicks} click${earlierClicks === 1 ? "" : "s"}</strong><code>Count retained for this visit</code></div></div>`
      : "",
  ].join("");
  const detailedEvents = events.map(renderJourneyEvent).join("");
  const inferredOrderEvent = completedOrder && !detailedOrder
    ? `<div class="journey-event journey-event--order"><i>✓</i><div><span>Order completed${orderCompletedAt ? ` · ${new Date(orderCompletedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</span><strong>Payment confirmed</strong><code>Purchase confirmation</code></div></div>`
    : "";
  const journey = summaryEvents || detailedEvents || inferredOrderEvent
    ? `${summaryEvents}${detailedEvents}${inferredOrderEvent}`
    : `<div class="journey-event journey-event--summary"><i>•</i><div><span>Session activity</span><strong>${escapeHtml(pageLabel(session.path))}</strong><code>${escapeHtml(session.path)}</code></div></div>`;
  const totalActions = session.pageViews + session.clicks + (completedOrder ? 1 : 0);
  const conversionBanner = completedOrder
    ? `<section class="conversion-banner" aria-label="Order conversion"><span aria-hidden="true">✓</span><div><strong>Order completed</strong><small>${orderCompletedAt ? `Confirmed ${new Date(orderCompletedAt).toLocaleString("en-US")}` : "Confirmed during this visit"}</small></div></section>`
    : "";
  sessionDetailContent.innerHTML = `<div class="session-status"><i></i><span>Last interaction ${relativeDate(session.lastSeenAt)} · started ${new Date(session.startedAt).toLocaleString("en-US")}</span></div>${conversionBanner}<div class="session-facts"><div><span>Visitor</span><strong>${visitorNumber ? `#${visitorNumber}` : "Anonymous"}</strong></div><div><span>Visit</span><strong>#${visitNumber}</strong></div><div><span>Type</span><strong>${returning ? "Returning" : "New"}</strong></div><div><span>Order</span><strong>${completedOrder ? "Completed" : "Not completed"}</strong></div><div><span>Source</span><strong>${escapeHtml(displayLabel(session.source))}</strong></div><div><span>Device</span><strong>${escapeHtml(displayLabel(session.device))}</strong></div><div><span>Duration</span><strong>${durationLabel}</strong></div><div><span>Activity</span><strong>${formatNumber(session.pageViews)} pages · ${formatNumber(session.clicks)} clicks</strong></div></div>${sessionIntentMarkup(session.id)}<section class="journey-panel"><div class="journey-heading"><span>Complete journey</span><b>${formatNumber(totalActions)} action${totalActions === 1 ? "" : "s"}</b></div><div class="journey-timeline">${journey}</div></section>`;
  sessionDetailElement.hidden = false;
  sessionBackdrop.hidden = false;
  setBackgroundInert(true);
  document.body.classList.add("detail-open");
  closeSessionDetailButton.focus();
}

function closeSessionDetail(): void {
  if (sessionDetailElement.hidden) return;
  sessionDetailElement.hidden = true;
  sessionBackdrop.hidden = true;
  setBackgroundInert(false);
  document.body.classList.remove("detail-open");
  const trigger = [...sessionListElement.querySelectorAll<HTMLButtonElement>("[data-session-id]")]
    .find((button) => button.dataset.sessionId === sessionDetailTriggerId);
  (trigger || document.querySelector<HTMLButtonElement>("[data-range].is-active"))?.focus();
  sessionDetailTriggerId = undefined;
}

const backgroundElements = [
  requiredElement<HTMLElement>(".masthead"),
  ...[...requiredElement<HTMLElement>("main").children].filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element !== sessionDetailElement &&
      element !== sessionBackdrop,
  ),
];

function setBackgroundInert(inert: boolean): void {
  for (const element of backgroundElements) element.inert = inert;
}

function renderRankList(element: HTMLElement, items: Array<{ label: string; count: number }>): void {
  const maximum = items[0]?.count || 1;
  element.innerHTML = items.length
    ? items.map((item) => `<div class="insight-row"><div><strong>${escapeHtml(displayLabel(item.label))}</strong><b>${formatNumber(item.count)}</b></div><span><i style="width:${Math.max(4, Math.round((item.count / maximum) * 100))}%"></i></span></div>`).join("")
    : '<p class="empty-state">There is no data to display yet.</p>';
}

function trafficSourceExplanation(value: string): string {
  const source = value.trim().toLocaleLowerCase("en");
  if (!source || source === "direct" || source === "none" || source === "unknown") {
    return "Typed URL, bookmark or a visit without a visible referrer";
  }
  if (["google", "bing", "yahoo", "duckduckgo", "organic", "search"].some((item) => source.includes(item))) {
    return "Unpaid visit from a search engine";
  }
  if (["instagram", "facebook", "tiktok", "twitter", "x.com", "youtube", "social"].some((item) => source.includes(item))) {
    return "Visit from a social network or shared post";
  }
  if (source.includes("email") || source.includes("newsletter") || source.includes("mail")) {
    return "Visit from an email or lifecycle campaign";
  }
  if (source.includes("paid") || source.includes("cpc") || source.includes("ads")) {
    return "Visit attributed to a paid campaign";
  }
  return "Referral link from another website or campaign";
}

function renderTrafficSources(element: HTMLElement, items: Array<{ label: string; count: number }>): void {
  const maximum = items[0]?.count || 1;
  element.innerHTML = items.length
    ? items.map((item) => `<div class="insight-row traffic-source-row"><div><span><strong>${escapeHtml(displayLabel(item.label))}</strong><small>${escapeHtml(trafficSourceExplanation(item.label))}</small></span><b>${formatNumber(item.count)}</b></div><span><i style="width:${Math.max(4, Math.round((item.count / maximum) * 100))}%"></i></span></div>`).join("")
    : '<p class="empty-state">Traffic sources will appear after storefront visits are recorded.</p>';
}

function relativeDate(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} day${Math.floor(minutes / 1440) === 1 ? "" : "s"} ago`;
}

function renderTrendInto(
  items: Array<{ date: string; visitors: number }>,
  chartElement: HTMLElement,
  totalLabel: HTMLElement,
  gradientId: string,
): void {
  if (selectedRange === "date" && selectedDate) {
    const visitors = items[0]?.visitors ?? 0;
    totalLabel.textContent = `${formatNumber(visitors)} visitor${visitors === 1 ? "" : "s"}`;
    chartElement.innerHTML = `<div class="single-day-result"><span>${escapeHtml(formatDateLabel(selectedDate))}</span><strong>${formatNumber(visitors)}</strong><small>unique visitor${visitors === 1 ? "" : "s"}</small></div>`;
    return;
  }
  const peak = Math.max(...items.map((item) => item.visitors), 0);
  totalLabel.textContent = selectedRange === "all"
    ? `Last 30 days · Peak ${formatNumber(peak)}`
    : `Peak ${formatNumber(peak)} per day`;
  if (!items.length || peak === 0) {
    chartElement.innerHTML = '<p class="empty-state">The chart will begin with the next store visit.</p>';
    return;
  }
  const max = Math.max(...items.map((item) => item.visitors), 1);
  const points = items.map((item, index) => {
    const x = items.length === 1 ? 50 : (index / (items.length - 1)) * 100;
    const y = 86 - (item.visitors / max) * 68;
    return `${x},${y}`;
  }).join(" ");
  const accessibleSummary = items
    .map((item) => `${item.date}: ${item.visitors}`)
    .join(", ");
  const labelStep = Math.max(1, Math.ceil((items.length - 1) / 6));
  const labels = items.filter(
    (_item, index) => index === 0 || index === items.length - 1 || index % labelStep === 0,
  );
  chartElement.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Unique visitors by day. ${accessibleSummary}"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171719" stop-opacity=".14"/><stop offset="1" stop-color="#171719" stop-opacity="0"/></linearGradient></defs><polygon points="0,100 ${points} 100,100" fill="url(#${gradientId})"/><polyline points="${points}" fill="none" stroke="#171719" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="trend-labels">${labels.map((item) => `<span title="${item.date}: ${formatNumber(item.visitors)} unique visitors">${item.date.slice(5)}</span>`).join("")}</div>`;
}

function renderTrend(items: Array<{ date: string; visitors: number }>): void {
  renderTrendInto(items, trendChartElement, trendTotalElement, "overview-trend-fill");
  renderTrendInto(
    items,
    monitorTrendChartElement,
    monitorTrendTotalElement,
    "monitor-trend-fill",
  );
}

function formatCurrency(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatCommerceDate(value: string | null): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function orderDateCell(value: string | null): string {
  if (!value) return '<span class="cell-muted">No date</span>';
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  const elapsed = Math.max(0, Date.now() - date.getTime());
  const relative = elapsed < 60_000
    ? "Just now"
    : elapsed < 3_600_000
      ? `${Math.floor(elapsed / 60_000)} min ago`
      : elapsed < 86_400_000
        ? `${Math.floor(elapsed / 3_600_000)} hr ago`
        : `${Math.floor(elapsed / 86_400_000)} days ago`;
  return `<div class="order-date-cell"><strong>${escapeHtml(day)}</strong><span>${escapeHtml(time)}</span><small>${relative}</small></div>`;
}

function paymentBadge(order: CommerceOrder): string {
  if (order.paymentMethodId === "phaseone_zelle") {
    return '<span class="payment-badge payment-badge--zelle"><i>Z</i><span><b>Zelle</b><small>Manual review</small></span></span>';
  }
  const title = order.paymentMethod || "Not specified";
  return `<span class="payment-badge payment-badge--card"><i>▰</i><span><b>${escapeHtml(title)}</b><small>${order.transactionId ? "Transaction linked" : "Secure checkout"}</small></span></span>`;
}

function orderStatusLabel(status: string): string {
  return {
    completed: "Completed",
    processing: "Processing",
    pending: "Pending",
    "on-hold": "On hold",
    cancelled: "Cancelled",
    failed: "Failed",
    refunded: "Refunded",
  }[status] || status.replace(/-/g, " ");
}

function statusClass(status: string): string {
  if (status === "completed") return "completed";
  if (status === "processing") return "processing";
  if (status === "pending" || status === "on-hold") return "pending";
  return "cancelled";
}

function paidOrder(order: CommerceOrder): boolean {
  return order.status === "completed" || order.status === "processing";
}

interface ProductSalesSummary {
  key: string;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  imageUrl: string | null;
  units: number;
  revenue: number;
  orders: Set<number>;
}

function salesRangeStart(range: typeof salesInsightRange): number {
  const now = new Date();
  if (range === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
}

function salesRangeLabel(range: typeof salesInsightRange): string {
  if (range === "today") return "Today";
  if (range === "week") return "Last 7 days";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
}

function salesOrders(range = salesInsightRange): CommerceOrder[] {
  const start = salesRangeStart(range);
  const source = salesInsightComplete?.range === range
    ? salesInsightComplete.orders
    : commerceData?.orders || [];
  return source.filter((order) =>
    paidOrder(order) && Boolean(order.paidAt || order.createdAt) && Date.parse(order.paidAt || order.createdAt || "") >= start,
  );
}

async function loadCompleteSalesRange(range = salesInsightRange): Promise<boolean> {
  if (salesInsightLoading) return false;
  if (salesInsightComplete?.range === range) return true;
  salesInsightLoading = true;
  renderSalesPerformance();
  try {
    const after = new Date(salesRangeStart(range) - 1_000).toISOString();
    const before = new Date(Date.now() + 60_000).toISOString();
    const response = await fetch(`/api/commerce/sales-report?after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.orders)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The complete sales period is unavailable");
    }
    salesInsightComplete = { range, orders: payload.orders as CommerceOrder[] };
    return true;
  } catch (error) {
    showToast("Complete report unavailable", `${error instanceof Error ? error.message : "Try again shortly."} Showing synchronized orders instead.`, false);
    return false;
  } finally {
    salesInsightLoading = false;
    renderSalesPerformance();
  }
}

function productSales(range = salesInsightRange): ProductSalesSummary[] {
  const totals = new Map<string, ProductSalesSummary>();
  for (const order of salesOrders(range)) {
    for (const item of order.lineItems) {
      const key = `${item.productId}:${item.variationId}:${item.sku || item.name}`;
      const current = totals.get(key) || {
        key,
        productId: item.productId,
        variationId: item.variationId,
        name: item.name,
        sku: item.sku,
        imageUrl: item.imageUrl,
        units: 0,
        revenue: 0,
        orders: new Set<number>(),
      };
      current.units += item.quantity;
      current.revenue += item.total + item.totalTax;
      current.orders.add(order.id);
      if (!current.imageUrl && item.imageUrl) current.imageUrl = item.imageUrl;
      totals.set(key, current);
    }
  }
  return [...totals.values()].sort((left, right) =>
    right.units - left.units || right.revenue - left.revenue || left.name.localeCompare(right.name),
  );
}

function renderSalesPerformance(): void {
  const container = document.querySelector<HTMLElement>("#overview-top-products");
  const summary = document.querySelector<HTMLElement>("#overview-sales-summary");
  if (!container || !summary) return;
  const orders = salesOrders();
  const products = productSales();
  const units = products.reduce((sum, product) => sum + product.units, 0);
  const revenue = products.reduce((sum, product) => sum + product.revenue, 0);
  const currency = orders[0]?.currency || commerceData?.orders[0]?.currency || "USD";
  const complete = salesInsightComplete?.range === salesInsightRange;
  summary.innerHTML = `<span><b>${escapeHtml(salesRangeLabel(salesInsightRange))}</b> · ${formatNumber(orders.length)} paid order${orders.length === 1 ? "" : "s"}</span><span><strong>${formatNumber(units)}</strong> units sold</span><span><strong>${escapeHtml(formatCurrency(revenue, currency))}</strong> product revenue</span><small>${salesInsightLoading ? "Loading the complete period…" : complete ? "Complete period loaded on demand." : "Fast preview from synchronized orders."}</small>`;
  container.innerHTML = products.length
    ? products.slice(0, 6).map((product, index) => `<article class="overview-product-rank"><span class="overview-product-position">${String(index + 1).padStart(2, "0")}</span><span class="overview-product-image">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" decoding="async" />` : escapeHtml((product.name[0] || "P").toUpperCase())}</span><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || (product.variationId ? `Variation ${product.variationId}` : `Product ${product.productId}`))} · ${formatNumber(product.orders.size)} order${product.orders.size === 1 ? "" : "s"}</small></div><span class="overview-product-units"><strong>${formatNumber(product.units)}</strong><small>units</small></span><span class="overview-product-revenue"><strong>${escapeHtml(formatCurrency(product.revenue, currency))}</strong><small>sales</small></span></article>`).join("")
    : `<div class="overview-sales-empty"><span>◇</span><div><strong>No paid product sales for ${escapeHtml(salesRangeLabel(salesInsightRange).toLocaleLowerCase("en"))}</strong><p>Completed and processing orders will be ranked here automatically.</p></div></div>`;
}

function monthToDateLabel(now = new Date()): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(now);
  return `${month} 1–${now.getDate()}`;
}

function renderOverviewFinancials(): void {
  const summary = summarizeCompleteMonthToDate(monthlyFinanceOrders);
  if (!summary) {
    requiredElement<HTMLElement>("#finance-period-label").textContent = monthToDateLabel();
    requiredElement<HTMLElement>("#finance-revenue").textContent = "—";
    requiredElement<HTMLElement>("#finance-profit").textContent = "—";
    requiredElement<HTMLElement>("#finance-profit-secondary").textContent = "—";
    financeOrdersElement.textContent = "—";
    requiredElement<HTMLElement>("#finance-margin").textContent = "—";
    requiredElement<HTMLElement>("#finance-revenue-change").textContent = monthlyFinanceError || "Loading the complete month…";
    requiredElement<HTMLElement>("#finance-profit-change").textContent = "Waiting for authoritative order totals";
    requiredElement<HTMLElement>("#profit-coverage").textContent = "Calculating cost coverage";
    requiredElement<HTMLElement>("#legend-revenue").textContent = "—";
    requiredElement<HTMLElement>("#legend-costs").textContent = "—";
    requiredElement<HTMLElement>("#legend-profit").textContent = "—";
    requiredElement<HTMLElement>("#margin-ring").style.setProperty("--margin", "0deg");
    requiredElement<HTMLElement>("#overview-payment-methods").innerHTML = '<span class="payment-method-loading">Calculating Zelle, card and eDebit…</span>';
    requiredElement<HTMLElement>("#finance-data-status").textContent = monthlyFinanceError || "Loading the complete month…";
    return;
  }
  const profitReady = summary.profit !== null;
  const completeCoverage = summary.orders > 0 && summary.coverage >= 99.999;
  requiredElement<HTMLElement>("#finance-period-label").textContent = monthToDateLabel();
  requiredElement<HTMLElement>("#finance-revenue").textContent = formatCurrency(summary.revenue, summary.currency);
  requiredElement<HTMLElement>("#finance-profit").textContent = profitReady
    ? formatCurrency(summary.profit || 0, summary.currency)
    : "—";
  requiredElement<HTMLElement>("#finance-profit-secondary").textContent = profitReady
    ? formatCurrency(summary.profit || 0, summary.currency)
    : "—";
  financeOrdersElement.textContent = formatNumber(summary.orders);
  requiredElement<HTMLElement>("#finance-margin").textContent = summary.margin === null ? "—" : `${summary.margin.toFixed(1)}%`;
  requiredElement<HTMLElement>("#finance-revenue-change").textContent = summary.refunds > 0
    ? `${formatNumber(summary.orders)} paid · ${formatCurrency(summary.refunds, summary.currency)} refunded`
    : `${formatNumber(summary.orders)} paid order${summary.orders === 1 ? "" : "s"} · no refunds`;
  requiredElement<HTMLElement>("#finance-profit-change").textContent = completeCoverage
    ? "Net after product, operations, fees and affiliate costs"
    : profitReady
      ? "Partial estimate · some product costs are missing"
      : "Add product costs to calculate profit";
  requiredElement<HTMLElement>("#profit-coverage").textContent = `${summary.coverage.toFixed(0)}% of paid orders calculated`;
  requiredElement<HTMLElement>("#legend-revenue").textContent = formatCurrency(summary.revenue, summary.currency);
  requiredElement<HTMLElement>("#legend-costs").textContent = summary.costs === null ? "—" : formatCurrency(summary.costs, summary.currency);
  requiredElement<HTMLElement>("#legend-profit").textContent = profitReady ? formatCurrency(summary.profit || 0, summary.currency) : "—";
  requiredElement<HTMLElement>("#margin-ring").style.setProperty(
    "--margin",
    `${Math.max(0, Math.min(360, (summary.margin || 0) * 3.6))}deg`,
  );

  const methods = requiredElement<HTMLElement>("#overview-payment-methods");
  methods.innerHTML = summary.paymentMethods.length
    ? summary.paymentMethods.map((method) => `<span class="payment-method-chip payment-method-chip--${method.kind}"><i aria-hidden="true"></i><span><b>${escapeHtml(method.label)}</b><small>${formatNumber(method.orders)} order${method.orders === 1 ? "" : "s"}</small></span><strong>${escapeHtml(formatCurrency(method.revenue, summary.currency))}</strong></span>`).join("")
    : '<span class="payment-method-loading">No paid orders have been recorded this month.</span>';
  const dataStatus = requiredElement<HTMLElement>("#finance-data-status");
  dataStatus.textContent = monthlyFinanceLoading
    ? "Refreshing the complete month…"
    : monthlyFinanceOrders
      ? `Complete month · updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(monthlyFinanceUpdatedAt))}`
      : "Fast preview · loading complete month";
}

async function loadMonthToDateFinancials(force = false): Promise<void> {
  if (monthlyFinanceLoading) return;
  if (!force && monthlyFinanceOrders && Date.now() - monthlyFinanceUpdatedAt < 5 * 60_000) return;
  monthlyFinanceLoading = true;
  monthlyFinanceError = "";
  renderOverviewFinancials();
  try {
    const after = new Date(monthToDateStart().getTime() - 1_000).toISOString();
    const before = new Date(Date.now() + 60_000).toISOString();
    const response = await fetch(`/api/commerce/sales-report?after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}&fresh=1`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.orders)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The monthly totals are unavailable");
    }
    monthlyFinanceOrders = payload.orders as CommerceOrder[];
    monthlyFinanceUpdatedAt = Date.now();
  } catch (error) {
    console.error("Month-to-date finance refresh failed", error);
    monthlyFinanceError = "Complete monthly totals are temporarily unavailable";
  } finally {
    monthlyFinanceLoading = false;
    renderOverviewFinancials();
  }
}

function reconcileMonthToDateOrders(recentOrders: CommerceOrder[]): void {
  if (!monthlyFinanceOrders) return;
  const start = monthToDateStart().getTime();
  const merged = new Map(monthlyFinanceOrders.map((order) => [order.id, order]));
  for (const order of recentOrders) {
    const timestamp = Date.parse(order.paidAt || order.createdAt || "");
    if (Number.isFinite(timestamp) && timestamp >= start) merged.set(order.id, order);
  }
  monthlyFinanceOrders = [...merged.values()];
  monthlyFinanceUpdatedAt = Date.now();
}

function visibleOrders(): CommerceOrder[] {
  const values = commerceData?.orders || [];
  const search = orderSearch.trim().toLocaleLowerCase("en");
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return values.filter((order) => {
    if (orderStatusFilter !== "all" && order.status !== orderStatusFilter) return false;
    const created = order.createdAt ? Date.parse(order.createdAt) : 0;
    if (orderDateFilter === "today" && created < startOfToday) return false;
    if (orderDateFilter === "7" && created < now.getTime() - 7 * 86_400_000) return false;
    if (orderDateFilter === "30" && created < now.getTime() - 30 * 86_400_000) return false;
    if (orderDateFilter === "custom") {
      if (orderDateFrom && created < new Date(orderDateFrom).getTime()) return false;
      if (orderDateTo && created > new Date(orderDateTo).getTime()) return false;
    }
    if (!search) return true;
    return [order.number, order.customer, order.paymentMethod, ...order.lineItems.map((item) => `${item.name} ${item.sku}`)]
      .join(" ").toLocaleLowerCase("en").includes(search);
  }).sort((left, right) => {
    if (orderSort === "total-desc") return right.total - left.total;
    if (orderSort === "total-asc") return left.total - right.total;
    const leftDate = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightDate = right.createdAt ? Date.parse(right.createdAt) : 0;
    return orderSort === "date-asc" ? leftDate - rightDate : rightDate - leftDate;
  });
}

function orderRow(order: CommerceOrder, compact = false): string {
  const profit = order.profitability.estimatedProfit;
  const profitCell = profit === null
    ? '<span class="cell-muted" title="One or more product costs are missing">Not calculated</span>'
    : `<span class="cell-profit${profit < 0 ? " cell-profit--negative" : ""}">${escapeHtml(formatCurrency(profit, order.currency))}</span>`;
  const itemCount = order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
  const commission = commerceData?.affiliateCommissions?.find((entry) => entry.orderId === order.id);
  const commissionStatus = commission
    ? ({ reserved: "Pending", pending: "On hold", approved: "Approved", paid: "Paid", reversed: "Reversed" } as const)[commission.status]
    : "";
  const commissionSummary = commission ? `<span class="order-commission-quick is-${escapeHtml(commission.status)}" title="${escapeHtml(`${commission.affiliateName} · Coupon ${commission.couponCode} · ${commissionStatus}`)}"><span>↗ Affiliate · ${escapeHtml(formatCurrency(commission.commissionAmount, commission.currency))}</span><small>${escapeHtml(commission.affiliateName)} · ${escapeHtml(commission.couponCode.toUpperCase())}</small></span>` : "";
  const totalCell = `<div class="order-total-stack"><strong>${escapeHtml(formatCurrency(order.total, order.currency))}</strong>${commissionSummary}</div>`;
  const base = `<td><button class="order-link" type="button" data-open-order="${order.id}">#${escapeHtml(order.number)}</button></td><td><div class="cell-customer"><strong>${escapeHtml(order.customer)}</strong><small>${escapeHtml(order.location)}</small></div></td>`;
  const state = `<span class="status-pill status-pill--${statusClass(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span>`;
  if (compact) {
    return `<tr data-order-id="${order.id}">${base}<td>${state}</td><td>${escapeHtml(formatCommerceDate(order.createdAt))}</td><td class="cell-money">${totalCell}</td><td>${profitCell}</td></tr>`;
  }
  return `<tr data-order-id="${order.id}"><td><input type="checkbox" aria-label="Select order ${escapeHtml(order.number)}" /></td>${base}<td>${paymentBadge(order)}</td><td>${formatNumber(itemCount)} item${itemCount === 1 ? "" : "s"}</td><td>${state}</td><td>${orderDateCell(order.createdAt)}</td><td class="cell-money">${totalCell}</td><td>${profitCell}</td><td><button class="row-menu" type="button" data-open-order="${order.id}" aria-label="Open order ${escapeHtml(order.number)}">•••</button></td></tr>`;
}

function renderMonitorOrders(): void {
  const orders = [...(commerceData?.orders || [])]
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))
    .slice(0, 6);
  requiredElement<HTMLElement>("#monitor-order-list").innerHTML = orders.length
    ? orders.map((order) => `<button type="button" data-monitor-order="${order.id}"><span class="monitor-order-id">#${escapeHtml(order.number)}</span>${paymentBadge(order)}<span class="monitor-order-customer"><strong>${escapeHtml(order.customer)}</strong><small>${escapeHtml(formatCommerceTimestamp(order.createdAt))}</small></span><b>${escapeHtml(formatCurrency(order.total, order.currency))}</b><i class="status-pill status-pill--${statusClass(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</i></button>`).join("")
    : '<div class="table-loading">No order activity is available yet.</div>';
}

function renderOrders(): void {
  const orders = visibleOrders();
  const allOrders = commerceData?.orders || [];
  const currency = allOrders[0]?.currency || "USD";
  const paid = orders.filter(paidOrder);
  const revenue = paid.reduce((sum, order) => sum + order.total, 0);
  const profit = paid.reduce(
    (sum, order) => sum + (order.profitability.estimatedProfit ?? 0),
    0,
  );
  requiredElement<HTMLElement>("#orders-visible-count").textContent = formatNumber(orders.length);
  requiredElement<HTMLElement>("#orders-processing-count").textContent = formatNumber(
    allOrders.filter((order) => order.status === "processing").length,
  );
  requiredElement<HTMLElement>("#orders-visible-revenue").textContent = formatCurrency(revenue, currency);
  requiredElement<HTMLElement>("#orders-visible-profit").textContent = formatCurrency(profit, currency);
  requiredElement<HTMLElement>("#orders-table-body").innerHTML = orders.length
    ? orders.map((order) => orderRow(order)).join("")
    : '<tr><td colspan="10"><div class="table-loading">No orders match the selected filters.</div></td></tr>';
  requiredElement<HTMLElement>("#orders-preview-body").innerHTML = allOrders.length
    ? allOrders.slice(0, 6).map((order) => orderRow(order, true)).join("")
    : '<tr><td colspan="6"><div class="table-loading">No orders are available yet.</div></td></tr>';
  renderMonitorOrders();
  renderSalesPerformance();
  renderPaymentReview();
  renderReconciliation();
  renderOrdersWorkspace();
}

function renderOrdersWorkspace(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-orders-workspace]")) {
    button.classList.toggle("is-active", button.dataset.ordersWorkspace === ordersWorkspace);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-orders-workspace-panel]")) {
    panel.hidden = panel.dataset.ordersWorkspacePanel !== ordersWorkspace;
  }
}

function paymentRail(order: CommerceOrder): { key: string; label: string; short: string } {
  const method = `${order.paymentMethodId} ${order.paymentMethod}`.toLocaleLowerCase("en");
  if (method.includes("zelle")) return { key: "zelle", label: "Zelle", short: "Z" };
  if (method.includes("venmo")) return { key: "venmo", label: "Venmo", short: "V" };
  if (method.includes("prism") || method.includes("card")) return { key: "prism", label: "PRISM card", short: "P" };
  if (method.includes("yodlee")) return { key: "yodlee", label: "Yodlee transfer", short: "Y" };
  if (method.includes("edebit") || method.includes("e-debit")) return { key: "edebit", label: "eDebit", short: "E" };
  return { key: "other", label: order.paymentMethod || "Other", short: "$" };
}

function renderPaymentReview(): void {
  const orders = commerceData?.orders || [];
  const review = orders.filter((order) =>
    order.paymentOperations.kind === "manual" ||
    (!["cancelled", "failed", "refunded"].includes(order.status) && !order.paymentOperations.reference && !order.transactionId),
  );
  const pending = review.filter((order) => order.paymentOperations.approvalState === "pending");
  const missingReference = review.filter((order) => !order.paymentOperations.reference && !order.transactionId);
  const currency = orders[0]?.currency || "USD";
  const pendingValue = pending.reduce((sum, order) => sum + order.total, 0);
  requiredElement<HTMLElement>("#payment-review-kpis").innerHTML = `
    <article><span>Awaiting decision</span><strong>${formatNumber(pending.length)}</strong><small>Manual payments to verify</small></article>
    <article><span>Missing reference</span><strong>${formatNumber(missingReference.length)}</strong><small>Orders without traceable ID</small></article>
    <article><span>Value on hold</span><strong>${escapeHtml(formatCurrency(pendingValue, currency))}</strong><small>Pending approval</small></article>
    <article><span>Evidence gap</span><strong>${formatNumber(review.length)}</strong><small>Open each order to inspect proof</small></article>`;
  requiredElement<HTMLElement>("#payment-review-body").innerHTML = review.length
    ? review.map((order) => {
      const rail = paymentRail(order);
      const state = order.paymentOperations.approvalState;
      return `<tr><td><button class="order-link" type="button" data-open-order="${order.id}">#${escapeHtml(order.number)}</button></td><td><div class="cell-customer"><strong>${escapeHtml(order.customer)}</strong><small>${escapeHtml(order.billing.email || order.location)}</small></div></td><td><span class="payment-rail payment-rail--${rail.key}"><i>${rail.short}</i>${escapeHtml(rail.label)}</span></td><td>${order.paymentOperations.reference ? `<code>${escapeHtml(order.paymentOperations.reference)}</code>` : '<span class="exception-label">Missing</span>'}</td><td>${orderDateCell(order.createdAt)}</td><td class="cell-money">${escapeHtml(formatCurrency(order.total, order.currency))}</td><td><button class="decision-button decision-button--${state}" type="button" data-open-order="${order.id}">${state === "pending" ? "Review payment" : state === "approved" ? "Approved" : "View record"}</button></td></tr>`;
    }).join("")
    : '<tr><td colspan="7"><div class="operations-empty"><strong>No payment exceptions</strong><span>Every visible payment has a reference or completed decision.</span></div></td></tr>';
}

function renderReconciliation(): void {
  const orders = commerceData?.orders || [];
  const currency = orders[0]?.currency || "USD";
  const settled = orders.filter((order) => paidOrder(order) || order.refundedTotal > 0);
  const charged = settled.reduce((sum, order) => sum + order.total, 0);
  const fees = settled.reduce((sum, order) => sum + order.paymentOperations.processingFee + order.feeLines.reduce((feeSum, fee) => feeSum + fee.total + fee.totalTax, 0), 0);
  const refunds = settled.reduce((sum, order) => sum + order.refundedTotal, 0);
  const net = charged - fees - refunds;
  requiredElement<HTMLElement>("#reconciliation-kpis").innerHTML = `
    <article><span>Total charged</span><strong>${escapeHtml(formatCurrency(charged, currency))}</strong><small>${formatNumber(settled.length)} settled orders</small></article>
    <article><span>Processing & order fees</span><strong>${escapeHtml(formatCurrency(fees, currency))}</strong><small>Recorded provider costs</small></article>
    <article><span>Refunds</span><strong>${escapeHtml(formatCurrency(refunds, currency))}</strong><small>Returned to customers</small></article>
    <article class="is-emphasis"><span>Net collected</span><strong>${escapeHtml(formatCurrency(net, currency))}</strong><small>Charged less fees and refunds</small></article>`;

  const byMethod = new Map<string, { label: string; short: string; count: number; charged: number; fees: number; refunds: number }>();
  for (const order of settled) {
    const rail = paymentRail(order);
    const current = byMethod.get(rail.key) || { label: rail.label, short: rail.short, count: 0, charged: 0, fees: 0, refunds: 0 };
    current.count += 1;
    current.charged += order.total;
    current.fees += order.paymentOperations.processingFee + order.feeLines.reduce((sum, fee) => sum + fee.total + fee.totalTax, 0);
    current.refunds += order.refundedTotal;
    byMethod.set(rail.key, current);
  }
  requiredElement<HTMLElement>("#reconciliation-methods").innerHTML = byMethod.size
    ? [...byMethod.entries()].map(([key, item]) => `<div><span class="payment-rail payment-rail--${key}"><i>${item.short}</i>${escapeHtml(item.label)}</span><span><small>${formatNumber(item.count)} orders</small><strong>${escapeHtml(formatCurrency(item.charged - item.fees - item.refunds, currency))}</strong></span></div>`).join("")
    : '<div class="operations-empty"><strong>No settled payments</strong><span>Collections will appear here.</span></div>';

  const byDay = new Map<string, { count: number; charged: number; fees: number; refunds: number }>();
  for (const order of settled) {
    const day = order.createdAt ? order.createdAt.slice(0, 10) : "Unknown";
    const current = byDay.get(day) || { count: 0, charged: 0, fees: 0, refunds: 0 };
    current.count += 1;
    current.charged += order.total;
    current.fees += order.paymentOperations.processingFee + order.feeLines.reduce((sum, fee) => sum + fee.total + fee.totalTax, 0);
    current.refunds += order.refundedTotal;
    byDay.set(day, current);
  }
  requiredElement<HTMLElement>("#reconciliation-days").innerHTML = byDay.size
    ? [...byDay.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([day, item]) => `<tr><td><strong>${day === "Unknown" ? day : escapeHtml(formatCommerceDate(`${day}T12:00:00Z`))}</strong></td><td>${formatNumber(item.count)}</td><td>${escapeHtml(formatCurrency(item.charged, currency))}</td><td>${escapeHtml(formatCurrency(item.fees, currency))}</td><td>${escapeHtml(formatCurrency(item.refunds, currency))}</td><td class="cell-money">${escapeHtml(formatCurrency(item.charged - item.fees - item.refunds, currency))}</td></tr>`).join("")
    : '<tr><td colspan="6"><div class="operations-empty"><strong>No settlement activity</strong></div></td></tr>';
}

function formatCommerceTimestamp(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function addressLines(address: CommerceAddress): string[] {
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  const city = [address.city, address.state, address.postcode].filter(Boolean).join(", ");
  return [
    name,
    address.company,
    address.address1,
    address.address2,
    city,
    address.country,
  ].filter(Boolean);
}

function customerInitials(customer: CustomerProfile): string {
  const parts = [customer.firstName, customer.lastName].filter(Boolean);
  if (parts.length) return parts.map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();
  return customer.displayName.slice(0, 2).toUpperCase() || "P1";
}

function customerAvatarTone(customer: CustomerProfile): number {
  const seed = customer.key || customer.email || customer.displayName || "phase-one";
  let hash = 0;
  for (const character of seed) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return (hash % 6) + 1;
}

function customerAvatar(customer: CustomerProfile, drawer = false): string {
  const tone = customerAvatarTone(customer);
  const className = `${drawer ? "customer-drawer-avatar" : "customer-avatar"} customer-avatar--tone-${tone}${customer.avatarUrl ? " has-photo" : " is-generated"}`;
  const id = drawer ? ' id="customer-drawer-avatar"' : "";
  const fallback = `<b aria-hidden="true">${escapeHtml(customerInitials(customer))}</b>`;
  return customer.avatarUrl
    ? `<span class="${className}"${id} aria-label="${escapeHtml(customer.displayName)}"><img src="${escapeHtml(customer.avatarUrl)}" alt="" loading="lazy" decoding="async" data-customer-avatar-image />${fallback}</span>`
    : `<span class="${className}"${id} aria-label="Generated avatar for ${escapeHtml(customer.displayName)}">${fallback}</span>`;
}

function customerTimestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function visibleCustomers(): CustomerProfile[] {
  const search = customerSearch.trim().toLocaleLowerCase("en");
  const customers = [...(customerDirectory?.customers || [])].filter((customer) => {
    if (customerFilter === "buyers" && customer.orderCount < 1) return false;
    if (customerFilter === "registered" && customer.accountType !== "registered") return false;
    if (customerFilter === "guest" && customer.accountType !== "guest") return false;
    const rewardValue = customer.pointsBalance ?? customer.pointsEarned;
    if (customerFilter === "rewards" && rewardValue <= 0) return false;
    if (!search) return true;
    const orderTerms = customer.orders.flatMap((order) => [
      order.number,
      ...order.items.map((item) => `${item.name} ${item.sku}`),
    ]);
    return [
      customer.displayName,
      customer.email,
      customer.phone,
      customer.username,
      customer.billing.city,
      customer.billing.state,
      ...orderTerms,
    ].join(" ").toLocaleLowerCase("en").includes(search);
  });
  return customers.sort((left, right) => {
    if (customerSort === "spend") return right.netSpent - left.netSpent;
    if (customerSort === "orders") return right.orderCount - left.orderCount;
    if (customerSort === "points") return (right.pointsBalance ?? right.pointsEarned) - (left.pointsBalance ?? left.pointsEarned);
    if (customerSort === "registered") return customerTimestamp(right.registeredAt) - customerTimestamp(left.registeredAt);
    if (customerSort === "name") return left.displayName.localeCompare(right.displayName, "en");
    return customerTimestamp(right.lastOrderAt) - customerTimestamp(left.lastOrderAt) ||
      customerTimestamp(right.registeredAt) - customerTimestamp(left.registeredAt);
  });
}

function customerRow(customer: CustomerProfile, currency: string): string {
  const city = [customer.billing.city, customer.billing.state, customer.billing.country].filter(Boolean).join(", ");
  const points = customer.pointsBalance;
  const pointsDisplay = points === null
    ? `<strong>${formatNumber(customer.pointsEarned)}</strong><small>recorded earned</small>`
    : `<strong>${formatNumber(points)}</strong><small>${formatNumber(customer.pointsEarned)} lifetime earned</small>`;
  const account = customer.accountType === "registered"
    ? '<span class="customer-type customer-type--registered">Registered</span>'
    : '<span class="customer-type customer-type--guest">Guest buyer</span>';
  const lastOrder = customer.lastOrderAt
    ? `<strong>${escapeHtml(formatCommerceDate(customer.lastOrderAt))}</strong><small>${escapeHtml(relativeDate(customer.lastOrderAt))}</small>`
    : '<strong>Never ordered</strong><small>Account only</small>';
  return `<tr data-customer-key="${escapeHtml(customer.key)}">
    <td><button class="customer-identity" type="button" data-open-customer="${escapeHtml(customer.key)}">${customerAvatar(customer)}<span><strong>${escapeHtml(customer.displayName)}</strong><small>${escapeHtml(customer.email || customer.username || "No email recorded")}</small></span></button></td>
    <td>${account}</td>
    <td><div class="customer-contact"><strong>${escapeHtml(customer.phone || "No phone")}</strong><small>${escapeHtml(city || "Location unavailable")}</small></div></td>
    <td><div class="customer-metric"><strong>${formatNumber(customer.orderCount)}</strong><small>${formatNumber(customer.totalItems)} items</small></div></td>
    <td><div class="customer-metric customer-metric--money"><strong>${escapeHtml(formatCurrency(customer.netSpent, currency))}</strong><small>${escapeHtml(formatCurrency(customer.averageOrderValue, currency))} avg.</small></div></td>
    <td><div class="customer-metric customer-metric--points">${pointsDisplay}</div></td>
    <td><div class="customer-metric"><strong>${customer.storeCredit === null ? "—" : escapeHtml(formatCurrency(customer.storeCredit, currency))}</strong><small>${customer.storeCredit === null ? "bridge pending" : "available credit"}</small></div></td>
    <td><div class="customer-last-order">${lastOrder}</div></td>
    <td><button class="customer-open-button" type="button" data-open-customer="${escapeHtml(customer.key)}" aria-label="Open ${escapeHtml(customer.displayName)}">→</button></td>
  </tr>`;
}

function renderCustomerDirectory(): void {
  if (!customerDirectory) return;
  const customers = visibleCustomers();
  const totals = customerDirectory.totals;
  const currency = customerDirectory.currency || "USD";
  const totalPages = Math.max(1, Math.ceil(customers.length / CUSTOMER_PAGE_SIZE));
  customerPage = Math.min(Math.max(1, customerPage), totalPages);
  const start = (customerPage - 1) * CUSTOMER_PAGE_SIZE;
  const pageCustomers = customers.slice(start, start + CUSTOMER_PAGE_SIZE);

  customerLoading.hidden = true;
  customerTableWrap.hidden = false;
  customerSyncElement.classList.toggle("is-live", customerDirectory.connected);
  customerSyncElement.classList.toggle("is-stale", Boolean(customerDirectory.stale));
  const syncLabel = customerSyncElement.querySelector<HTMLElement>("b");
  if (syncLabel) syncLabel.textContent = customerDirectory.stale
    ? "Showing protected cache"
    : customerDirectory.refreshing
      ? "Ready · updating quietly"
      : "Directory synchronized";
  customerRecordStatus.textContent = customerDirectory.syncedAt
    ? `${formatNumber(customerDirectory.customers.length)} complete profiles · synced ${relativeDate(customerDirectory.syncedAt)}`
    : `${formatNumber(customerDirectory.customers.length)} complete profiles`;
  requiredElement<HTMLElement>("#customer-total-profiles").textContent = formatNumber(totals?.profiles || customerDirectory.customers.length);
  requiredElement<HTMLElement>("#customer-profile-breakdown").textContent = totals
    ? `${formatNumber(totals.registeredCustomers)} registered · ${formatNumber(totals.guestBuyers)} guest buyers`
    : "Registered accounts + guest buyers";
  requiredElement<HTMLElement>("#customer-paying-count").textContent = formatNumber(totals?.payingCustomers || 0);
  requiredElement<HTMLElement>("#customer-lifetime-revenue").textContent = formatCurrency(totals?.lifetimeRevenue || 0, currency);
  requiredElement<HTMLElement>("#customer-points-outstanding").textContent = totals?.pointsOutstanding === null || totals?.pointsOutstanding === undefined
    ? formatNumber(totals?.recordedPointsEarned || 0)
    : formatNumber(totals.pointsOutstanding);
  requiredElement<HTMLElement>("#customer-points-status").textContent = customerDirectory.rewardsLive
    ? `${formatNumber(totals?.recordedPointsEarned || 0)} lifetime points earned`
    : "Recorded earnings · live balance bridge ready";
  requiredElement<HTMLElement>("#customer-credit-outstanding").textContent = totals?.storeCreditOutstanding === null || totals?.storeCreditOutstanding === undefined
    ? "—"
    : formatCurrency(totals.storeCreditOutstanding, currency);
  customerDirectoryCount.textContent = `${formatNumber(customers.length)} of ${formatNumber(customerDirectory.customers.length)} profiles`;
  customerTableBody.innerHTML = pageCustomers.length
    ? pageCustomers.map((customer) => customerRow(customer, currency)).join("")
    : '<tr><td colspan="9"><div class="table-loading">No customer profiles match these filters.</div></td></tr>';
  customerPagination.hidden = customers.length <= CUSTOMER_PAGE_SIZE;
  customerPageSummary.textContent = customers.length
    ? `${formatNumber(start + 1)}–${formatNumber(Math.min(start + CUSTOMER_PAGE_SIZE, customers.length))} of ${formatNumber(customers.length)}`
    : "0 profiles";
  customerPageNumber.textContent = `Page ${customerPage} of ${totalPages}`;
  customerPagePrevious.disabled = customerPage <= 1;
  customerPageNext.disabled = customerPage >= totalPages;
}

async function loadCustomerDirectory(force = false): Promise<void> {
  if (customerDirectoryLoading) return;
  if (customerDirectory && !force) {
    renderCustomerDirectory();
    return;
  }
  customerDirectoryLoading = true;
  customerLoading.hidden = false;
  customerTableWrap.hidden = true;
  customerPagination.hidden = true;
  customerSyncElement.classList.remove("is-live", "is-stale");
  const syncLabel = customerSyncElement.querySelector<HTMLElement>("b");
  if (syncLabel) syncLabel.textContent = "Syncing all customers";
  try {
    const response = await fetch(`/api/customers${force ? "?refresh=1" : ""}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.customers)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The customer directory could not be loaded");
    }
    customerDirectory = payload as unknown as CustomerDirectoryPayload;
    customerPage = 1;
    renderCustomerDirectory();
  } catch (error) {
    customerLoading.innerHTML = `<span class="customer-load-error">!</span><div><strong>Customer records could not be synchronized.</strong><small>${escapeHtml(error instanceof Error ? error.message : "Check the live store connection and try again.")}</small></div>`;
    if (syncLabel) syncLabel.textContent = "Customer sync unavailable";
  } finally {
    customerDirectoryLoading = false;
  }
}

const loyaltyDefaults: LoyaltySettings = {
  earningEnabled: true,
  redemptionEnabled: true,
  pointsPerCurrency: 1,
  redemptionBlockPoints: 500,
  redemptionBlockCredit: 5,
  minimumOrderAmount: 0,
  maximumPointsPerOrder: 0,
  includeShipping: false,
  includeTax: false,
  rounding: "floor",
  awardStatuses: ["processing", "completed"],
};

function loyaltySettingsFromForm(): LoyaltySettings {
  const numberValue = (selector: string, fallback = 0) => {
    const value = Number(requiredElement<HTMLInputElement>(selector).value);
    return Number.isFinite(value) ? value : fallback;
  };
  const awardStatuses: LoyaltySettings["awardStatuses"] = [];
  if (requiredElement<HTMLInputElement>("#loyalty-status-processing").checked) awardStatuses.push("processing");
  if (requiredElement<HTMLInputElement>("#loyalty-status-completed").checked) awardStatuses.push("completed");
  const rounding = requiredElement<HTMLSelectElement>("#loyalty-rounding").value;
  return {
    earningEnabled: requiredElement<HTMLInputElement>("#loyalty-earning-enabled").checked,
    redemptionEnabled: requiredElement<HTMLInputElement>("#loyalty-redemption-enabled").checked,
    pointsPerCurrency: Math.max(0.01, numberValue("#loyalty-points-rate", 1)),
    redemptionBlockPoints: Math.max(1, Math.round(numberValue("#loyalty-block-points", 500))),
    redemptionBlockCredit: Math.max(0.01, numberValue("#loyalty-block-credit", 5)),
    minimumOrderAmount: Math.max(0, numberValue("#loyalty-minimum-order")),
    maximumPointsPerOrder: Math.max(0, Math.round(numberValue("#loyalty-maximum-points"))),
    includeShipping: requiredElement<HTMLInputElement>("#loyalty-include-shipping").checked,
    includeTax: requiredElement<HTMLInputElement>("#loyalty-include-tax").checked,
    rounding: rounding === "round" || rounding === "ceil" ? rounding : "floor",
    awardStatuses,
  };
}

function applyLoyaltySettings(settings: LoyaltySettings): void {
  requiredElement<HTMLInputElement>("#loyalty-earning-enabled").checked = settings.earningEnabled;
  requiredElement<HTMLInputElement>("#loyalty-redemption-enabled").checked = settings.redemptionEnabled;
  requiredElement<HTMLInputElement>("#loyalty-points-rate").value = String(settings.pointsPerCurrency);
  requiredElement<HTMLInputElement>("#loyalty-block-points").value = String(settings.redemptionBlockPoints);
  requiredElement<HTMLInputElement>("#loyalty-block-credit").value = String(settings.redemptionBlockCredit);
  requiredElement<HTMLInputElement>("#loyalty-minimum-order").value = String(settings.minimumOrderAmount);
  requiredElement<HTMLInputElement>("#loyalty-maximum-points").value = String(settings.maximumPointsPerOrder);
  requiredElement<HTMLInputElement>("#loyalty-include-shipping").checked = settings.includeShipping;
  requiredElement<HTMLInputElement>("#loyalty-include-tax").checked = settings.includeTax;
  requiredElement<HTMLSelectElement>("#loyalty-rounding").value = settings.rounding;
  requiredElement<HTMLInputElement>("#loyalty-status-processing").checked = settings.awardStatuses.includes("processing");
  requiredElement<HTMLInputElement>("#loyalty-status-completed").checked = settings.awardStatuses.includes("completed");
  updateLoyaltySimulator();
}

function rewardRound(value: number, rounding: LoyaltySettings["rounding"]): number {
  if (rounding === "ceil") return Math.ceil(value);
  if (rounding === "round") return Math.round(value);
  return Math.floor(value);
}

function updateLoyaltySimulator(): void {
  const settings = loyaltySettingsFromForm();
  const orderValue = Math.max(0, Number(requiredElement<HTMLInputElement>("#loyalty-example-order").value) || 0);
  let earned = orderValue < settings.minimumOrderAmount ? 0 : rewardRound(orderValue * settings.pointsPerCurrency, settings.rounding);
  if (settings.maximumPointsPerOrder > 0) earned = Math.min(earned, settings.maximumPointsPerOrder);
  const credit = (earned / settings.redemptionBlockPoints) * settings.redemptionBlockCredit;
  const rate = orderValue > 0 ? (credit / orderValue) * 100 : 0;
  requiredElement<HTMLElement>("#loyalty-preview-earned").textContent = formatNumber(earned);
  requiredElement<HTMLElement>("#loyalty-preview-credit").textContent = formatCurrency(credit, customerDirectory?.currency || "USD");
  requiredElement<HTMLElement>("#loyalty-preview-rate").textContent = `${rate.toFixed(2)}%`;
  updateLoyaltyImpact(settings);
}

function updateLoyaltyImpact(settings = loyaltySettingsFromForm()): void {
  const points = loyaltyData?.metrics?.pointsOutstanding ?? customerDirectory?.totals?.pointsOutstanding ?? 0;
  const liability = Math.floor(Math.max(0, points || 0) / settings.redemptionBlockPoints) * settings.redemptionBlockCredit;
  requiredElement<HTMLElement>("#loyalty-impact-copy").textContent = `${formatNumber(points || 0)} outstanding points represent up to ${formatCurrency(liability, customerDirectory?.currency || "USD")} at this rule.`;
}

function loyaltyActivityRows(): string {
  const rows = (customerDirectory?.customers || []).flatMap((customer) => customer.rewardHistory.map((activity) => ({ customer, activity })))
    .sort((left, right) => customerTimestamp(right.activity.createdAt) - customerTimestamp(left.activity.createdAt))
    .slice(0, 16);
  if (!rows.length) return '<div class="customer-empty-detail"><span>◎</span><strong>No point activity yet</strong><small>Earned points and manual adjustments will appear here.</small></div>';
  return rows.map(({ customer, activity }) => `<div class="loyalty-activity-row"><span class="reward-change ${activity.change < 0 ? "is-negative" : "is-positive"}">${activity.change > 0 ? "+" : ""}${formatNumber(activity.change)}</span><div><strong>${escapeHtml(customer.displayName)}</strong><small>${escapeHtml(activity.reason || activity.type.replace(/_/g, " "))}</small></div><span>${escapeHtml(formatCommerceTimestamp(activity.createdAt))}</span><b>${formatNumber(activity.balanceAfter)} pts</b></div>`).join("");
}

function policyChangeSummary(before: LoyaltySettings, after: LoyaltySettings): string {
  const changes: string[] = [];
  if (before.pointsPerCurrency !== after.pointsPerCurrency) changes.push(`${after.pointsPerCurrency} pts / $1`);
  if (before.redemptionBlockPoints !== after.redemptionBlockPoints || before.redemptionBlockCredit !== after.redemptionBlockCredit) changes.push(`${formatNumber(after.redemptionBlockPoints)} pts = ${formatCurrency(after.redemptionBlockCredit, customerDirectory?.currency || "USD")}`);
  if (before.earningEnabled !== after.earningEnabled) changes.push(after.earningEnabled ? "earning resumed" : "earning paused");
  if (before.redemptionEnabled !== after.redemptionEnabled) changes.push(after.redemptionEnabled ? "redemption resumed" : "redemption paused");
  return changes.join(" · ") || "Operational rules updated";
}

function renderLoyalty(): void {
  const data = loyaltyData;
  const settings = data?.settings || loyaltyDefaults;
  const metrics = data?.metrics;
  const directoryTotals = customerDirectory?.totals;
  const writable = Boolean(data?.canManage && data.writeEnabled && data.settings);
  const state = requiredElement<HTMLElement>("#loyalty-command-state");
  const live = requiredElement<HTMLElement>("#loyalty-live-state");
  live.classList.toggle("is-live", Boolean(data?.connected && data.settings));
  requiredElement<HTMLElement>("#loyalty-bridge-version").textContent = data?.bridgeVersion ? `Control service v${data.bridgeVersion}` : "Secure policy service";
  if (data?.requiresBridgeUpdate) {
    state.textContent = "Upgrade ready";
    state.className = "integration-state integration-state--warning";
    requiredElement<HTMLElement>("#loyalty-command-title").textContent = "The new control layer is prepared";
    requiredElement<HTMLElement>("#loyalty-command-copy").textContent = "Install Operations Bridge 1.3.0 to publish rules and audited customer adjustments. Existing balances remain visible and protected.";
  } else if (data?.settings) {
    state.textContent = writable ? "Editable" : "Read only";
    state.className = `integration-state${writable ? " integration-state--connected" : ""}`;
    requiredElement<HTMLElement>("#loyalty-command-title").textContent = `${settings.pointsPerCurrency} point${settings.pointsPerCurrency === 1 ? "" : "s"} per $1 · ${formatNumber(settings.redemptionBlockPoints)} points = ${formatCurrency(settings.redemptionBlockCredit, customerDirectory?.currency || "USD")}`;
    requiredElement<HTMLElement>("#loyalty-command-copy").textContent = writable ? "Administrators can publish future earning and redemption economics with full audit protection." : "Your role can review the live program but cannot publish changes.";
  } else {
    state.textContent = "Unavailable";
    state.className = "integration-state integration-state--warning";
    requiredElement<HTMLElement>("#loyalty-command-title").textContent = "Loyalty service is not connected";
    requiredElement<HTMLElement>("#loyalty-command-copy").textContent = data?.error || "Check the live store connection and reload this workspace.";
  }

  requiredElement<HTMLElement>("#loyalty-points-outstanding").textContent = formatNumber(metrics?.pointsOutstanding ?? directoryTotals?.pointsOutstanding ?? directoryTotals?.recordedPointsEarned ?? 0);
  requiredElement<HTMLElement>("#loyalty-members").textContent = formatNumber(metrics?.membersWithPoints ?? (customerDirectory?.customers || []).filter((customer) => (customer.pointsBalance ?? 0) > 0).length);
  requiredElement<HTMLElement>("#loyalty-liability").textContent = formatCurrency(metrics?.redeemableCreditLiability ?? 0, customerDirectory?.currency || "USD");
  requiredElement<HTMLElement>("#loyalty-credit").textContent = formatCurrency(metrics?.storeCreditOutstanding ?? directoryTotals?.storeCreditOutstanding ?? 0, customerDirectory?.currency || "USD");
  requiredElement<HTMLElement>("#loyalty-customers").textContent = formatNumber(metrics?.customers ?? directoryTotals?.registeredCustomers ?? 0);
  requiredElement<HTMLElement>("#loyalty-policy-status").textContent = settings.earningEnabled && settings.redemptionEnabled ? "Program active" : settings.earningEnabled ? "Redemption paused" : settings.redemptionEnabled ? "Earning paused" : "Program paused";

  const form = requiredElement<HTMLFormElement>("#loyalty-policy-form");
  for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")) {
    input.disabled = !writable;
  }
  requiredElement<HTMLButtonElement>("#loyalty-policy-save").disabled = !writable;
  requiredElement<HTMLElement>("#loyalty-activity-list").innerHTML = loyaltyActivityRows();
  const audit = data?.audit || [];
  requiredElement<HTMLElement>("#loyalty-audit-list").innerHTML = audit.length
    ? audit.map((item) => `<div class="loyalty-audit-row"><span>↺</span><div><strong>${escapeHtml(item.reason)}</strong><small>${escapeHtml(item.actorName)} · ${escapeHtml(formatCommerceTimestamp(item.createdAt))}</small></div><p>${escapeHtml(policyChangeSummary(item.before, item.after))}</p></div>`).join("")
    : '<div class="customer-empty-detail"><span>✓</span><strong>No policy changes recorded</strong><small>The first governed update will appear here.</small></div>';
  renderLoyaltySelectedCustomer();
  updateLoyaltySimulator();
}

async function loadLoyalty(force = false): Promise<void> {
  if (loyaltyLoading) return;
  if (loyaltyData && !force) { renderLoyalty(); return; }
  loyaltyLoading = true;
  requiredElement<HTMLElement>("#loyalty-command-state").textContent = "Syncing";
  void loadCustomerDirectory(force).then(() => renderLoyalty());
  try {
    const response = await fetch(`/api/rewards${force ? "?refresh=1" : ""}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Loyalty control could not be loaded");
    loyaltyData = payload as unknown as LoyaltyPayload;
    applyLoyaltySettings(loyaltyData.settings || loyaltyDefaults);
    renderLoyalty();
  } catch (error) {
    loyaltyData = { connected: false, writeEnabled: false, canManage: false, settings: null, metrics: null, audit: [], error: error instanceof Error ? error.message : "Try again shortly." };
    applyLoyaltySettings(loyaltyDefaults);
    renderLoyalty();
  } finally {
    loyaltyLoading = false;
  }
}

function loyaltyEligibleCustomers(): CustomerProfile[] {
  return (customerDirectory?.customers || []).filter((customer): customer is CustomerProfile & { id: number } => customer.id !== null && customer.accountType === "registered");
}

function renderLoyaltySearchResults(): void {
  const input = requiredElement<HTMLInputElement>("#loyalty-customer-search");
  const results = requiredElement<HTMLElement>("#loyalty-search-results");
  const search = input.value.trim().toLocaleLowerCase("en");
  if (search.length < 2) { results.hidden = true; results.innerHTML = ""; return; }
  const matches = loyaltyEligibleCustomers().filter((customer) => `${customer.displayName} ${customer.email} ${customer.username} ${customer.id}`.toLocaleLowerCase("en").includes(search)).slice(0, 8);
  results.innerHTML = matches.length
    ? matches.map((customer) => `<button type="button" data-loyalty-customer="${customer.id}">${customerAvatar(customer)}<span><strong>${escapeHtml(customer.displayName)}</strong><small>${escapeHtml(customer.email || customer.username)}</small></span><b>${formatNumber(customer.pointsBalance ?? customer.pointsEarned)} pts</b></button>`).join("")
    : '<p>No registered customer matches this search.</p>';
  results.hidden = false;
}

function renderLoyaltySelectedCustomer(): void {
  const customer = loyaltyEligibleCustomers().find((item) => item.id === loyaltySelectedCustomerId);
  const container = requiredElement<HTMLElement>("#loyalty-selected-customer");
  const save = requiredElement<HTMLButtonElement>("#loyalty-adjustment-save");
  if (!customer) {
    container.innerHTML = '<span>◎</span><div><strong>No customer selected</strong><small>Search the complete customer directory above.</small></div><b>—</b>';
    save.disabled = true;
    requiredElement<HTMLElement>("#loyalty-adjustment-result").textContent = "—";
    return;
  }
  container.innerHTML = `${customerAvatar(customer)}<div><strong>${escapeHtml(customer.displayName)}</strong><small>${escapeHtml(customer.email || customer.username)}</small></div><b>${formatNumber(customer.pointsBalance ?? customer.pointsEarned)} pts</b>`;
  requiredElement<HTMLInputElement>("#loyalty-customer-search").value = customer.displayName;
  requiredElement<HTMLElement>("#loyalty-search-results").hidden = true;
  updateLoyaltyAdjustmentPreview();
}

function updateLoyaltyAdjustmentPreview(): void {
  const customer = loyaltyEligibleCustomers().find((item) => item.id === loyaltySelectedCustomerId);
  const amount = Math.max(0, Math.round(Number(requiredElement<HTMLInputElement>("#loyalty-adjustment-amount").value) || 0));
  const operation = requiredElement<HTMLSelectElement>("#loyalty-adjustment-operation").value;
  const before = customer?.pointsBalance ?? customer?.pointsEarned ?? 0;
  const after = operation === "set" ? amount : operation === "subtract" ? before - amount : before + amount;
  const valid = Boolean(customer && amount >= (operation === "set" ? 0 : 1) && after >= 0 && after <= 1_000_000 && loyaltyData?.canManage && loyaltyData.writeEnabled);
  const result = requiredElement<HTMLElement>("#loyalty-adjustment-result");
  result.textContent = customer ? (after < 0 ? "Blocked — negative balance" : `${formatNumber(after)} points`) : "—";
  result.classList.toggle("is-invalid", after < 0);
  requiredElement<HTMLButtonElement>("#loyalty-adjustment-save").disabled = !valid;
}

function customerAddressCard(title: string, address: CommerceAddress): string {
  const lines = addressLines(address);
  const contact = [address.email, address.phone].filter(Boolean);
  return `<article class="customer-address-card"><span>${escapeHtml(title)}</span>${lines.length || contact.length
    ? `<strong>${escapeHtml(lines.shift() || "Address")}</strong>${lines.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}${contact.map((line) => `<small>${escapeHtml(line)}</small>`).join("")}`
    : '<strong>Not provided</strong><small>No address is saved for this customer.</small>'}</article>`;
}

function rewardActivityRows(customer: CustomerProfile): string {
  const history = customer.rewardHistory.length
    ? customer.rewardHistory
    : customer.orders.filter((order) => order.pointsEarned > 0).map((order) => ({
      id: `order:${order.id}`,
      change: order.pointsEarned,
      balanceBefore: 0,
      balanceAfter: 0,
      type: "order_earned",
      reason: `Points earned from order #${order.number}.`,
      createdAt: order.createdAt,
      orderId: order.id,
    }));
  if (!history.length) return '<div class="customer-empty-detail"><span>◎</span><strong>No points activity recorded</strong><small>This customer has no reward transactions yet.</small></div>';
  return history.slice(0, 20).map((item) => `<div class="reward-activity-row"><span class="reward-change ${item.change < 0 ? "is-negative" : "is-positive"}">${item.change > 0 ? "+" : ""}${formatNumber(item.change)}</span><div><strong>${escapeHtml(item.reason || item.type.replace(/_/g, " "))}</strong><small>${escapeHtml(formatCommerceTimestamp(item.createdAt))}${item.orderId ? ` · Order #${item.orderId}` : ""}</small></div><b>${customerDirectory?.rewardsLive ? `${formatNumber(item.balanceAfter)} pts` : "Recorded"}</b></div>`).join("");
}

function renderCustomerDetail(customer: CustomerProfile): void {
  const currency = customerDirectory?.currency || customer.orders[0]?.currency || "USD";
  requiredElement<HTMLElement>("#customer-drawer-title").textContent = customer.displayName;
  requiredElement<HTMLElement>("#customer-drawer-subtitle").textContent = [customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact information recorded";
  const avatarHost = requiredElement<HTMLElement>("#customer-drawer-avatar");
  avatarHost.outerHTML = customerAvatar(customer, true);
  const account = requiredElement<HTMLElement>("#customer-drawer-account");
  account.textContent = customer.accountType === "registered" ? "Registered account" : "Guest buyer";
  account.className = `customer-account-badge customer-account-badge--${customer.accountType}`;
  const points = customer.pointsBalance ?? customer.pointsEarned;
  const products = customer.topProducts.length
    ? customer.topProducts.map((product) => `<div class="customer-product-row">${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" />` : `<span>${escapeHtml(product.name.charAt(0) || "P")}</span>`}<div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || `Product ${product.productId}`)}</small></div><b>${formatNumber(product.quantity)} units</b><em>${escapeHtml(formatCurrency(product.spent, currency))}</em></div>`).join("")
    : '<div class="customer-empty-detail"><span>◇</span><strong>No products purchased</strong><small>Product history will appear after the first order.</small></div>';
  const orders = customer.orders.length
    ? customer.orders.map((order) => `<button class="customer-order-row" type="button" data-customer-order="${order.id}"><span><strong>#${escapeHtml(order.number)}</strong><small>${escapeHtml(formatCommerceTimestamp(order.createdAt))}</small></span><span>${formatNumber(order.items.reduce((sum, item) => sum + item.quantity, 0))} items</span><span class="status-pill status-pill--${statusClass(order.status)}">${escapeHtml(orderStatusLabel(order.status))}</span><b>${escapeHtml(formatCurrency(order.netTotal, order.currency))}</b><i>→</i></button>`).join("")
    : '<div class="customer-empty-detail"><span>▤</span><strong>No orders yet</strong><small>This account exists in the store but has not placed an order.</small></div>';
  const registered = customer.registeredAt ? formatCommerceTimestamp(customer.registeredAt) : "Guest checkout profile";
  customerDetailContent.innerHTML = `
    <div class="customer-detail-hero">
      <div class="customer-detail-kpis"><article><span>Current points</span><strong>${formatNumber(points)}</strong><small>${customer.pointsBalance === null ? "Recorded earnings" : "Live reward balance"}</small></article><article><span>Store credit</span><strong>${customer.storeCredit === null ? "—" : escapeHtml(formatCurrency(customer.storeCredit, currency))}</strong><small>${customer.storeCredit === null ? "Balance bridge pending" : "Available balance"}</small></article><article><span>Net lifetime value</span><strong>${escapeHtml(formatCurrency(customer.netSpent, currency))}</strong><small>${escapeHtml(formatCurrency(customer.averageOrderValue, currency))} average order</small></article><article><span>Order history</span><strong>${formatNumber(customer.orderCount)}</strong><small>${formatNumber(customer.totalItems)} items purchased</small></article></div>
      <div class="customer-profile-facts"><div><span>Customer ID</span><strong>${customer.id ? `#${customer.id}` : "Guest profile"}</strong></div><div><span>Registered</span><strong>${escapeHtml(registered)}</strong></div><div><span>First order</span><strong>${escapeHtml(formatCommerceTimestamp(customer.firstOrderAt))}</strong></div><div><span>Latest order</span><strong>${escapeHtml(formatCommerceTimestamp(customer.lastOrderAt))}</strong></div><div><span>Successful orders</span><strong>${formatNumber(customer.successfulOrderCount)}</strong></div><div><span>Lifetime points earned</span><strong>${formatNumber(customer.pointsEarned)}</strong></div></div>
    </div>
    <section class="customer-detail-section"><div class="customer-section-heading"><div><p class="section-kicker">Contact & fulfillment</p><h3>Saved customer information</h3></div><span>Protected session</span></div><div class="customer-address-grid">${customerAddressCard("Billing profile", customer.billing)}${customerAddressCard("Shipping profile", customer.shipping)}</div></section>
    <section class="customer-detail-section"><div class="customer-section-heading"><div><p class="section-kicker">Loyalty ledger</p><h3>Points activity</h3></div><span>${customerDirectory?.rewardsLive ? "Live balance + audit history" : "Order-earned points preserved"}</span></div><div class="reward-activity-list">${rewardActivityRows(customer)}</div></section>
    <section class="customer-detail-section"><div class="customer-section-heading"><div><p class="section-kicker">Purchase history</p><h3>Top products</h3></div><span>${formatNumber(customer.topProducts.length)} products</span></div><div class="customer-products-list">${products}</div></section>
    <section class="customer-detail-section customer-orders-section"><div class="customer-section-heading"><div><p class="section-kicker">Complete order history</p><h3>Every order</h3></div><span>${formatNumber(customer.orderCount)} total</span></div><div class="customer-order-history">${orders}</div></section>`;
}

function openCustomerDrawer(key: string): void {
  const customer = customerDirectory?.customers.find((item) => item.key === key);
  if (!customer) return;
  renderCustomerDetail(customer);
  customerDrawer.hidden = false;
  customerBackdrop.hidden = false;
  document.body.classList.add("drawer-open");
}

function closeCustomerDrawer(): void {
  customerDrawer.hidden = true;
  customerBackdrop.hidden = true;
  document.body.classList.remove("drawer-open");
}

function orderLineImage(item: CommerceOrder["lineItems"][number]): string | null {
  return item.imageUrl ||
    commerceData?.products.find((product) => product.id === item.productId)?.imageUrl ||
    null;
}

function renderOrderDetail(order: CommerceOrder): void {
  const itemSubtotal = order.lineItems.reduce((sum, item) => sum + item.subtotal, 0);
  const fees = order.feeLines.reduce((sum, fee) => sum + fee.total + fee.totalTax, 0);
  const netCaptured = Math.max(0, order.total - order.refundedTotal);
  const billingLines = addressLines(order.billing);
  const shippingLines = addressLines(order.shipping);
  const detailContent = requiredElement<HTMLElement>("#order-detail-content");
  const operations = activeOrderOperations || {
    evidence: { orderId: order.id, items: [], unavailable: true },
    coas: { orderId: order.id, items: [], unavailable: true },
    notes: [],
  };

  requiredElement<HTMLElement>("#order-drawer-title").textContent = `Order #${order.number}`;
  requiredElement<HTMLElement>("#order-drawer-subtitle").textContent =
    `Placed ${formatCommerceTimestamp(order.createdAt)} · ${order.lineItems.reduce((sum, item) => sum + item.quantity, 0)} items`;
  const status = requiredElement<HTMLElement>("#order-drawer-status");
  status.className = `status-pill status-pill--${statusClass(order.status)}`;
  status.textContent = orderStatusLabel(order.status);

  const lineItems = order.lineItems.map((item) => {
    const imageUrl = orderLineImage(item);
    const visual = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" />`
      : `<span>${escapeHtml(item.name.trim().charAt(0).toUpperCase() || "P")}</span>`;
    return `<div class="order-line-item"><div class="order-line-visual">${visual}</div><div class="order-line-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku || `Product ${item.productId}`)}${item.variationId ? ` · Variant ${item.variationId}` : ""}</small><span>${formatNumber(item.quantity)} × ${escapeHtml(formatCurrency(item.price, order.currency))}</span></div><div class="order-line-values"><strong>${escapeHtml(formatCurrency(item.total + item.totalTax, order.currency))}</strong><small>${item.totalTax > 0 ? `${escapeHtml(formatCurrency(item.totalTax, order.currency))} tax` : "No item tax"}</small></div></div>`;
  }).join("");
  const feeRows = order.feeLines.map((fee) =>
    `<div><span>${escapeHtml(fee.name)}</span><strong>${escapeHtml(formatCurrency(fee.total + fee.totalTax, order.currency))}</strong></div>`,
  ).join("");
  const couponRows = order.couponLines.map((coupon) =>
    `<div><span>Coupon · ${escapeHtml(coupon.code || "Applied")}</span><strong>−${escapeHtml(formatCurrency(coupon.discount + coupon.discountTax, order.currency))}</strong></div>`,
  ).join("");
  const refundRows = order.refunds.map((refund) =>
    `<div class="is-refund"><span>Refund #${refund.id}${refund.reason ? ` · ${escapeHtml(refund.reason)}` : ""}</span><strong>−${escapeHtml(formatCurrency(Math.abs(refund.total), order.currency))}</strong></div>`,
  ).join("");
  const profit = order.profitability.estimatedProfit;
  const rail = paymentRail(order);
  const reference = order.paymentOperations.reference || order.transactionId;
  const evidenceCards = operations.evidence.items.map((item) => {
    const isImage = item.mime.startsWith("image/");
    const preview = isImage && item.url
      ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.label)}" loading="lazy" />`
      : `<span>${item.mime.includes("pdf") ? "PDF" : "FILE"}</span>`;
    return `<article class="evidence-card"><div class="evidence-preview">${preview}</div><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(formatCommerceTimestamp(item.capturedAt))} · ${item.bytes ? `${(item.bytes / 1024).toFixed(0)} KB` : "Stored securely"}</small><span>${item.customerVisible ? "Customer visible" : "Internal only"}</span></div><div>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">Open</a>` : ""}<button type="button" data-delete-evidence="${escapeHtml(item.id)}">Remove</button></div></article>`;
  }).join("");
  const coaLines = operations.coas.items.map((line) => {
    const assignments = line.assignments.length
      ? line.assignments.map((assignment) => `<div class="coa-assignment"><span><strong>${escapeHtml(assignment.lot || assignment.coaId)}</strong><small>${formatNumber(assignment.quantity)} unit${assignment.quantity === 1 ? "" : "s"} · ${escapeHtml(assignment.source || "Manual assignment")}</small></span><button type="button" data-remove-coa="${escapeHtml(assignment.assignmentId)}" data-coa-item="${line.itemId}">Remove</button></div>`).join("")
      : '<p class="operations-empty operations-empty--compact"><strong>No certificate assigned</strong><span>Select a verified lot below.</span></p>';
    const candidates = line.candidates.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.number || candidate.productName)} · Lot ${escapeHtml(candidate.lot || "unlisted")}${candidate.currentShippingLot ? " · Current shipping lot" : ""}</option>`).join("");
    return `<article class="coa-line"><header><div><strong>${escapeHtml(line.name)}</strong><small>${escapeHtml(line.sku || `Line ${line.itemId}`)} · ${formatNumber(line.quantity)} ordered</small></div><span>${formatNumber(line.remainingQuantity)} unassigned</span></header><div class="coa-assignment-list">${assignments}</div><form data-coa-assignment-form data-item-id="${line.itemId}"><label><span>Verified lot</span><select name="coaId" required><option value="">Choose a certificate</option>${candidates}</select></label><label><span>Quantity</span><input name="quantity" type="number" min="1" max="${Math.max(1, line.remainingQuantity)}" value="${Math.max(1, line.remainingQuantity)}" required /></label><button class="button button--secondary" type="submit"${!candidates || line.remainingQuantity < 1 ? " disabled" : ""}>Assign COA</button></form></article>`;
  }).join("");
  const timelineEntries = [
    ...operations.notes.map((note) => ({ id: `note-${note.id}`, at: note.createdAt, title: note.customerNote ? "Customer note" : note.author || "Order action", copy: note.note })),
    { id: "created", at: order.createdAt, title: "Order created", copy: `${order.paymentMethod} · ${formatCurrency(order.total, order.currency)}` },
    ...(order.paidAt ? [{ id: "paid", at: order.paidAt, title: "Payment recorded", copy: reference || "Payment completed" }] : []),
    ...(order.completedAt ? [{ id: "completed", at: order.completedAt, title: "Order completed", copy: "Fulfillment marked complete" }] : []),
  ].sort((left, right) => Date.parse(right.at || "") - Date.parse(left.at || ""));
  const paymentFees = fees + order.paymentOperations.processingFee;
  const commission = operations.affiliateCommission;
  const commissionStatusLabel = commission
    ? ({ reserved: "Awaiting payment", pending: "On approval hold", approved: "Approved", paid: "Paid", reversed: "Reversed" } as const)[commission.status]
    : "";
  const commissionRule = commission
    ? commission.commissionType === "fixed"
      ? `${formatCurrency(commission.commissionRate, commission.currency)} fixed`
      : `${commission.commissionRate}%`
    : "";
  const commissionTiming = commission
    ? commission.status === "pending" && commission.heldUntil
      ? `Eligible ${formatCommerceTimestamp(commission.heldUntil)}`
      : commission.status === "reversed"
        ? `Reversed ${formatCommerceTimestamp(commission.reversedAt)}`
        : commission.status === "approved"
          ? `Approved ${formatCommerceTimestamp(commission.approvedAt)}`
          : `Attributed ${formatCommerceTimestamp(commission.attributedAt)}`
    : "";
  const affiliateCommissionCard = commission ? `
    <section class="order-affiliate-card">
      <div class="order-affiliate-mark" aria-hidden="true">↗</div>
      <div class="order-affiliate-identity"><p class="section-kicker">Affiliate attribution</p><h3>${escapeHtml(commission.affiliateName)}</h3><span>${escapeHtml(commission.affiliateEmail)} · Coupon <strong>${escapeHtml(commission.couponCode.toUpperCase())}</strong></span></div>
      <dl><div><dt>Eligible sale</dt><dd>${escapeHtml(formatCurrency(commission.eligibleAmount, commission.currency))}</dd></div><div><dt>Commission rule</dt><dd>${escapeHtml(commissionRule)}</dd></div><div><dt>Commission earned</dt><dd>${escapeHtml(formatCurrency(commission.commissionAmount, commission.currency))}</dd></div></dl>
      <div class="order-affiliate-state"><span class="affiliate-ledger-status is-${escapeHtml(commission.status)}">${escapeHtml(commissionStatusLabel)}</span><small>${escapeHtml(commissionTiming)}</small></div>
    </section>` : "";

  detailContent.innerHTML = `
    <section class="order-summary-band"><div><span>Order total</span><strong>${escapeHtml(formatCurrency(order.total, order.currency))}</strong></div><div><span>Net captured</span><strong>${escapeHtml(formatCurrency(netCaptured, order.currency))}</strong></div><div><span>Refundable</span><strong>${escapeHtml(formatCurrency(order.refundableTotal, order.currency))}</strong></div><div><span>Est. profit</span><strong class="${profit !== null && profit < 0 ? "is-negative" : ""}">${profit === null ? "Not calculated" : escapeHtml(formatCurrency(profit, order.currency))}</strong></div></section>
    <nav class="order-workspace-tabs" aria-label="Order details">${([['overview', 'Overview'], ['payment', 'Payment'], ['documents', `Documents ${operations.evidence.items.length ? `(${operations.evidence.items.length})` : ''}`], ['coas', 'COAs'], ['shipping', 'Shipping'], ['timeline', 'Timeline']] as const).map(([key, label]) => `<button class="${activeOrderTab === key ? "is-active" : ""}" type="button" data-order-tab="${key}">${label}</button>`).join("")}</nav>
    <div class="order-tab-panel" data-order-tab-panel="overview"${activeOrderTab === "overview" ? "" : " hidden"}>
      ${affiliateCommissionCard}
      <section class="order-detail-section"><div class="order-section-head"><div><p class="section-kicker">Line items</p><h3>Products purchased</h3></div><span>${order.lineItems.length} line${order.lineItems.length === 1 ? "" : "s"}</span></div><div class="order-line-list">${lineItems || '<p class="empty-state">No line items were returned.</p>'}</div></section>
      <div class="order-detail-columns"><section class="order-detail-section"><div class="order-section-head"><div><p class="section-kicker">Customer</p><h3>Billing details</h3></div></div><div class="address-card"><strong>${escapeHtml(order.customer)}</strong>${billingLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}${order.billing.email ? `<span>${escapeHtml(order.billing.email)}</span>` : ""}${order.billing.phone ? `<span>${escapeHtml(order.billing.phone)}</span>` : ""}</div></section><section class="order-detail-section"><div class="order-section-head"><div><p class="section-kicker">Fulfillment</p><h3>Shipping address</h3></div></div><div class="address-card">${shippingLines.length ? shippingLines.map((line, index) => index === 0 ? `<strong>${escapeHtml(line)}</strong>` : `<span>${escapeHtml(line)}</span>`).join("") : '<span>No shipping address supplied.</span>'}</div></section></div>
      ${order.customerNote ? `<section class="order-detail-section"><div class="order-section-head"><div><p class="section-kicker">Customer note</p><h3>Order instructions</h3></div></div><p class="order-note">${escapeHtml(order.customerNote)}</p></section>` : ""}
    </div>
    <div class="order-tab-panel" data-order-tab-panel="payment"${activeOrderTab === "payment" ? "" : " hidden"}>
      <section class="payment-review-hero payment-review-hero--${order.paymentOperations.approvalState}"><div class="payment-rail payment-rail--${rail.key}"><i>${rail.short}</i><span><small>PAYMENT METHOD</small><strong>${escapeHtml(rail.label)}</strong></span></div><div><small>Verification status</small><strong>${order.paymentOperations.approvalState === "pending" ? "Decision required" : order.paymentOperations.approvalState === "approved" ? "Approved" : order.paymentOperations.approvalState === "rejected" ? "Rejected" : "Provider verified"}</strong></div>${order.paymentOperations.kind === "manual" && order.paymentOperations.approvalState === "pending" ? '<div class="payment-decision-actions"><button class="button button--primary" type="button" data-payment-decision="approve">Approve payment</button><button class="button button--danger" type="button" data-payment-decision="reject">Reject payment</button></div>' : ""}</section>
      <div class="order-detail-columns"><section class="order-detail-section"><div class="order-section-head"><div><p class="section-kicker">Payment record</p><h3>Reference & verification</h3></div>${paymentBadge(order)}</div><dl class="order-facts"><div><dt>Reference</dt><dd>${escapeHtml(reference || "Missing — follow up required")}</dd></div><div><dt>Verification</dt><dd>${escapeHtml(order.paymentOperations.verification || "No provider result recorded")}</dd></div><div><dt>Payment deadline</dt><dd>${escapeHtml(formatCommerceTimestamp(order.paymentOperations.expiresAt))}</dd></div><div><dt>Paid</dt><dd>${escapeHtml(formatCommerceTimestamp(order.paidAt))}</dd></div></dl></section><section class="order-detail-section order-financials"><div class="order-section-head"><div><p class="section-kicker">Reconciliation</p><h3>Charges & net collection</h3></div></div><div class="money-breakdown"><div><span>Items subtotal</span><strong>${escapeHtml(formatCurrency(itemSubtotal, order.currency))}</strong></div>${couponRows}<div><span>Shipping</span><strong>${escapeHtml(formatCurrency(order.shippingTotal + order.shippingTax, order.currency))}</strong></div><div><span>Tax</span><strong>${escapeHtml(formatCurrency(order.totalTax, order.currency))}</strong></div>${feeRows}${order.paymentOperations.processingFee ? `<div><span>Processing fee${order.paymentOperations.processingFeeRate ? ` · ${order.paymentOperations.processingFeeRate}%` : ""}</span><strong>${escapeHtml(formatCurrency(order.paymentOperations.processingFee, order.currency))}</strong></div>` : ""}<div class="money-breakdown-total"><span>Order total</span><strong>${escapeHtml(formatCurrency(order.total, order.currency))}</strong></div>${refundRows}<div class="money-breakdown-net"><span>Net after fees & refunds</span><strong>${escapeHtml(formatCurrency(Math.max(0, order.total - paymentFees - order.refundedTotal), order.currency))}</strong></div></div></section></div>
    </div>
    <div class="order-tab-panel" data-order-tab-panel="documents"${activeOrderTab === "documents" ? "" : " hidden"}>
      <section class="document-toolbar"><div><p class="section-kicker">Evidence vault</p><h3>Payment proof and supporting documents</h3><p>Files remain attached to this order and every change is auditable.</p></div><form id="order-evidence-form"><input id="order-evidence-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /><label for="order-evidence-file">Choose evidence</label><button class="button button--primary" type="submit">Upload file</button></form></section>
      <div class="evidence-grid">${evidenceCards || `<div class="operations-empty"><strong>${operations.evidence.unavailable ? "Evidence service needs the bridge update" : "No evidence attached"}</strong><span>${operations.evidence.unavailable ? "Install Operations Bridge 1.4 to read and upload evidence here." : "This order has no payment proof or supporting document yet."}</span></div>`}</div>
      <section class="agreement-card agreement-card--${order.agreement.status}"><div class="agreement-mark">${order.agreement.status === "sealed" ? "✓" : "—"}</div><div><p class="section-kicker">Signed agreement</p><h3>${order.agreement.status === "sealed" ? "Sealed and archived" : order.agreement.status === "accepted" ? "Accepted — archive pending" : "No agreement found"}</h3><p>${order.agreement.signer ? `Signed by ${escapeHtml(order.agreement.signer)} · ` : ""}${escapeHtml(formatCommerceTimestamp(order.agreement.acceptedAt))}${order.agreement.version ? ` · Version ${escapeHtml(order.agreement.version)}` : ""}</p></div>${order.agreement.downloadAvailable ? `<a class="button button--secondary" href="/api/commerce/order-agreement?orderId=${order.id}" target="_blank">Open signed PDF</a>` : ""}</section>
    </div>
    <div class="order-tab-panel" data-order-tab-panel="coas"${activeOrderTab === "coas" ? "" : " hidden"}><section class="coa-workspace-head"><div><p class="section-kicker">Lot traceability</p><h3>Assign certificates by product and quantity</h3><p>Use the verified shipping lot for every fulfilled unit.</p></div><span>${operations.coas.items.reduce((sum, line) => sum + line.assignments.length, 0)} assignments</span></section><div class="coa-order-list">${coaLines || `<div class="operations-empty"><strong>${operations.coas.unavailable ? "COA assignment needs the bridge update" : "No COA-compatible line items"}</strong><span>${operations.coas.unavailable ? "Install Operations Bridge 1.4 to manage order certificates." : "This order has no assignable certificate records."}</span></div>`}</div></div>
    <div class="order-tab-panel" data-order-tab-panel="shipping"${activeOrderTab === "shipping" ? "" : " hidden"}><div class="shipping-status-grid"><article><span>Carrier sync</span><strong>${order.shippingOperations.exported ? "Exported" : "Not exported"}</strong><small>${escapeHtml(order.shippingOperations.carrier || "Carrier not assigned")} ${escapeHtml(order.shippingOperations.service || "")}</small></article><article><span>Tracking</span><strong>${escapeHtml(order.shippingOperations.trackingNumber || "Not available")}</strong><small>${formatNumber(order.shippingOperations.shippedItemCount)} shipped items</small></article><article><span>Shipping protection</span><strong>${order.shippingOperations.protectionSelected ? "Protected" : "Not selected"}</strong><small>${order.shippingOperations.protectionSelected ? `${escapeHtml(formatCurrency(order.shippingOperations.protectionValue || order.total, order.currency))} insured value` : "No protection fee recorded"}</small></article></div><section class="order-detail-section"><div class="order-section-head"><div><p class="section-kicker">Delivery destination</p><h3>Shipping address</h3></div></div><div class="address-card">${shippingLines.length ? shippingLines.map((line, index) => index === 0 ? `<strong>${escapeHtml(line)}</strong>` : `<span>${escapeHtml(line)}</span>`).join("") : '<span>No shipping address supplied.</span>'}</div></section></div>
    <div class="order-tab-panel" data-order-tab-panel="timeline"${activeOrderTab === "timeline" ? "" : " hidden"}><section class="timeline-head"><div><p class="section-kicker">Audit trail</p><h3>Complete order history</h3></div><span>${timelineEntries.length} recorded events</span></section><div class="order-timeline">${timelineEntries.map((entry) => `<article><i></i><div><time>${escapeHtml(formatCommerceTimestamp(entry.at))}</time><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.copy)}</p></div></article>`).join("")}</div></div>
  `;

  const writeEnabled = commerceData?.mode === "read_write";
  const confirmButton = requiredElement<HTMLButtonElement>("#order-confirm-button");
  const completeButton = requiredElement<HTMLButtonElement>("#order-complete-button");
  const cancelButton = requiredElement<HTMLButtonElement>("#order-cancel-button");
  const refundButton = requiredElement<HTMLButtonElement>("#order-refund-button");
  confirmButton.hidden = !["pending", "on-hold", "failed"].includes(order.status);
  completeButton.hidden = !["processing", "on-hold"].includes(order.status);
  cancelButton.hidden = !["pending", "on-hold", "processing", "failed"].includes(order.status);
  refundButton.hidden = !["processing", "completed"].includes(order.status) || order.refundableTotal <= 0;
  for (const button of [confirmButton, completeButton, cancelButton, refundButton]) {
    button.disabled = !writeEnabled;
  }
  requiredElement<HTMLElement>("#order-action-hint").textContent = writeEnabled
    ? "Actions update the live order immediately."
    : "This connection is read only; operational actions are unavailable.";
  requiredElement<HTMLElement>("#order-detail-loading").hidden = true;
  detailContent.hidden = false;
  requiredElement<HTMLElement>("#order-drawer-actions").hidden = false;
}

async function openOrderDrawer(orderId: number): Promise<void> {
  const drawer = requiredElement<HTMLElement>("#order-drawer");
  const backdrop = requiredElement<HTMLButtonElement>("#order-backdrop");
  activeOrder = null;
  activeOrderOperations = null;
  activeOrderTab = "overview";
  requiredElement<HTMLElement>("#order-drawer-title").textContent = "Order details";
  requiredElement<HTMLElement>("#order-drawer-subtitle").textContent = "Loading financials and fulfillment data.";
  requiredElement<HTMLElement>("#order-detail-loading").hidden = false;
  requiredElement<HTMLElement>("#order-detail-content").hidden = true;
  requiredElement<HTMLElement>("#order-drawer-actions").hidden = true;
  drawer.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add("drawer-open");
  try {
    const response = await fetch(`/api/commerce/order?orderId=${encodeURIComponent(String(orderId))}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.order)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Order details could not be loaded");
    }
    activeOrder = payload.order as unknown as CommerceOrder;
    activeOrderOperations = isRecord(payload.operations) ? payload.operations as unknown as OrderOperations : null;
    renderOrderDetail(activeOrder);
  } catch (error) {
    requiredElement<HTMLElement>("#order-detail-loading").hidden = true;
    const content = requiredElement<HTMLElement>("#order-detail-content");
    content.hidden = false;
    content.innerHTML = `<div class="order-detail-error"><strong>Unable to open this order</strong><p>${escapeHtml(error instanceof Error ? error.message : "Try again in a moment.")}</p></div>`;
  }
}

function closeOrderDrawer(): void {
  requiredElement<HTMLElement>("#order-drawer").hidden = true;
  requiredElement<HTMLButtonElement>("#order-backdrop").hidden = true;
  document.body.classList.remove("drawer-open");
  activeOrder = null;
  activeOrderOperations = null;
}

function productRow(product: CommerceProduct): string {
  const initial = product.name.trim().charAt(0).toUpperCase() || "P";
  const thumbnail = product.thumbnailUrl || product.imageUrl
    ? `<img src="${escapeHtml(product.thumbnailUrl || product.imageUrl || "")}" data-fallback-src="${escapeHtml(product.imageUrl || "")}" alt="" loading="lazy" decoding="async" />`
    : escapeHtml(initial);
  const inventory = product.stockQuantity === null
    ? product.stockStatus === "instock" ? "Available" : "Out of stock"
    : `${formatNumber(product.stockQuantity)} units`;
  const lowStock = product.stockQuantity !== null && product.stockQuantity < 5;
  const cost = product.type === "variable"
    ? '<span class="cell-muted">By variant</span>'
    : product.cost
      ? `<span class="cell-cost-stack"><b>${escapeHtml(formatCurrency(product.cost.unitCost))}</b>${product.testingCostPerUnit ? `<small>+ ${escapeHtml(formatCurrency(product.testingCostPerUnit))} test · Lot ${escapeHtml(product.testingLot || "current")}</small>` : ""}</span>`
      : '<button class="cost-action" type="button" data-edit-cost>Set cost</button>';
  const profit = product.type === "variable"
    ? '<span class="cell-muted">Open product</span>'
    : product.estimatedProfit === null
    ? '<span class="cell-muted">—</span>'
    : `<span class="cell-profit${product.estimatedProfit < 0 ? " cell-profit--negative" : ""}">${escapeHtml(formatCurrency(product.estimatedProfit))}</span>`;
  const margin = product.type === "variable"
    ? '<span class="cell-muted">Per mg</span>'
    : product.margin === null
    ? '<span class="cell-muted">—</span>'
    : `${product.margin.toFixed(1)}%`;
  const state = {
    public: "Public",
    hidden: "Hidden",
    private: "Admin only",
    draft: "Draft",
  }[product.visibility] || "Draft";
  const stateClass = product.visibility === "public"
    ? "completed"
    : product.visibility === "private"
      ? "private"
      : "pending";
  const rowAction = product.localDraft
    ? '<span class="draft-origin">Local draft</span>'
    : '<button class="row-menu" type="button" data-open-product-row aria-label="Open product">→</button>';
  return `<tr class="product-row" data-product-id="${product.id}" data-open-product-row tabindex="0"><td><div class="product-cell"><span class="product-thumb">${thumbnail}</span><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)}${product.variationIds.length ? ` · ${product.variationIds.length} variants` : ""}</small></div></div></td><td><code class="sku-code">${escapeHtml(product.sku || "—")}</code></td><td class="cell-money">${escapeHtml(formatCurrency(product.price))}</td><td>${cost}</td><td>${profit}</td><td>${margin}</td><td class="${lowStock ? "stock-low" : ""}">${escapeHtml(inventory)}</td><td><span class="status-pill status-pill--${stateClass}">${state}</span></td><td>${rowAction}</td></tr>`;
}

function localDraftProducts(): CommerceProduct[] {
  try {
    const raw = localStorage.getItem("phaseone:product-drafts");
    const values: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(values)) return [];
    return values.flatMap((value, index) => {
      if (!value || typeof value !== "object") return [];
      const draft = value as Partial<ProductDraftRecord>;
      if (typeof draft.name !== "string" || !draft.name.trim()) return [];
      const price = Number(draft.price) || 0;
      const unitCost = Number(draft.cost) || 0;
      const packagingCost = Number(draft.packaging) || 0;
      const feeRate = Number(draft.feeRate) || 0;
      const affiliateRate = Number(draft.affiliateRate) || 0;
      const profitability = calculateProductProfitability(price, {
        unitCost,
        packagingCost,
        feeRate,
        affiliateRate,
      });
      return [{
        id: Number(draft.id) || -(index + 1),
        name: draft.name.trim(),
        sku: typeof draft.sku === "string" ? draft.sku : "",
        type: "simple",
        status: draft.status === "ready" ? "ready" : "draft",
        catalogVisibility: "hidden",
        visibility: "draft" as const,
        price,
        regularPrice: price,
        salePrice: null,
        stockQuantity: Number(draft.stock) || 0,
        stockStatus: Number(draft.stock) > 0 ? "instock" : "outofstock",
        category: typeof draft.category === "string" && draft.category.trim()
          ? draft.category.trim()
          : "Uncategorized",
        imageUrl: null,
        thumbnailUrl: null,
        images: [],
        variationIds: [],
        attributes: [],
        cost: { unitCost, packagingCost, feeRate, affiliateRate },
        estimatedProfit: profitability.estimatedProfit,
        margin: profitability.margin,
        testingCostPerUnit: 0,
        testingCostTotal: 0,
        testingBatchUnitCount: 0,
        testingLot: "",
        localDraft: true as const,
      }];
    });
  } catch {
    return [];
  }
}

function renderProducts(): void {
  const products = [...(commerceData?.products || []), ...localDraftProducts()];
  const search = productSearch.trim().toLocaleLowerCase("en");
  const visible = products.filter((product) =>
    (!search || `${product.name} ${product.sku} ${product.category}`
      .toLocaleLowerCase("en")
      .includes(search)) && (
      productFilter === "all" ||
      product.visibility === productFilter ||
      (productFilter === "low" && product.stockQuantity !== null && product.stockQuantity < 5)
    ),
  );
  const costed = products.filter((product) => product.cost);
  const margins = costed.flatMap((product) => product.margin === null ? [] : [product.margin]);
  const averageMargin = margins.length
    ? margins.reduce((sum, value) => sum + value, 0) / margins.length
    : null;
  const coverage = products.length ? (costed.length / products.length) * 100 : 0;
  requiredElement<HTMLElement>("#products-count").textContent = formatNumber(products.length);
  requiredElement<HTMLElement>("#products-costed-count").textContent = formatNumber(costed.length);
  requiredElement<HTMLElement>("#products-coverage-label").textContent = `${coverage.toFixed(0)}% coverage`;
  requiredElement<HTMLElement>("#products-low-stock").textContent = formatNumber(
    products.filter((product) => product.stockQuantity !== null && product.stockQuantity < 5).length,
  );
  requiredElement<HTMLElement>("#products-average-margin").textContent = averageMargin === null
    ? "—"
    : `${averageMargin.toFixed(1)}%`;
  requiredElement<HTMLElement>("#products-table-body").innerHTML = visible.length
    ? visible.map(productRow).join("")
    : '<tr><td colspan="9"><div class="table-loading">No products match your search.</div></td></tr>';
  for (const image of document.querySelectorAll<HTMLImageElement>("#products-table-body img[data-fallback-src]")) {
    image.addEventListener("error", () => {
      const fallback = image.dataset.fallbackSrc;
      if (fallback && image.src !== fallback) image.src = fallback;
    }, { once: true });
  }
  renderProductsWorkspace();
  renderInventoryOperations();
}

function renderProductsWorkspace(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-products-workspace]")) {
    button.classList.toggle("is-active", button.dataset.productsWorkspace === productsWorkspace);
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-products-workspace-panel]")) {
    panel.hidden = panel.dataset.productsWorkspacePanel !== productsWorkspace;
  }
}

function inventoryState(product: Pick<CommerceProduct, "stockQuantity" | "stockStatus"> & { type?: string }): { label: string; tone: string } {
  if ((product.stockQuantity ?? 0) < 0) return { label: "Negative stock", tone: "critical" };
  if (product.stockStatus === "outofstock" || product.stockQuantity === 0) return { label: "Out of stock", tone: "critical" };
  if (product.stockQuantity !== null && product.stockQuantity < 5) return { label: "Low stock", tone: "warning" };
  if (product.type?.includes("bundle") || product.type?.includes("group")) return { label: "Bundle", tone: "neutral" };
  return { label: "Healthy", tone: "good" };
}

function stockStrength(attributes: Array<{ name: string; option?: string; options?: string[] }>, fallback = "—"): string {
  const preferred = attributes.find((attribute) =>
    /strength|dosage|size|weight|mg|mcg|ml/i.test(attribute.name),
  );
  const attribute = preferred || (attributes.length === 1 ? attributes[0] : undefined);
  if (!attribute) return fallback;
  return attribute.option || attribute.options?.join(", ") || fallback;
}

function stockQuantityLabel(quantity: number | null, status: string): string {
  if (quantity !== null) return formatNumber(quantity);
  return status === "instock" ? "In stock" : "Not tracked";
}

function exactInventoryLots(productId: number, variationId: number): CommerceCoa[] {
  return (inventoryOperations?.lots || [])
    .filter((coa) => coa.status === "Available" && coa.matchedProductId === productId && coa.matchedVariationId === variationId)
    .sort((left, right) => Number(right.currentShippingLot) - Number(left.currentShippingLot) ||
      String(right.date || "").localeCompare(String(left.date || "")));
}

function shippingLotCell(productId: number, variationId: number, variableGroup = false): string {
  if (variableGroup) {
    return '<div class="shipping-lot-cell shipping-lot-cell--group"><strong>Assigned per variation</strong><small>Expand to manage each strength</small></div>';
  }
  const current = exactInventoryLots(productId, variationId).find((coa) => coa.currentShippingLot);
  if (!current) {
    return '<div class="shipping-lot-cell shipping-lot-cell--empty"><strong>No lot assigned</strong><small>Profit uses no testing allocation yet</small></div>';
  }
  const perUnit = Math.max(0, Number(current.testingCostPerUnit || 0));
  return `<div class="shipping-lot-cell"><strong>${escapeHtml(current.lot || current.batch || current.coaNumber)}</strong><small>${perUnit ? `${escapeHtml(formatCurrency(perUnit))} testing / unit` : "Testing cost not recorded"} · ${escapeHtml(current.date || "No test date")}</small></div>`;
}

function renderSkuStockLedger(): void {
  const body = document.querySelector<HTMLElement>("#sku-stock-body");
  if (!body) return;
  const sourceProducts = inventoryOperations?.products?.length
    ? inventoryOperations.products
    : commerceData?.products || [];
  const search = skuStockSearch.trim().toLocaleLowerCase("en");
  const products = sourceProducts.filter((product) => {
    const details = skuStockDetails.get(product.id);
    const variationText = details?.variations.map((variation) =>
      `${variation.sku} ${variation.attributes.map((attribute) => `${attribute.name} ${attribute.option}`).join(" ")}`,
    ).join(" ") || "";
    return !search || `${product.name} ${product.sku} ${product.category} ${variationText}`
      .toLocaleLowerCase("en").includes(search);
  });
  const rows = products.flatMap((product) => {
    const state = inventoryState(product);
    const variable = product.type === "variable" || product.variationIds.length > 0;
    const expanded = skuStockExpanded.has(product.id);
    const details = skuStockDetails.get(product.id);
    const base = `<tr class="sku-stock-parent${expanded ? " is-expanded" : ""}"><td><div class="sku-stock-product"><span>${product.thumbnailUrl || product.imageUrl ? `<img src="${escapeHtml(product.thumbnailUrl || product.imageUrl || "")}" alt="" loading="lazy" decoding="async" />` : escapeHtml((product.name[0] || "P").toUpperCase())}</span><div><strong>${escapeHtml(product.name)}</strong><small>${variable ? `${formatNumber(product.variationIds.length)} variation${product.variationIds.length === 1 ? "" : "s"}` : "Simple product"}</small></div></div></td><td><code>${escapeHtml(product.sku || "—")}</code></td><td>${escapeHtml(stockStrength(product.attributes))}</td><td><strong>${escapeHtml(stockQuantityLabel(product.stockQuantity, product.stockStatus))}</strong></td><td><span class="inventory-risk inventory-risk--${state.tone}">${escapeHtml(state.label)}</span></td><td>${shippingLotCell(product.id, 0, variable)}</td><td><div class="sku-stock-actions">${variable ? `<button type="button" data-toggle-sku-product="${product.id}" aria-expanded="${expanded}">${expanded ? "Hide SKUs" : "View SKUs"}</button>` : `<button type="button" data-assign-lot-product="${product.id}" data-assign-lot-variation="0">${exactInventoryLots(product.id, 0).some((coa) => coa.currentShippingLot) ? "Change lot" : "Assign lot"}</button>`}<button type="button" data-edit-stock-product="${product.id}">Edit</button></div></td></tr>`;
    if (!expanded) return [base];
    if (skuStockLoading.has(product.id)) {
      return [base, '<tr class="sku-stock-child"><td colspan="7"><div class="table-loading">Loading variation stock…</div></td></tr>'];
    }
    if (!details?.variations.length) {
      return [base, '<tr class="sku-stock-child"><td colspan="7"><div class="operations-empty"><strong>No variation records returned</strong><span>Refresh the product connection or open the product editor.</span></div></td></tr>'];
    }
    return [base, ...details.variations.map((variation) => {
      const variationState = inventoryState(variation);
      const variationName = variation.attributes.map((attribute) => attribute.option).filter(Boolean).join(" · ") || `Variation ${variation.id}`;
      return `<tr class="sku-stock-child"><td><div class="sku-stock-product sku-stock-product--variation"><span>${variation.image?.thumbnailUrl || variation.image?.src ? `<img src="${escapeHtml(variation.image.thumbnailUrl || variation.image.src)}" alt="" loading="lazy" decoding="async" />` : "↳"}</span><div><strong>${escapeHtml(variationName)}</strong><small>Variation ${variation.id}</small></div></div></td><td><code>${escapeHtml(variation.sku || "—")}</code></td><td>${escapeHtml(stockStrength(variation.attributes))}</td><td><strong>${escapeHtml(stockQuantityLabel(variation.stockQuantity, variation.stockStatus))}</strong></td><td><span class="inventory-risk inventory-risk--${variationState.tone}">${escapeHtml(variationState.label)}</span></td><td>${shippingLotCell(product.id, variation.id)}</td><td><div class="sku-stock-actions"><button type="button" data-assign-lot-product="${product.id}" data-assign-lot-variation="${variation.id}">${exactInventoryLots(product.id, variation.id).some((coa) => coa.currentShippingLot) ? "Change lot" : "Assign lot"}</button><button class="sku-stock-edit" type="button" data-edit-stock-product="${product.id}">Edit product</button></div></td></tr>`;
    })];
  });
  body.innerHTML = rows.length
    ? rows.join("")
    : '<tr><td colspan="7"><div class="operations-empty"><strong>No stock records match</strong><span>Try another product name, SKU or strength.</span></div></td></tr>';
}

async function toggleSkuStockProduct(productId: number): Promise<void> {
  if (skuStockExpanded.has(productId)) {
    skuStockExpanded.delete(productId);
    renderSkuStockLedger();
    return;
  }
  skuStockExpanded.add(productId);
  if (skuStockDetails.has(productId) || skuStockLoading.has(productId)) {
    renderSkuStockLedger();
    return;
  }
  skuStockLoading.add(productId);
  renderSkuStockLedger();
  try {
    const response = await fetch(`/api/commerce/product?productId=${encodeURIComponent(String(productId))}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.product) || !Array.isArray(payload.variations)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Variation stock is unavailable");
    }
    skuStockDetails.set(productId, {
      product: payload.product as unknown as CommerceProduct,
      variations: payload.variations as CommerceVariation[],
    });
  } catch (error) {
    skuStockExpanded.delete(productId);
    showToast("Variation stock unavailable", error instanceof Error ? error.message : "Try refreshing inventory.", false);
  } finally {
    skuStockLoading.delete(productId);
    renderSkuStockLedger();
  }
}

function renderInventoryOperations(): void {
  const sourceProducts = inventoryOperations?.products?.length ? inventoryOperations.products : commerceData?.products || [];
  const restocks = inventoryOperations?.restocks || [];
  const restockByProduct = new Map(restocks.map((item) => [item.productId, item]));
  const exceptions = sourceProducts.filter((product) => {
    const state = inventoryState(product);
    return state.tone !== "good" || restockByProduct.has(product.id);
  }).sort((left, right) => {
    const severity = { critical: 0, warning: 1, neutral: 2, good: 3 };
    return severity[inventoryState(left).tone as keyof typeof severity] - severity[inventoryState(right).tone as keyof typeof severity];
  });
  const out = sourceProducts.filter((product) => inventoryState(product).tone === "critical");
  const low = sourceProducts.filter((product) => inventoryState(product).tone === "warning");
  const waitlistCounts = inventoryOperations?.waitlistCounts || {};
  const waitingCustomers = Object.values(waitlistCounts).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  requiredElement<HTMLElement>("#inventory-kpis").innerHTML = `
    <article><span>Out of stock</span><strong>${formatNumber(out.length)}</strong><small>Immediate sales risk</small></article>
    <article><span>Low stock</span><strong>${formatNumber(low.length)}</strong><small>Below 5 available units</small></article>
    <article><span>Active restocks</span><strong>${formatNumber(restocks.length)}</strong><small>Incoming inventory records</small></article>
    <article><span>Waiting customers</span><strong>${formatNumber(waitingCustomers)}</strong><small>Live stock-alert audience</small></article>`;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-inventory-view]")) {
    const active = button.dataset.inventoryView === inventoryView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-inventory-view-panel]")) {
    panel.hidden = panel.dataset.inventoryViewPanel !== inventoryView;
  }
  const exceptionList = requiredElement<HTMLElement>("#inventory-exceptions-list");
  if (inventoryOperationsLoading) {
    exceptionList.innerHTML = '<div class="inventory-loading-state"><span></span><strong>Refreshing live inventory…</strong><small>Reading products, variations and restock records.</small></div>';
  } else {
    exceptionList.innerHTML = exceptions.length
      ? exceptions.map((product) => {
        const state = inventoryState(product);
        const restock = restockByProduct.get(product.id);
        const available = product.stockQuantity === null ? (product.stockStatus === "instock" ? "Available" : "0") : formatNumber(product.stockQuantity);
        const waitlist = waitlistCounts[String(product.id)] ?? restock?.waitlistCount;
        const visual = product.thumbnailUrl || product.imageUrl
          ? `<img src="${escapeHtml(product.thumbnailUrl || product.imageUrl || "")}" alt="" loading="lazy" decoding="async" />`
          : `<b>${escapeHtml(product.name.charAt(0).toUpperCase() || "P")}</b>`;
        return `<article class="inventory-exception-card inventory-exception-card--${state.tone}"><div class="inventory-exception-product"><span>${visual}</span><div><div><span class="inventory-risk inventory-risk--${state.tone}">${escapeHtml(state.label)}</span>${restock ? `<em>${escapeHtml(restock.status)}</em>` : ""}</div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || `Product ${product.id}`)}</small></div></div><div class="inventory-exception-metric"><span>Available</span><strong>${available}</strong><small>${escapeHtml(product.stockStatus.replace(/_/g, " "))}</small></div><div class="inventory-exception-metric"><span>Expected</span><strong>${restock?.expectedAt ? escapeHtml(formatCommerceDate(restock.expectedAt)) : "Not scheduled"}</strong><small>${restock ? "Incoming record" : "No restock recorded"}</small></div><div class="inventory-exception-metric"><span>Waiting</span><strong>${waitlist === null || waitlist === undefined ? "Open list" : formatNumber(waitlist)}</strong><small>Back-in-stock subscribers</small></div><div class="inventory-exception-actions"><button type="button" data-view-waitlist="${product.id}">View subscribers</button><button class="button button--secondary" type="button" data-edit-product="${product.id}">Edit stock</button></div></article>`;
      }).join("")
      : '<div class="inventory-healthy-state"><span>✓</span><div><strong>Inventory is healthy</strong><p>No low-stock, negative-stock or restock exceptions were found.</p></div></div>';
  }
  requiredElement<HTMLElement>("#restock-program-list").innerHTML = restocks.length
    ? restocks.map((item) => {
      const product = sourceProducts.find((candidate) => candidate.id === item.productId);
      const productName = product?.name || item.productName;
      const productReference = product?.sku || `Product ${item.productId}`;
      const waitlistCount = waitlistCounts[String(item.productId)] ?? item.waitlistCount;
      return `<article><div><span class="restock-index">${String(item.id).slice(-2)}</span><div><strong>${escapeHtml(productName)}</strong><small>${escapeHtml(productReference)} · ${item.expectedAt ? `Expected ${escapeHtml(formatCommerceDate(item.expectedAt))}` : "Arrival date not recorded"}</small></div></div><span><b class="restock-state">${escapeHtml(item.status)}</b><small>${waitlistCount === null || waitlistCount === undefined ? "Audience unavailable" : `${formatNumber(waitlistCount)} waiting`}</small></span></article>`;
    }).join("")
    : `<div class="operations-empty"><strong>${inventoryOperations?.bridgeAvailable === false ? "Restock sync unavailable" : "No active restocks"}</strong><span>${inventoryOperations?.bridgeAvailable === false ? "The Operations Bridge update is required to read the live restock program." : "Incoming inventory will appear here."}</span></div>`;
  const waitlistProductMap = new Map<number, {
    product: CommerceProduct | undefined;
    restock: InventoryOperationsPayload["restocks"][number] | undefined;
  }>();
  for (const restock of restocks) {
    waitlistProductMap.set(restock.productId, {
      product: sourceProducts.find((item) => item.id === restock.productId),
      restock,
    });
  }
  for (const product of out) {
    if (!waitlistProductMap.has(product.id)) waitlistProductMap.set(product.id, { product, restock: restockByProduct.get(product.id) });
  }
  const waitlistProducts = [...waitlistProductMap.values()];
  requiredElement<HTMLElement>("#waitlist-overview-list").innerHTML = waitlistProducts.length
    ? waitlistProducts.map(({ product, restock }) => {
      const productId = product?.id || restock?.productId || 0;
      const waitlistCount = waitlistCounts[String(productId)] ?? restock?.waitlistCount;
      return `<button class="waitlist-product-row" type="button" data-view-waitlist="${productId}"><span>${product?.thumbnailUrl || product?.imageUrl ? `<img src="${escapeHtml(product.thumbnailUrl || product.imageUrl || "")}" alt="" loading="lazy" />` : escapeHtml((product?.name || restock?.productName || "P").charAt(0))}</span><div><strong>${escapeHtml(product?.name || restock?.productName || "Product")}</strong><small>${escapeHtml(product?.sku || (restock?.productId ? `Product ${restock.productId}` : "Subscriber list"))}</small></div><b>${waitlistCount === null || waitlistCount === undefined ? "Unavailable" : `${formatNumber(waitlistCount)} waiting`}</b><i>→</i></button>`;
    }).join("")
    : '<div class="operations-empty"><strong>No active waitlists</strong><span>Products with back-in-stock demand will appear here.</span></div>';
  renderSkuStockLedger();
}

async function loadInventoryOperations(force = false): Promise<void> {
  if (inventoryOperationsLoading || (inventoryOperations && !force)) return;
  inventoryOperationsLoading = true;
  renderInventoryOperations();
  try {
    const response = await fetch("/api/inventory-operations", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.restocks) || !Array.isArray(payload.lots)) throw new Error("Inventory operations are unavailable");
    inventoryOperations = payload as unknown as InventoryOperationsPayload;
  } catch {
    inventoryOperations = {
      restocks: [],
      products: commerceData?.products || [],
      lots: extensionsData?.coas?.filter((coa) => coa.status === "Available") || [],
      waitlistCounts: {},
      bridgeAvailable: false,
      lotAssignmentsAvailable: Boolean(extensionsData?.coaWriteEnabled),
      syncedAt: new Date().toISOString(),
    };
  } finally {
    inventoryOperationsLoading = false;
    renderInventoryOperations();
  }
}

function renderLotAssignmentDrawer(): void {
  const target = lotAssignmentTarget;
  if (!target) return;
  const candidates = exactInventoryLots(target.productId, target.variationId);
  const current = candidates.find((coa) => coa.currentShippingLot);
  lotAssignmentTargetElement.innerHTML = `<span>LOT</span><div><strong>${escapeHtml(target.label)}</strong><small>${escapeHtml(target.sku || `Product ${target.productId}`)}${target.strength && target.strength !== "—" ? ` · ${escapeHtml(target.strength)}` : ""}</small></div><b>${current ? "Active lot" : "Needs assignment"}</b>`;
  lotAssignmentOptions.innerHTML = candidates.length
    ? candidates.map((coa, index) => {
      const checked = current ? coa.id === current.id : index === 0;
      const perUnit = Math.max(0, Number(coa.testingCostPerUnit || 0));
      const testing = perUnit
        ? `${formatCurrency(coa.testingCostTotal || 0)} test ÷ ${formatNumber(coa.batchUnitCount || 0)} units`
        : "Testing expense not recorded";
      return `<label class="lot-assignment-option"><input type="radio" name="inventoryShippingLot" value="${escapeHtml(coa.id)}" data-lot-revision="${Math.max(0, Number(coa.revision || 0))}"${checked ? " checked" : ""} /><span><div><strong>${escapeHtml(coa.lot || coa.batch || coa.coaNumber)}</strong><small>${escapeHtml(coa.coaNumber)} · Tested ${escapeHtml(coa.date || "date not recorded")}</small></div><em>${perUnit ? `${escapeHtml(formatCurrency(perUnit))} / unit` : "No allocation"}<small>${escapeHtml(testing)}</small></em></span></label>`;
    }).join("")
    : `<div class="lot-assignment-empty"><span>!</span><strong>No Available lot is mapped to this exact item.</strong><p>Upload or open a COA, map it to this product${target.variationId ? " and exact variation" : ""}, record its testing cost and approve it. It will then appear here.</p></div>`;
  lotAssignmentSave.disabled = lotAssignmentBusy || !candidates.length || !workspaceSession?.permissions.operate;
  lotAssignmentOpenCoa.textContent = candidates.length ? "Manage COAs" : "Upload or map a COA";
  lotAssignmentSave.textContent = lotAssignmentBusy ? "Assigning safely…" : current ? "Confirm shipping lot" : "Use selected lot";
}

function openLotAssignment(productId: number, variationId: number): void {
  const product = (inventoryOperations?.products || commerceData?.products || []).find((item) => item.id === productId);
  if (!product) {
    showToast("Product unavailable", "Refresh inventory and try again.", false);
    return;
  }
  const variation = variationId ? skuStockDetails.get(productId)?.variations.find((item) => item.id === variationId) : undefined;
  if (variationId && !variation) {
    showToast("Presentation unavailable", "Expand the product again and retry the exact variation.", false);
    return;
  }
  const strength = variation ? stockStrength(variation.attributes) : stockStrength(product.attributes);
  const variationLabel = variation?.attributes.map((attribute) => attribute.option).filter(Boolean).join(" · ");
  lotAssignmentTarget = {
    productId,
    variationId,
    label: variation ? `${product.name} · ${variationLabel || `Variation ${variation.id}`}` : product.name,
    sku: variation?.sku || product.sku,
    strength,
  };
  lotAssignmentBusy = false;
  requiredElement<HTMLElement>("#lot-assignment-title").textContent = exactInventoryLots(productId, variationId).some((coa) => coa.currentShippingLot)
    ? "Change shipping lot"
    : "Assign shipping lot";
  renderLotAssignmentDrawer();
  lotAssignmentDrawer.hidden = false;
  lotAssignmentBackdrop.hidden = false;
  document.body.classList.add("drawer-open");
  lotAssignmentDrawer.querySelector<HTMLInputElement>('input[name="inventoryShippingLot"]:checked')?.focus();
}

function closeLotAssignment(): void {
  lotAssignmentDrawer.hidden = true;
  lotAssignmentBackdrop.hidden = true;
  lotAssignmentTarget = null;
  lotAssignmentBusy = false;
  document.body.classList.remove("drawer-open");
}

async function saveLotAssignment(): Promise<void> {
  if (!lotAssignmentTarget || lotAssignmentBusy) return;
  const selected = lotAssignmentForm.querySelector<HTMLInputElement>('input[name="inventoryShippingLot"]:checked');
  if (!selected) {
    showToast("Choose a lot", "Select the exact Available batch that is being shipped.", false);
    return;
  }
  lotAssignmentBusy = true;
  renderLotAssignmentDrawer();
  try {
    const response = await fetch("/api/inventory-operations/current-lot", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        certificateId: selected.value,
        productId: lotAssignmentTarget.productId,
        variationId: lotAssignmentTarget.variationId,
        expectedRevision: Number(selected.dataset.lotRevision) || 0,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.lots)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The shipping lot could not be assigned");
    }
    const lots = payload.lots as CommerceCoa[];
    if (inventoryOperations) inventoryOperations.lots = lots;
    if (extensionsData) {
      const publishedById = new Map(lots.map((coa) => [coa.id, coa]));
      const preserved = extensionsData.coas.map((coa) => publishedById.get(coa.id) || coa);
      const knownIds = new Set(preserved.map((coa) => coa.id));
      extensionsData.coas = [...preserved, ...lots.filter((coa) => !knownIds.has(coa.id))];
    }
    const selectedLot = lots.find((coa) => coa.id === selected.value);
    closeLotAssignment();
    await loadCommerce();
    if (inventoryOperations && commerceData) inventoryOperations.products = commerceData.products;
    renderInventoryOperations();
    renderLabelWorkspace(false);
    showToast(
      "Shipping lot assigned",
      `${selectedLot?.lot || selectedLot?.batch || "The selected lot"} is now the planning lot. Fulfillment will still preserve the exact scanned vial lot.`,
    );
  } catch (error) {
    showToast("Unable to assign the lot", error instanceof Error ? error.message : "Refresh inventory and try again.", false);
  } finally {
    lotAssignmentBusy = false;
    if (!lotAssignmentDrawer.hidden) renderLotAssignmentDrawer();
  }
}

function renderMediaLibrary(): void {
  const media = commerceData?.media || [];
  const search = mediaSearch.trim().toLocaleLowerCase("en");
  const visible = media.filter((item) => !search || `${item.name} ${item.alt} ${(item.productNames || []).join(" ")}`.toLocaleLowerCase("en").includes(search));
  const products = commerceData?.products || [];
  const covered = products.filter((product) => product.images.length > 0).length;
  requiredElement<HTMLElement>("#media-count").textContent = formatNumber(media.length);
  requiredElement<HTMLElement>("#media-coverage").textContent = `${products.length ? Math.round((covered / products.length) * 100) : 0}%`;
  requiredElement<HTMLElement>("#media-grid").innerHTML = visible.length
    ? visible.map((item) => `<article class="media-card"><div class="media-card-image"><img src="${escapeHtml(item.thumbnailUrl || item.src)}" data-fallback-src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || item.name)}" loading="lazy" decoding="async" /></div><div><strong>${escapeHtml(item.name)}</strong><small>${item.productIds?.length || 0} product${item.productIds?.length === 1 ? "" : "s"}</small></div><button type="button" data-media-open-product="${item.productIds?.[0] || ""}"${item.productIds?.length ? "" : " disabled"}>View use</button></article>`).join("")
    : '<div class="media-empty"><span>▧</span><strong>No media matches your search.</strong><p>Product images will appear here automatically.</p></div>';
}

function renderCommerce(): void {
  if (!commerceData) return;
  const commerceNotice = requiredElement<HTMLElement>("#commerce-notice");
  const integrationState = requiredElement<HTMLElement>("#catalog-integration-state");
  if (!commerceData.connected) {
    commerceNotice.hidden = false;
    requiredElement<HTMLElement>("#commerce-notice-message").textContent = commerceData.message || "Complete the connection to continue.";
    integrationState.textContent = commerceData.mode === "not_configured" ? "Connection required" : "Unavailable";
    integrationState.className = "integration-state";
  } else {
    commerceNotice.hidden = true;
    integrationState.textContent = commerceData.mode === "read_write"
      ? "Connected · read/write"
      : "Connected · read only";
    integrationState.className = "integration-state integration-state--connected";
  }
  const syncLabel = document.querySelector<HTMLElement>("#catalog-sync-label");
  if (syncLabel) {
    syncLabel.textContent = commerceData.refreshing
      ? "Refreshing in background"
      : commerceData.cacheAgeSeconds && commerceData.cacheAgeSeconds > 5
        ? `Ready · cached ${commerceData.cacheAgeSeconds}s ago`
        : "Live catalog ready";
  }

  const orders = commerceData.orders;
  renderOverviewFinancials();
  requiredElement<HTMLElement>("#orders-nav-count").textContent = formatNumber(
    orders.filter((order) => order.status === "processing").length,
  );
  renderOrders();
  renderProducts();
  renderLabelWorkspace(false);
  renderMediaLibrary();
  if (extensionsData?.siteControls) renderSiteControls();
}

async function loadCommerce(): Promise<void> {
  try {
    const response = await fetch("/api/commerce", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("Invalid commerce response");
    commerceData = payload as CommercePayload;
  } catch {
    commerceData = {
      connected: false,
      mode: "unavailable",
      message: "The live catalog could not be reached at this time.",
      products: [],
      orders: [],
      media: [],
    };
  }
  renderCommerce();
  if (latestSnapshot) renderMarketing(latestSnapshot);
}

function directProductLocation(productId: number, variationId = 0): ProductLocation | undefined {
  return fulfillmentLocations?.locations.find((location) =>
    location.productId === productId && location.variationId === variationId);
}

function effectiveProductLocation(productId: number, variationId = 0): {
  location: ProductLocation | undefined;
  inherited: boolean;
} {
  const direct = directProductLocation(productId, variationId);
  if (direct || variationId === 0) return { location: direct, inherited: false };
  return { location: directProductLocation(productId, 0), inherited: true };
}

function labelVariation(variationId = selectedLabelVariationId): CommerceVariation | undefined {
  return labelProductDetail?.variations.find((variation) => variation.id === variationId);
}

function renderLabelMetrics(): void {
  const products = commerceData?.products || [];
  const productLocations = fulfillmentLocations?.locations.filter((location) => location.variationId === 0) || [];
  const variationLocations = fulfillmentLocations?.locations.filter((location) => location.variationId > 0) || [];
  const locatedProductIds = new Set(productLocations.map((location) => location.productId));
  const currentBatches = (extensionsData?.coas || []).filter((coa) => coa.currentShippingLot).length;
  const ready = products.filter((product) => product.sku.trim() && locatedProductIds.has(product.id)).length;
  requiredElement<HTMLElement>("#label-products-located").textContent = formatNumber(
    products.filter((product) => locatedProductIds.has(product.id)).length,
  );
  requiredElement<HTMLElement>("#label-variations-located").textContent = formatNumber(variationLocations.length);
  requiredElement<HTMLElement>("#label-current-batches").textContent = formatNumber(currentBatches);
  requiredElement<HTMLElement>("#label-ready-count").textContent = formatNumber(ready);
  requiredElement<HTMLElement>("#labels-nav-count").textContent = formatNumber(ready);
}

function labelStockCopy(product: CommerceProduct): { label: string; tone: "good" | "warning" | "danger" | "neutral" } {
  if (product.stockQuantity !== null) {
    if (product.stockQuantity <= 0) return { label: "Out of stock", tone: "danger" };
    if (product.stockQuantity < 5) return { label: `${formatNumber(product.stockQuantity)} in stock`, tone: "warning" };
    return { label: `${formatNumber(product.stockQuantity)} in stock`, tone: "good" };
  }
  if (product.stockStatus === "outofstock") return { label: "Out of stock", tone: "danger" };
  if (product.stockStatus === "instock") return { label: "Available", tone: "good" };
  return { label: product.stockStatus || "Stock not reported", tone: "neutral" };
}

function labelStockRank(product: CommerceProduct): number {
  if (product.stockQuantity !== null) return product.stockQuantity;
  return product.stockStatus === "outofstock" ? 0 : Number.MAX_SAFE_INTEGER;
}

function syncLabelCategoryFilter(products: CommerceProduct[]): void {
  const select = requiredElement<HTMLSelectElement>("#label-category-filter");
  const categories = [...new Set(products.map((product) => product.category.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  if (labelProductCategory !== "all" && !categories.includes(labelProductCategory)) labelProductCategory = "all";
  select.innerHTML = '<option value="all">All categories</option>' + categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  select.value = labelProductCategory;
}

function renderLabelProductList(): void {
  const container = requiredElement<HTMLElement>("#label-product-list");
  container.classList.toggle("is-grid", labelProductView === "grid");
  container.classList.toggle("is-list", labelProductView === "list");
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-label-product-view]")) {
    const active = button.dataset.labelProductView === labelProductView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const catalog = commerceData?.products || [];
  syncLabelCategoryFilter(catalog);
  const search = labelProductSearch.trim().toLocaleLowerCase("en");
  const matchingProducts = catalog.filter((product) => {
    const matchesSearch = !search || `${product.name} ${product.sku} ${product.category}`.toLocaleLowerCase("en").includes(search);
    const matchesCategory = labelProductCategory === "all" || product.category === labelProductCategory;
    return matchesSearch && matchesCategory;
  }).sort((left, right) => {
    if (labelProductSort === "stock-low") return labelStockRank(left) - labelStockRank(right) || left.name.localeCompare(right.name, "en");
    if (labelProductSort === "location") {
      const registered = fulfillmentLocations?.registeredLabels || [];
      const leftReady = registered.some((record) => record.productId === left.id && record.type !== "batch") ? 0 : 1;
      const rightReady = registered.some((record) => record.productId === right.id && record.type !== "batch") ? 0 : 1;
      return leftReady - rightReady || left.name.localeCompare(right.name, "en");
    }
    return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
  });
  const products = matchingProducts.slice(0, 48);
  requiredElement<HTMLElement>("#label-catalog-count").textContent = `${formatNumber(catalog.length)} products`;
  requiredElement<HTMLElement>("#label-catalog-result").textContent = matchingProducts.length > products.length
    ? `${formatNumber(matchingProducts.length)} matches · showing first ${products.length}`
    : `${formatNumber(matchingProducts.length)} ${matchingProducts.length === 1 ? "match" : "matches"}`;
  if (!commerceData) {
    container.innerHTML = '<div class="label-skeleton-grid" aria-label="Loading products"><i></i><i></i><i></i><i></i></div>';
    return;
  }
  if (!products.length) {
    container.innerHTML = '<div class="label-empty-panel"><span>⌕</span><strong>No matching products</strong><p>Try another product name, SKU or category.</p></div>';
    return;
  }
  container.innerHTML = products.map((product) => {
    const registered = Boolean(fulfillmentLocations?.registeredLabels.some((record) =>
      record.productId === product.id && record.type !== "batch"));
    const image = product.thumbnailUrl || product.imageUrl;
    const stock = labelStockCopy(product);
    const selected = product.id === selectedLabelProductId;
    const media = image
      ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />`
      : "P1";
    return `<button class="label-product-item${selected ? " is-active" : ""}" type="button" data-label-product="${product.id}" aria-pressed="${selected}" aria-label="Select ${escapeHtml(product.name)}">
      <span class="label-product-thumb">${media}</span>
      <span class="label-product-copy"><span><strong>${escapeHtml(product.name)}</strong>${selected ? '<i aria-hidden="true">✓</i>' : ""}</span><small>SKU ${escapeHtml(product.sku || "required")}</small></span>
      <span class="label-product-meta"><span>${escapeHtml(product.category || "Uncategorized")}</span>${product.variationIds.length ? `<span>${product.variationIds.length} variant${product.variationIds.length === 1 ? "" : "s"}</span>` : ""}</span>
      <span class="label-product-footer"><em class="is-${stock.tone}">${escapeHtml(stock.label)}</em><b class="label-location-chip${registered ? "" : " is-missing"}">${registered ? "Barcode registered" : "Ready to generate"}</b></span>
    </button>`;
  }).join("");
}

function renderLocationProductList(): void {
  const container = requiredElement<HTMLElement>("#label-location-product-list");
  const search = locationProductSearch.trim().toLocaleLowerCase("en");
  const matchingProducts = (commerceData?.products || []).filter((product) => {
    const assigned = Boolean(directProductLocation(product.id));
    const matchesFilter = labelLocationFilter === "all" || (labelLocationFilter === "assigned" ? assigned : !assigned);
    return matchesFilter && (!search || `${product.name} ${product.sku} ${product.category}`.toLocaleLowerCase("en").includes(search));
  }).sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
  const products = matchingProducts.slice(0, 80);
  requiredElement<HTMLElement>("#label-location-catalog-count").textContent = matchingProducts.length > products.length
    ? `${formatNumber(matchingProducts.length)} · first ${products.length}`
    : formatNumber(matchingProducts.length);
  if (!commerceData) {
    container.innerHTML = '<div class="label-skeleton-list" aria-label="Loading locations"><i></i><i></i><i></i></div>';
    return;
  }
  if (!products.length) {
    container.innerHTML = '<div class="label-empty-panel"><span>⌕</span><strong>No products found</strong><p>Search by product name or SKU.</p></div>';
    return;
  }
  container.innerHTML = products.map((product) => {
    const location = directProductLocation(product.id);
    const image = product.thumbnailUrl || product.imageUrl;
    const stock = labelStockCopy(product);
    return `<button class="location-browser-item${product.id === selectedLocationProductId ? " is-active" : ""}" type="button" data-location-product="${product.id}">
      <span>${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />` : "P1"}</span>
      <div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || "SKU required")} · ${escapeHtml(stock.label)}</small></div>
      <b class="label-location-chip${location ? "" : " is-missing"}">${escapeHtml(location?.locationCode || "UNSET")}</b>
    </button>`;
  }).join("");
}

function registeredLabelProduct(record: BarcodeRegistryRecord): CommerceProduct | undefined {
  return commerceData?.products.find((product) => product.id === record.productId);
}

function renderRegisteredLabels(): void {
  const container = requiredElement<HTMLElement>("#registered-label-list");
  const labels = fulfillmentLocations?.registeredLabels || [];
  const canPrint = Boolean(fulfillmentLocations?.configured && fulfillmentLocations.permissions.printLabels);
  const search = labelHistorySearch.trim().toLocaleLowerCase("en");
  const matching = labels.filter((record) => {
    const product = registeredLabelProduct(record);
    const matchesType = labelHistoryType === "all" || record.type === labelHistoryType;
    const matchesSearch = !search || [
      record.barcodeValue,
      record.type,
      record.lot || "",
      record.coaId || "",
      product?.name || "",
      product?.sku || "",
    ].join(" ").toLocaleLowerCase("en").includes(search);
    return matchesType && matchesSearch;
  }).sort((left, right) => {
    if (labelHistorySort === "product") {
      return (registeredLabelProduct(left)?.name || "").localeCompare(registeredLabelProduct(right)?.name || "", "en", { sensitivity: "base" });
    }
    const comparison = (left.createdAt || "").localeCompare(right.createdAt || "");
    return labelHistorySort === "oldest" ? comparison : -comparison;
  });
  requiredElement<HTMLElement>("#label-history-count").textContent = matching.length === labels.length
    ? `${formatNumber(labels.length)} registered`
    : `${formatNumber(matching.length)} of ${formatNumber(labels.length)}`;
  if (!fulfillmentLocations) {
    container.innerHTML = '<div class="label-skeleton-list" aria-label="Loading registered labels"><i></i><i></i><i></i></div>';
    return;
  }
  if (!matching.length) {
    container.innerHTML = labels.length
      ? '<div class="label-empty-panel"><span>⌕</span><strong>No registered labels match</strong><p>Try a product, SKU, lot or barcode identifier.</p></div>'
      : '<div class="label-empty-panel"><span>03</span><strong>No labels registered yet</strong><p>Generate the first label from Print Labels. This view will show real registered identities only.</p></div>';
    return;
  }
  container.innerHTML = matching.map((record) => {
    const product = registeredLabelProduct(record);
    const image = product?.thumbnailUrl || product?.imageUrl;
    const detail = record.type === "batch"
      ? record.lot || "Batch"
      : record.type === "variation"
        ? `Variation #${record.variationId}`
        : "Base product";
    return `<article class="registered-label-row">
      <div class="registered-label-product"><span>${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />` : "P1"}</span><div><strong>${escapeHtml(product?.name || `Product #${record.productId}`)}</strong><small>${escapeHtml(product?.sku || `Product ID ${record.productId}`)}</small></div></div>
      <div class="registered-label-summary"><span class="registered-label-type is-${escapeHtml(record.type)}">${escapeHtml(record.type === "batch" ? "Batch / COA" : record.type.charAt(0).toUpperCase() + record.type.slice(1))}</span><strong>${escapeHtml(detail)}</strong><small>Registered ${escapeHtml(formatCommerceTimestamp(record.createdAt))}</small><details class="registered-label-details"><summary>Show barcode number</summary><code>${escapeHtml(record.barcodeValue)}</code></details></div>
      <button class="button button--secondary" type="button" data-reprint-label="${escapeHtml(record.barcodeValue)}" ${canPrint ? "" : "disabled"}>${canPrint ? "Reprint" : "View only"}</button>
    </article>`;
  }).join("");
}

function locationEditorRow(input: {
  name: string;
  sku: string;
  productId: number;
  variationId: number;
}): string {
  const direct = directProductLocation(input.productId, input.variationId);
  const effective = effectiveProductLocation(input.productId, input.variationId);
  const canManage = Boolean(fulfillmentLocations?.permissions.manageLocations);
  const inherited = !direct && effective.location && input.variationId > 0
    ? `Inherited ${effective.location.locationCode}`
    : "A-01";
  return `<div class="location-row" data-location-row data-product-id="${input.productId}" data-variation-id="${input.variationId}">
    <div class="location-row-identity"><strong>${escapeHtml(input.name)}</strong><span>${escapeHtml(input.sku || "SKU required")}${input.variationId === 0 ? " · Base product" : ""}</span></div>
    <label class="location-field"><input data-location-input type="text" maxlength="20" value="${escapeHtml(direct?.locationCode || "")}" placeholder="${escapeHtml(inherited)}" aria-label="Storage location for ${escapeHtml(input.name)}" ${canManage ? "" : "disabled"} /><span>${direct ? "DIRECT" : effective.location ? "INHERITED" : "SHELF"}</span></label>
    <div class="location-row-actions"><button type="button" data-save-location ${canManage ? "" : "disabled"}>Save</button><button class="is-remove" type="button" data-remove-location ${canManage && direct ? "" : "disabled"}>Clear</button></div>
  </div>`;
}

function renderLocationEditor(): void {
  const editor = requiredElement<HTMLElement>("#label-location-editor");
  const selected = requiredElement<HTMLElement>("#location-selected-product");
  const detail = locationProductDetail;
  if (!detail) {
    selected.innerHTML = '<span>◇</span><div><small>NO PRODUCT SELECTED</small><strong>Choose a product from the list</strong><p>Only that product and its variations will be editable.</p></div>';
    editor.innerHTML = '<div class="label-empty-panel"><span>2</span><strong>Select a catalog item</strong><p>Start with the product list. Its primary shelf and optional variation overrides will appear here.</p></div>';
    return;
  }
  const product = detail.product;
  const image = product.thumbnailUrl || product.imageUrl;
  selected.innerHTML = `<span>${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />` : "P1"}</span><div><small>SELECTED PRODUCT</small><strong>${escapeHtml(product.name)}</strong><p>${escapeHtml(product.sku || "SKU required")} · ${detail.variations.length} variation${detail.variations.length === 1 ? "" : "s"}</p></div>`;
  const primaryRow = locationEditorRow({
    name: product.name,
    sku: product.sku,
    productId: product.id,
    variationId: 0,
  });
  const variationRows = detail.variations.map((variation) => locationEditorRow({
    name: variation.attributes.map((attribute) => attribute.option).filter(Boolean).join(" · ") || `Variation ${variation.id}`,
    sku: variation.sku,
    productId: product.id,
    variationId: variation.id,
  })).join("");
  const overrides = variationRows
    ? `<details class="location-variation-overrides"><summary><span>Variation locations</span><small>Optional · ${detail.variations.length} variation${detail.variations.length === 1 ? "" : "s"}</small></summary>${variationRows}</details>`
    : "";
  editor.innerHTML = `<div class="location-editor-intro"><div><h3>Primary shelf</h3><p>Enter a simple code such as A-01. Variations use this shelf automatically unless you add an override.</p></div><code>A-01</code></div>${primaryRow}${overrides}`;
}

function renderLabelPrintStep(): void {
  const order: Array<"product" | "details" | "preview"> = ["product", "details", "preview"];
  const activeIndex = order.indexOf(labelPrintStep);
  for (const panel of document.querySelectorAll<HTMLElement>("[data-label-print-step]")) {
    panel.hidden = panel.dataset.labelPrintStep !== labelPrintStep;
  }
  for (const indicator of document.querySelectorAll<HTMLElement>("[data-label-step-indicator]")) {
    const index = order.indexOf(indicator.dataset.labelStepIndicator as typeof order[number]);
    indicator.classList.toggle("is-active", index === activeIndex);
    indicator.classList.toggle("is-complete", index < activeIndex);
    indicator.setAttribute("aria-current", index === activeIndex ? "step" : "false");
  }
}

function renderLocationStep(): void {
  const editing = selectedLocationProductId !== null;
  document.querySelector<HTMLElement>(".label-location-simple")?.classList.toggle("is-editing", editing);
  for (const panel of document.querySelectorAll<HTMLElement>("[data-location-step]")) {
    panel.hidden = false;
  }
}

function clearBarcodePreview(): void {
  activeBarcodeLabel = null;
  requiredElement<HTMLElement>("#thermal-label-stage").innerHTML = '<div class="label-empty-panel"><span>3</span><strong>Your label will appear here</strong><p>Choose an item and generate the preview. No stock or order data will change.</p></div>';
  requiredElement<HTMLButtonElement>("#copy-barcode-token").disabled = true;
  requiredElement<HTMLButtonElement>("#print-barcode-label").disabled = true;
}

function renderLabelComposer(): void {
  const product = labelProductDetail?.product;
  const variations = labelProductDetail?.variations || [];
  const selected = requiredElement<HTMLElement>("#label-selected-product");
  const typeSelect = requiredElement<HTMLSelectElement>("#label-type-select");
  const variationSelect = requiredElement<HTMLSelectElement>("#label-variation-select");
  const variationField = requiredElement<HTMLElement>("#label-variation-field");
  const batchSelect = requiredElement<HTMLSelectElement>("#label-batch-select");
  const batchField = requiredElement<HTMLElement>("#label-batch-field");
  if (selectedLabelType === "variation" && variations.length === 0) selectedLabelType = "product";
  if (selectedLabelType === "batch") selectedLabelType = variations.length ? "variation" : "product";
  typeSelect.innerHTML = variations.length
    ? '<option value="variation">Exact variation</option>'
    : '<option value="product">Product</option>';
  typeSelect.value = selectedLabelType;
  typeSelect.disabled = !product;
  if (selectedLabelType === "product") selectedLabelVariationId = 0;
  if (selectedLabelType === "variation" && !variations.some((item) => item.id === selectedLabelVariationId)) {
    selectedLabelVariationId = variations[0]?.id || 0;
  }
  const baseOption = selectedLabelType === "variation" ? "" : '<option value="0">Base product</option>';
  variationSelect.innerHTML = baseOption + variations.map((variation) => {
    const name = variation.attributes.map((attribute) => attribute.option).filter(Boolean).join(" · ") || `Variation ${variation.id}`;
    return `<option value="${variation.id}"${variation.id === selectedLabelVariationId ? " selected" : ""}>${escapeHtml(name)} · ${escapeHtml(variation.sku || "No SKU")}</option>`;
  }).join("");
  variationSelect.value = String(selectedLabelVariationId);
  variationField.hidden = selectedLabelType === "product" || variations.length === 0;
  variationSelect.disabled = !product || selectedLabelType === "product" || (selectedLabelType === "variation" && variations.length === 0);
  batchField.hidden = true;
  batchSelect.innerHTML = '<option value="">Not used for product barcodes</option>';
  batchSelect.value = "";
  const variation = labelVariation();
  const sku = variation?.sku || product?.sku || "";
  const effective = product ? effectiveProductLocation(product.id, selectedLabelVariationId) : { location: undefined, inherited: false };
  if (product) {
    const image = product.thumbnailUrl || product.imageUrl;
    const variationText = variation
      ? variation.attributes.map((attribute) => attribute.option).filter(Boolean).join(" · ")
      : `${variations.length} variation${variations.length === 1 ? "" : "s"}`;
    selected.innerHTML = `<span>${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />` : "P1"}</span><div><small>SELECTED PRODUCT</small><strong>${escapeHtml(product.name)}</strong><p>${escapeHtml(sku || "SKU required")}${variationText ? ` · ${escapeHtml(variationText)}` : ""}</p></div>`;
  } else {
    selected.innerHTML = '<span>◇</span><div><small>NO PRODUCT SELECTED</small><strong>Choose a product above</strong><p>Variation, batch and shelf information will appear here.</p></div>';
  }
  const locationCard = requiredElement<HTMLElement>("#label-effective-location");
  if (!product) {
    locationCard.className = "label-effective-location";
    locationCard.innerHTML = '<span>▤</span><div><small>DRAWER LABEL</small><strong>Select a product</strong><p>The large barcode will identify the exact catalog item.</p></div>';
  } else if (effective.location) {
    locationCard.className = "label-effective-location is-ready";
    locationCard.innerHTML = `<span>▤</span><div><small>DRAWER LABEL</small><strong>${escapeHtml(effective.location.locationCode)}</strong><p>${effective.inherited ? "Uses the base product shelf" : "Shelf code included on the label"}</p></div>`;
  } else {
    locationCard.className = "label-effective-location is-ready";
    locationCard.innerHTML = '<span>▤</span><div><small>DRAWER LABEL</small><strong>Ready without a shelf code</strong><p>The barcode can be printed now and attached to any drawer or bin.</p></div>';
  }
  const canPrint = Boolean(fulfillmentLocations?.configured && fulfillmentLocations.permissions.printLabels);
  const targetValid = selectedLabelType !== "variation" || Boolean(variation);
  const generate = requiredElement<HTMLButtonElement>("#generate-barcode-label");
  generate.disabled = !product || !canPrint || !sku.trim() || !targetValid;
  generate.title = !product ? "Choose a product" : !sku.trim() ? "This record needs an SKU" : !canPrint ? "Operations access and barcode configuration are required" : "Generate a server-validated Code 128 label";
  requiredElement<HTMLElement>("#label-preview-size").textContent = requiredElement<HTMLSelectElement>("#label-size-select").value === "3x1" ? "3 × 1" : "2 × 1";
  const previewCopies = document.querySelector<HTMLElement>("#label-preview-copies");
  const copyCount = Math.max(1, Number(requiredElement<HTMLInputElement>("#label-copy-count").value) || 1);
  if (previewCopies) previewCopies.textContent = `${copyCount} ${copyCount === 1 ? "copy" : "copies"}`;
  const settingsSummary = document.querySelector<HTMLElement>(".label-advanced-settings summary small");
  if (settingsSummary) {
    const size = requiredElement<HTMLSelectElement>("#label-size-select").value === "3x1" ? "3 × 1 inch" : "2 × 1 inch";
    settingsSummary.textContent = `${size} · ${copyCount} ${copyCount === 1 ? "copy" : "copies"}`;
  }
  renderLabelPrintStep();
}

function renderLabelWorkspace(refreshDetail = true): void {
  renderLabelMetrics();
  renderLabelProductList();
  renderLocationProductList();
  renderRegisteredLabels();
  const state = requiredElement<HTMLElement>("#label-service-state");
  const ready = Boolean(fulfillmentLocations && !fulfillmentLocations.error && fulfillmentLocations.configured);
  state.className = `label-service-state${ready ? " is-ready" : fulfillmentLocations?.error ? " is-error" : ""}`;
  const serviceCopy = fulfillmentLocationsLoading
    ? "Refreshing barcode data"
    : ready
      ? "Barcode printing ready"
      : fulfillmentLocations?.error || "Barcode service unavailable";
  state.querySelector<HTMLElement>("b")!.textContent = serviceCopy;
  state.dataset.state = fulfillmentLocationsLoading ? "connecting" : ready ? "ready" : fulfillmentLocations?.error ? "error" : "unavailable";
  state.title = serviceCopy;
  const contextService = document.querySelector<HTMLElement>("#label-context-service");
  if (contextService) {
    contextService.className = `label-context-service${ready ? " is-ready" : fulfillmentLocations?.error ? " is-error" : ""}`;
    contextService.querySelector<HTMLElement>("strong")!.textContent = fulfillmentLocationsLoading
      ? "Connecting…"
      : ready
        ? "Secure barcodes ready"
        : "Service unavailable";
  }
  const previewService = document.querySelector<HTMLElement>("#label-preview-service");
  if (previewService) previewService.textContent = fulfillmentLocationsLoading ? "Connecting" : ready ? "Ready" : "Unavailable";
  const badge = requiredElement<HTMLElement>("#label-admin-badge");
  badge.textContent = fulfillmentLocations?.permissions.manageLocations ? "Location editing enabled" : "View only";
  badge.classList.toggle("is-enabled", Boolean(fulfillmentLocations?.permissions.manageLocations));
  if (refreshDetail) {
    renderLocationEditor();
    renderLabelComposer();
    renderLocationStep();
  }
}

function showLabelWorkspace(next: "print" | "locations" | "history"): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-label-workspace]")) {
    const active = button.dataset.labelWorkspace === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-label-workspace-panel]")) {
    panel.hidden = panel.dataset.labelWorkspacePanel !== next;
  }
  renderLabelWorkspace();
}

async function loadFulfillmentLocations(force = false): Promise<void> {
  if (fulfillmentLocationsLoading) return;
  if (fulfillmentLocations && !force) {
    renderLabelWorkspace();
    return;
  }
  fulfillmentLocationsLoading = true;
  renderLabelWorkspace(false);
  try {
    const response = await fetch("/api/fulfillment/locations", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.locations) || !isRecord(payload.permissions)) {
      throw new Error("Invalid storage location response");
    }
    fulfillmentLocations = payload as unknown as FulfillmentLocationsPayload;
    if (!Array.isArray(fulfillmentLocations.registeredLabels)) {
      fulfillmentLocations.registeredLabels = [];
    }
    if (!response.ok && !fulfillmentLocations.error) {
      fulfillmentLocations.error = "Storage location service unavailable";
    }
  } catch {
    fulfillmentLocations = {
      configured: false,
      locations: [],
      registeredLabels: [],
      permissions: { read: true, printLabels: false, manageLocations: false },
      error: "Storage location service unavailable",
    };
  } finally {
    fulfillmentLocationsLoading = false;
  }
  renderLabelWorkspace();
}

const fulfillmentStatusCopy: Record<FulfillmentQueueEntry["queueStatus"], {
  label: string;
  symbol: string;
  empty: string;
  emptyDetail: string;
}> = {
  waiting: {
    label: "Ready to pick",
    symbol: "✓",
    empty: "No orders are ready right now.",
    emptyDetail: "When an order enters Processing and passes payment and product checks, it will appear here. Its exact COA lot is assigned from the vial QR during picking.",
  },
  active: {
    label: "Picking now",
    symbol: "→",
    empty: "No order is being picked.",
    emptyDetail: "Open a ready order and start picking when you are ready.",
  },
  paused: {
    label: "Paused",
    symbol: "Ⅱ",
    empty: "No orders are paused.",
    emptyDetail: "Paused orders keep every verified scan and can be resumed safely.",
  },
  blocked: {
    label: "Needs attention",
    symbol: "!",
    empty: "Nothing needs attention.",
    emptyDetail: "All visible orders currently satisfy their required safety checks.",
  },
  packed: {
    label: "Packed",
    symbol: "✓",
    empty: "No packed orders yet.",
    emptyDetail: "Orders appear here after quantities and batches are fully verified and packing is confirmed.",
  },
};

const fulfillmentReasonGuidance: Record<string, { title: string; next: string }> = {
  order_not_processing: {
    title: "This order left the picking queue",
    next: "If the status change was intentional, remove this old session from the working queue. Otherwise return the source order to Processing.",
  },
  payment_not_approved: {
    title: "Payment approval is required",
    next: "Review the payment evidence and approve it from the order payment workflow.",
  },
  payment_date_missing: {
    title: "Paid date is missing",
    next: "Confirm payment and make sure the paid timestamp is saved on the source order.",
  },
  order_refunded: {
    title: "This order has a refund",
    next: "Review the refund and confirm the correct items before fulfillment can continue.",
  },
  order_has_no_items: {
    title: "No physical products found",
    next: "Add or restore the physical line items on the source order.",
  },
  invalid_order_line: {
    title: "An order line is incomplete",
    next: "Correct the product, variation or quantity on the affected order line.",
  },
  missing_sku: {
    title: "A product is missing its SKU",
    next: "Assign an SKU to the affected product or variation before scanning.",
  },
  payment_gateway_verification_required: {
    title: "Payment method needs verification",
    next: "Complete the payment-method review for this order, then refresh Fulfillment.",
  },
  payment_method_not_verified: {
    title: "Payment workflow is not verified",
    next: "Verify this payment method before releasing the order for picking.",
  },
  missing_product_mapping: {
    title: "Product mapping is missing",
    next: "Reconnect the order line to its catalog product, then refresh Fulfillment.",
  },
  missing_variation_mapping: {
    title: "Variation mapping is missing",
    next: "Reconnect the order line to the exact purchased variation.",
  },
  source_order_changed: {
    title: "Review the updated order",
    next: "The order changed after picking began. Review its products and quantities before continuing.",
  },
  fulfillment_cancelled: {
    title: "Fulfillment session was cancelled",
    next: "Review the order before creating any new warehouse workflow.",
  },
};

function fulfillmentIssueMarkup(reason: FulfillmentQueueEntry["reasons"][number], compact = false): string {
  const guidance = fulfillmentReasonGuidance[reason.code] || {
    title: "This order cannot continue yet",
    next: "Resolve this requirement in its source record, then refresh Fulfillment.",
  };
  if (compact) {
    return `<div class="fulfillment-card-issue" role="note"><span>!</span><div><strong>${escapeHtml(guidance.title)}</strong><p>${escapeHtml(guidance.next)}</p></div></div>`;
  }
  return `<li><span aria-hidden="true">!</span><div><strong>${escapeHtml(guidance.title)}</strong><p>${escapeHtml(reason.message)}</p><small><b>Next:</b> ${escapeHtml(guidance.next)}</small></div></li>`;
}

function fulfillmentOrderProductPreview(order: FulfillmentQueueEntry): string {
  const first = order.lines[0];
  if (!first) {
    return '<div class="fulfillment-order-product"><span class="fulfillment-image-placeholder">P1</span><div><strong>No product preview</strong><small>Open the order for details</small></div></div>';
  }
  const extra = Math.max(0, order.itemCount - 1);
  return `<div class="fulfillment-order-product">
    <span class="fulfillment-order-product-image">${first.imageUrl ? `<img src="${escapeHtml(first.imageUrl)}" alt="" loading="lazy" />` : "P1"}</span>
    <div><strong>${escapeHtml(first.name)}</strong><small>${first.quantity} unit${first.quantity === 1 ? "" : "s"}${extra ? ` · +${extra} more product${extra === 1 ? "" : "s"}` : ""}</small></div>
  </div>`;
}

function selectedFulfillmentOrder(): FulfillmentQueueEntry | undefined {
  return fulfillmentQueue?.orders.find((order) => order.orderId === selectedFulfillmentOrderId);
}

function pickingProgressPercent(order: FulfillmentQueueEntry): number {
  return order.unitCount > 0 ? Math.min(100, Math.round((order.verifiedUnits / order.unitCount) * 100)) : 0;
}

function pickingFeedbackMarkup(): string {
  if (fulfillmentScanBusy && !fulfillmentScanFeedback) {
    return '<div class="picking-feedback is-reading" role="status"><span class="picking-feedback-icon">···</span><div><strong>Checking scanned code</strong><p>Verifying the exact product, variation, COA requirements and live order.</p></div></div>';
  }
  if (!fulfillmentScanFeedback) {
    return '<div class="picking-feedback is-idle" role="status"><span class="picking-feedback-icon">⌁</span><div><strong>Ready for the first item</strong><p>Scan the lab QR when the vial has one, or use the registered Phase One item code printed for products without a QR.</p></div></div>';
  }
  const feedback = fulfillmentScanFeedback;
  const mismatch = !feedback.accepted && ["wrong_product", "wrong_variation"].includes(feedback.reasonCode);
  const mismatchMarkup = mismatch
    ? `<div class="picking-mismatch-comparison"><span><small>SCANNED VIAL</small><strong>${escapeHtml(feedback.scannedProductName || "Different product")}</strong>${feedback.scannedSku ? `<b>SKU ${escapeHtml(feedback.scannedSku)}</b>` : ""}</span><i aria-hidden="true">≠</i><span><small>ORDER REQUIRES</small><strong>${escapeHtml(feedback.expectedProductName || "Review order item")}</strong>${feedback.expectedSku ? `<b>SKU ${escapeHtml(feedback.expectedSku)}</b>` : ""}</span></div><em class="picking-mismatch-action">Put this vial aside and scan the product shown in the order. Nothing was added.</em>`
    : "";
  return `<div class="picking-feedback ${feedback.accepted ? "is-accepted" : "is-rejected"}" role="status" aria-live="assertive">
    <span class="picking-feedback-icon">${feedback.accepted ? "✓" : "!"}</span>
    <div><small>${feedback.accepted ? (feedback.lot ? "VIAL VERIFIED" : "PRODUCT VERIFIED") : mismatch ? "WRONG PRODUCT — NOT ADDED" : "CODE NOT ACCEPTED"}</small><strong>${escapeHtml(mismatch ? "This item does not match the order" : feedback.productName || (feedback.accepted ? "Product verified" : "Check this code"))}</strong><p>${escapeHtml(feedback.message)}</p>${mismatchMarkup}${feedback.accepted && feedback.requiredQuantity ? `<b>${feedback.verifiedQuantity} of ${feedback.requiredQuantity} verified</b>` : ""}</div>
  </div>`;
}

function renderPickingStation(order: FulfillmentQueueEntry): string {
  const session = order.session!;
  const percent = pickingProgressPercent(order);
  const complete = order.unitCount > 0 && order.verifiedUnits >= order.unitCount;
  const orderedLines = [...order.lines].sort((left, right) => {
    const leftComplete = left.verifiedQuantity >= left.quantity ? 1 : 0;
    const rightComplete = right.verifiedQuantity >= right.quantity ? 1 : 0;
    return leftComplete - rightComplete;
  });
  const nextLine = orderedLines.find((line) => line.verifiedQuantity < line.quantity) || orderedLines[0];
  const cards = orderedLines.map((line) => {
    const lineComplete = line.verifiedQuantity >= line.quantity;
    const isNext = !complete && nextLine?.orderItemId === line.orderItemId;
    const remaining = Math.max(0, line.quantity - line.verifiedQuantity);
    const capturedLots = line.verifiedLots.length
      ? line.verifiedLots.map((allocation) => `${allocation.lot} × ${allocation.quantity}`).join(" · ")
      : "Scan the required code";
    return `<article class="picking-product-card${lineComplete ? " is-complete" : ""}${isNext ? " is-next" : ""}" data-picking-line="${line.orderItemId}">
      <div class="picking-product-image">${line.imageUrl ? `<img src="${escapeHtml(line.imageUrl)}" alt="" />` : '<span>P1</span>'}<i>${lineComplete ? "✓" : remaining}</i></div>
      <div class="picking-product-copy"><div class="picking-product-state">${lineComplete ? "VERIFIED" : isNext ? "PICK THIS NOW" : "UP NEXT"}</div><h3>${escapeHtml(line.name)}</h3><p>SKU ${escapeHtml(line.sku)}${line.variationId ? ` · Variation ${line.variationId}` : ""}</p><div class="picking-product-tags"><span>Verification <b>${escapeHtml(capturedLots)}</b></span><span>Scan <b>item code</b></span></div></div>
      <div class="picking-location"><small>VERIFY WITH</small><strong>Item code</strong><span>Vial QR or product barcode</span></div>
      <div class="picking-quantity"><small>VERIFIED</small><strong>${line.verifiedQuantity}<span>/ ${line.quantity}</span></strong><p>${lineComplete ? "Complete" : `${remaining} remaining`}</p></div>
    </article>`;
  }).join("");
  const controls = complete
    ? `<div class="packing-ready-action"><div><strong>Everything matches the order</strong><p>Review once, then save the permanent Packed record.</p></div><button class="button button--primary" type="button" data-open-packing-confirm>Review &amp; confirm packing</button></div>`
    : `<div class="picking-controls">
      <div class="picking-scanner-state"><span></span><div><strong>${fulfillmentScanBusy ? "Verifying scan…" : "Scanner ready"}</strong><small>Camera, Zebra, USB or Bluetooth HID</small></div></div>
      <button class="picking-camera-launch" type="button" data-open-picking-camera>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.4 4.5 9.6 3h4.8l1.2 1.5H19A2.5 2.5 0 0 1 21.5 7v10A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V7A2.5 2.5 0 0 1 5 4.5h3.4Z"/><circle cx="12" cy="12" r="4"/></svg>
        <span><strong>Scan with Camera</strong><small>iPhone or Android</small></span>
      </button>
      <form class="picking-scan-form" id="picking-scan-form">
        <label for="picking-scan-input">Vial QR or product barcode</label>
        <div><span>⌁</span><input id="picking-scan-input" name="barcode" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" maxlength="2048" placeholder="Scan QR, barcode or paste a COA link" aria-describedby="picking-scan-help" /><button class="button button--primary" type="submit">${fulfillmentScanBusy ? "Queue scan" : "Verify"}</button></div>
        <small id="picking-scan-help">USB/Bluetooth scanners submit with Enter. The lab website is not opened during picking.</small>
      </form>
      <div class="picking-control-actions"><button type="button" class="picking-sound-toggle" data-picking-sound aria-pressed="${fulfillmentScanSound}">${fulfillmentScanSound ? "Sound on" : "Sound off"}</button><button class="button button--secondary" type="button" data-pause-fulfillment="${escapeHtml(session.id)}" data-version="${session.version}">Pause</button></div>
    </div>`;
  return `<section class="picking-station${complete ? " is-complete" : ""}">
    <header class="picking-station-head">
      <div><p class="section-kicker">Picking station · Order #${escapeHtml(order.orderNumber)}</p><h2>${complete ? "Ready for packing" : `Pick ${escapeHtml(nextLine?.name || "the next item")}`}</h2><p>${complete ? "Every required unit has been verified." : "Scan the code on the item or drawer. Products with an Available COA still require the QR printed on the vial."}</p></div>
      <div class="picking-order-progress" aria-label="${percent}% complete"><strong>${percent}%</strong><span>${order.verifiedUnits} of ${order.unitCount} units</span><div><i style="--fulfillment-progress:${percent / 100}"></i></div></div>
    </header>
    ${complete ? '<div class="picking-ready-banner"><span>✓</span><div><strong>Picking complete</strong><p>The exact vial lots are saved and will be assigned to the customer order when packing is confirmed.</p></div></div>' : pickingFeedbackMarkup()}
    <div class="picking-product-list">${cards}</div>
    ${controls}
    ${complete ? "" : '<p class="picking-limitation"><span>i</span> Lab QR scans capture the exact lot. Products using a printed Phase One label can be verified directly with that registered item code.</p>'}
  </section>`;
}

function packingSnapshotFromSession(order: FulfillmentQueueEntry): FulfillmentPackingSnapshot | null {
  const value = order.session?.completionSnapshot;
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.lines)) return null;
  if (
    Number(value.orderId) !== order.orderId || typeof value.orderNumber !== "string" ||
    typeof value.confirmedAt !== "string" || typeof value.packedBy !== "string"
  ) return null;
  return value as unknown as FulfillmentPackingSnapshot;
}

function phaseOneShippingCarrier(capabilities: ShippingCapabilitiesPayload) {
  return capabilities.carriers.find((carrier) =>
    carrier.code.trim().toLowerCase() === PHASE_ONE_SHIPPING_POLICY.carrierCode &&
    carrier.packages.some((item) => item.code === PHASE_ONE_SHIPPING_POLICY.packageCode && item.domestic)
  ) || null;
}

function initialShippingState(): FulfillmentShippingUiState {
  return {
    loading: true,
    rateLoading: false,
    labelBusy: false,
    label: null,
    printUrl: null,
    selectedCarrierId: "",
    selectedRateIndex: null,
    package: {
      weightOz: 16,
      lengthIn: 8,
      widthIn: 6,
      heightIn: 4,
      packageCode: PHASE_ONE_SHIPPING_POLICY.packageCode,
      packageName: PHASE_ONE_SHIPPING_POLICY.packageName,
    },
    labelAttemptId: null,
    error: null,
  };
}

function shippingWorkspaceMarkup(order: FulfillmentQueueEntry, state: FulfillmentShippingUiState): string {
  const fulfillmentId = order.session!.id;
  if (state.loading) {
    return `<section class="shipping-workspace is-loading" aria-busy="true"><div class="shipping-loading-mark"><span></span></div><div><p class="section-kicker">Shipping</p><h3>Preparing the shipping workspace…</h3><p>Checking the protected carrier connection and any existing label record.</p></div></section>`;
  }
  if (state.label) {
    const label = state.label;
    if (label.state === "voided") {
      const syncWarning = label.wordpressSyncState === "failed"
        ? `<div class="shipping-sync-warning"><span>!</span><div><strong>Source order sync needs attention</strong><p>${escapeHtml(label.wordpressSyncMessage || "The voided tracking could not be removed from the source order.")}</p></div><button class="button button--secondary" type="button" data-sync-shipping-label>Retry sync</button></div>`
        : "";
      return `<section class="shipping-workspace shipping-label-state is-voided" data-fulfillment-id="${escapeHtml(fulfillmentId)}">
        <div class="shipping-flow-rail"><span class="is-done"><i>✓</i><b>Packed</b></span><em></em><span class="is-done"><i>✓</i><b>Label created</b></span><em></em><span class="is-current"><i>×</i><b>Voided</b></span></div>
        <div class="shipping-state-card"><span>×</span><div><p class="section-kicker">Label voided</p><h3>This postage label can no longer be used</h3><p>${escapeHtml(label.failureMessage || "ShipStation accepted the void request.")}</p><small>Refund timing is controlled by the carrier. A new rate can be purchased only through a new reviewed workflow.</small></div></div>
        ${syncWarning}
      </section>`;
    }
    if (label.state !== "label_ready") {
      const uncertain = label.state === "purchase_unknown" || label.state === "purchase_pending";
      const title = label.state === "failed"
        ? "The label was not created"
        : label.state === "purchase_pending"
          ? "Finishing the label request"
          : "The result needs verification";
      const message = label.failureMessage || (uncertain
        ? "The system will verify the existing request before allowing another attempt."
        : "Nothing was charged. Review the service and try again when ready.");
      return `<section class="shipping-workspace shipping-label-state is-${escapeHtml(label.state)}" data-fulfillment-id="${escapeHtml(fulfillmentId)}">
        <div class="shipping-flow-rail"><span class="is-done"><i>✓</i><b>Packed</b></span><em></em><span class="is-done"><i>✓</i><b>Service chosen</b></span><em></em><span class="is-current"><i>${uncertain ? "…" : "!"}</i><b>${uncertain ? "Checking label" : "Needs attention"}</b></span></div>
        <div class="shipping-state-card"><span>${uncertain ? "↻" : "!"}</span><div><p class="section-kicker">Protected shipping request</p><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${uncertain ? "<small>Do not submit another purchase. The same request will be reconciled safely.</small>" : `<small>${label.providerMode === "mock" ? "This simulated attempt failed before completion." : "ShipStation rejected the request before a label was completed."} Selecting another rate is safe.</small>`}</div></div>
        <div class="shipping-label-actions">${uncertain
          ? `<button class="button button--primary" type="button" data-reconcile-shipping${state.labelBusy ? " disabled" : ""}>${state.labelBusy ? "Checking safely…" : "Check existing request"}</button>`
          : '<button class="button button--secondary" type="button" data-retry-shipping>Choose another service</button>'}</div>
      </section>`;
    }
    const live = label.providerMode === "live";
    const syncWarning = live && label.wordpressSyncState === "failed"
      ? `<div class="shipping-sync-warning"><span>!</span><div><strong>Label purchased, source order not updated</strong><p>${escapeHtml(label.wordpressSyncMessage || "Tracking could not be written to the source order.")}</p></div><button class="button button--secondary" type="button" data-sync-shipping-label>Retry sync</button></div>`
      : live && label.wordpressSyncState === "synced"
        ? '<div class="shipping-sync-success"><span>✓</span><p>Tracking and shipment details are safely linked to the source order.</p></div>'
        : "";
    return `<section class="shipping-workspace shipping-label-ready" data-fulfillment-id="${escapeHtml(fulfillmentId)}">
      <div class="shipping-flow-rail"><span class="is-done"><i>✓</i><b>Packed</b></span><em></em><span class="is-done"><i>✓</i><b>Rate selected</b></span><em></em><span class="is-current"><i>✓</i><b>${live ? "Postage purchased" : "Test label"}</b></span></div>
      <div class="shipping-label-card${live ? " is-live" : ""}"><div class="shipping-label-icon">4×6</div><div><p class="section-kicker">${live ? "Shipping label ready" : "Test label ready"}</p><h3>${escapeHtml(label.carrierName)} · ${escapeHtml(label.serviceName)}</h3><p>${formatCurrency(label.amount, label.currency)} · ${escapeHtml(label.trackingNumber || "Tracking pending")}</p><small>Saved once · ${label.printCount} print${label.printCount === 1 ? "" : "s"} · Reprinting never purchases another label.</small></div><span>${live ? "POSTAGE PAID" : "TEST ONLY"}</span></div>
      ${syncWarning}
      <div class="shipping-label-actions"><div><strong>Ready for the thermal printer</strong><small>${live ? "This PDF is the purchased carrier label." : "No postage was purchased and the live order was not changed."}</small></div><div class="shipping-label-buttons"><button class="button button--primary" type="button" data-print-shipping-label="${escapeHtml(state.printUrl || "")}">${label.printCount > 0 ? "Reprint" : "Open & print"} 4×6 label</button>${live ? '<button class="button button--danger" type="button" data-review-void-label>Void label</button>' : ""}</div></div>
    </section>`;
  }
  const capabilities = state.capabilities;
  if (!capabilities?.rateShoppingAvailable) {
    return `<section class="shipping-workspace shipping-connection-blocked" data-fulfillment-id="${escapeHtml(fulfillmentId)}">
      <div class="shipping-flow-rail"><span class="is-done"><i>✓</i><b>Packed</b></span><em></em><span class="is-current"><i>2</i><b>Connect carriers</b></span><em></em><span><i>3</i><b>Label</b></span></div>
      <div class="shipping-connection-message"><span>!</span><div><p class="section-kicker">Shipping connection</p><h3>${capabilities?.credentialConfigured ? "Connection needs attention" : "Server credential required"}</h3><p>${escapeHtml(state.error || capabilities?.error || "ShipStation rate shopping is not available yet.")}</p><small>The credential stays on the server. It is never sent to this browser.</small></div></div>
      <button class="button button--secondary" type="button" data-refresh-shipping>Check connection again</button>
    </section>`;
  }
  const modeLabel = capabilities.dataMode === "live" ? "Live carrier rates" : "Test rates";
  const purchaseUnlocked = capabilities.labelPurchaseMode === "live_enabled";
  const selectedCarrier = phaseOneShippingCarrier(capabilities);
  const selectedPackage = selectedCarrier?.packages.find((item) =>
    item.code === PHASE_ONE_SHIPPING_POLICY.packageCode && item.domestic
  ) || null;
  const policyReady = Boolean(selectedCarrier && selectedPackage);
  const oneRateSelected = true;
  const destination = state.rates?.destination;
  const rateCards = state.rates?.rates.length
    ? `<div class="shipping-rate-list">${state.rates.rates.map((rate, index) => {
      const selected = state.selectedRateIndex === index;
      const delivery = rate.deliveryDays === null
        ? "Delivery estimate unavailable"
        : `${rate.deliveryDays} business day${rate.deliveryDays === 1 ? "" : "s"}`;
      const displayName = oneRateSelected && !/one\s*rate/i.test(rate.serviceName)
        ? `${rate.serviceName} One Rate`
        : rate.serviceName;
      const packageDetail = selectedPackage ? ` · ${selectedPackage.name}` : "";
      return `<button class="shipping-rate-card${selected ? " is-selected" : ""}" type="button" data-select-shipping-rate="${index}" aria-pressed="${selected}"><span class="shipping-carrier-mark">${escapeHtml(rate.carrierName.slice(0, 3).toUpperCase())}</span><span><strong>${escapeHtml(displayName)}</strong><small>${escapeHtml(rate.carrierName)} · ${escapeHtml(delivery + packageDetail)}</small></span><b>${formatCurrency(rate.amount, rate.currency)}</b><i>${selected ? "✓" : "Select"}</i></button>`;
    }).join("")}</div>`
    : state.rates
      ? '<div class="shipping-empty-rates"><span>!</span><strong>FedEx One Rate Pak is unavailable</strong><p>Confirm this service is enabled on the connected FedEx account and try again.</p></div>'
      : "";
  const selectedRate = state.selectedRateIndex === null
    ? null
    : state.rates?.rates[state.selectedRateIndex] || null;
  return `<section class="shipping-workspace" data-fulfillment-id="${escapeHtml(fulfillmentId)}">
    <div class="shipping-flow-rail"><span class="is-done"><i>✓</i><b>Packed</b></span><em></em><span class="is-current"><i>2</i><b>Choose shipping</b></span><em></em><span><i>3</i><b>${capabilities.dataMode === "live" ? "Purchase label" : "Test label"}</b></span></div>
    <header class="shipping-workspace-head"><div><p class="section-kicker">Shipping · ${escapeHtml(modeLabel)}</p><h3>FedEx One Rate Pak</h3><p>The approved warehouse service is locked in, so the worker only confirms the package weight and purchases the exact rate.</p></div><span class="shipping-mode is-${capabilities.dataMode}">${capabilities.dataMode === "live" ? "CONNECTED" : "SAFE TEST MODE"}</span></header>
    ${capabilities.dataMode === "mock"
      ? '<div class="shipping-test-banner"><span>i</span><p><strong>Test environment</strong> Carrier names, prices and label purchase are simulated. Nothing is sent to ShipStation.</p></div>'
      : purchaseUnlocked
        ? '<div class="shipping-test-banner is-purchase-live"><span>!</span><p><strong>Live postage enabled</strong> The displayed total is a persistent carrier quote. Final confirmation will charge the connected account and create one real label.</p></div>'
        : '<div class="shipping-test-banner is-live"><span>✓</span><p><strong>Live rates, purchase locked</strong> Prices come from connected carriers, but the server safety flag prevents every label charge.</p></div>'}
    <form class="shipping-rate-form" id="shipping-rate-form">
      <label class="shipping-carrier-field"><span>Carrier</span><select name="carrierId"${policyReady ? "" : " disabled"}><option value="${escapeHtml(selectedCarrier?.id || "")}" selected>FedEx</option></select><small>Only the approved carrier · ${escapeHtml(capabilities.originName || "Origin ready")}</small></label>
      <label class="shipping-package-field"><span>Package type</span><select name="packageCode"${policyReady ? "" : " disabled"}><option value="${PHASE_ONE_SHIPPING_POLICY.packageCode}" selected>${PHASE_ONE_SHIPPING_POLICY.packageName}</option></select><small>Only FedEx One Rate Pak is enabled for fulfillment</small></label>
      <fieldset class="is-carrier-package"><legend>Package</legend><label><span>Weight</span><div><input name="weightOz" type="number" min="0.1" max="2400" step="0.1" value="${state.package.weightOz}" required><b>oz</b></div></label><div class="shipping-carrier-package-note"><strong>${PHASE_ONE_SHIPPING_POLICY.packageName}</strong><small>FedEx supplies the Pak dimensions automatically.</small></div></fieldset>
      <button class="button button--primary" type="submit"${state.rateLoading || !policyReady ? " disabled" : ""}>${state.rateLoading ? "Loading One Rate…" : "Load One Rate"}</button>
    </form>
    ${destination ? `<div class="shipping-destination"><span>SHIP TO</span><strong>${escapeHtml(destination.city)}, ${escapeHtml(destination.state)} ${escapeHtml(destination.postalCode)}</strong><small>${escapeHtml(destination.countryCode)} · Address remains sourced from the order</small></div>` : ""}
    ${state.error ? `<p class="shipping-error" role="alert"><span>!</span>${escapeHtml(state.error)}</p>` : ""}
    ${rateCards}
    ${selectedRate ? `<div class="shipping-purchase-review"><div><p class="section-kicker">Approved service</p><h4>${PHASE_ONE_SHIPPING_POLICY.serviceName}</h4><p>${formatCurrency(selectedRate.amount, selectedRate.currency)}${selectedRate.isEstimate ? " estimated" : " final quoted total"} · ${PHASE_ONE_SHIPPING_POLICY.packageName} · 4×6 PDF</p></div><div class="shipping-purchase-safety${purchaseUnlocked ? " is-live" : ""}"><span>${capabilities.dataMode === "mock" ? "TEST" : purchaseUnlocked ? "LIVE" : "LOCKED"}</span><p>${capabilities.dataMode === "mock" ? "Creates a local test label only. No postage or source order is changed." : purchaseUnlocked ? "Explicit confirmation purchases this exact rate once and writes tracking back safely." : "Live purchase is disabled on the server. Ask an administrator to complete the launch checklist."}</p></div><button class="button button--primary" type="button" ${capabilities.dataMode === "mock" ? "data-generate-shipping-label" : purchaseUnlocked ? "data-review-live-label" : "disabled"}${state.labelBusy ? " disabled" : ""}>${state.labelBusy ? "Processing safely…" : capabilities.dataMode === "mock" ? "Generate test label" : purchaseUnlocked ? `Review & purchase ${formatCurrency(selectedRate.amount, selectedRate.currency)}` : "Purchase locked"}</button></div>` : ""}
  </section>`;
}

function renderFulfillmentShipping(order: FulfillmentQueueEntry): void {
  const target = document.querySelector<HTMLElement>("#fulfillment-shipping-workspace");
  if (!target || !order.session) return;
  const state = fulfillmentShippingStates.get(order.session.id) || initialShippingState();
  target.innerHTML = shippingWorkspaceMarkup(order, state);
}

async function loadFulfillmentShipping(order: FulfillmentQueueEntry, force = false): Promise<void> {
  const fulfillmentId = order.session?.id;
  if (!fulfillmentId) return;
  const existing = fulfillmentShippingStates.get(fulfillmentId);
  if (existing && !force) {
    renderFulfillmentShipping(order);
    return;
  }
  const state = existing || initialShippingState();
  state.loading = true;
  state.error = null;
  fulfillmentShippingStates.set(fulfillmentId, state);
  renderFulfillmentShipping(order);
  try {
    const [capabilityResponse, labelResponse] = await Promise.all([
      fetch("/api/shipping/capabilities", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }),
      fetch(`/api/shipping/label?fulfillmentId=${encodeURIComponent(fulfillmentId)}`, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }),
    ]);
    const capabilities: unknown = await capabilityResponse.json();
    const labelPayload: unknown = await labelResponse.json();
    if (!capabilityResponse.ok || !isRecord(capabilities) || !Array.isArray(capabilities.carriers)) {
      throw new Error(isRecord(capabilities) && typeof capabilities.error === "string"
        ? capabilities.error
        : "The carrier connection could not be checked.");
    }
    if (!labelResponse.ok || !isRecord(labelPayload)) {
      throw new Error(isRecord(labelPayload) && typeof labelPayload.error === "string"
        ? labelPayload.error
        : "The shipping record could not be loaded.");
    }
    state.capabilities = capabilities as unknown as ShippingCapabilitiesPayload;
    const policyCarrier = phaseOneShippingCarrier(state.capabilities);
    if (policyCarrier) {
      state.selectedCarrierId = policyCarrier.id;
      state.package.packageCode = PHASE_ONE_SHIPPING_POLICY.packageCode;
      state.package.packageName = PHASE_ONE_SHIPPING_POLICY.packageName;
    } else if (!state.label) {
      state.error = "FedEx One Rate Pak is not enabled on the connected ShipStation account.";
    }
    state.label = isRecord(labelPayload.label)
      ? labelPayload.label as unknown as ShippingLabel
      : null;
    state.printUrl = typeof labelPayload.printUrl === "string" ? labelPayload.printUrl : null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Shipping is temporarily unavailable.";
  } finally {
    state.loading = false;
    if (selectedFulfillmentOrder()?.session?.id === fulfillmentId) renderFulfillmentShipping(order);
  }
}

async function compareShippingRates(): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  const form = document.querySelector<HTMLFormElement>("#shipping-rate-form");
  if (!order || !fulfillmentId || !form) return;
  const state = fulfillmentShippingStates.get(fulfillmentId);
  if (!state?.capabilities || state.rateLoading) return;
  const data = new FormData(form);
  const packageCarrier = phaseOneShippingCarrier(state.capabilities);
  const packageDefinition = packageCarrier?.packages.find(
    (item) => item.code === PHASE_ONE_SHIPPING_POLICY.packageCode && item.domestic,
  ) || null;
  if (!packageCarrier || !packageDefinition) {
    state.error = "FedEx One Rate Pak is not enabled on the connected ShipStation account.";
    renderFulfillmentShipping(order);
    return;
  }
  state.package = {
    weightOz: Number(data.get("weightOz")),
    lengthIn: state.package.lengthIn,
    widthIn: state.package.widthIn,
    heightIn: state.package.heightIn,
    packageCode: PHASE_ONE_SHIPPING_POLICY.packageCode,
    packageName: PHASE_ONE_SHIPPING_POLICY.packageName,
  };
  state.selectedCarrierId = packageCarrier.id;
  const carrierIds = [packageCarrier.id];
  state.rateLoading = true;
  state.error = null;
  state.selectedRateIndex = null;
  renderFulfillmentShipping(order);
  try {
    const response = await fetch("/api/shipping/rates", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId, carrierIds, package: state.package }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.rates)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "Rates could not be retrieved.");
    }
    state.rates = payload as unknown as ShippingRatesPayload;
    state.selectedRateIndex = state.rates.rates.length === 1 ? 0 : null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Rates could not be retrieved.";
  } finally {
    state.rateLoading = false;
    renderFulfillmentShipping(order);
  }
}

async function generateShippingLabel(): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  if (!order || !fulfillmentId) return;
  const state = fulfillmentShippingStates.get(fulfillmentId);
  const selectedRate = state?.selectedRateIndex === null || state?.selectedRateIndex === undefined
    ? null
    : state.rates?.rates[state.selectedRateIndex] || null;
  if (!state || !selectedRate || state.labelBusy) return;
  state.labelBusy = true;
  state.error = null;
  state.labelAttemptId ||= crypto.randomUUID();
  renderFulfillmentShipping(order);
  try {
    const response = await fetch("/api/shipping/label", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        fulfillmentId,
        clientEventId: state.labelAttemptId,
        quoteToken: selectedRate.quoteToken,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.label)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "The shipping label could not be generated.");
    }
    state.label = payload.label as unknown as ShippingLabel;
    state.printUrl = typeof payload.printUrl === "string" ? payload.printUrl : null;
    if (state.label.state === "label_ready" || state.label.state === "failed") {
      state.labelAttemptId = null;
    }
    showToast(
      state.label.state === "label_ready"
        ? state.label.providerMode === "live" ? "Shipping label purchased" : "Test label generated"
        : state.label.state === "failed"
          ? "No label was created"
          : "Shipping request saved",
      state.label.state === "label_ready"
        ? state.label.providerMode === "live"
          ? "The 4×6 label is ready and the tracking sync was recorded."
          : "No postage was purchased and the live order was not changed."
        : state.label.state === "failed"
          ? state.label.failureMessage || "Choose another service and try again."
          : "The request is protected from duplicate submission.",
    );
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The shipping label could not be generated.";
  } finally {
    state.labelBusy = false;
    renderFulfillmentShipping(order);
  }
}

function closeShippingConfirmation(): void {
  requiredElement<HTMLElement>("#shipping-confirm-dialog").hidden = true;
  requiredElement<HTMLButtonElement>("#shipping-confirm-backdrop").hidden = true;
  document.body.classList.remove("has-shipping-confirm");
  shippingConfirmationAction = null;
}

function openShippingConfirmation(action: "purchase" | "void"): void {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  const state = fulfillmentId ? fulfillmentShippingStates.get(fulfillmentId) : undefined;
  const rate = state?.selectedRateIndex === null || state?.selectedRateIndex === undefined
    ? null
    : state.rates?.rates[state.selectedRateIndex] || null;
  if (!order || !state || (action === "purchase" && !rate) || (action === "void" && !state.label)) return;
  shippingConfirmationAction = action;
  const isVoid = action === "void";
  requiredElement<HTMLElement>("#shipping-confirm-icon").textContent = isVoid ? "×" : "$";
  requiredElement<HTMLElement>("#shipping-confirm-eyebrow").textContent = isVoid ? "Carrier refund request" : "Live postage";
  requiredElement<HTMLElement>("#shipping-confirm-title").textContent = isVoid ? "Void this shipping label?" : `Purchase label for order #${order.orderNumber}?`;
  requiredElement<HTMLElement>("#shipping-confirm-description").textContent = isVoid
    ? "A voided label cannot be restored. The carrier decides whether and when the postage is refunded."
    : "Review the exact carrier service and total. Confirmation creates one real 4×6 label.";
  requiredElement<HTMLElement>("#shipping-confirm-summary").innerHTML = isVoid
    ? `<strong>${escapeHtml(state.label!.carrierName)} · ${escapeHtml(state.label!.serviceName)}</strong><b>${formatCurrency(state.label!.amount, state.label!.currency)}</b><small>Tracking ${escapeHtml(state.label!.trackingNumber || "Unavailable")}</small>`
    : `<strong>${escapeHtml(rate!.carrierName)} · ${escapeHtml(rate!.serviceName)}</strong><b>${formatCurrency(rate!.amount, rate!.currency)}</b><small>Final quoted total · 4×6 PDF · one protected purchase</small>`;
  const safety = requiredElement<HTMLElement>("#shipping-confirm-safety");
  safety.classList.toggle("is-danger", isVoid);
  safety.innerHTML = isVoid
    ? "<span>!</span><p>This submits a real carrier void request. It does not cancel the customer order or confirm a refund.</p>"
    : "<span>!</span><p>This can charge the connected shipping account. Retries use the same durable request ID and cannot silently purchase a second label.</p>";
  const error = requiredElement<HTMLElement>("#shipping-confirm-error");
  error.hidden = true;
  error.textContent = "";
  const submit = requiredElement<HTMLButtonElement>("#shipping-confirm-submit");
  submit.textContent = isVoid ? "Void label" : `Purchase ${formatCurrency(rate!.amount, rate!.currency)}`;
  submit.classList.toggle("button--danger", isVoid);
  submit.classList.toggle("button--primary", !isVoid);
  requiredElement<HTMLElement>("#shipping-confirm-dialog").hidden = false;
  requiredElement<HTMLButtonElement>("#shipping-confirm-backdrop").hidden = false;
  document.body.classList.add("has-shipping-confirm");
  window.setTimeout(() => submit.focus(), 0);
}

async function synchronizeShippingLabel(): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  const state = fulfillmentId ? fulfillmentShippingStates.get(fulfillmentId) : undefined;
  if (!order || !fulfillmentId || !state?.label || state.labelBusy) return;
  state.labelBusy = true;
  state.error = null;
  renderFulfillmentShipping(order);
  try {
    const response = await fetch("/api/shipping/label/sync", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.label)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Tracking could not be synchronized.");
    }
    state.label = payload.label as unknown as ShippingLabel;
    showToast("Source order synchronized", state.label.wordpressSyncMessage || "Tracking is linked to the source order.");
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Tracking could not be synchronized.";
  } finally {
    state.labelBusy = false;
    renderFulfillmentShipping(order);
  }
}

async function voidShippingLabel(): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  const state = fulfillmentId ? fulfillmentShippingStates.get(fulfillmentId) : undefined;
  if (!order || !fulfillmentId || !state?.label || state.labelBusy) return;
  state.labelBusy = true;
  state.error = null;
  renderFulfillmentShipping(order);
  try {
    const response = await fetch("/api/shipping/label/void", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId, confirmation: "VOID" }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.label)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The label could not be voided.");
    }
    state.label = payload.label as unknown as ShippingLabel;
    state.printUrl = null;
    showToast("Label voided", "The carrier accepted the void request. Refund timing remains subject to carrier policy.");
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The label could not be voided.";
  } finally {
    state.labelBusy = false;
    renderFulfillmentShipping(order);
  }
}

async function reconcileShippingLabel(): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  if (!order || !fulfillmentId) return;
  const state = fulfillmentShippingStates.get(fulfillmentId);
  if (!state?.label || state.labelBusy) return;
  state.labelBusy = true;
  state.error = null;
  renderFulfillmentShipping(order);
  try {
    const response = await fetch("/api/shipping/label/reconcile", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.label)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "The existing label request could not be checked.");
    }
    state.label = payload.label as unknown as ShippingLabel;
    state.printUrl = typeof payload.printUrl === "string" ? payload.printUrl : null;
    showToast(
      state.label.state === "label_ready"
        ? "Label recovered safely"
        : state.label.state === "failed"
          ? "No label was created"
          : "No duplicate request sent",
      state.label.state === "label_ready"
        ? "The existing label was found and is ready to print."
        : state.label.state === "failed"
          ? state.label.failureMessage || "Choose another service and try again."
          : "The original request remains protected while its outcome is uncertain.",
    );
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The label request could not be checked.";
  } finally {
    state.labelBusy = false;
    renderFulfillmentShipping(order);
  }
}

function initialEvidenceState(): FulfillmentEvidenceUiState {
  return { loading: true, busyKind: null, confirming: false, notifying: false, error: null };
}

function evidenceFileFor(
  workspace: FulfillmentEvidenceWorkspace | undefined,
  kind: FulfillmentEvidenceKind,
): FulfillmentEvidenceFile | undefined {
  return workspace?.files.find((file) => file.kind === kind);
}

function evidenceSlotMarkup(
  state: FulfillmentEvidenceUiState,
  kind: FulfillmentEvidenceKind,
  step: number,
): string {
  const file = evidenceFileFor(state.workspace, kind);
  const busy = state.busyKind === kind;
  const confirmed = state.workspace?.state === "confirmed";
  const title = kind === "contents" ? "Packed contents" : "Sealed package & label";
  const help = kind === "contents"
    ? "Show every vial and the packing material before closing the box."
    : "Show the closed package with the shipping label clearly visible.";
  if (file) {
    return `<article class="evidence-capture-card is-complete${busy ? " is-busy" : ""}">
      <div class="evidence-photo-preview"><img src="${escapeHtml(file.contentUrl)}&v=${encodeURIComponent(file.sha256.slice(0, 10))}" alt="${escapeHtml(title)} evidence" /><span aria-hidden="true">✓</span></div>
      <div class="evidence-capture-copy"><p><i>${step}</i><small>PHOTO ${step} · SAVED</small></p><h4>${escapeHtml(title)}</h4><span>${escapeHtml(help)}</span><b>${Math.max(1, Math.round(file.bytes / 1024))} KB · Encrypted</b></div>
      ${confirmed ? '<span class="evidence-lock-state">LOCKED</span>' : `<div class="evidence-capture-actions"><label class="button button--secondary${busy ? " is-disabled" : ""}">${busy ? "Saving…" : "Retake"}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-evidence-file="${kind}"${busy ? " disabled" : ""}></label><button type="button" data-remove-evidence="${escapeHtml(file.id)}"${busy ? " disabled" : ""}>Remove</button></div>`}
    </article>`;
  }
  return `<article class="evidence-capture-card${busy ? " is-busy" : ""}">
    <div class="evidence-empty-photo" aria-hidden="true"><span>${kind === "contents" ? "▦" : "▱"}</span></div>
    <div class="evidence-capture-copy"><p><i>${step}</i><small>PHOTO ${step} · CHOOSE ONE</small></p><h4>${escapeHtml(title)}</h4><span>${escapeHtml(help)}</span></div>
    <label class="evidence-capture-button${busy ? " is-disabled" : ""}"><span aria-hidden="true">${busy ? "···" : "+"}</span><b>${busy ? "Securing photo…" : "Take photo"}</b><small>Camera or photo library</small><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-evidence-file="${kind}"${busy ? " disabled" : ""}></label>
  </article>`;
}

function evidenceWorkspaceMarkup(order: FulfillmentQueueEntry, state: FulfillmentEvidenceUiState): string {
  if (state.loading) {
    return `<section class="packaging-evidence is-loading" aria-busy="true"><span class="evidence-loading-mark"></span><div><p class="section-kicker">Packaging evidence</p><h3>Opening the secure evidence vault…</h3><p>Your packing record is safe. Loading the guided photo slots.</p></div></section>`;
  }
  if (!state.workspace) {
    return `<section class="packaging-evidence is-error" role="alert"><span>!</span><div><p class="section-kicker">Packaging evidence</p><h3>Evidence is temporarily unavailable</h3><p>${escapeHtml(state.error || "The secure vault could not be opened.")}</p><button class="button button--secondary" type="button" data-refresh-evidence>Try again</button></div></section>`;
  }
  const workspace = state.workspace;
  const contents = evidenceFileFor(workspace, "contents");
  const sealed = evidenceFileFor(workspace, "sealed_label");
  const completed = Number(Boolean(contents)) + Number(Boolean(sealed));
  if (workspace.state === "confirmed") {
    const emailLabel = workspace.notificationState === "sent"
      ? "EMAIL SENT"
      : workspace.notificationState === "queued"
        ? "EMAIL QUEUED"
        : workspace.notificationState === "failed"
          ? "EMAIL FAILED"
          : workspace.notificationState === "uncertain"
            ? "REVIEW EMAIL"
            : "EMAIL DISABLED";
    const retry = workspace.notificationState === "failed" || workspace.notificationState === "queued"
      ? `<button class="evidence-email-retry" type="button" data-retry-evidence-email${state.notifying ? " disabled" : ""}>${state.notifying ? "Sending…" : workspace.notificationState === "queued" ? "Resume email" : "Retry email"}</button>`
      : "";
    return `<section class="packaging-evidence is-confirmed">
      <div class="evidence-confirmed-mark" aria-hidden="true">✓</div>
      <div class="evidence-confirmed-copy"><p class="section-kicker">Packaging evidence · Complete</p><h3>Order protected with verified evidence</h3><p>${workspace.files.length === 1 ? "The required photo is" : "Both photos are"} encrypted, audit-locked and connected to order #${escapeHtml(order.orderNumber)}.</p><small>Confirmed ${escapeHtml(formatCommerceTimestamp(workspace.confirmedAt))} · ${escapeHtml(workspace.notificationMessage)}</small></div>
      <div class="evidence-confirmed-thumbs">${workspace.files.map((file) => `<a href="${escapeHtml(file.contentUrl)}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(file.label)}"><img src="${escapeHtml(file.contentUrl)}&v=${encodeURIComponent(file.sha256.slice(0, 10))}" alt="" /><span>View</span></a>`).join("")}</div>
      <div class="evidence-confirmed-status"><span class="evidence-confirmed-badge">AUDIT LOCKED</span><span class="evidence-email-state is-${workspace.notificationState}">${emailLabel}</span>${retry}</div>
    </section>`;
  }
  const canConfirm = completed >= 1 && !state.busyKind && !state.confirming;
  return `<section class="packaging-evidence">
    <header class="evidence-workspace-head"><div><p class="section-kicker">Packaging evidence</p><h3>One photo to keep the order moving</h3><p>Take either photo to continue. The second slot remains available as optional extra protection.</p></div><div class="evidence-progress" aria-label="${Math.min(completed, 1)} of 1 required photos ready"><strong>${Math.min(completed, 1)}<span>/1</span></strong><small>${completed === 2 ? "+ OPTIONAL SAVED" : "1 REQUIRED"}</small><i style="--evidence-progress:${Math.min(completed, 1)}"></i></div></header>
    <div class="evidence-privacy-note"><span aria-hidden="true">◇</span><p><strong>Private by design</strong> Location metadata is removed in the browser. The optimized photo is encrypted before it is stored.</p></div>
    <div class="evidence-capture-grid">
      ${evidenceSlotMarkup(state, "contents", 1)}
      ${evidenceSlotMarkup(state, "sealed_label", 2)}
    </div>
    ${state.error ? `<p class="evidence-inline-error" role="alert"><span>!</span>${escapeHtml(state.error)}</p>` : ""}
    <footer class="evidence-confirm-bar"><div><span class="${canConfirm ? "is-ready" : ""}">${canConfirm ? "✓" : "0"}</span><p><strong>${canConfirm ? completed === 2 ? "Both photos are ready" : "Required evidence is ready" : "1 photo remaining"}</strong><small>${canConfirm ? completed === 2 ? "Confirm once to lock both photos." : "You can continue now; the other photo is optional." : "Take either guided photo to continue."}</small></p></div><button class="button button--primary" type="button" data-confirm-evidence${canConfirm ? "" : " disabled"}>${state.confirming ? "Locking evidence…" : "Confirm and continue"}</button></footer>
  </section>`;
}

function renderFulfillmentEvidence(order: FulfillmentQueueEntry): void {
  const target = document.querySelector<HTMLElement>("#fulfillment-evidence-workspace");
  if (!target || !order.session) return;
  const state = fulfillmentEvidenceStates.get(order.session.id) || initialEvidenceState();
  target.innerHTML = evidenceWorkspaceMarkup(order, state);
}

async function loadFulfillmentEvidence(order: FulfillmentQueueEntry, force = false): Promise<void> {
  const fulfillmentId = order.session?.id;
  if (!fulfillmentId) return;
  const existing = fulfillmentEvidenceStates.get(fulfillmentId);
  if (existing && !force) {
    renderFulfillmentEvidence(order);
    return;
  }
  const state = existing || initialEvidenceState();
  state.loading = true;
  state.error = null;
  fulfillmentEvidenceStates.set(fulfillmentId, state);
  renderFulfillmentEvidence(order);
  try {
    const response = await fetch(`/api/fulfillment/evidence?fulfillmentId=${encodeURIComponent(fulfillmentId)}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.workspace)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The secure evidence vault could not be opened.");
    }
    state.workspace = payload.workspace as unknown as FulfillmentEvidenceWorkspace;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Packaging evidence is temporarily unavailable.";
  } finally {
    state.loading = false;
    if (selectedFulfillmentOrder()?.session?.id === fulfillmentId) renderFulfillmentEvidence(order);
  }
}

async function optimizeEvidencePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/") || file.size <= 0 || file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG or WebP photo smaller than 12 MB.");
  }
  let source: CanvasImageSource;
  let sourceWidth: number;
  let sourceHeight: number;
  let close: () => void = () => undefined;
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    sourceWidth = bitmap.width;
    sourceHeight = bitmap.height;
    close = () => bitmap.close();
  } else {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    source = image;
    sourceWidth = image.naturalWidth;
    sourceHeight = image.naturalHeight;
    close = () => URL.revokeObjectURL(objectUrl);
  }
  try {
    const scale = Math.min(1, 2200 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not prepare the evidence photo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolveBlob) => canvas.toBlob(resolveBlob, "image/jpeg", 0.86));
    if (!blob) throw new Error("This browser could not prepare the evidence photo.");
    return { blob, width, height };
  } finally {
    close();
  }
}

async function uploadFulfillmentEvidence(kind: FulfillmentEvidenceKind, file: File): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  if (!order || !fulfillmentId) return;
  const state = fulfillmentEvidenceStates.get(fulfillmentId) || initialEvidenceState();
  if (state.busyKind || state.workspace?.state === "confirmed") return;
  state.loading = false;
  state.busyKind = kind;
  state.error = null;
  fulfillmentEvidenceStates.set(fulfillmentId, state);
  renderFulfillmentEvidence(order);
  try {
    const optimized = await optimizeEvidencePhoto(file);
    const query = new URLSearchParams({ fulfillmentId, kind, clientEventId: crypto.randomUUID() });
    const response = await fetch(`/api/fulfillment/evidence/upload?${query.toString()}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": optimized.blob.type,
        Accept: "application/json",
        "X-Evidence-Width": String(optimized.width),
        "X-Evidence-Height": String(optimized.height),
      },
      body: optimized.blob,
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.workspace)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The photo could not be saved.");
    }
    state.workspace = payload.workspace as unknown as FulfillmentEvidenceWorkspace;
    showToast(kind === "contents" ? "Contents photo secured" : "Sealed package photo secured", "The optimized photo is encrypted and attached to this fulfillment.");
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The evidence photo could not be saved.";
  } finally {
    state.busyKind = null;
    renderFulfillmentEvidence(order);
  }
}

async function removeFulfillmentEvidence(evidenceId: string): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  if (!order || !fulfillmentId) return;
  const state = fulfillmentEvidenceStates.get(fulfillmentId);
  const file = state?.workspace?.files.find((item) => item.id === evidenceId);
  if (!state || !file || state.busyKind || state.workspace?.state === "confirmed") return;
  state.busyKind = file.kind;
  state.error = null;
  renderFulfillmentEvidence(order);
  try {
    const response = await fetch("/api/fulfillment/evidence/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId, evidenceId, clientEventId: crypto.randomUUID() }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.workspace)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The photo could not be removed.");
    }
    state.workspace = payload.workspace as unknown as FulfillmentEvidenceWorkspace;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "The evidence photo could not be removed.";
  } finally {
    state.busyKind = null;
    renderFulfillmentEvidence(order);
  }
}

async function confirmFulfillmentEvidence(): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  if (!order || !fulfillmentId) return;
  const state = fulfillmentEvidenceStates.get(fulfillmentId);
  if (!state?.workspace || state.confirming || state.workspace.files.length < 1) return;
  state.confirming = true;
  state.error = null;
  renderFulfillmentEvidence(order);
  try {
    const response = await fetch("/api/fulfillment/evidence/confirm", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId, clientEventId: crypto.randomUUID() }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.workspace)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Evidence could not be confirmed.");
    }
    state.workspace = payload.workspace as unknown as FulfillmentEvidenceWorkspace;
    showToast(
      "Packaging evidence complete",
      `${state.workspace.files.length === 1 ? "The required photo is" : "Both photos are"} encrypted, audit-locked and connected to this order.`,
    );
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Evidence could not be confirmed.";
  } finally {
    state.confirming = false;
    renderFulfillmentEvidence(order);
  }
}

async function retryFulfillmentEvidenceNotification(): Promise<void> {
  const order = selectedFulfillmentOrder();
  const fulfillmentId = order?.session?.id;
  if (!order || !fulfillmentId) return;
  const state = fulfillmentEvidenceStates.get(fulfillmentId);
  if (
    !state?.workspace ||
    state.notifying ||
    !["failed", "queued"].includes(state.workspace.notificationState)
  ) return;
  state.notifying = true;
  state.error = null;
  renderFulfillmentEvidence(order);
  try {
    const response = await fetch("/api/fulfillment/evidence/notify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId, clientEventId: crypto.randomUUID() }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.workspace)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Customer email could not be retried.");
    }
    state.workspace = payload.workspace as unknown as FulfillmentEvidenceWorkspace;
    showToast(
      state.workspace.notificationState === "sent" ? "Evidence email sent" : "Email needs review",
      state.workspace.notificationMessage,
    );
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Customer email could not be retried.";
  } finally {
    state.notifying = false;
    renderFulfillmentEvidence(order);
  }
}

function renderPackedFulfillment(order: FulfillmentQueueEntry): string {
  const snapshot = packingSnapshotFromSession(order);
  const session = order.session!;
  const lines = snapshot?.lines || [];
  const lineMarkup = lines.length
    ? lines.map((line) => {
      const liveLine = order.lines.find((item) => item.orderItemId === line.orderItemId);
      const allocations = line.allocations?.length
        ? line.allocations
        : line.coaId && line.lot
          ? [{
              orderItemId: line.orderItemId,
              coaId: line.coaId,
              coaNumber: line.coaNumber,
              lot: line.lot,
              batch: line.batch,
              quantity: line.verifiedQuantity,
            }]
          : [];
      const allocationMarkup = allocations.length ? allocations
        .map((allocation) => `<small><b>${escapeHtml(allocation.lot)}</b> × ${allocation.quantity}${allocation.coaNumber ? ` · ${escapeHtml(allocation.coaNumber)}` : ""}</small>`)
        .join("") : "<small>Registered product barcode · no COA lot required</small>";
      return `<article class="fulfillment-line">
        <div class="fulfillment-line-image">${liveLine?.imageUrl ? `<img src="${escapeHtml(liveLine.imageUrl)}" alt="" />` : "P1"}</div>
        <div class="fulfillment-line-main"><strong>${escapeHtml(line.name)}</strong><p>SKU ${escapeHtml(line.sku)}${line.variationId ? ` · Variation ${line.variationId}` : ""}</p></div>
        <div class="fulfillment-line-fact fulfillment-line-lots"><span>${allocations.length ? `Customer lot${allocations.length === 1 ? "" : "s"}` : "Verification"}</span><strong>${allocations.length === 1 ? escapeHtml(allocations[0]!.lot) : allocations.length ? `${allocations.length} verified lots` : "Product barcode"}</strong>${allocationMarkup}</div>
        <div class="fulfillment-line-quantity"><span>Packed</span><strong>${line.verifiedQuantity} / ${line.requiredQuantity}</strong></div>
      </article>`;
    }).join("")
    : '<div class="fulfillment-empty is-error"><span>!</span><strong>Packing record unavailable</strong><p>The local session is packed, but its completion snapshot cannot be displayed. The audit record has not been changed.</p></div>';
  const unitCount = snapshot?.totalUnits || order.unitCount;
  const lotCount = lines.reduce((sum, line) => sum + (line.allocations?.length || (line.coaId && line.lot ? 1 : 0)), 0);
  const hasCoaAllocations = lotCount > 0;
  const evidenceState = fulfillmentEvidenceStates.get(session.id) || initialEvidenceState();
  const syncState = session.wordpressSyncState;
  const syncMarkup = !hasCoaAllocations
    ? '<section class="packed-coa-sync is-synced"><span>✓</span><div><strong>Product barcode verification saved</strong><p>These items do not require a customer COA lot assignment.</p></div></section>'
    : syncState === "synced"
    ? '<section class="packed-coa-sync is-synced"><span>✓</span><div><strong>Customer COAs assigned</strong><p>The exact lots scanned from the vials are now attached to this customer order.</p></div></section>'
    : `<section class="packed-coa-sync is-${escapeHtml(syncState)}"><span>!</span><div><strong>${syncState === "failed" ? "Customer COA assignment needs attention" : "Customer COA assignment pending"}</strong><p>${escapeHtml(session.wordpressLastError || "Packing is safe. The scanned lots still need to be mirrored to the order COA record.")}</p></div><button class="button button--secondary" type="button" data-sync-packed-coas${fulfillmentCoaSyncBusy ? " disabled" : ""}>${fulfillmentCoaSyncBusy ? "Checking…" : "Retry assignment"}</button></section>`;
  return `<article class="surface fulfillment-detail-card">
    <header class="fulfillment-detail-head"><div><p class="section-kicker">Order #${escapeHtml(order.orderNumber)}</p><h2>${escapeHtml(order.customer)}</h2><p>Immutable local fulfillment record</p></div><span class="fulfillment-status is-packed">Packed</span></header>
    <section class="packed-record-hero"><span>✓</span><div><strong>Packing confirmed</strong><p>Products, quantities and every required COA batch are preserved below.</p></div><small>${formatCommerceTimestamp(session.packedAt || snapshot?.confirmedAt || null)}</small></section>
    ${syncMarkup}
    <section class="fulfillment-review"><div class="fulfillment-review-title"><div><p class="section-kicker">Packing record</p><h3>${unitCount} verified unit${unitCount === 1 ? "" : "s"}</h3></div><span>${lotCount ? `${lotCount} lot record${lotCount === 1 ? "" : "s"}` : "Product barcode verified"}</span></div>${lineMarkup}</section>
    <p class="packed-record-note"><span>i</span>This is a local Packed status. No live store status or commercial stock was changed.</p>
    <div id="fulfillment-evidence-workspace" class="fulfillment-evidence-host">${evidenceWorkspaceMarkup(order, evidenceState)}</div>
    <div id="fulfillment-shipping-workspace" class="fulfillment-shipping-host"></div>
  </article>`;
}

function renderFulfillmentDetail(order: FulfillmentQueueEntry): void {
  const detail = requiredElement<HTMLElement>("#fulfillment-order-detail");
  requiredElement<HTMLElement>("#fulfillment-detail-context").textContent = `Order #${order.orderNumber}`;
  const canOperate = Boolean(fulfillmentQueue?.permissions.operateQueue);
  const anotherActive = Boolean(
    fulfillmentQueue?.activeSessionId && order.session?.id !== fulfillmentQueue.activeSessionId,
  );
  const canStart = canOperate && ["waiting", "paused"].includes(order.queueStatus) && !anotherActive;
  if (order.queueStatus === "active" && order.session && order.reasons.length === 0) {
    detail.innerHTML = renderPickingStation(order);
    window.setTimeout(() => document.querySelector<HTMLInputElement>("#picking-scan-input")?.focus({ preventScroll: true }), 0);
    return;
  }
  if (order.queueStatus === "packed" && order.session) {
    detail.innerHTML = renderPackedFulfillment(order);
    window.setTimeout(() => {
      void loadFulfillmentEvidence(order);
      void loadFulfillmentShipping(order);
    }, 0);
    return;
  }
  const reasons = order.reasons.length
    ? `<section class="fulfillment-issues" role="alert"><header><span>!</span><div><p class="section-kicker">Action required</p><strong>${order.reasons.length} ${order.reasons.length === 1 ? "item is" : "items are"} blocking this order</strong><p>Nothing can be scanned until every requirement below is resolved.</p></div></header><ul>${order.reasons.map((reason) => fulfillmentIssueMarkup(reason)).join("")}</ul></section>`
    : `<section class="fulfillment-ready-check"><span>✓</span><div><p class="section-kicker">Ready to pick</p><strong>Every required safety check passed</strong><p>Use the lab QR when present. Products with a printed Phase One label can be verified with their registered item code.</p></div></section>`;
  const lines = order.lines.map((line) => {
    const batch = line.coa?.lot || line.coa?.batch || "Not assigned";
    return `<article class="fulfillment-line">
      <div class="fulfillment-line-image">${line.imageUrl ? `<img src="${escapeHtml(line.imageUrl)}" alt="" loading="lazy" />` : "P1"}</div>
      <div class="fulfillment-line-main"><strong>${escapeHtml(line.name)}</strong><p>SKU ${escapeHtml(line.sku || "Missing")}${line.variationId ? ` · Variation ${line.variationId}` : ""}</p></div>
      <div class="fulfillment-line-fact"><span>${line.coa ? "Customer lot" : "Verification"}</span><strong>${escapeHtml(line.coa ? batch : "Scan required")}</strong><small>${line.coa ? escapeHtml(line.coa.number || "Current COA") : "Vial QR or registered product barcode, enforced by the server"}</small></div>
      <div class="fulfillment-line-quantity"><span>Quantity</span><strong>${line.verifiedQuantity} / ${line.quantity}</strong></div>
    </article>`;
  }).join("");
  let action = "";
  if (["waiting", "paused"].includes(order.queueStatus)) {
    const label = order.queueStatus === "paused" ? "Resume picking" : "Start picking";
    const explanation = !canOperate
      ? "Your role has view-only access."
      : anotherActive
        ? "Pause the current order before starting another one."
        : "A durable session will be created. No stock or order status will change.";
    action = `<div class="fulfillment-detail-action"><div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(explanation)}</p></div><button class="button button--primary" type="button" data-start-fulfillment="${order.orderId}"${canStart ? "" : " disabled"}>${escapeHtml(label)}</button></div>`;
  } else if (order.queueStatus === "active" && order.session) {
    action = `<div class="fulfillment-detail-action"><div><strong>Picking session secured</strong><p>Progress is durable. Barcode scanning will be added in Phase 4.</p></div><button class="button button--secondary" type="button" data-pause-fulfillment="${escapeHtml(order.session.id)}" data-version="${order.session.version}"${canOperate ? "" : " disabled"}>Pause order</button></div>`;
  } else if (order.queueStatus === "blocked" && order.session?.state === "open") {
    const leftProcessing = order.orderStatus.trim().toLowerCase() !== "processing";
    const actionTitle = leftProcessing ? "Remove this old session from the working queue" : "This active session needs attention";
    const actionCopy = leftProcessing
      ? "Its scans and audit history stay saved. It will only return here if the source order is changed back to Processing."
      : "Pause it to release the workstation while the source issue is corrected.";
    const actionLabel = leftProcessing ? "Remove from queue" : "Pause order";
    action = `<div class="fulfillment-detail-action"><div><strong>${escapeHtml(actionTitle)}</strong><p>${escapeHtml(actionCopy)}</p></div><button class="button button--secondary" type="button" data-pause-fulfillment="${escapeHtml(order.session.id)}" data-version="${order.session.version}"${canOperate ? "" : " disabled"}>${escapeHtml(actionLabel)}</button></div>`;
  } else if (order.queueStatus === "packed") {
    action = '<div class="fulfillment-complete-note"><span>✓</span><p><strong>Packed locally</strong>This fulfillment record is read-only.</p></div>';
  }
  detail.innerHTML = `<article class="surface fulfillment-detail-card">
    <header class="fulfillment-detail-head"><div><div class="fulfillment-detail-order"><span>ORDER #${escapeHtml(order.orderNumber)}</span><time>${formatCommerceTimestamp(order.createdAt)}</time></div><h2>${escapeHtml(order.customer)}</h2><p>${order.itemCount} product${order.itemCount === 1 ? "" : "s"} · ${order.unitCount} unit${order.unitCount === 1 ? "" : "s"} · ${escapeHtml(order.paymentMethod)}</p></div><span class="fulfillment-status is-${order.queueStatus}"><i aria-hidden="true">${fulfillmentStatusCopy[order.queueStatus].symbol}</i>${fulfillmentStatusCopy[order.queueStatus].label}</span></header>
    ${reasons}
    <section class="fulfillment-review"><div class="fulfillment-review-title"><div><p class="section-kicker">Items to prepare</p><h3>${order.unitCount} unit${order.unitCount === 1 ? "" : "s"} across ${order.itemCount} product${order.itemCount === 1 ? "" : "s"}</h3></div><span>${order.verifiedUnits} verified</span></div>${lines}</section>
    ${action}
  </article>`;
}

function renderFulfillmentQueue(): void {
  const live = requiredElement<HTMLElement>("#fulfillment-live-state");
  live.className = `fulfillment-live-state${fulfillmentQueue?.connected ? " is-ready" : fulfillmentQueue?.error ? " is-error" : ""}`;
  live.querySelector<HTMLElement>("b")!.textContent = fulfillmentQueueLoading
    ? "Verifying live orders"
    : fulfillmentQueue?.connected
      ? "Live verification ready"
      : fulfillmentQueue?.error || "Service unavailable";
  const orders = fulfillmentQueue?.orders || [];
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-fulfillment-filter]")) {
    const status = button.dataset.fulfillmentFilter as FulfillmentQueueEntry["queueStatus"];
    const count = orders.filter((order) => order.queueStatus === status).length;
    button.querySelector<HTMLElement>("b")!.textContent = String(count);
    button.classList.toggle("is-active", status === fulfillmentQueueFilter);
    button.setAttribute("aria-selected", String(status === fulfillmentQueueFilter));
  }
  const actionable = orders.filter((order) => ["waiting", "active", "paused", "blocked"].includes(order.queueStatus)).length;
  requiredElement<HTMLElement>("#fulfillment-nav-count").textContent = String(actionable);
  const activeOrder = orders.find((order) => order.session?.state === "open");
  const banner = requiredElement<HTMLElement>("#fulfillment-active-banner");
  banner.hidden = !activeOrder;
  banner.classList.toggle("is-blocked", activeOrder?.queueStatus === "blocked");
  if (activeOrder) {
    const blocked = activeOrder.queueStatus === "blocked";
    const description = blocked
      ? activeOrder.reasons[0]?.message || "This order needs attention before picking can continue."
      : `${activeOrder.verifiedUnits} of ${activeOrder.unitCount} units verified · ${Math.max(0, activeOrder.unitCount - activeOrder.verifiedUnits)} remaining`;
    banner.innerHTML = `<div><span aria-hidden="true">${blocked ? "!" : "→"}</span><p><small>${blocked ? "CURRENT ORDER NEEDS ATTENTION" : "CURRENT ORDER"}</small><strong>Order #${escapeHtml(activeOrder.orderNumber)} · ${escapeHtml(activeOrder.customer)}</strong><em>${escapeHtml(description)}</em></p></div><button type="button" data-open-fulfillment="${activeOrder.orderId}">${blocked ? "Review blocker" : "Continue picking"}<span aria-hidden="true">→</span></button>`;
  }
  const selected = selectedFulfillmentOrder();
  requiredElement<HTMLElement>("#fulfillment-queue-view").hidden = Boolean(selected);
  requiredElement<HTMLElement>("#fulfillment-detail-view").hidden = !selected;
  if (selected) {
    renderFulfillmentDetail(selected);
    return;
  }
  const list = requiredElement<HTMLElement>("#fulfillment-order-list");
  if (fulfillmentQueueLoading && !fulfillmentQueue) {
    list.innerHTML = `<div class="fulfillment-loading-state" role="status" aria-live="polite"><div><span></span><strong>Checking orders</strong><p>Verifying payment, order status and product mappings.</p></div>${Array.from({ length: 3 }, () => '<article class="fulfillment-order-skeleton"><i></i><p><b></b><span></span><span></span></p><em></em></article>').join("")}</div>`;
    return;
  }
  if (fulfillmentQueue?.error && !orders.length) {
    list.innerHTML = `<div class="fulfillment-empty is-error" role="alert"><span>!</span><strong>Fulfillment could not load safely</strong><p>${escapeHtml(fulfillmentQueue.error)}</p><button class="button button--secondary" type="button" data-refresh-fulfillment>Try again</button></div>`;
    return;
  }
  const filtered = orders.filter((order) => order.queueStatus === fulfillmentQueueFilter);
  if (!filtered.length) {
    const status = fulfillmentStatusCopy[fulfillmentQueueFilter];
    list.innerHTML = `<div class="fulfillment-empty is-${fulfillmentQueueFilter}"><span>${status.symbol}</span><strong>${escapeHtml(status.empty)}</strong><p>${escapeHtml(status.emptyDetail)}</p></div>`;
    return;
  }
  list.innerHTML = filtered.map((order) => {
    const issue = order.queueStatus === "packed" ? undefined : order.reasons[0];
    const action = order.queueStatus === "blocked" ? "Fix this order" : order.queueStatus === "active" ? "Continue picking" : order.queueStatus === "paused" ? "Review & resume" : order.queueStatus === "packed" ? "View packed order" : "Review & start";
    const percent = pickingProgressPercent(order);
    return `<article class="surface fulfillment-order-card is-${order.queueStatus}" aria-labelledby="fulfillment-order-${order.orderId}">
      <div class="fulfillment-order-main">
        <div class="fulfillment-order-heading"><span>ORDER #${escapeHtml(order.orderNumber)}</span><time>${formatCommerceTimestamp(order.createdAt)}</time></div>
        <h2 id="fulfillment-order-${order.orderId}">${escapeHtml(order.customer)}</h2>
        ${fulfillmentOrderProductPreview(order)}
        ${issue ? fulfillmentIssueMarkup(issue, true) : ""}
      </div>
      <div class="fulfillment-order-facts" aria-label="Order summary">
        <span><small>UNITS</small><strong>${order.unitCount}</strong></span>
        <span><small>PRODUCTS</small><strong>${order.itemCount}</strong></span>
        <span><small>PAYMENT</small><strong>${escapeHtml(order.paymentMethod)}</strong></span>
      </div>
      <div class="fulfillment-order-state">
        <span class="fulfillment-status is-${order.queueStatus}"><i aria-hidden="true">${fulfillmentStatusCopy[order.queueStatus].symbol}</i>${fulfillmentStatusCopy[order.queueStatus].label}</span>
        <div class="fulfillment-order-progress" aria-label="${percent}% verified"><span><b>${order.verifiedUnits} / ${order.unitCount}</b><small>verified</small></span><div><i style="--fulfillment-progress:${percent / 100}"></i></div></div>
      </div>
      <div class="fulfillment-order-action"><button class="button ${order.queueStatus === "waiting" || order.queueStatus === "active" ? "button--primary" : "button--secondary"}" type="button" data-open-fulfillment="${order.orderId}">${action}<span aria-hidden="true">→</span></button></div>
    </article>`;
  }).join("");
}

async function loadFulfillmentQueue(force = false): Promise<void> {
  if (fulfillmentQueueLoading) return;
  if (fulfillmentQueue && !force) {
    renderFulfillmentQueue();
    return;
  }
  fulfillmentQueueLoading = true;
  renderFulfillmentQueue();
  try {
    const response = await fetch("/api/fulfillment/queue", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.orders) || !isRecord(payload.permissions)) {
      throw new Error("Invalid fulfillment queue response");
    }
    fulfillmentQueue = payload as unknown as FulfillmentQueuePayload;
    if (!selectedFulfillmentOrderId) {
      const openSessionOrder = fulfillmentQueue.orders.find((order) => order.session?.state === "open");
      if (openSessionOrder) fulfillmentQueueFilter = openSessionOrder.queueStatus;
      else if (!fulfillmentQueue.orders.some((order) => order.queueStatus === fulfillmentQueueFilter)) {
        const nextStatus = (["active", "waiting", "paused", "blocked", "packed"] as const)
          .find((status) => fulfillmentQueue?.orders.some((order) => order.queueStatus === status));
        if (nextStatus) fulfillmentQueueFilter = nextStatus;
      }
    }
  } catch (error) {
    fulfillmentQueue = {
      configured: false,
      connected: false,
      generatedAt: new Date().toISOString(),
      activeSessionId: null,
      permissions: { read: true, operateQueue: false },
      orders: [],
      error: "Live order verification is temporarily unavailable. Refresh when the connection recovers.",
    };
  } finally {
    fulfillmentQueueLoading = false;
    renderFulfillmentQueue();
  }
}

async function startFulfillment(orderId: number): Promise<void> {
  fulfillmentScanFeedback = null;
  const button = document.querySelector<HTMLButtonElement>(`[data-start-fulfillment="${orderId}"]`);
  if (button) { button.disabled = true; button.textContent = "Verifying live order…"; }
  try {
    const response = await fetch("/api/fulfillment/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The order could not be started");
    }
    fulfillmentQueueFilter = "active";
    await loadFulfillmentQueue(true);
    showToast("Picking session ready", "The order is locked to one durable fulfillment session.");
  } catch (error) {
    showToast("Order not started", error instanceof Error ? error.message : "Refresh and try again.", false);
    if (button) { button.disabled = false; button.textContent = "Start picking"; }
  }
}

async function pauseFulfillment(fulfillmentId: string, expectedVersion: number): Promise<void> {
  try {
    const response = await fetch("/api/fulfillment/pause", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId, expectedVersion }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The order could not be paused");
    }
    selectedFulfillmentOrderId = null;
    fulfillmentScanFeedback = null;
    fulfillmentPackingAttempt = null;
    fulfillmentScanQueue.length = 0;
    fulfillmentQueueFilter = "paused";
    await loadFulfillmentQueue(true);
    showToast("Order removed from the working queue", "Its durable progress and audit history are still preserved.");
  } catch (error) {
    showToast("Order not paused", error instanceof Error ? error.message : "Refresh and try again.", false);
  }
}

function closePackingConfirmation(): void {
  if (fulfillmentPackingBusy) return;
  requiredElement<HTMLElement>("#packing-confirm-dialog").hidden = true;
  requiredElement<HTMLButtonElement>("#packing-confirm-backdrop").hidden = true;
  document.body.classList.remove("has-packing-confirm");
}

function openPackingConfirmation(): void {
  const order = selectedFulfillmentOrder();
  if (
    !order?.session || order.session.state !== "open" || order.unitCount <= 0 ||
    order.verifiedUnits !== order.unitCount
  ) {
    showToast("Packing is not ready", "Verify every required unit before confirming packing.", false);
    return;
  }
  const lots = new Set(order.lines.flatMap((line) => line.verifiedLots.map((allocation) => allocation.lot)).filter(Boolean));
  requiredElement<HTMLElement>("#packing-confirm-title").textContent = `Confirm order #${order.orderNumber} packed`;
  requiredElement<HTMLElement>("#packing-confirm-summary").innerHTML = `
    <div><strong>${order.itemCount}</strong><small>Products</small></div>
    <div><strong>${order.unitCount}</strong><small>Verified units</small></div>
    <div><strong>${lots.size}</strong><small>Verified batches</small></div>`;
  const error = requiredElement<HTMLElement>("#packing-confirm-error");
  error.hidden = true;
  error.textContent = "";
  const submit = requiredElement<HTMLButtonElement>("#packing-confirm-submit");
  submit.disabled = false;
  submit.textContent = fulfillmentPackingAttempt?.fulfillmentId === order.session.id
    ? "Retry confirmation"
    : "Confirm packed";
  requiredElement<HTMLElement>("#packing-confirm-dialog").hidden = false;
  requiredElement<HTMLButtonElement>("#packing-confirm-backdrop").hidden = false;
  document.body.classList.add("has-packing-confirm");
  window.setTimeout(() => submit.focus(), 0);
}

async function postPackingConfirmation(
  order: FulfillmentQueueEntry,
  clientEventId: string,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/fulfillment/pack", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          fulfillmentId: order.session?.id,
          expectedVersion: order.session?.version,
          clientEventId,
        }),
      });
      if (response.status < 500 || attempt === 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Packing connection unavailable");
}

async function completePacking(): Promise<void> {
  if (fulfillmentPackingBusy) return;
  const order = selectedFulfillmentOrder();
  if (!order?.session || order.session.state !== "open") {
    closePackingConfirmation();
    showToast("Packing session changed", "Refresh the order and review its current state.", false);
    return;
  }
  if (!fulfillmentPackingAttempt || fulfillmentPackingAttempt.fulfillmentId !== order.session.id) {
    fulfillmentPackingAttempt = {
      fulfillmentId: order.session.id,
      clientEventId: crypto.randomUUID(),
    };
  }
  const attempt = fulfillmentPackingAttempt;
  const submit = requiredElement<HTMLButtonElement>("#packing-confirm-submit");
  const cancel = requiredElement<HTMLButtonElement>("#packing-confirm-cancel");
  const errorElement = requiredElement<HTMLElement>("#packing-confirm-error");
  fulfillmentPackingBusy = true;
  submit.disabled = true;
  cancel.disabled = true;
  submit.textContent = "Confirming safely…";
  errorElement.hidden = true;
  try {
    const response = await postPackingConfirmation(order, attempt.clientEventId);
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || !isRecord(body.session) || !isRecord(body.snapshot)) {
      throw new Error(isRecord(body) && typeof body.error === "string"
        ? body.error
        : "Packing could not be confirmed safely.");
    }
    const packed = body as unknown as FulfillmentPackingPayload;
    order.session = packed.session;
    order.queueStatus = "packed";
    fulfillmentPackingAttempt = null;
    fulfillmentPackingBusy = false;
    cancel.disabled = false;
    closePackingConfirmation();
    fulfillmentQueueFilter = "packed";
    fulfillmentScanFeedback = null;
    await loadFulfillmentQueue(true);
    showToast(
      packed.replayed ? "Packing already confirmed" : "Order packed",
      packed.coaSync?.state === "synced"
        ? "The vial QR lots were also assigned to the customer order."
        : packed.coaSync?.message || "The verified products and COA lots are preserved in the local fulfillment record.",
      packed.coaSync?.state !== "failed",
    );
  } catch (error) {
    errorElement.textContent = error instanceof Error ? error.message : "Packing could not be confirmed safely.";
    errorElement.hidden = false;
    submit.textContent = "Retry confirmation";
  } finally {
    fulfillmentPackingBusy = false;
    submit.disabled = false;
    cancel.disabled = false;
  }
}

async function retryPackedCoaSync(): Promise<void> {
  if (fulfillmentCoaSyncBusy) return;
  const order = selectedFulfillmentOrder();
  if (!order?.session || order.session.state !== "packed") return;
  fulfillmentCoaSyncBusy = true;
  renderFulfillmentQueue();
  try {
    const response = await fetch("/api/fulfillment/coa-sync", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ fulfillmentId: order.session.id }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.session) || !isRecord(payload.coaSync)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "The customer COA assignment could not be confirmed.");
    }
    order.session = payload.session as unknown as FulfillmentQueueEntry["session"];
    const sync = payload.coaSync as { state?: string; message?: string };
    showToast(
      sync.state === "synced" ? "Customer COAs assigned" : "COA assignment pending",
      sync.message || "The scanned vial lots were checked.",
      sync.state !== "failed",
    );
    await loadFulfillmentQueue(true);
  } catch (error) {
    showToast(
      "COA assignment not confirmed",
      error instanceof Error ? error.message : "Refresh and try again.",
      false,
    );
  } finally {
    fulfillmentCoaSyncBusy = false;
    renderFulfillmentQueue();
  }
}

function playPickingTone(accepted: boolean): void {
  if (!fulfillmentScanSound) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = accepted ? 760 : 190;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(accepted ? 0.08 : 0.06, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (accepted ? 0.12 : 0.2));
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (accepted ? 0.13 : 0.21));
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Audio is an optional enhancement and may be blocked by browser policy.
  }
  if ("vibrate" in navigator) navigator.vibrate(accepted ? 24 : [45, 35, 45]);
}

function applyPickingScan(payload: FulfillmentScanPayload): void {
  const order = selectedFulfillmentOrder();
  if (!order || order.session?.id !== payload.session.id) return;
  order.session = payload.session;
  const progress = isRecord(payload.session.progress) ? payload.session.progress : null;
  const progressLines = progress && Array.isArray(progress.lines) ? progress.lines : [];
  for (const stored of progressLines) {
    if (!isRecord(stored)) continue;
    const line = order.lines.find((item) => item.orderItemId === Number(stored.orderItemId));
    if (line) line.verifiedQuantity = Math.max(0, Number(stored.verifiedQuantity) || 0);
  }
  const allocations = progress && Array.isArray(progress.allocations) ? progress.allocations : [];
  for (const line of order.lines) {
    line.verifiedLots = allocations.flatMap((value) => {
      if (!isRecord(value) || Number(value.orderItemId) !== line.orderItemId) return [];
      const coaId = typeof value.coaId === "string" ? value.coaId : "";
      const lot = typeof value.lot === "string" ? value.lot : "";
      const quantity = Math.max(0, Math.floor(Number(value.quantity) || 0));
      if (!coaId || !lot || !quantity) return [];
      return [{
        orderItemId: line.orderItemId,
        coaId,
        coaNumber: line.coa?.id === coaId ? line.coa.number : "",
        lot,
        batch: lot,
        quantity,
      }];
    });
  }
  order.verifiedUnits = progress
    ? Math.max(0, Number(progress.verifiedUnits) || 0)
    : order.lines.reduce((sum, line) => sum + line.verifiedQuantity, 0);
}

async function postPickingScan(
  order: FulfillmentQueueEntry,
  queued: { barcode: string; clientEventId: string },
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/fulfillment/scan", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          fulfillmentId: order.session?.id,
          clientEventId: queued.clientEventId,
          barcode: queued.barcode,
        }),
      });
      if (response.status < 500 || attempt === 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Scanner connection unavailable");
}

async function processFulfillmentScans(): Promise<void> {
  if (fulfillmentScanBusy) return;
  fulfillmentScanBusy = true;
  if (!fulfillmentScanFeedback) renderFulfillmentQueue();
  while (fulfillmentScanQueue.length) {
    const queued = fulfillmentScanQueue.shift()!;
    const order = selectedFulfillmentOrder();
    if (!order?.session || order.session.state !== "open") {
      fulfillmentScanQueue.length = 0;
      break;
    }
    try {
      const response = await postPickingScan(order, queued);
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(isRecord(body) && typeof body.error === "string"
          ? body.error
          : "The barcode could not be verified.");
      }
      if (!isRecord(body) || !isRecord(body.feedback) || !isRecord(body.session)) {
        throw new Error("The scanner received an invalid response.");
      }
      const payload = body as unknown as FulfillmentScanPayload;
      fulfillmentScanFeedback = payload.feedback;
      applyPickingScan(payload);
      playPickingTone(payload.feedback.accepted);
      renderFulfillmentQueue();
    } catch (error) {
      const current = selectedFulfillmentOrder();
      fulfillmentScanFeedback = {
        accepted: false,
        reasonCode: "order_ineligible",
        message: error instanceof Error ? error.message : "The barcode could not be verified safely.",
        productName: null,
        sku: null,
        locationCode: null,
        lot: null,
        orderItemId: null,
        verifiedQuantity: 0,
        requiredQuantity: 0,
        verifiedUnits: current?.verifiedUnits || 0,
        totalUnits: current?.unitCount || 0,
        complete: false,
        scannedProductName: null,
        scannedSku: null,
        expectedProductName: null,
        expectedSku: null,
      };
      fulfillmentScanQueue.length = 0;
      playPickingTone(false);
      renderFulfillmentQueue();
    }
  }
  fulfillmentScanBusy = false;
  renderFulfillmentQueue();
}

function queueFulfillmentScan(value: string): void {
  const barcode = value.trim();
  if (!barcode) {
    showToast("Vial QR required", "Scan the QR on the vial or paste its verification link.", false);
    return;
  }
  const order = selectedFulfillmentOrder();
  if (!order?.session || order.session.state !== "open") {
    showToast("Picking is not active", "Start or resume the order before scanning.", false);
    return;
  }
  fulfillmentScanQueue.push({ barcode, clientEventId: crypto.randomUUID() });
  const input = document.querySelector<HTMLInputElement>("#picking-scan-input");
  if (input) input.value = "";
  void processFulfillmentScans();
}

type FulfillmentCameraState = "loading" | "scanning" | "warning" | "success" | "error";

function setFulfillmentCameraStatus(
  state: FulfillmentCameraState,
  title: string,
  message: string,
): void {
  const stage = requiredElement<HTMLElement>("#picking-camera-dialog .picking-camera-stage");
  const loading = requiredElement<HTMLElement>("#picking-camera-loading");
  const status = requiredElement<HTMLElement>("#picking-camera-status");
  const retry = requiredElement<HTMLButtonElement>("#picking-camera-retry");
  stage.dataset.cameraState = state;
  loading.hidden = state !== "loading";
  retry.hidden = state !== "error";
  const icon = status.querySelector<HTMLElement>(":scope > span");
  if (icon) icon.textContent = state === "success" ? "✓" : state === "error" || state === "warning" ? "!" : "⌁";
  status.dataset.cameraState = state;
  status.querySelector<HTMLElement>("strong")!.textContent = title;
  status.querySelector<HTMLElement>("p")!.textContent = message;
}

function stopFulfillmentCamera(): void {
  fulfillmentCameraRequest += 1;
  fulfillmentCameraControls?.stop();
  fulfillmentCameraControls = null;
  if (fulfillmentCameraSuccessTimer) {
    window.clearTimeout(fulfillmentCameraSuccessTimer);
    fulfillmentCameraSuccessTimer = undefined;
  }
  const video = document.querySelector<HTMLVideoElement>("#picking-camera-video");
  const stream = video?.srcObject;
  if (stream && "getTracks" in stream) {
    for (const track of (stream as MediaStream).getTracks()) track.stop();
  }
  if (video) video.srcObject = null;
}

function closeFulfillmentCamera(restoreFocus = true): void {
  const dialog = requiredElement<HTMLElement>("#picking-camera-dialog");
  if (dialog.hidden) return;
  stopFulfillmentCamera();
  dialog.hidden = true;
  requiredElement<HTMLButtonElement>("#picking-camera-backdrop").hidden = true;
  document.body.classList.remove("has-picking-camera");
  if (restoreFocus) {
    const fallback = document.querySelector<HTMLInputElement>("#picking-scan-input");
    const focusTarget = fulfillmentCameraReturnFocus?.isConnected ? fulfillmentCameraReturnFocus : fallback;
    window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), 0);
  }
  fulfillmentCameraReturnFocus = null;
}

function cameraFailureMessage(error: unknown): { title: string; message: string } {
  const name = error instanceof DOMException ? error.name : "";
  if (!window.isSecureContext) {
    return {
      title: "Secure connection required",
      message: "Open the dashboard over HTTPS to use the phone camera. Physical scanners and manual entry still work.",
    };
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      title: "Camera permission is blocked",
      message: "Allow camera access for this site in your browser settings, then try again.",
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      title: "No camera was found",
      message: "Connect a camera or continue with a Zebra, USB/Bluetooth scanner or manual entry.",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      title: "Camera is already in use",
      message: "Close the other camera app or browser tab and try again.",
    };
  }
  return {
    title: "Camera could not start",
    message: "Check camera permission and try again. Physical scanners and manual entry remain available.",
  };
}

async function optimizeFulfillmentCamera(video: HTMLVideoElement): Promise<string> {
  const stream = video.srcObject;
  if (!(stream instanceof MediaStream)) return "";
  const track = stream.getVideoTracks()[0];
  if (!track) return "";

  const capabilities = track.getCapabilities() as MediaTrackCapabilities & CameraTrackCapabilitiesLike;
  const settings = track.getSettings() as MediaTrackSettings & CameraTrackSettingsLike;
  const plan = cameraOptimizationPlan(capabilities, settings);
  const constraints = plan as MediaTrackConstraintSet;
  if (!Object.keys(constraints).length) return "";

  try {
    await track.applyConstraints({ advanced: [constraints] });
  } catch {
    // Some mobile browsers expose a control but reject a combined constraint.
    // Retry independently so one unsupported option does not disable the other.
    if (plan.focusMode) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: plan.focusMode } as MediaTrackConstraintSet] });
      } catch {
        delete plan.focusMode;
      }
    }
    if (plan.zoom) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: plan.zoom } as MediaTrackConstraintSet] });
      } catch {
        delete plan.zoom;
      }
    }
  }

  return cameraOptimizationLabel(plan);
}

async function startFulfillmentCamera(): Promise<void> {
  const order = selectedFulfillmentOrder();
  if (!order?.session || order.session.state !== "open" || order.verifiedUnits >= order.unitCount) {
    showToast("Camera unavailable", "Open an active order with units remaining before scanning.", false);
    return;
  }
  const dialog = requiredElement<HTMLElement>("#picking-camera-dialog");
  const backdrop = requiredElement<HTMLButtonElement>("#picking-camera-backdrop");
  const video = requiredElement<HTMLVideoElement>("#picking-camera-video");
  stopFulfillmentCamera();
  fulfillmentCameraReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  fulfillmentCameraCaptured = false;
  dialog.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add("has-picking-camera");
  setFulfillmentCameraStatus("loading", "Starting camera", "Camera access stays on this device and no image is uploaded.");
  window.setTimeout(() => dialog.querySelector<HTMLButtonElement>("[data-close-picking-camera]")?.focus(), 0);
  const request = ++fulfillmentCameraRequest;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new DOMException("A secure camera context is required", "SecurityError");
    }
    const [{ BrowserMultiFormatReader, BarcodeFormat }, { DecodeHintType }] = await Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]);
    if (request !== fulfillmentCameraRequest || dialog.hidden) return;
    const hints = new Map<ZXingDecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 60,
      delayBetweenScanSuccess: 900,
      tryPlayVideoTimeout: 5_000,
    });
    const controls = await reader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
      },
      video,
      (result, _error, activeControls) => {
        if (!result || fulfillmentCameraCaptured || request !== fulfillmentCameraRequest) return;
        const formatName = BarcodeFormat[result.getBarcodeFormat()] || "UNKNOWN";
        const candidate = cameraBarcodeCandidate(result.getText(), formatName);
        if (!candidate.accepted || !candidate.value) {
          setFulfillmentCameraStatus(
            "warning",
            candidate.reason === "unsupported_format" ? "QR or Code 128 required" : "This code is not a valid registered format",
            "Keep the complete QR square or the full horizontal barcode inside the guide.",
          );
          return;
        }
        fulfillmentCameraCaptured = true;
        activeControls.stop();
        fulfillmentCameraControls = null;
        setFulfillmentCameraStatus("success", "Code captured", "Matching the registered product and its verification rules securely…");
        fulfillmentCameraSuccessTimer = window.setTimeout(() => {
          fulfillmentCameraSuccessTimer = undefined;
          closeFulfillmentCamera(false);
          queueFulfillmentScan(candidate.value!);
        }, 360);
      },
    );
    if (request !== fulfillmentCameraRequest || dialog.hidden || fulfillmentCameraCaptured) {
      controls.stop();
      return;
    }
    fulfillmentCameraControls = controls;
    const optimization = await optimizeFulfillmentCamera(video);
    if (request !== fulfillmentCameraRequest || dialog.hidden || fulfillmentCameraCaptured) return;
    setFulfillmentCameraStatus(
      "scanning",
      optimization ? "Tiny QR mode ready" : "Camera ready",
      optimization
        ? `${optimization}. Hold the vial 15–25 cm away and keep the complete QR inside the guide.`
        : "Hold the vial 15–25 cm away and keep the complete QR inside the guide.",
    );
  } catch (error) {
    if (request !== fulfillmentCameraRequest || dialog.hidden) return;
    stopFulfillmentCamera();
    const failure = cameraFailureMessage(error);
    setFulfillmentCameraStatus("error", failure.title, failure.message);
  }
}

function resetLabelSelection(): void {
  labelProductRequest += 1;
  selectedLabelProductId = null;
  labelProductDetail = undefined;
  selectedLabelType = "product";
  selectedLabelVariationId = 0;
  selectedLabelCoaId = "";
  labelPrintStep = "product";
  clearBarcodePreview();
  renderLabelWorkspace();
  window.setTimeout(() => requiredElement<HTMLInputElement>("#label-product-search").focus(), 0);
}

function resetLocationSelection(): void {
  locationProductRequest += 1;
  selectedLocationProductId = null;
  locationProductDetail = undefined;
  renderLocationProductList();
  renderLocationEditor();
  renderLocationStep();
  window.setTimeout(() => requiredElement<HTMLInputElement>("#label-location-search").focus(), 0);
}

async function selectLabelProduct(productId: number): Promise<void> {
  const product = commerceData?.products.find((item) => item.id === productId);
  if (!product) return;
  selectedLabelProductId = productId;
  labelProductDetail = undefined;
  selectedLabelType = "product";
  selectedLabelVariationId = 0;
  selectedLabelCoaId = "";
  clearBarcodePreview();
  labelPrintStep = "details";
  renderLabelPrintStep();
  renderLabelProductList();
  requiredElement<HTMLElement>("#label-selected-product").innerHTML = `<span>${product.thumbnailUrl || product.imageUrl ? `<img src="${escapeHtml(product.thumbnailUrl || product.imageUrl || "")}" alt="" />` : "P1"}</span><div><small>LOADING PRODUCT</small><strong>${escapeHtml(product.name)}</strong><p>Loading variations and storage assignments…</p></div>`;
  const requestId = ++labelProductRequest;
  try {
    const response = await fetch(`/api/commerce/product?productId=${encodeURIComponent(String(productId))}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.product) || !Array.isArray(payload.variations)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Product details are unavailable");
    }
    if (requestId !== labelProductRequest) return;
    const variations = payload.variations as CommerceVariation[];
    labelProductDetail = {
      product: payload.product as unknown as CommerceProduct,
      variations,
    };
    selectedLabelType = variations.length ? "variation" : "product";
    selectedLabelVariationId = variations[0]?.id || 0;
    renderLabelWorkspace();
  } catch (error) {
    if (requestId !== labelProductRequest) return;
    labelProductDetail = undefined;
    selectedLabelProductId = null;
    labelPrintStep = "product";
    renderLabelWorkspace();
    showToast("Product details unavailable", error instanceof Error ? error.message : "Try selecting the product again.", false);
  }
}

async function selectLocationProduct(productId: number): Promise<void> {
  const product = commerceData?.products.find((item) => item.id === productId);
  if (!product) return;
  selectedLocationProductId = productId;
  locationProductDetail = undefined;
  renderLocationStep();
  renderLocationProductList();
  requiredElement<HTMLElement>("#location-selected-product").innerHTML = `<span>${product.thumbnailUrl || product.imageUrl ? `<img src="${escapeHtml(product.thumbnailUrl || product.imageUrl || "")}" alt="" />` : "P1"}</span><div><small>LOADING PRODUCT</small><strong>${escapeHtml(product.name)}</strong><p>Loading base and variation locations…</p></div>`;
  requiredElement<HTMLElement>("#label-location-editor").innerHTML = '<div class="table-loading">Loading product and variation records…</div>';
  const requestId = ++locationProductRequest;
  try {
    const response = await fetch(`/api/commerce/product?productId=${encodeURIComponent(String(productId))}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.product) || !Array.isArray(payload.variations)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Product details are unavailable");
    }
    if (requestId !== locationProductRequest) return;
    locationProductDetail = {
      product: payload.product as unknown as CommerceProduct,
      variations: payload.variations as CommerceVariation[],
    };
    renderLabelWorkspace();
  } catch (error) {
    if (requestId !== locationProductRequest) return;
    locationProductDetail = { product, variations: [] };
    renderLabelWorkspace();
    showToast("Product details delayed", error instanceof Error ? error.message : "Try refreshing storage locations.", false);
  }
}

async function saveProductLocation(row: HTMLElement, remove: boolean): Promise<void> {
  const productId = Number(row.dataset.productId);
  const variationId = Number(row.dataset.variationId || 0);
  const input = row.querySelector<HTMLInputElement>("[data-location-input]");
  const buttons = [...row.querySelectorAll<HTMLButtonElement>("button")];
  for (const button of buttons) button.disabled = true;
  try {
    const response = await fetch("/api/fulfillment/location", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        productId,
        variationId,
        locationCode: input?.value.trim().toUpperCase() || "",
        remove,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.locations)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The location could not be saved");
    }
    if (fulfillmentLocations) fulfillmentLocations.locations = payload.locations as unknown as ProductLocation[];
    clearBarcodePreview();
    renderLabelWorkspace();
    showToast(remove ? "Location cleared" : "Location saved", remove
      ? "This record now inherits its product location when one is available."
      : `${input?.value.trim().toUpperCase()} is now the primary storage location.`);
  } catch (error) {
    for (const button of buttons) button.disabled = false;
    showToast("Location not saved", error instanceof Error ? error.message : "Check the location code and try again.", false);
  }
}

function renderBarcodeLabelPreview(label: BarcodeLabel, inheritedLocation: boolean): void {
  activeBarcodeLabel = label;
  const title = label.variantName ? `${label.productName} · ${label.variantName}` : label.productName;
  const batch = label.lot
    ? `<p><b>LOT ${escapeHtml(label.lot)}</b>${label.coaNumber ? ` · ${escapeHtml(label.coaNumber)}` : ""}</p>`
    : "";
  requiredElement<HTMLElement>("#thermal-label-stage").innerHTML = `<div><section class="thermal-label-preview${label.layout.size === "3x1" ? " is-wide" : ""}"><header><span>PHASE ONE LABZ</span><b>${escapeHtml(label.locationCode)}</b></header><div class="thermal-label-copy"><h3>${escapeHtml(title)}</h3><span>SKU ${escapeHtml(label.sku)}</span>${batch}${inheritedLocation ? "<p>Uses base product location</p>" : ""}</div><div class="thermal-label-art">${label.svg}</div></section><div class="label-token-line" title="${escapeHtml(label.token)}">${escapeHtml(label.token)}</div></div>`;
  requiredElement<HTMLButtonElement>("#copy-barcode-token").disabled = false;
  requiredElement<HTMLButtonElement>("#print-barcode-label").disabled = false;
}

async function generateBarcodeLabel(): Promise<void> {
  const product = labelProductDetail?.product;
  if (!product) return;
  const button = requiredElement<HTMLButtonElement>("#generate-barcode-label");
  button.disabled = true;
  button.textContent = "Generating verified label…";
  try {
    const response = await fetch("/api/fulfillment/barcode-label", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        type: selectedLabelType,
        productId: product.id,
        variationId: selectedLabelVariationId,
        coaId: selectedLabelType === "batch" ? selectedLabelCoaId : undefined,
        size: requiredElement<HTMLSelectElement>("#label-size-select").value,
        copies: Number(requiredElement<HTMLInputElement>("#label-copy-count").value),
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.label)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The label could not be generated");
    }
    renderBarcodeLabelPreview(payload.label as unknown as BarcodeLabel, payload.inheritedLocation === true);
    if (fulfillmentLocations && isRecord(payload.registeredLabel)) {
      const registered = payload.registeredLabel as unknown as BarcodeRegistryRecord;
      fulfillmentLocations.registeredLabels = [
        registered,
        ...fulfillmentLocations.registeredLabels.filter((item) => item.barcodeValue !== registered.barcodeValue),
      ];
      renderRegisteredLabels();
    }
    labelPrintStep = "preview";
    renderLabelPrintStep();
    showToast("Label ready", "The Code 128 identifier was validated and is ready for thermal printing.");
  } catch (error) {
    clearBarcodePreview();
    showToast("Label not generated", error instanceof Error ? error.message : "Review the product, batch and location.", false);
  } finally {
    button.textContent = "Continue to preview";
    renderLabelComposer();
  }
}

function openBarcodePrintWindow(
  token: string,
  size: "2x1" | "3x1" = "2x1",
  copies = 1,
): void {
  const printUrl = new URL("/api/fulfillment/barcode-label/print", window.location.origin);
  printUrl.searchParams.set("token", token);
  printUrl.searchParams.set("size", size);
  printUrl.searchParams.set("copies", String(copies));
  const printWindow = window.open(printUrl, "_blank", "width=900,height=700");
  if (!printWindow) {
    showToast("Allow print pop-ups", "The browser blocked the thermal print window.", false);
    return;
  }
  let openedDialog = false;
  const openDialog = () => {
    if (openedDialog || printWindow.closed) return;
    if (printWindow.document.title !== "Phase One labels") return;
    openedDialog = true;
    printWindow.focus();
    printWindow.print();
  };
  printWindow.addEventListener("load", openDialog, { once: true });
  window.setTimeout(() => {
    openDialog();
    if (!openedDialog && !printWindow.closed) {
      showToast("Print page opened", "If the dialog did not open automatically, press Ctrl+P in the label window.");
    }
  }, 2_500);
}

function printBarcodeLabel(): void {
  if (!activeBarcodeLabel) return;
  openBarcodePrintWindow(
    activeBarcodeLabel.token,
    activeBarcodeLabel.layout.size,
    activeBarcodeLabel.layout.copies,
  );
}

function orderAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(ORDER_ALERTS_STORAGE_KEY) === "enabled";
  } catch {
    return false;
  }
}

let alertAudioContext: AudioContext | undefined;

function updateOrderAlertControl(): void {
  const enabled = orderAlertsEnabled();
  const button = requiredElement<HTMLButtonElement>("#order-alert-toggle");
  button.textContent = enabled ? "Sale sound on" : "Enable sale sound";
  button.classList.toggle("is-enabled", enabled);
  button.setAttribute("aria-pressed", String(enabled));
}

async function toggleOrderAlerts(): Promise<void> {
  const enable = !orderAlertsEnabled();
  if (enable && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  try {
    localStorage.setItem(ORDER_ALERTS_STORAGE_KEY, enable ? "enabled" : "disabled");
  } catch {
    // The alert still works for the current page when storage is unavailable.
  }
  if (enable) {
    alertAudioContext ||= new AudioContext();
    await alertAudioContext.resume().catch(() => undefined);
  }
  updateOrderAlertControl();
  showToast(enable ? "Order alerts enabled" : "Order alerts paused", enable
    ? "A banner, chime and system notification will signal every new order."
    : "The live order feed will continue without audible alerts.");
}

function playOrderChime(): void {
  if (!alertAudioContext) return;
  const start = alertAudioContext.currentTime + .015;
  const master = alertAudioContext.createGain();
  const compressor = alertAudioContext.createDynamicsCompressor();
  master.gain.setValueAtTime(.58, start);
  master.connect(compressor).connect(alertAudioContext.destination);
  for (const [index, frequency] of [659.25, 830.61, 987.77, 1318.51].entries()) {
    const oscillator = alertAudioContext.createOscillator();
    const gain = alertAudioContext.createGain();
    oscillator.type = index === 3 ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    const noteAt = start + index * .085;
    gain.gain.setValueAtTime(.0001, noteAt);
    gain.gain.exponentialRampToValueAtTime(index === 3 ? .09 : .14, noteAt + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, noteAt + .42);
    oscillator.connect(gain).connect(master);
    oscillator.start(noteAt);
    oscillator.stop(noteAt + .45);
  }
  const shimmer = alertAudioContext.createOscillator();
  const shimmerGain = alertAudioContext.createGain();
  shimmer.type = "triangle";
  shimmer.frequency.setValueAtTime(1760, start + .12);
  shimmer.frequency.exponentialRampToValueAtTime(1320, start + .52);
  shimmerGain.gain.setValueAtTime(.0001, start + .12);
  shimmerGain.gain.exponentialRampToValueAtTime(.045, start + .14);
  shimmerGain.gain.exponentialRampToValueAtTime(.0001, start + .58);
  shimmer.connect(shimmerGain).connect(master);
  shimmer.start(start + .12);
  shimmer.stop(start + .6);
}

function announceNewOrder(order: CommerceOrder): void {
  latestNotifiedOrderId = order.id;
  orderNotificationCount += 1;
  const isZelle = order.paymentMethodId === "phaseone_zelle";
  requiredElement<HTMLElement>("#new-order-title").textContent = `New order #${order.number} · ${formatCurrency(order.total, order.currency)}`;
  requiredElement<HTMLElement>("#new-order-message").textContent = isZelle
    ? `Zelle payment from ${order.customer} requires review.`
    : `${order.customer} placed a new ${order.paymentMethod || "online"} order.`;
  requiredElement<HTMLElement>("#new-order-banner").hidden = false;
  updateNotificationBadge();
  announcement.textContent = `New order ${order.number} received from ${order.customer}.`;
  if (!orderAlertsEnabled()) return;
  playOrderChime();
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`New order #${order.number}`, {
      body: isZelle
        ? `Zelle · ${order.customer} · ${formatCurrency(order.total, order.currency)}`
        : `${order.customer} · ${formatCurrency(order.total, order.currency)}`,
      icon: "/phase-one-labz-logo.webp",
      tag: `phaseone-order-${order.id}`,
    });
  }
}

async function loadLiveOrders(initial = false): Promise<void> {
  if (liveOrdersRefreshInFlight) return;
  liveOrdersRefreshInFlight = true;
  const feedLabel = requiredElement<HTMLElement>("#order-feed-status");
  const monitorLabel = requiredElement<HTMLElement>("#monitor-order-stream");
  try {
    const response = await fetch("/api/commerce/orders", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.orders)) {
      throw new Error("Live order refresh failed");
    }
    const orders = payload.orders as CommerceOrder[];
    if (!commerceData) return;
    const newOrders = orderFeedInitialized
      ? orders.filter((order) => !knownOrderIds.has(order.id))
      : [];
    commerceData.orders = orders;
    commerceData.affiliateCommissions = Array.isArray(payload.affiliateCommissions)
      ? payload.affiliateCommissions as unknown as AffiliateCommissionSummary[]
      : [];
    reconcileMonthToDateOrders(orders);
    knownOrderIds = new Set(orders.map((order) => order.id));
    orderFeedInitialized = true;
    consecutiveOrderFeedFailures = 0;
    renderCommerce();
    const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date());
    feedLabel.textContent = `Updated ${time}`;
    monitorLabel.textContent = `${orders.length} recent orders`;
    for (const order of [...newOrders].reverse()) announceNewOrder(order);
    if (initial || newOrders.length) void loadNotifications();
  } catch {
    consecutiveOrderFeedFailures += 1;
    const hasCachedOrders = Boolean(commerceData?.orders.length);
    if (!hasCachedOrders || consecutiveOrderFeedFailures >= 3) {
      feedLabel.textContent = hasCachedOrders ? "Last confirmed order data" : "Order data temporarily unavailable";
      monitorLabel.textContent = hasCachedOrders
        ? `${commerceData?.orders.length || 0} confirmed orders`
        : "Waiting for order data";
    }
    if (!initial && consecutiveOrderFeedFailures === 3) {
      showToast("Order feed delayed", "Confirmed orders remain visible while the background refresh retries.", false);
    }
  } finally {
    liveOrdersRefreshInFlight = false;
  }
}

function coaGroups(): Array<{ key: string; name: string; items: CommerceCoa[] }> {
  const groups = new Map<string, { key: string; name: string; items: CommerceCoa[] }>();
  for (const coa of extensionsData?.coas || []) {
    const key = coa.familyKey || coa.familyName || coa.productName || coa.id;
    const existing = groups.get(key);
    if (existing) existing.items.push(coa);
    else groups.set(key, { key, name: coa.familyName || coa.productName || "Unassigned family", items: [coa] });
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function renderCoaManager(): void {
  const coas = extensionsData?.coas || [];
  const groups = coaGroups();
  const currentCount = coas.filter((coa) => coa.currentShippingLot).length;
  const archivedCount = coas.filter((coa) => coa.status.toLocaleLowerCase("en").includes("archiv")).length;
  requiredElement<HTMLElement>("#coa-family-count").textContent = formatNumber(groups.length);
  requiredElement<HTMLElement>("#coa-record-count").textContent = formatNumber(coas.length);
  requiredElement<HTMLElement>("#coa-current-count").textContent = formatNumber(currentCount);
  requiredElement<HTMLElement>("#coa-archive-count").textContent = formatNumber(archivedCount);
  requiredElement<HTMLElement>("#coa-nav-count").textContent = formatNumber(currentCount);
  requiredElement<HTMLElement>("#overview-current-lots").textContent = formatNumber(currentCount);
  requiredElement<HTMLElement>("#overview-coa-families").textContent = `${groups.length} certificate families`;
  requiredElement<HTMLElement>("#coa-sync-label").textContent = extensionsData?.connected
    ? `${coas.length} certificates · ${groups.length} families`
    : "Certificate service unavailable";

  const search = coaSearch.trim().toLocaleLowerCase("en");
  const visibleGroups = groups.filter((group) => {
    const searchText = group.items.map((coa) => [coa.productName, coa.familyName, coa.batch, coa.lot, coa.coaNumber, ...coa.skus].join(" ")).join(" ").toLocaleLowerCase("en");
    if (search && !searchText.includes(search)) return false;
    if (coaFilter === "current" && !group.items.some((coa) => coa.currentShippingLot)) return false;
    if (coaFilter === "history" && group.items.length < 2 && !group.items.some((coa) => coa.historyCount > 0)) return false;
    if (coaFilter === "missing" && group.items.every((coa) => coa.fileUrl)) return false;
    return true;
  });
  requiredElement<HTMLElement>("#coa-family-grid").innerHTML = visibleGroups.length
    ? visibleGroups.map((group) => {
      const current = group.items.find((coa) => coa.currentShippingLot) || group.items[0];
      if (!current) return "";
      const strength = current.strength || current.compound || "Certificate family";
      const quality = [current.purity, current.tested].filter(Boolean).join(" · ") || "Quality data available in report";
      return `<article class="coa-family-card"><header><span class="coa-family-mark">COA</span><div><small>FAMILY</small><h3>${escapeHtml(group.name)}</h3><p>${escapeHtml(strength)}</p></div><b>${group.items.length} record${group.items.length === 1 ? "" : "s"}</b></header><div class="coa-family-facts"><div><span>Current batch</span><strong>${escapeHtml(current.batch || current.lot || "Not assigned")}</strong></div><div><span>Certificate</span><strong>${escapeHtml(current.coaNumber || current.id)}</strong></div><div><span>Quality</span><strong>${escapeHtml(quality)}</strong></div><div><span>SKU</span><strong>${escapeHtml(current.skus.join(", ") || "Not mapped")}</strong></div></div><footer><span class="status-pill status-pill--${current.currentShippingLot ? "completed" : "pending"}">${current.currentShippingLot ? "Current shipping lot" : orderStatusLabel(current.status)}</span><button class="coa-edit-button" type="button" data-edit-coa="${escapeHtml(current.recordId || current.id)}">Edit COA</button>${current.fileUrl ? `<a class="table-document-link" href="${escapeHtml(current.fileUrl)}" target="_blank" rel="noopener noreferrer">View certificate ↗</a>` : '<span class="cell-muted">Document missing</span>'}</footer></article>`;
    }).join("")
    : '<div class="module-empty"><span>⌕</span><strong>No certificate families match these filters.</strong></div>';

  requiredElement<HTMLElement>("#coa-table-count").textContent = `${coas.length} records`;
  requiredElement<HTMLElement>("#coa-table-body").innerHTML = coas.length
    ? coas.map((coa) => `<tr><td><div class="cell-customer"><strong>${escapeHtml(coa.productName || coa.familyName)}</strong><small>${escapeHtml(coa.strength || coa.compound)}</small></div></td><td><code class="sku-code">${escapeHtml(coa.coaNumber || coa.id)}</code></td><td><div class="cell-customer"><strong>${escapeHtml(coa.batch || "—")}</strong><small>${escapeHtml(coa.lot || "No lot")}</small></div></td><td>${escapeHtml([coa.purity, coa.tested].filter(Boolean).join(" · ") || "—")}</td><td>${escapeHtml(coa.date || "—")}</td><td><span class="status-pill status-pill--${coa.currentShippingLot ? "completed" : "pending"}">${coa.currentShippingLot ? "Current lot" : escapeHtml(orderStatusLabel(coa.status))}</span></td><td>${coa.fileUrl ? `<a class="table-document-link" href="${escapeHtml(coa.fileUrl)}" target="_blank" rel="noopener noreferrer">Open PDF ↗</a>` : '<span class="cell-muted">Missing</span>'}</td><td class="coa-table-actions"><button class="coa-edit-button" type="button" data-edit-coa="${escapeHtml(coa.recordId || coa.id)}">Edit</button></td></tr>`).join("")
    : '<tr><td colspan="8"><div class="table-loading">No certificates are available.</div></td></tr>';
  renderCoaReviewQueue();
}

function renderCoaReviewQueue(): void {
  const persistedDrafts = (extensionsData?.coas || [])
    .filter((coa) => coa.source === "custom" && coa.status === "Review")
    .map((coa) => ({ coa, duplicate: false }));
  const source = coaIntakeResults.length ? coaIntakeResults : persistedDrafts;
  const unique = [...new Map(source.map((item) => [item.coa.recordId || item.coa.id, item])).values()]
    .sort((left, right) => Date.parse(right.coa.updatedAt || "") - Date.parse(left.coa.updatedAt || ""))
    .slice(0, 20);
  const pending = unique.filter((item) => item.coa.status === "Review").length;
  requiredElement<HTMLElement>("#coa-review-count").textContent = unique.length
    ? `${pending} pending · ${unique.length} shown`
    : "0 pending";
  requiredElement<HTMLElement>("#coa-review-list").innerHTML = unique.length
    ? unique.map(({ coa, duplicate }) => {
      const analysis = coa.intakeAnalysis;
      const dateDetection = analysis?.dateDetection;
      const dateNeedsConfirmation = Boolean(dateDetection && dateDetection.confidence !== "explicit");
      const warning = dateNeedsConfirmation
        ? (dateDetection?.confidence === "fallback"
          ? `${dateDetection.label} was suggested because the PDF did not identify a specific test or analysis date. Confirm the actual testing date.`
          : "The test or analysis date was not detected. Enter the actual laboratory testing date before publication.")
        : analysis?.warnings?.[0] || "Confirm every value before publication.";
      const statusLabel = duplicate
        ? "Already registered"
        : analysis?.status === "complete"
          ? `${analysis.detectedFieldCount} fields detected`
          : analysis?.status === "failed"
            ? "Manual review needed"
            : "Saved for review";
      const privateDocument = coa.source === "custom" && coa.recordId
        ? `/api/extensions/coa/${encodeURIComponent(coa.recordId)}/document`
        : coa.fileUrl;
      const assays = analysis?.assays || [];
      const assaySummary = assays.length
        ? `<section class="coa-review-assays"><header><strong>Detected testing panel</strong><span>${assays.length} result${assays.length === 1 ? "" : "s"}</span></header><div>${assays.map((assay) => `<span class="coa-assay-result is-${assay.status}"><b>${escapeHtml(assay.name)}</b><small>${escapeHtml(assay.result)}</small></span>`).join("")}</div></section>`
        : "";
      const canDelete = coa.source === "custom" && coa.status === "Review" && !coa.publishedAt;
      return `<article class="coa-review-card ${duplicate ? "is-duplicate" : ""}">
        <div class="coa-review-card-head"><span class="coa-review-document">PDF</span><div><small>${duplicate ? "EXISTING RECORD" : "DETECTED CERTIFICATE"}</small><h3>${escapeHtml(coa.productName === "Needs product review" ? "Product not identified" : (coa.productName || coa.familyName || "Product not identified"))}</h3><p>${escapeHtml(statusLabel)}</p></div><div class="coa-review-card-actions"><span class="status-pill status-pill--${coa.status === "Available" ? "completed" : "pending"}">${escapeHtml(coa.status === "Available" ? "Published" : "Review required")}</span>${canDelete ? `<button class="coa-review-delete" type="button" data-delete-coa="${escapeHtml(coa.recordId || coa.id)}" aria-label="Discard this COA draft" title="Discard draft">×</button>` : ""}</div></div>
        <dl class="coa-review-fields"><div><dt>COA number</dt><dd>${escapeHtml(coa.coaNumber.startsWith("DRAFT-") ? "Not detected" : coa.coaNumber)}</dd></div><div><dt>Batch / lot</dt><dd>${escapeHtml(coa.batch || coa.lot || "Not detected")}</dd></div><div><dt>Purity</dt><dd>${escapeHtml(coa.purity || "Not detected")}</dd></div><div><dt>Laboratory</dt><dd>${escapeHtml(coa.laboratory || "Not detected")}</dd></div><div><dt>Test / analysis date</dt><dd>${escapeHtml(coa.date || "Not detected")}</dd></div><div><dt>Testing allocation</dt><dd>${coa.testingCostPerUnit ? `${escapeHtml(formatCurrency(coa.testingCostPerUnit))} / unit · ${formatNumber(coa.batchUnitCount || 0)} units` : "Not recorded"}</dd></div><div><dt>Store match</dt><dd>${escapeHtml(coa.skus?.join(", ") || (coa.matchedProductId ? `Product ${coa.matchedProductId}` : "Needs mapping"))}</dd></div></dl>
        ${assaySummary}
        <div class="coa-review-notice ${analysis?.status === "failed" || dateNeedsConfirmation ? "is-warning" : ""}"><span>${analysis?.status === "complete" && !dateNeedsConfirmation ? "✓" : "!"}</span><p><strong>${dateNeedsConfirmation ? "Confirm the laboratory test date" : analysis?.status === "complete" ? "Information extracted from the PDF" : "Check the missing information"}</strong><small>${escapeHtml(warning)}</small></p></div>
        <footer>${privateDocument ? `<a class="button button--secondary" href="${escapeHtml(privateDocument)}" target="_blank" rel="noopener noreferrer">Open certificate</a>` : ""}<button class="button button--primary" type="button" data-review-coa="${escapeHtml(coa.recordId || coa.id)}">${coa.status === "Available" ? "Open existing COA" : "Review and approve"}</button></footer>
      </article>`;
    }).join("")
    : '<div class="module-empty"><span>✓</span><strong>No certificates are waiting for review.</strong><small>Upload a PDF or paste a laboratory link above.</small></div>';
}

function normalizePromoType(value: string): "general" | "product" | "simple_gifts" {
  if (value === "product") return "product";
  if (value === "simple_gifts" || value === "sitewide") return "simple_gifts";
  return "general";
}

function renderPromoEditorMode(): void {
  for (const option of document.querySelectorAll<HTMLButtonElement>("[data-promo-option]")) {
    const active = option.dataset.promoOption === selectedPromoType;
    option.classList.toggle("is-active", active);
    option.setAttribute("aria-checked", String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-promo-panel]")) {
    panel.hidden = panel.dataset.promoPanel !== selectedPromoType;
  }
  for (const field of document.querySelectorAll<HTMLElement>("[data-general-url]")) {
    field.hidden = selectedPromoType === "product";
  }
}

function siteControlProduct(): CommerceProduct | undefined {
  const id = Number(requiredElement<HTMLSelectElement>("#promo-product-select").value);
  return commerceData?.products.find((product) => product.id === id);
}

function renderPromoProductOptions(selectedId: number): void {
  const select = requiredElement<HTMLSelectElement>("#promo-product-select");
  const products = [...(commerceData?.products || [])]
    .filter((product) => product.status === "publish" || product.id === selectedId)
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const current = extensionsData?.siteControls?.promo.product;
  const missingCurrent = current && !products.some((product) => product.id === current.id);
  select.innerHTML = `<option value="">Select a product…</option>${missingCurrent ? `<option value="${current.id}">${escapeHtml(current.name)} — ${escapeHtml(current.sku || `Product ${current.id}`)}</option>` : ""}${products.map((product) => `<option value="${product.id}">${escapeHtml(product.name)}${product.sku ? ` — ${escapeHtml(product.sku)}` : ""}</option>`).join("")}`;
  if (selectedId > 0) select.value = String(selectedId);
}

function updatePromoProductPreview(): void {
  const controlsProduct = extensionsData?.siteControls?.promo.product;
  const product = siteControlProduct();
  const selectedId = Number(requiredElement<HTMLSelectElement>("#promo-product-select").value);
  const matchingLive = controlsProduct?.id === selectedId ? controlsProduct : null;
  const name = product?.name || matchingLive?.name || "Select a product";
  const sku = product?.sku || matchingLive?.sku || "—";
  const originalPrice = product?.regularPrice || product?.price || matchingLive?.originalPrice || 0;
  const salePriceInput = requiredElement<HTMLInputElement>("#promo-sale-price-input");
  const salePrice = Number(salePriceInput.value) || matchingLive?.promoPrice || 0;
  const validPrice = originalPrice > 0 && salePrice > 0 && salePrice < originalPrice;
  const activeUntil = extensionsData?.siteControls?.promo.endsAt;
  const liveNow = Boolean(
    matchingLive?.salePriceActive &&
    extensionsData?.siteControls?.promo.enabled &&
    activeUntil &&
    Date.parse(activeUntil) > Date.now(),
  );
  requiredElement<HTMLElement>("#promo-product-name").textContent = name;
  requiredElement<HTMLElement>("#promo-product-sku").textContent = sku;
  requiredElement<HTMLElement>("#promo-current-price").textContent = originalPrice > 0 ? formatCurrency(originalPrice) : "—";
  requiredElement<HTMLElement>("#promo-original-price").textContent = originalPrice > 0 ? formatCurrency(originalPrice) : "—";
  requiredElement<HTMLElement>("#promo-sale-price").textContent = salePrice > 0 ? formatCurrency(salePrice) : "—";
  requiredElement<HTMLElement>("#promo-price-state").textContent = liveNow ? "Live in store + checkout" : validPrice ? "Ready to publish" : selectedId ? "Needs a valid price" : "Not scheduled";
  const discountSummary = requiredElement<HTMLElement>("#promo-discount-summary");
  const commerceStatus = requiredElement<HTMLElement>("#promo-commerce-status");
  salePriceInput.setAttribute("aria-invalid", String(Boolean(salePrice > 0 && !validPrice)));
  commerceStatus.classList.toggle("is-ready", validPrice);
  commerceStatus.classList.toggle("is-warning", Boolean(selectedId && salePrice > 0 && !validPrice));
  if (!selectedId) {
    discountSummary.textContent = "Select a product to prepare its real selling price.";
    commerceStatus.querySelector("strong")!.textContent = "Choose a product first";
    commerceStatus.querySelector("small")!.textContent = "The catalog price and checkout validation will appear automatically.";
  } else if (validPrice) {
    const savings = originalPrice - salePrice;
    const percentage = Math.round((savings / originalPrice) * 100);
    discountSummary.textContent = `${percentage}% off · customers save ${formatCurrency(savings)}`;
    commerceStatus.querySelector("strong")!.textContent = liveNow ? "Promotion synchronized" : "One price everywhere";
    commerceStatus.querySelector("small")!.textContent = liveNow
      ? "The storefront, cart and checkout are using this promotional price."
      : "Saving publishes this exact price to the storefront, cart and checkout.";
  } else if (salePrice > 0) {
    discountSummary.textContent = "The promotional price must be lower than the normal price.";
    commerceStatus.querySelector("strong")!.textContent = "Price needs attention";
    commerceStatus.querySelector("small")!.textContent = "Use an amount below the normal catalog price before publishing.";
  } else {
    discountSummary.textContent = "Enter the price customers will actually pay.";
    commerceStatus.querySelector("strong")!.textContent = "Set the customer price";
    commerceStatus.querySelector("small")!.textContent = "It will be synchronized with the storefront and checkout when saved.";
  }
  const media = requiredElement<HTMLElement>("#featured-promo-media");
  const image = product?.thumbnailUrl || product?.imageUrl || matchingLive?.image || "";
  media.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />` : "<span>P1</span>";
}

function updateMaintenancePreview(): void {
  const enabled = requiredElement<HTMLInputElement>("#maintenance-enabled").checked;
  const title = requiredElement<HTMLInputElement>("#maintenance-title").value.trim();
  const message = requiredElement<HTMLTextAreaElement>("#maintenance-message").value.trim();
  requiredElement<HTMLElement>("#maintenance-preview-title").textContent = title || "Precision work in progress.";
  requiredElement<HTMLElement>("#maintenance-preview-message").textContent = message || "The storefront is available.";
  requiredElement<HTMLElement>("#maintenance-preview-status").textContent = enabled ? "Maintenance screen active" : "Website online";
  requiredElement<HTMLElement>("#maintenance-state").textContent = enabled ? "ACTIVE" : "STANDBY";
}

function updateSiteControlsDraftState(): void {
  const indicator = requiredElement<HTMLElement>("#site-controls-draft-state");
  indicator.hidden = !siteControlsDraft.dirty;
  indicator.classList.toggle("has-remote-update", siteControlsDraft.remoteChanged);
  indicator.querySelector("strong")!.textContent = siteControlsDraft.remoteChanged
    ? "Draft protected"
    : "Unsaved changes";
  indicator.querySelector("small")!.textContent = siteControlsDraft.remoteChanged
    ? "The published version changed, but your entries were not replaced. Save to apply your draft or reload to discard it."
    : "Your entries are protected from automatic refreshes.";
}

function markSiteControlsDirty(): void {
  siteControlsDraft = markSiteControlsDraftDirty(siteControlsDraft);
  updateSiteControlsDraftState();
}

function renderSiteControls(options: { force?: boolean } = {}): void {
  const controls = extensionsData?.siteControls;
  const save = requiredElement<HTMLButtonElement>("#site-controls-save");
  const writable = Boolean(workspaceSession?.permissions.operate);
  save.disabled = !writable || !controls;
  save.textContent = writable ? "Save storefront controls" : "Read-only access";
  requiredElement<HTMLElement>("#site-controls-write-status").textContent = writable
    ? "Independent control state · product campaigns synchronize the real checkout price"
    : "Your role can review controls but cannot publish changes.";
  if (!controls) {
    requiredElement<HTMLElement>("#site-controls-version").textContent = "Control service unavailable";
    return;
  }
  requiredElement<HTMLElement>("#site-controls-version").textContent = controls.revision
    ? `Independent control · revision ${controls.revision}`
    : `Independent control · v${controls.version || "2.0"}`;
  const decision = reconcileSiteControlsDraft(siteControlsDraft, Number(controls.revision || 0), options.force === true);
  siteControlsDraft = decision.state;
  updateSiteControlsDraftState();
  if (!decision.hydrate) return;
  selectedPromoType = normalizePromoType(controls.promo.type);
  requiredElement<HTMLInputElement>("#promo-enabled").checked = controls.promo.enabled;
  requiredElement<HTMLElement>("#promo-state").textContent = controls.promo.enabled ? "ACTIVE" : "OFF";
  requiredElement<HTMLInputElement>("#promo-eyebrow").value = controls.promo.eyebrow;
  requiredElement<HTMLInputElement>("#promo-cta").value = controls.promo.ctaLabel;
  requiredElement<HTMLInputElement>("#promo-title").value = controls.promo.title;
  requiredElement<HTMLTextAreaElement>("#promo-info").value = controls.promo.info;
  requiredElement<HTMLInputElement>("#promo-cta-url").value = controls.promo.ctaUrl;
  requiredElement<HTMLInputElement>("#promo-sitewide-label").value = "10% SITEWIDE";
  requiredElement<HTMLElement>("#promo-ends-at").textContent = controls.promo.endsAt
    ? `Ends ${formatCommerceTimestamp(controls.promo.endsAt)}`
    : "No active end date";
  const duration = Math.max(1, Math.floor(controls.promo.durationMinutes || 1_440));
  requiredElement<HTMLInputElement>("#promo-duration-days").value = String(Math.floor(duration / 1_440));
  requiredElement<HTMLInputElement>("#promo-duration-hours").value = String(Math.floor((duration % 1_440) / 60));
  requiredElement<HTMLInputElement>("#promo-duration-minutes").value = String(duration % 60);
  requiredElement<HTMLInputElement>("#promo-restart").checked = false;
  renderPromoProductOptions(controls.promo.product?.id || 0);
  requiredElement<HTMLInputElement>("#promo-sale-price-input").value = controls.promo.product?.promoPrice ? String(controls.promo.product.promoPrice) : "";
  renderPromoEditorMode();
  updatePromoProductPreview();
  requiredElement<HTMLInputElement>("#maintenance-enabled").checked = controls.maintenance.enabled;
  requiredElement<HTMLInputElement>("#maintenance-title").value = controls.maintenance.title;
  requiredElement<HTMLTextAreaElement>("#maintenance-message").value = controls.maintenance.message;
  requiredElement<HTMLInputElement>("#maintenance-email").value = controls.maintenance.supportEmail;
  updateMaintenancePreview();
  updatePromoCountdown();
}

function updatePromoCountdown(): void {
  const endsAt = extensionsData?.siteControls?.promo.endsAt;
  const remaining = endsAt ? Math.max(0, Date.parse(endsAt) - Date.now()) : 0;
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  requiredElement<HTMLElement>("#promo-countdown").innerHTML = `<b>${String(days).padStart(2, "0")}<small>days</small></b><b>${String(hours).padStart(2, "0")}<small>hours</small></b><b>${String(minutes).padStart(2, "0")}<small>minutes</small></b>`;
}

async function loadExtensions(): Promise<void> {
  try {
    const response = await fetch("/api/extensions", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload)) throw new Error("Business modules unavailable");
    extensionsData = payload as unknown as ExtensionsPayload;
  } catch {
    extensionsData = {
      connected: false,
      coas: extensionsData?.coas || [],
      siteControls: extensionsData?.siteControls || null,
      siteControlsWriteEnabled: Boolean(workspaceSession?.permissions.operate),
      siteControlsSource: "operations-control-plane",
    };
  }
  renderCoaManager();
  renderSiteControls();
  renderLabelWorkspace();
  if (!lastUpdatedAt) lastUpdatedAt = Date.now();
  updateRelativeTime();
}

async function loadIndependentSiteControls(forceRender = false): Promise<void> {
  try {
    const response = await fetch("/api/site-controls", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.siteControls)) {
      throw new Error("Independent control service unavailable");
    }
    extensionsData = {
      ...(extensionsData || { connected: false, coas: [], siteControls: null }),
      siteControls: payload.siteControls as unknown as SiteControls,
      siteControlsWriteEnabled: payload.canManage === true,
      siteControlsSource: "operations-control-plane",
      siteControlsStorage: typeof payload.storage === "string" ? payload.storage : "independent",
      storefrontDelivery: typeof payload.storefrontDelivery === "string" ? payload.storefrontDelivery : "research-peptides-direct",
    };
    renderSiteControls({ force: forceRender });
  } catch {
    if (!extensionsData?.siteControls) {
      requiredElement<HTMLElement>("#site-controls-version").textContent = "Independent control service unavailable";
    }
  }
}

async function saveSiteControls(): Promise<void> {
  if (!workspaceSession?.permissions.operate) {
    showToast("Read-only access", "An operations or administrator role is required to change the storefront.", false);
    return;
  }
  const promotionEnabled = requiredElement<HTMLInputElement>("#promo-enabled").checked;
  const selectedProduct = siteControlProduct();
  const requestedSalePrice = Number(requiredElement<HTMLInputElement>("#promo-sale-price-input").value) || 0;
  if (promotionEnabled && selectedPromoType === "product") {
    const catalogPrice = selectedProduct?.regularPrice || selectedProduct?.price || 0;
    if (!selectedProduct) {
      showToast("Choose a product", "Select the exact product that should receive the promotion.", false);
      requiredElement<HTMLSelectElement>("#promo-product-select").focus();
      return;
    }
    if (selectedProduct.type !== "simple") {
      showToast("Choose an exact presentation", "This product has multiple options, so one shared price could charge the wrong amount.", false);
      return;
    }
    if (requestedSalePrice <= 0 || requestedSalePrice >= catalogPrice) {
      showToast("Check the promotional price", "Enter an amount lower than the normal catalog price.", false);
      requiredElement<HTMLInputElement>("#promo-sale-price-input").focus();
      return;
    }
  }
  const save = requiredElement<HTMLButtonElement>("#site-controls-save");
  save.disabled = true;
  save.textContent = "Securing change…";
  const payload = {
    expectedRevision: Number(extensionsData?.siteControls?.revision || 0),
    promo: {
      enabled: promotionEnabled,
      type: selectedPromoType,
      productId: Number(requiredElement<HTMLSelectElement>("#promo-product-select").value) || 0,
      salePrice: requestedSalePrice,
      sitewideLabel: requiredElement<HTMLInputElement>("#promo-sitewide-label").value.trim(),
      eyebrow: requiredElement<HTMLInputElement>("#promo-eyebrow").value.trim(),
      title: requiredElement<HTMLInputElement>("#promo-title").value.trim(),
      info: requiredElement<HTMLTextAreaElement>("#promo-info").value.trim(),
      ctaLabel: requiredElement<HTMLInputElement>("#promo-cta").value.trim(),
      ctaUrl: requiredElement<HTMLInputElement>("#promo-cta-url").value.trim(),
      durationDays: Number(requiredElement<HTMLInputElement>("#promo-duration-days").value) || 0,
      durationHours: Number(requiredElement<HTMLInputElement>("#promo-duration-hours").value) || 0,
      durationMinutes: Number(requiredElement<HTMLInputElement>("#promo-duration-minutes").value) || 0,
      restart: requiredElement<HTMLInputElement>("#promo-restart").checked,
      product: selectedProduct ? {
        name: selectedProduct.name,
        sku: selectedProduct.sku,
        image: selectedProduct.thumbnailUrl || selectedProduct.imageUrl || "",
        originalPrice: selectedProduct.regularPrice || selectedProduct.price || 0,
      } : null,
    },
    maintenance: {
      enabled: requiredElement<HTMLInputElement>("#maintenance-enabled").checked,
      title: requiredElement<HTMLInputElement>("#maintenance-title").value.trim(),
      message: requiredElement<HTMLTextAreaElement>("#maintenance-message").value.trim(),
      supportEmail: requiredElement<HTMLInputElement>("#maintenance-email").value.trim(),
    },
  };
  try {
    const response = await fetch("/api/extensions/site-controls", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(result) && typeof result.error === "string" ? result.error : "Site controls could not be published");
    if (isRecord(result) && isRecord(result.siteControls)) {
      extensionsData = {
        ...(extensionsData || { connected: false, coas: [] }),
        siteControls: result.siteControls as unknown as SiteControls,
        siteControlsWriteEnabled: true,
        siteControlsSource: "operations-control-plane",
      };
      renderSiteControls({ force: true });
    } else {
      await loadExtensions();
    }
    showToast(
      promotionEnabled && selectedPromoType === "product" ? "Promotion is live" : "Storefront controls published",
      promotionEnabled && selectedPromoType === "product"
        ? "The promotional price is synchronized with the product, cart and checkout."
        : "research-peptides is now reading this revision directly.",
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("another session")) {
      await loadIndependentSiteControls();
    }
    showToast("Unable to publish", error instanceof Error ? error.message : "Check the protected connection and try again.", false);
  } finally {
    save.textContent = workspaceSession?.permissions.operate ? "Save storefront controls" : "Read-only access";
    save.disabled = !workspaceSession?.permissions.operate;
  }
}

function updateRelativeTime(): void {
  if (!lastUpdatedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1_000));
  const label =
    seconds < 5
      ? "Now"
      : seconds < 60
        ? `${seconds}s ago`
        : `${Math.floor(seconds / 60)} min ago`;
  updatedElement.textContent = label;
  footerUpdated.textContent = label;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function roleLabel(role: WorkspaceRole): string {
  return { owner: "Owner", administrator: "Administrator", operations: "Operations", analyst: "Analyst" }[role];
}

function userInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "P1";
}

async function loadWorkspaceSession(): Promise<void> {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.user) || !isRecord(payload.permissions)) return;
    workspaceSession = payload as unknown as WorkspaceSession;
    const initials = userInitials(workspaceSession.user.displayName);
    const role = roleLabel(workspaceSession.user.role);
    requiredElement<HTMLElement>("#account-initials").textContent = initials;
    requiredElement<HTMLElement>("#account-name").textContent = workspaceSession.user.displayName;
    requiredElement<HTMLElement>("#account-role").textContent = role;
    requiredElement<HTMLElement>("#account-menu-initials").textContent = initials;
    requiredElement<HTMLElement>("#account-menu-name").textContent = workspaceSession.user.displayName;
    requiredElement<HTMLElement>("#account-menu-role").textContent = `${role} account`;
    requiredElement<HTMLButtonElement>("#open-user-create").hidden = !workspaceSession.permissions.administer;
    if (loyaltyData) renderLoyalty();
    if (extensionsData) renderSiteControls();
    if (fulfillmentLocations) renderLabelWorkspace();
  } catch {
    // The server redirects unauthenticated sessions before the dashboard loads.
  }
}

function renderWorkspaceUsers(): void {
  const container = requiredElement<HTMLElement>("#team-list");
  const search = requiredElement<HTMLInputElement>("#team-search").value.trim().toLocaleLowerCase("en");
  const users = workspaceUsers.filter((user) => !search || `${user.displayName} ${user.username} ${user.email}`.toLocaleLowerCase("en").includes(search));
  requiredElement<HTMLElement>("#team-count").textContent = `${workspaceUsers.length} ${workspaceUsers.length === 1 ? "person" : "people"}`;
  if (!users.length) {
    container.innerHTML = '<div class="customer-empty-detail"><span>⊙</span><strong>No matching people</strong><small>Try another name, username or email.</small></div>';
    return;
  }
  const canAdminister = Boolean(workspaceSession?.permissions.administer);
  container.innerHTML = users.map((user) => {
    const current = user.id === workspaceSession?.user.id;
    return `<article class="team-member${user.status === "suspended" ? " is-suspended" : ""}" data-user-id="${escapeHtml(user.id)}"><span class="team-avatar">${escapeHtml(userInitials(user.displayName))}</span><div class="team-identity"><strong>${escapeHtml(user.displayName)}${current ? " <em>You</em>" : ""}</strong><span>@${escapeHtml(user.username)}${user.email ? ` · ${escapeHtml(user.email)}` : " · Primary account"}</span><small>${user.lastLoginAt ? `Last login ${escapeHtml(formatCommerceTimestamp(user.lastLoginAt))}` : "Has not signed in yet"}</small></div><div class="team-access"><select data-user-role aria-label="Role for ${escapeHtml(user.displayName)}" ${!canAdminister || current ? "disabled" : ""}>${(["owner", "administrator", "operations", "analyst"] as WorkspaceRole[]).map((role) => `<option value="${role}"${role === user.role ? " selected" : ""}>${roleLabel(role)}</option>`).join("")}</select><span class="team-status ${user.status === "active" ? "is-active" : ""}">${user.status === "active" ? "Active" : "Suspended"}</span></div><div class="team-actions"><button type="button" data-user-reset ${!canAdminister || current ? "disabled" : ""}>Reset password</button><button type="button" data-user-status ${!canAdminister || current ? "disabled" : ""}>${user.status === "active" ? "Suspend" : "Reactivate"}</button></div></article>`;
  }).join("");
}

async function loadWorkspaceUsers(): Promise<void> {
  const container = requiredElement<HTMLElement>("#team-list");
  if (!workspaceSession?.permissions.administer) {
    container.innerHTML = '<div class="customer-empty-detail"><span>◇</span><strong>Administrator access required</strong><small>Your role can use the workspace but cannot manage other accounts.</small></div>';
    requiredElement<HTMLElement>("#team-count").textContent = "Restricted directory";
    return;
  }
  try {
    const response = await fetch("/api/users", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.users)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Team directory could not be loaded");
    workspaceUsers = payload.users as WorkspaceUser[];
    renderWorkspaceUsers();
  } catch (error) {
    container.innerHTML = `<div class="customer-empty-detail"><span>!</span><strong>Unable to load team</strong><small>${escapeHtml(error instanceof Error ? error.message : "Try again shortly.")}</small></div>`;
  }
}

function metricChange(value: number | null, inverse = false): string {
  if (value === null || !Number.isFinite(value)) return "No prior comparison";
  const improved = inverse ? value > 0 : value >= 0;
  return `${improved ? "↑" : "↓"} ${Math.abs(value).toFixed(1)}% vs previous period`;
}

function renderSeoChart(rows: SeoRow[]): void {
  const chart = requiredElement<HTMLElement>("#seo-chart");
  if (!rows.length) { chart.innerHTML = '<p class="empty-state">No search activity is available for this period.</p>'; return; }
  const width = 100; const height = 100;
  const maxClicks = Math.max(1, ...rows.map((row) => row.clicks));
  const maxImpressions = Math.max(1, ...rows.map((row) => row.impressions));
  const points = (key: "clicks" | "impressions", max: number) => rows.map((row, index) => `${rows.length === 1 ? 50 : (index / (rows.length - 1)) * width},${height - (row[key] / max) * 82 - 8}`).join(" ");
  chart.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Organic clicks and impressions over ${rows.length} days"><polyline class="seo-line-impressions" points="${points("impressions", maxImpressions)}"/><polyline class="seo-line-clicks" points="${points("clicks", maxClicks)}"/></svg><div class="seo-chart-labels">${rows.filter((_, index) => index % Math.max(1, Math.floor(rows.length / 6)) === 0 || index === rows.length - 1).map((row) => `<span>${escapeHtml(row.key.slice(5))}</span>`).join("")}</div>`;
}

function renderSeoTable(selector: string, rows: SeoRow[], page = false): void {
  const body = requiredElement<HTMLElement>(selector);
  if (!rows.length) { body.innerHTML = '<tr><td colspan="5"><div class="table-loading">No data for this period.</div></td></tr>'; return; }
  body.innerHTML = rows.slice(0, 12).map((row) => `<tr><td><span class="seo-key${page ? " is-page" : ""}" title="${escapeHtml(row.key)}">${escapeHtml(page ? row.key.replace(/^https?:\/\/[^/]+/, "") || "/" : row.key)}</span></td><td class="cell-money">${formatNumber(Math.round(row.clicks))}</td><td>${formatNumber(Math.round(row.impressions))}</td><td>${(row.ctr * 100).toFixed(1)}%</td><td>${row.position.toFixed(1)}</td></tr>`).join("");
}

function seoDimensionLabel(value: string, dimension: "device" | "country"): string {
  const normalized = value.trim().toLowerCase();
  if (dimension === "device") {
    return ({ mobile: "Mobile", desktop: "Desktop", tablet: "Tablet" } as Record<string, string>)[normalized] || value;
  }
  const countryNames: Record<string, string> = {
    usa: "United States", can: "Canada", gbr: "United Kingdom", aus: "Australia", deu: "Germany",
    fra: "France", mex: "Mexico", col: "Colombia", esp: "Spain", ita: "Italy", ind: "India",
    mys: "Malaysia", pri: "Puerto Rico", nld: "Netherlands", bra: "Brazil", jpn: "Japan",
  };
  return countryNames[normalized] || value.toUpperCase();
}

function renderSeoInsights(selector: string, rows: SeoRow[], dimension: "device" | "country"): void {
  const container = requiredElement<HTMLElement>(selector);
  const total = Math.max(1, rows.reduce((sum, item) => sum + item.clicks, 0));
  container.innerHTML = rows.slice(0, 6).map((item) => {
    const share = (item.clicks / total) * 100;
    return `<div class="insight-row"><div class="insight-row-head"><strong>${escapeHtml(seoDimensionLabel(item.key, dimension))}</strong><span>${formatNumber(Math.round(item.clicks))} click${Math.round(item.clicks) === 1 ? "" : "s"} · ${share.toFixed(0)}%</span></div><progress class="insight-row-bar" max="100" value="${Math.max(0, Math.min(100, share))}" aria-label="${share.toFixed(0)} percent of organic clicks"></progress></div>`;
  }).join("") || '<p class="empty-state">No data available for this period.</p>';
}

function renderSeo(report: SeoReport): void {
  const total = report.totals;
  requiredElement<HTMLElement>("#seo-clicks").textContent = formatNumber(Math.round(total.clicks));
  requiredElement<HTMLElement>("#seo-impressions").textContent = formatNumber(Math.round(total.impressions));
  requiredElement<HTMLElement>("#seo-ctr").textContent = `${(total.ctr * 100).toFixed(1)}%`;
  requiredElement<HTMLElement>("#seo-position").textContent = total.position ? total.position.toFixed(1) : "—";
  requiredElement<HTMLElement>("#seo-clicks-change").textContent = metricChange(report.changes.clicks);
  requiredElement<HTMLElement>("#seo-impressions-change").textContent = metricChange(report.changes.impressions);
  requiredElement<HTMLElement>("#seo-ctr-change").textContent = metricChange(report.changes.ctr);
  requiredElement<HTMLElement>("#seo-position-change").textContent = report.changes.position === null ? "No prior comparison" : `${report.changes.position >= 0 ? "↑" : "↓"} ${Math.abs(report.changes.position).toFixed(1)} positions`;
  requiredElement<HTMLElement>("#seo-opportunity-count").textContent = String(report.opportunities.length);
  requiredElement<HTMLElement>("#seo-period").textContent = `${formatShortDateLabel(report.period.start)} – ${formatShortDateLabel(report.period.end)}`;
  const navCount = requiredElement<HTMLElement>("#seo-nav-count"); navCount.textContent = String(report.opportunities.length); navCount.hidden = report.opportunities.length === 0;
  renderSeoChart(report.daily);
  renderSeoTable("#seo-query-body", report.topQueries);
  renderSeoTable("#seo-page-body", report.topPages, true);
  renderSeoInsights("#seo-devices", report.devices, "device");
  renderSeoInsights("#seo-countries", report.countries, "country");
  const opportunities = requiredElement<HTMLElement>("#seo-opportunities");
  opportunities.innerHTML = report.opportunities.map((item, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title.replace(/^https?:\/\/[^/]+/, "") || "/")}</strong><p>${escapeHtml(item.message)}</p><small>${escapeHtml(item.impact)}</small></div><b>${item.type === "query" ? "QUERY" : "PAGE"}</b></article>`).join("") || '<div class="customer-empty-detail"><span>✓</span><strong>No urgent SEO opportunities</strong><small>Search performance is currently within healthy thresholds.</small></div>';
  requiredElement<HTMLElement>("#seo-opportunity-summary").textContent = report.opportunities.length === 1 ? "priority" : "priorities";
  const sitemaps = requiredElement<HTMLElement>("#seo-sitemaps");
  sitemaps.innerHTML = report.sitemaps.map((item) => `<article><span>${String(item.isPending) === "true" ? "…" : "✓"}</span><div><strong>${escapeHtml(String(item.path || "Sitemap"))}</strong><small>${formatNumber(Number(item.contents && Array.isArray(item.contents) ? (item.contents as Array<Record<string, unknown>>).reduce((sum, content) => sum + Number(content.submitted || 0), 0) : 0))} submitted · ${item.lastSubmitted ? escapeHtml(formatCommerceTimestamp(String(item.lastSubmitted))) : "Awaiting submission data"}</small></div></article>`).join("") || '<p class="empty-state">No sitemap records were returned.</p>';
}

async function loadSeo(force = false): Promise<void> {
  const state = requiredElement<HTMLElement>("#seo-connection-state");
  state.textContent = force ? "Syncing" : "Checking";
  try {
    const response = await fetch(force ? "/api/seo/sync" : "/api/seo", { method: force ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json", ...(force ? { "Content-Type": "application/json" } : {}) }, ...(force ? { body: "{}" } : {}) });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Search performance could not be loaded");
    const configured = payload.configured !== false;
    const connected = payload.connected === true || (isRecord(payload.report) && payload.report.connected === true);
    if (typeof payload.callbackUrl === "string" && payload.callbackUrl) {
      requiredElement<HTMLElement>("#seo-callback-url").textContent = payload.callbackUrl;
    }
    requiredElement<HTMLElement>("#seo-setup").hidden = configured && connected;
    const connect = requiredElement<HTMLButtonElement>("#seo-connect");
    connect.disabled = !configured || !workspaceSession?.permissions.administer;
    connect.textContent = connected ? "Reconnect account" : configured ? "Connect search data" : "Credentials required";
    requiredElement<HTMLButtonElement>("#seo-sync").disabled = !connected || !workspaceSession?.permissions.operate;
    requiredElement<HTMLElement>("#seo-connection-title").textContent = connected ? "Phase One Labz search data is connected" : configured ? "Ready for secure authorization" : "Google credentials required";
    requiredElement<HTMLElement>("#seo-connection-copy").textContent = connected ? "Read-only access · phaseonelabz.com · refreshed on demand" : configured ? "Authorize the Google account that owns the Phase One Labz property." : "Add the client ID and client secret to activate the OAuth connection.";
    state.textContent = connected ? "Connected" : configured ? "Ready" : "Setup required";
    state.className = `integration-state${connected ? " integration-state--connected" : " integration-state--planned"}`;
    const property = requiredElement<HTMLSelectElement>("#seo-property");
    const sites = Array.isArray(payload.sites) ? payload.sites as Array<{ siteUrl: string }> : [];
    property.innerHTML = sites.map((site) => `<option value="${escapeHtml(site.siteUrl)}"${site.siteUrl === payload.siteUrl ? " selected" : ""}>${escapeHtml(site.siteUrl)}</option>`).join("");
    if (isRecord(payload.report)) renderSeo(payload.report as unknown as SeoReport);
    if (isRecord(payload.report) && force) showToast("Search data synchronized", "SEO metrics and opportunities now reflect the latest available Search Console data.");
  } catch (error) {
    state.textContent = "Unavailable";
    showToast("SEO sync unavailable", error instanceof Error ? error.message : "Try again shortly.", false);
  }
}

function updateNotificationBadge(): void {
  const unread = workspaceNotifications.filter((item) => !item.read).length + orderNotificationCount;
  const badge = requiredElement<HTMLElement>("#notification-badge");
  badge.textContent = String(unread);
  badge.hidden = unread === 0;
  requiredElement<HTMLElement>("#notification-unread").textContent = `${unread} unread`;
}

function notificationTime(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} hr ago`;
  return formatShortDateLabel(value.slice(0, 10));
}

function notificationOrderId(item: WorkspaceNotification): number | null {
  if (Number.isSafeInteger(item.actionEntityId) && Number(item.actionEntityId) > 0) {
    return Number(item.actionEntityId);
  }
  const orderNumber = item.title.match(/#([^\s]+)/)?.[1];
  return commerceData?.orders.find((order) => order.number === orderNumber)?.id || null;
}

function renderOrderCatchup(): void {
  const stack = requiredElement<HTMLElement>("#order-catchup-stack");
  const list = requiredElement<HTMLElement>("#order-catchup-list");
  const more = requiredElement<HTMLButtonElement>("#order-catchup-more");
  const unreadOrders = catchupOrderNotifications.filter((item) => !item.read);
  stack.hidden = unreadOrders.length === 0;
  if (!unreadOrders.length) {
    list.innerHTML = "";
    more.hidden = true;
    return;
  }
  const visible = unreadOrders.slice(0, 5);
  requiredElement<HTMLElement>("#order-catchup-title").textContent = `${unreadOrders.length} new order${unreadOrders.length === 1 ? "" : "s"} received`;
  list.innerHTML = visible.map((item) => {
    const warning = item.severity === "warning" || item.severity === "critical";
    return `<article class="order-catchup-card${warning ? " is-warning" : ""}" data-catchup-notification="${escapeHtml(item.id)}"><button class="order-catchup-open" type="button"><span class="order-catchup-icon" aria-hidden="true">${warning ? "!" : "✓"}</span><div><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(notificationTime(item.createdAt))}</small></span><p>${escapeHtml(item.message)}</p><em>${warning ? "Review payment" : "Open order"} →</em></div></button><button class="order-catchup-dismiss" type="button" aria-label="Dismiss ${escapeHtml(item.title)}">×</button></article>`;
  }).join("");
  const remaining = unreadOrders.length - visible.length;
  more.hidden = remaining < 1;
  more.textContent = remaining > 0 ? `View ${remaining} more in notifications` : "";
}

async function markWorkspaceNotificationRead(id: string): Promise<void> {
  const response = await fetch("/api/notifications/read", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error("The notification could not be updated");
  workspaceNotifications = workspaceNotifications.map((item) => item.id === id ? { ...item, read: true } : item);
  catchupOrderNotifications = catchupOrderNotifications.filter((item) => item.id !== id);
  renderNotifications();
  renderOrderCatchup();
}

function renderNotifications(): void {
  const list = requiredElement<HTMLElement>("#notification-list");
  const items = workspaceNotifications.filter((item) => notificationFilter === "all" || item.type === notificationFilter);
  list.innerHTML = items.map((item) => `<button class="notification-item${item.read ? "" : " is-unread"}" type="button" data-notification-id="${escapeHtml(item.id)}" data-notification-view="${escapeHtml(item.actionView)}"><span class="notification-type notification-type--${item.severity}">${item.type === "order" ? "▤" : item.type === "seo" ? "⌁" : item.type === "security" ? "◇" : "P1"}</span><div><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(notificationTime(item.createdAt))}</small></span><p>${escapeHtml(item.message)}</p><em>${item.type.toUpperCase()}</em></div>${item.read ? "" : '<i aria-label="Unread"></i>'}</button>`).join("") || '<div class="customer-empty-detail"><span>✓</span><strong>All clear</strong><small>No notifications in this category.</small></div>';
  updateNotificationBadge();
}

async function loadNotifications(): Promise<void> {
  try {
    const response = await fetch("/api/notifications", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.notifications)) return;
    workspaceNotifications = payload.notifications as WorkspaceNotification[];
    catchupOrderNotifications = workspaceNotifications.filter((item) => item.type === "order" && !item.read);
    orderNotificationCount = 0;
    renderNotifications();
    renderOrderCatchup();
  } catch { updateNotificationBadge(); }
}

function openNotificationCenter(): void {
  requiredElement<HTMLElement>("#notification-center").hidden = false;
  requiredElement<HTMLButtonElement>("#notification-backdrop").hidden = false;
  document.body.classList.add("drawer-open");
  void loadNotifications();
}

function closeNotificationCenter(): void {
  requiredElement<HTMLElement>("#notification-center").hidden = true;
  requiredElement<HTMLButtonElement>("#notification-backdrop").hidden = true;
  document.body.classList.remove("drawer-open");
}

function setDialogVisibility(dialogSelector: string, backdropSelector: string, visible: boolean): void {
  requiredElement<HTMLElement>(dialogSelector).hidden = !visible;
  requiredElement<HTMLButtonElement>(backdropSelector).hidden = !visible;
  document.body.classList.toggle("drawer-open", visible);
}

function closeUserDialog(): void {
  setDialogVisibility("#user-dialog", "#user-dialog-backdrop", false);
  requiredElement<HTMLFormElement>("#user-form").reset();
}

let resetPasswordUserId = "";
function closePasswordResetDialog(): void {
  setDialogVisibility("#password-reset-dialog", "#password-reset-backdrop", false);
  requiredElement<HTMLFormElement>("#password-reset-form").reset();
  resetPasswordUserId = "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isDateKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00.000Z`))
  );
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function optionalFinite(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isFiniteNumber(record[key]);
}

function isSnapshot(value: unknown): value is DashboardSnapshot {
  if (!isRecord(value) || value.type !== "presence:snapshot") return false;
  if (!isFiniteNumber(value.total) || !isTimestamp(value.serverTime)) return false;
  if (!isRecord(value.counts) || !isRecord(value.analytics)) return false;
  const counts = value.counts;
  const analytics = value.analytics;
  if (!PRESENCE_SECTIONS.every((section) => isFiniteNumber(counts[section]))) {
    return false;
  }

  const requiredTotals = [
    "totalViews",
    "uniqueVisitors",
    "totalSessions",
    "totalClicks",
    "visitorsLast30Minutes",
  ];
  if (!requiredTotals.every((key) => isFiniteNumber(analytics[key]))) return false;
  if (
    !["returningVisitors", "returningSessions", "totalOrders"].every(
      (key) => optionalFinite(analytics, key),
    ) ||
    (analytics.timeZone !== undefined && !isTimeZone(analytics.timeZone))
  ) {
    return false;
  }

  if (analytics.visitorRanges !== undefined) {
    if (!isRecord(analytics.visitorRanges)) return false;
    const visitorRanges = analytics.visitorRanges;
    if (
      !["today", "last7Days", "last30Days", "all"].every((key) =>
        isFiniteNumber(visitorRanges[key]),
      )
    ) {
      return false;
    }
  }

  const validRank = (item: unknown): boolean =>
    isRecord(item) && typeof item.label === "string" && isFiniteNumber(item.count);
  const validPage = (item: unknown): boolean =>
    isRecord(item) && typeof item.path === "string" && isFiniteNumber(item.views);
  const validClick = (item: unknown): boolean =>
    isRecord(item) &&
    typeof item.path === "string" &&
    typeof item.label === "string" &&
    isFiniteNumber(item.count);
  const validDailyView = (item: unknown): boolean =>
    isRecord(item) && isDateKey(item.date) && isFiniteNumber(item.views);
  const validDailyVisitor = (item: unknown): boolean =>
    isRecord(item) && isDateKey(item.date) && isFiniteNumber(item.visitors);
  const validDailyActivity = (item: unknown): boolean =>
    isRecord(item) &&
    isDateKey(item.date) &&
    isFiniteNumber(item.views) &&
    isFiniteNumber(item.sessions) &&
    isFiniteNumber(item.clicks) &&
    optionalFinite(item, "visitors") &&
    optionalFinite(item, "returningSessions") &&
    optionalFinite(item, "orders");
  const validEvent = (item: unknown): boolean =>
    isRecord(item) &&
    (item.type === "pageview" || item.type === "click" || item.type === "order") &&
    isTimestamp(item.at) &&
    typeof item.path === "string" &&
    (item.label === undefined || typeof item.label === "string") &&
    (item.status === undefined || item.status === "paid");
  const validSession = (item: unknown): boolean =>
    isRecord(item) &&
    typeof item.id === "string" &&
    isFiniteNumber(item.number) &&
    typeof item.source === "string" &&
    typeof item.device === "string" &&
    typeof item.path === "string" &&
    isTimestamp(item.startedAt) &&
    isTimestamp(item.lastSeenAt) &&
    isFiniteNumber(item.pageViews) &&
    isFiniteNumber(item.clicks) &&
    optionalFinite(item, "visitorNumber") &&
    optionalFinite(item, "visitNumber") &&
    (item.returningVisitor === undefined || typeof item.returningVisitor === "boolean") &&
    (item.orderCompleted === undefined || typeof item.orderCompleted === "boolean") &&
    (item.orderCompletedAt === undefined || isTimestamp(item.orderCompletedAt)) &&
    Array.isArray(item.events) &&
    item.events.every(validEvent);
  const validMarketingItem = (item: unknown): boolean =>
    isRecord(item) &&
    isFiniteNumber(item.productId) &&
    isFiniteNumber(item.variationId) &&
    typeof item.name === "string" &&
    typeof item.sku === "string" &&
    isFiniteNumber(item.quantity) &&
    isFiniteNumber(item.price) &&
    typeof item.imageUrl === "string";
  const validMarketingCart = (item: unknown): boolean =>
    isRecord(item) &&
    typeof item.sessionId === "string" &&
    isFiniteNumber(item.visitorNumber) &&
    typeof item.customerName === "string" &&
    typeof item.customerEmail === "string" &&
    Array.isArray(item.items) &&
    item.items.every(validMarketingItem) &&
    isFiniteNumber(item.itemCount) &&
    isFiniteNumber(item.total) &&
    ["active", "abandoned", "converted", "cleared"].includes(String(item.status)) &&
    isTimestamp(item.createdAt) &&
    isTimestamp(item.updatedAt) &&
    (item.expiresAt === null || isTimestamp(item.expiresAt)) &&
    typeof item.path === "string";
  const validMarketing = (item: unknown): boolean => {
    if (!isRecord(item)) return false;
    const validTopSearch = (search: unknown): boolean =>
      isRecord(search) &&
      typeof search.query === "string" &&
      isFiniteNumber(search.count) &&
      isFiniteNumber(search.zeroResults);
    const validRecentSearch = (search: unknown): boolean =>
      isRecord(search) &&
      typeof search.sessionId === "string" &&
      isFiniteNumber(search.visitorNumber) &&
      typeof search.query === "string" &&
      isFiniteNumber(search.resultCount) &&
      typeof search.path === "string" &&
      isTimestamp(search.searchedAt);
    return (
      Array.isArray(item.topSearches) && item.topSearches.every(validTopSearch) &&
      Array.isArray(item.recentSearches) && item.recentSearches.every(validRecentSearch) &&
      Array.isArray(item.carts) && item.carts.every(validMarketingCart) &&
      isFiniteNumber(item.activeCarts) &&
      isFiniteNumber(item.abandonedCarts) &&
      isFiniteNumber(item.capturedValue) &&
      isFiniteNumber(item.abandonedValue) &&
      isFiniteNumber(item.zeroResultSearches)
    );
  };

  return (
    Array.isArray(analytics.topPages) && analytics.topPages.every(validPage) &&
    Array.isArray(analytics.topSources) && analytics.topSources.every(validRank) &&
    Array.isArray(analytics.topDevices) && analytics.topDevices.every(validRank) &&
    Array.isArray(analytics.topClicks) && analytics.topClicks.every(validClick) &&
    Array.isArray(analytics.dailyViews) && analytics.dailyViews.every(validDailyView) &&
    (analytics.dailyVisitors === undefined ||
      (Array.isArray(analytics.dailyVisitors) &&
        analytics.dailyVisitors.every(validDailyVisitor))) &&
    Array.isArray(analytics.dailyActivity) &&
    analytics.dailyActivity.every(validDailyActivity) &&
    Array.isArray(analytics.recentSessions) &&
    analytics.recentSessions.every(validSession) &&
    (analytics.marketing === undefined || validMarketing(analytics.marketing))
  );
}

async function sessionStillValid(): Promise<boolean> {
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return response.ok && !response.redirected;
  } catch {
    return true;
  }
}

async function refreshSnapshotFallback(force = false): Promise<void> {
  const socketFresh = socket?.readyState === WebSocket.OPEN && lastSocketMessageAt > 0 && Date.now() - lastSocketMessageAt < SOCKET_STALE_AFTER_MS;
  if ((!force && socketFresh) || fallbackRefreshInFlight) return;
  fallbackRefreshInFlight = true;
  try {
    const response = await fetch("/api/live-snapshot", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isSnapshot(payload.snapshot)) return;
    const socketRecovered = socket?.readyState === WebSocket.OPEN && lastSocketMessageAt > 0 && Date.now() - lastSocketMessageAt < SOCKET_STALE_AFTER_MS;
    if (socketRecovered) return;
    applySnapshot(payload.snapshot, "http");
  } catch {
    if (!hasRecentLiveSnapshot()) setConnectionState("offline", "Waiting for live data");
  } finally {
    fallbackRefreshInFlight = false;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (!hasRecentLiveSnapshot()) {
    setConnectionState("reconnecting", "Reconnecting");
  }
  const baseDelay = Math.min(15_000, 750 * 2 ** reconnectAttempt);
  const jitter = Math.floor(Math.random() * 350);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, baseDelay + jitter);
}

function clearConnectionDeadline(): void {
  if (connectionDeadlineTimer) window.clearTimeout(connectionDeadlineTimer);
  connectionDeadlineTimer = undefined;
}

function closeStaleSocket(reason: string): void {
  const current = socket;
  if (!current || current.readyState === WebSocket.CLOSING || current.readyState === WebSocket.CLOSED) return;
  try {
    current.close(4000, reason.slice(0, 80));
  } catch {
    if (socket === current) socket = undefined;
  }
}

function connect(force = false): void {
  const now = Date.now();
  if (socket?.readyState === WebSocket.OPEN) {
    if (!force || (lastSocketMessageAt > 0 && now - lastSocketMessageAt < SOCKET_STALE_AFTER_MS)) return;
    closeStaleSocket("Live snapshot timeout");
    return;
  }
  if (socket?.readyState === WebSocket.CONNECTING) {
    if (!force && now - connectionStartedAt < SOCKET_CONNECT_TIMEOUT_MS) return;
    closeStaleSocket("Connection attempt timeout");
    return;
  }
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  clearConnectionDeadline();
  if (!hasRecentLiveSnapshot()) {
    setConnectionState(hasSnapshot ? "reconnecting" : "connecting", hasSnapshot ? "Reconnecting" : "Connecting");
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const candidate = new WebSocket(`${protocol}//${location.host}/ws/dashboard`);
  socket = candidate;
  connectionStartedAt = now;
  let receivedSnapshot = false;
  connectionDeadlineTimer = window.setTimeout(() => {
    if (socket !== candidate || receivedSnapshot) return;
    if (!hasRecentLiveSnapshot()) {
      setConnectionState("offline", hasSnapshot ? "Live data delayed" : "Connection delayed");
    }
    void refreshSnapshotFallback(true);
    closeStaleSocket("Initial snapshot timeout");
  }, SOCKET_CONNECT_TIMEOUT_MS);

  candidate.addEventListener("open", () => {
    if (socket !== candidate) return;
    if (!hasRecentLiveSnapshot()) setConnectionState("connecting", "Syncing");
  });

  candidate.addEventListener("message", (event) => {
    if (socket !== candidate) return;
    try {
      const message: unknown = JSON.parse(String(event.data));
      if (isSnapshot(message)) {
        receivedSnapshot = true;
        lastSocketMessageAt = Date.now();
        clearConnectionDeadline();
        applySnapshot(message, "socket");
      }
    } catch {
      // Ignore malformed frames; the next authoritative snapshot replaces state.
    }
  });

  candidate.addEventListener("close", () => {
    if (socket !== candidate) return;
    clearConnectionDeadline();
    socket = undefined;
    void refreshSnapshotFallback(true);
    void sessionStillValid().then((valid) => {
      if (!valid) {
        location.assign("/login");
        return;
      }
      scheduleReconnect();
    });
  });

  candidate.addEventListener("error", () => {
    if (socket !== candidate) return;
    if (!hasRecentLiveSnapshot()) {
      setConnectionState("offline", hasSnapshot ? "Live data delayed" : "Restoring connection");
    }
    void refreshSnapshotFallback(true);
    closeStaleSocket("WebSocket error");
  });
}

function recoverConnectionIfStale(): void {
  if (!socket) {
    connect();
    return;
  }
  if (socket.readyState === WebSocket.CONNECTING && Date.now() - connectionStartedAt >= SOCKET_CONNECT_TIMEOUT_MS) {
    connect(true);
    return;
  }
  if (socket.readyState === WebSocket.OPEN && lastSocketMessageAt > 0 && Date.now() - lastSocketMessageAt >= SOCKET_STALE_AFTER_MS) {
    void refreshSnapshotFallback(true);
    connect(true);
  }
}

window.setInterval(updateRelativeTime, 1_000);
window.setInterval(() => {
  if (!navigator.onLine) return;
  if (!socket) {
    scheduleReconnect();
    return;
  }
  recoverConnectionIfStale();
}, SOCKET_WATCHDOG_INTERVAL_MS);
window.setInterval(() => { void refreshSnapshotFallback(); }, 10_000);
window.addEventListener("online", () => {
  reconnectAttempt = 0;
  connect(true);
});
window.addEventListener("offline", () => {
  setConnectionState("offline", "Offline");
  closeStaleSocket("Browser offline");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    recoverConnectionIfStale();
  }
});
window.addEventListener("pageshow", recoverConnectionIfStale);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
  button.addEventListener("click", () => {
    const range = button.dataset.range;
    if (range !== "today" && range !== "7" && range !== "30" && range !== "all") return;
    selectedRange = range;
    selectedDate = null;
    sessionPage = 1;
    specificDateInput.value = "";
    monitorSpecificDateInput.value = "";
    specificDateLabel.textContent = "Choose date";
    monitorSpecificDateLabel.textContent = "Specific day";
    specificDateInput.setCustomValidity("");
    monitorSpecificDateInput.setCustomValidity("");
    datePickerControl.classList.remove("is-active");
    monitorDatePickerControl.classList.remove("is-active");
    const rangeLabel = {
      today: "Today",
      "7": "Last 7 days",
      "30": "Last 30 days",
      all: "All time",
    }[range];
    activeRangeLabel.textContent = rangeLabel;
    monitorActiveRangeLabel.textContent = rangeLabel;
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
      const selected = item.dataset.range === range;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-pressed", String(selected));
    }
    if (latestSnapshot) {
      renderAnalytics(latestSnapshot);
      renderMarketing(latestSnapshot);
    }
  });
}

function selectSpecificDate(input: HTMLInputElement): void {
  const value = input.value;
  if (!value) return;
  if (
    (input.min && value < input.min) ||
    (input.max && value > input.max)
  ) {
    input.setCustomValidity(
      `Choose a date between ${formatDateLabel(input.min)} and ${formatDateLabel(input.max)}.`,
    );
    input.reportValidity();
    return;
  }

  specificDateInput.setCustomValidity("");
  monitorSpecificDateInput.setCustomValidity("");
  specificDateInput.value = value;
  monitorSpecificDateInput.value = value;
  selectedRange = "date";
  selectedDate = value;
  sessionPage = 1;
  specificDateLabel.textContent = formatShortDateLabel(value);
  monitorSpecificDateLabel.textContent = formatShortDateLabel(value);
  activeRangeLabel.textContent = formatDateLabel(value);
  monitorActiveRangeLabel.textContent = formatDateLabel(value);
  datePickerControl.classList.add("is-active");
  monitorDatePickerControl.classList.add("is-active");
  for (const item of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
    item.classList.remove("is-active");
    item.setAttribute("aria-pressed", "false");
  }
  if (latestSnapshot) {
    renderAnalytics(latestSnapshot);
    renderMarketing(latestSnapshot);
  }
}

specificDateInput.addEventListener("change", () => selectSpecificDate(specificDateInput));
monitorSpecificDateInput.addEventListener("change", () =>
  selectSpecificDate(monitorSpecificDateInput),
);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-marketing-cart-filter]")) {
  button.addEventListener("click", () => {
    const filter = button.dataset.marketingCartFilter;
    if (filter !== "open" && filter !== "abandoned" && filter !== "all") return;
    marketingCartFilter = filter;
    for (const option of document.querySelectorAll<HTMLButtonElement>("[data-marketing-cart-filter]")) {
      option.classList.toggle("is-active", option === button);
      option.setAttribute("aria-pressed", String(option === button));
    }
    if (latestSnapshot) renderMarketing(latestSnapshot);
  });
}

sessionListElement.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-session-id]")
    : null;
  if (target?.dataset.sessionId) {
    sessionDetailTriggerId = target.dataset.sessionId;
    openSessionDetail(target.dataset.sessionId);
  }
});
sessionsPrevious.addEventListener("click", () => {
  if (sessionPage <= 1) return;
  sessionPage -= 1;
  if (latestSnapshot) renderAnalytics(latestSnapshot);
});
sessionsNext.addEventListener("click", () => {
  sessionPage += 1;
  if (latestSnapshot) renderAnalytics(latestSnapshot);
});
closeSessionDetailButton.addEventListener("click", closeSessionDetail);
sessionBackdrop.addEventListener("click", closeSessionDetail);
window.addEventListener("keydown", (event) => {
  if (sessionDetailElement.hidden) return;
  if (event.key === "Escape") {
    closeSessionDetail();
    return;
  }
  if (event.key === "Tab") {
    const focusable = [...sessionDetailElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

const viewNames: Record<string, string> = {
  overview: "Overview",
  orders: "Orders",
  products: "Products",
  fulfillment: "Fulfillment",
  labels: "Product barcode labels",
  media: "Media library",
  customers: "Customers",
  affiliates: "Affiliates",
  loyalty: "Loyalty control",
  seo: "SEO reports",
  marketing: "Marketing",
  coa: "COA Manager",
  "site-controls": "Site Controls",
  monitor: "Live monitor",
  integrations: "Integrations",
  team: "Team & access",
  settings: "Settings",
};
const storageLocationsVisible = false;
if (!storageLocationsVisible) {
  for (const entry of document.querySelectorAll<HTMLElement>('[data-view="labels"], [data-go-view="labels"]')) {
    entry.hidden = true;
    entry.setAttribute("aria-hidden", "true");
  }
}

type SettingsView = "general" | "team" | "security";
function showSettingsView(view: SettingsView): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-settings-view]")) {
    const active = button.dataset.settingsView === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-settings-panel]")) {
    panel.hidden = panel.dataset.settingsPanel !== view;
  }
  if (view === "team") void loadWorkspaceUsers();
}

const sidebar = requiredElement<HTMLElement>("#sidebar");
const commandPalette = requiredElement<HTMLElement>("#command-palette");
const commandBackdrop = requiredElement<HTMLButtonElement>("#command-backdrop");
const commandInput = requiredElement<HTMLInputElement>("#command-input");
const orderDrawer = requiredElement<HTMLElement>("#order-drawer");
const orderBackdrop = requiredElement<HTMLButtonElement>("#order-backdrop");
const orderActionDialog = requiredElement<HTMLElement>("#order-action-dialog");
const orderActionBackdrop = requiredElement<HTMLButtonElement>("#order-action-backdrop");
const orderActionConfirm = requiredElement<HTMLButtonElement>("#order-action-confirm");
const refundDialog = requiredElement<HTMLElement>("#refund-dialog");
const refundBackdrop = requiredElement<HTMLButtonElement>("#refund-backdrop");
const refundForm = requiredElement<HTMLFormElement>("#refund-form");
const refundAmount = requiredElement<HTMLInputElement>("#refund-amount");
const refundReason = requiredElement<HTMLTextAreaElement>("#refund-reason");
const coaEditorDrawer = requiredElement<HTMLElement>("#coa-editor-drawer");
const coaEditorBackdrop = requiredElement<HTMLButtonElement>("#coa-editor-backdrop");
const coaEditorForm = requiredElement<HTMLFormElement>("#coa-editor-form");
const coaFamilyNameInput = requiredElement<HTMLInputElement>("#coa-family-name");
const coaProductNameInput = requiredElement<HTMLInputElement>("#coa-product-name");
const coaCompoundInput = requiredElement<HTMLInputElement>("#coa-compound");
const coaStrengthInput = requiredElement<HTMLInputElement>("#coa-strength");
const coaNumberInput = requiredElement<HTMLInputElement>("#coa-number");
const coaBatchInput = requiredElement<HTMLInputElement>("#coa-batch");
const coaDateInput = requiredElement<HTMLInputElement>("#coa-date");
const coaDateGuidance = requiredElement<HTMLElement>("#coa-date-guidance");
const coaPurityInput = requiredElement<HTMLInputElement>("#coa-purity");
const coaLaboratoryInput = requiredElement<HTMLInputElement>("#coa-laboratory");
const coaStatusInput = requiredElement<HTMLSelectElement>("#coa-status");
const coaMethodInput = requiredElement<HTMLInputElement>("#coa-method");
const coaTestedInput = requiredElement<HTMLTextAreaElement>("#coa-tested");
const coaTestingCostInput = requiredElement<HTMLInputElement>("#coa-testing-cost");
const coaBatchUnitsInput = requiredElement<HTMLInputElement>("#coa-batch-units");
const coaTestingPerUnit = requiredElement<HTMLElement>("#coa-testing-per-unit");
const coaTestingCostGuidance = requiredElement<HTMLElement>("#coa-testing-cost-guidance");
const coaCurrentLotInput = requiredElement<HTMLInputElement>("#coa-current-lot-input");
const coaFileUrlInput = requiredElement<HTMLInputElement>("#coa-file-url");
const coaVerifyUrlInput = requiredElement<HTMLInputElement>("#coa-verify-url");
const coaProductPicker = requiredElement<HTMLSelectElement>("#coa-product-picker");
const coaProductCorrection = requiredElement<HTMLElement>("#coa-product-correction");
const coaPresentationMatch = requiredElement<HTMLElement>("#coa-presentation-match");
const coaProductMatchName = requiredElement<HTMLElement>("#coa-product-match-name");
const coaProductMatchMeta = requiredElement<HTMLElement>("#coa-product-match-meta");
const coaDetectedAssays = requiredElement<HTMLElement>("#coa-detected-assays");
const coaProductIdInput = requiredElement<HTMLInputElement>("#coa-product-id");
const coaVariationIdInput = requiredElement<HTMLSelectElement>("#coa-variation-id");
const coaFamilyKeyInput = requiredElement<HTMLInputElement>("#coa-family-key");
const coaSkusInput = requiredElement<HTMLTextAreaElement>("#coa-skus");
const coaAliasesInput = requiredElement<HTMLTextAreaElement>("#coa-aliases");
const coaKeywordsInput = requiredElement<HTMLTextAreaElement>("#coa-keywords");
const lotAssignmentDrawer = requiredElement<HTMLElement>("#lot-assignment-drawer");
const lotAssignmentBackdrop = requiredElement<HTMLButtonElement>("#lot-assignment-backdrop");
const lotAssignmentForm = requiredElement<HTMLFormElement>("#lot-assignment-form");
const lotAssignmentTargetElement = requiredElement<HTMLElement>("#lot-assignment-target");
const lotAssignmentOptions = requiredElement<HTMLElement>("#lot-assignment-options");
const lotAssignmentSave = requiredElement<HTMLButtonElement>("#lot-assignment-save");
const lotAssignmentOpenCoa = requiredElement<HTMLButtonElement>("#lot-assignment-open-coa");

function syncCoaTestingCost(): void {
  const total = Math.max(0, Number(coaTestingCostInput.value) || 0);
  const units = Math.max(0, Math.floor(Number(coaBatchUnitsInput.value) || 0));
  const complete = total > 0 && units > 0;
  coaTestingPerUnit.textContent = formatCurrency(complete ? total / units : 0);
  coaTestingCostGuidance.textContent = complete
    ? `${formatCurrency(total)} allocated across ${formatNumber(units)} units from this exact lot.`
    : total || units
      ? "Complete both values so the expense can be allocated safely."
      : "Optional. Enter both values to include testing in profitability.";
  coaTestingCostGuidance.classList.toggle("is-warning", Boolean(total || units) && !complete);
}

function syncCoaDistributionControl(): void {
  const available = coaStatusInput.value === "Available";
  if (!available) coaCurrentLotInput.checked = false;
  coaCurrentLotInput.disabled = !available;
  coaCurrentLotInput.title = available
    ? "Publish this certificate as the lot customers are currently receiving."
    : "Approve the certificate first. Only Available certificates can be a current shipping lot.";

  const saveButton = requiredElement<HTMLButtonElement>("#save-coa-editor");
  if (!saveButton.disabled || extensionsData?.coaWriteEnabled) {
    saveButton.textContent = available ? "Approve & publish COA" : "Save review";
  }
}
const productDrawer = requiredElement<HTMLElement>("#product-drawer");
const drawerBackdrop = requiredElement<HTMLButtonElement>("#drawer-backdrop");
const productForm = requiredElement<HTMLFormElement>("#product-form");
const productNameInput = requiredElement<HTMLInputElement>("#product-name-input");
const productSkuInput = requiredElement<HTMLInputElement>("#product-sku-input");
const productSkuStatus = requiredElement<HTMLElement>("#product-sku-status");
const productStockInput = requiredElement<HTMLInputElement>("#product-stock-input");
const productCategoryInput = requiredElement<HTMLSelectElement>("#product-category-input");
const productStatusInput = requiredElement<HTMLSelectElement>("#product-status-input");
const productCostInput = requiredElement<HTMLInputElement>("#product-cost-input");
const productPriceInput = requiredElement<HTMLInputElement>("#product-price-input");
const productPackagingInput = requiredElement<HTMLInputElement>("#product-packaging-input");
const productFeeInput = requiredElement<HTMLInputElement>("#product-fee-input");
const productAffiliateRateInput = requiredElement<HTMLInputElement>("#product-affiliate-rate-input");
const trashProductButton = requiredElement<HTMLButtonElement>("#trash-product");
const productImagesInput = requiredElement<HTMLInputElement>("#product-images-input");
const productImagePreview = requiredElement<HTMLElement>("#product-image-preview");
const productImageCount = requiredElement<HTMLElement>("#product-image-count");
const productDropzone = requiredElement<HTMLElement>("#product-dropzone");
const productVariantsToggle = requiredElement<HTMLInputElement>("#product-variants-toggle");
const variantBuilder = requiredElement<HTMLElement>("#variant-builder");
const variantAttributeInput = requiredElement<HTMLInputElement>("#variant-attribute-input");
const variantOptionsInput = requiredElement<HTMLInputElement>("#variant-options-input");
const variantTable = requiredElement<HTMLElement>("#variant-table");
const variantRows = requiredElement<HTMLElement>("#variant-rows");
const productDetailLoading = requiredElement<HTMLElement>("#product-detail-loading");
const mediaPicker = requiredElement<HTMLElement>("#media-picker");
const mediaPickerBackdrop = requiredElement<HTMLButtonElement>("#media-picker-backdrop");
const mediaPickerSearch = requiredElement<HTMLInputElement>("#media-picker-search");
const mediaPickerGrid = requiredElement<HTMLElement>("#media-picker-grid");
let productImageFiles: File[] = [];
let productImageUrls: string[] = [];
let selectedProductMedia: CommerceMedia[] = [];
let mediaPickerVariantRow: HTMLElement | null = null;
let toastTimer: number | undefined;
let skuSuggestionTimer: number | undefined;
let skuSuggestionSequence = 0;

requiredElement<HTMLButtonElement>("#theme-toggle").addEventListener("click", () => {
  const nextTheme: ColorTheme = document.documentElement.dataset.theme === "dark"
    ? "light"
    : "dark";
  applyTheme(nextTheme, true);
});
for (const option of document.querySelectorAll<HTMLButtonElement>("[data-set-theme]")) {
  option.addEventListener("click", () => {
    const theme = option.dataset.setTheme;
    if (theme === "light" || theme === "dark") applyTheme(theme, true);
  });
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
  if (!storedTheme()) applyTheme(event.matches ? "dark" : "light");
});

function navigate(view: string): void {
  if (view === "analytics") view = "monitor";
  const requestedTeamSettings = view === "team";
  if (requestedTeamSettings) view = "settings";
  if (!viewNames[view]) return;
  if (view !== "fulfillment") closeFulfillmentCamera(false);
  for (const panel of document.querySelectorAll<HTMLElement>("[data-view-panel]")) {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  }
  for (const item of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    const active = item.dataset.view === view;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  requiredElement<HTMLElement>("#current-view-name").textContent = viewNames[view] || "Overview";
  const nextUrl = view === "overview" ? location.pathname : `${location.pathname}#${view}`;
  history.replaceState(null, "", nextUrl);
  sidebar.classList.remove("is-open");
  closeCommandPalette();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "customers") void loadCustomerDirectory();
  if (view === "affiliates") void loadAffiliateAdmin();
  if (view === "loyalty") void loadLoyalty();
  if (view === "seo") void loadSeo();
  if (view === "settings") showSettingsView(requestedTeamSettings ? "team" : "general");
  if (view === "labels") void loadFulfillmentLocations();
  if (view === "fulfillment") void loadFulfillmentQueue();
}

function openCommandPalette(): void {
  commandPalette.hidden = false;
  commandBackdrop.hidden = false;
  commandInput.value = "";
  commandInput.focus();
}

function closeCommandPalette(): void {
  commandPalette.hidden = true;
  commandBackdrop.hidden = true;
}

function showToast(title: string, message: string, success = true): void {
  const toast = requiredElement<HTMLElement>("#toast");
  requiredElement<HTMLElement>("#toast-title").textContent = title;
  requiredElement<HTMLElement>("#toast-message").textContent = message;
  const icon = toast.querySelector<HTMLElement>(":scope > span");
  if (icon) icon.textContent = success ? "✓" : "!";
  toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4_200);
}

const SETTINGS_STORAGE_KEY = "phaseone:operations-settings-v1";

function loadSavedSettings(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "null") as Record<string, unknown> | null;
    if (!saved) return;
    const assign = (selector: string, key: string) => {
      const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      if (field && typeof saved[key] === "string") field.value = String(saved[key]);
    };
    assign("#settings-business-name", "businessName");
    assign("#settings-timezone", "timezone");
    assign("#settings-currency", "currency");
    assign("#settings-language", "language");
    assign("#settings-default-fee", "defaultFee");
    assign("#settings-packaging-cost", "packagingCost");
  } catch {
    // Invalid or unavailable browser storage falls back to the governed defaults.
  }
}

function saveSettings(): void {
  const settings = {
    businessName: requiredElement<HTMLInputElement>("#settings-business-name").value.trim(),
    timezone: requiredElement<HTMLSelectElement>("#settings-timezone").value,
    currency: requiredElement<HTMLSelectElement>("#settings-currency").value,
    language: requiredElement<HTMLSelectElement>("#settings-language").value,
    defaultFee: requiredElement<HTMLInputElement>("#settings-default-fee").value,
    packagingCost: requiredElement<HTMLInputElement>("#settings-packaging-cost").value,
  };
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    showToast("Settings saved", "Your operating preferences are available on this device.");
  } catch {
    showToast("Unable to save settings", "Browser storage is unavailable in this session.", false);
  }
}

function downloadCsv(rows: string[][], filename: string, message: string): void {
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Report downloaded", message);
}

async function downloadSalesReport(): Promise<void> {
  if (!commerceData) {
    showToast("Report not ready", "Wait for orders to finish synchronizing.", false);
    return;
  }
  await loadCompleteSalesRange(salesInsightRange);
  const orders = salesOrders();
  const products = productSales();
  const completePeriod = salesInsightComplete?.range === salesInsightRange;
  const currency = orders[0]?.currency || commerceData.orders[0]?.currency || "USD";
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const refunds = orders.reduce((sum, order) => sum + order.refundedTotal, 0);
  const profit = orders.reduce((sum, order) => sum + (order.profitability.estimatedProfit || 0), 0);
  const units = products.reduce((sum, product) => sum + product.units, 0);
  const byDay = new Map<string, { orders: number; revenue: number; refunds: number; profit: number }>();
  const reportTimeZone = latestSnapshot?.analytics.timeZone || "America/Bogota";
  for (const order of orders) {
    const timestamp = order.paidAt || order.createdAt;
    const day = timestamp ? dateKey(new Date(timestamp), reportTimeZone) : "Unknown";
    const value = byDay.get(day) || { orders: 0, revenue: 0, refunds: 0, profit: 0 };
    value.orders += 1;
    value.revenue += order.total;
    value.refunds += order.refundedTotal;
    value.profit += order.profitability.estimatedProfit || 0;
    byDay.set(day, value);
  }
  const rows: string[][] = [
    ["PHASE ONE LABZ SALES REPORT"],
    ["Period", salesRangeLabel(salesInsightRange)],
    ["Generated", new Date().toISOString()],
    ["Data coverage", completePeriod ? "Complete period loaded on demand from the live order service" : "Fallback to orders currently synchronized in the operations dashboard"],
    [],
    ["Metric", "Value", "Currency"],
    ["Paid orders", String(orders.length), ""],
    ["Units sold", String(units), ""],
    ["Gross order revenue", revenue.toFixed(2), currency],
    ["Refunded", refunds.toFixed(2), currency],
    ["Estimated profit", profit.toFixed(2), currency],
    [],
    ["PRODUCT SALES"],
    ["Rank", "Product", "SKU", "Product ID", "Variation ID", "Units", "Orders", "Revenue", "Currency"],
    ...products.map((product, index) => [String(index + 1), product.name, product.sku, String(product.productId), String(product.variationId || ""), String(product.units), String(product.orders.size), product.revenue.toFixed(2), currency]),
    [],
    ["DAILY SALES"],
    ["Date", "Orders", "Revenue", "Refunds", "Estimated profit", "Currency"],
    ...[...byDay.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([day, value]) => [day, String(value.orders), value.revenue.toFixed(2), value.refunds.toFixed(2), value.profit.toFixed(2), currency]),
  ];
  downloadCsv(rows, `phase-one-sales-${salesInsightRange}-${new Date().toISOString().slice(0, 10)}.csv`, `${salesRangeLabel(salesInsightRange)} sales and product performance were exported.`);
}

function closeOrdersReportDialog(): void {
  requiredElement<HTMLElement>("#orders-report-dialog").hidden = true;
  requiredElement<HTMLElement>("#orders-report-backdrop").hidden = true;
}

function openOrdersReportDialog(): void {
  const today = new Date();
  const value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  requiredElement<HTMLInputElement>("#orders-report-from").value ||= value;
  requiredElement<HTMLInputElement>("#orders-report-to").value ||= value;
  requiredElement<HTMLElement>("#orders-report-dialog").hidden = false;
  requiredElement<HTMLElement>("#orders-report-backdrop").hidden = false;
}

function selectedOrderReportRange(): { after: Date; before: Date; label: string } {
  const selected = requiredElement<HTMLInputElement>('#orders-report-form input[name="reportPeriod"]:checked').value;
  const now = new Date();
  if (selected === "month") {
    return {
      after: new Date(now.getFullYear(), now.getMonth(), 1),
      before: new Date(now.getTime() + 60_000),
      label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(now),
    };
  }
  if (selected === "year") {
    return { after: new Date(now.getFullYear(), 0, 1), before: new Date(now.getTime() + 60_000), label: String(now.getFullYear()) };
  }
  if (selected === "custom") {
    const fromValue = requiredElement<HTMLInputElement>("#orders-report-from").value;
    const toValue = requiredElement<HTMLInputElement>("#orders-report-to").value;
    if (!fromValue || !toValue) throw new Error("Choose both custom report dates.");
    const after = new Date(`${fromValue}T00:00:00`);
    const before = new Date(`${toValue}T00:00:00`);
    before.setDate(before.getDate() + 1);
    if (before <= after) throw new Error("The report end date must be on or after the start date.");
    return {
      after,
      before,
      label: `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(after)} – ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(before.getTime() - 1))}`,
    };
  }
  const after = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    after,
    before: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    label: new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(now),
  };
}

async function downloadPdfFrom(url: string, filename: string, button?: HTMLButtonElement): Promise<void> {
  const original = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Building PDF…";
  }
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/pdf" } });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => ({}));
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The PDF could not be generated");
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    showToast("PDF ready", "The financial order report has been downloaded.");
  } catch (error) {
    showToast("PDF unavailable", error instanceof Error ? error.message : "Try again in a moment.", false);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function downloadOrdersPdf(button: HTMLButtonElement): Promise<void> {
  try {
    const range = selectedOrderReportRange();
    if (range.before.getTime() - range.after.getTime() > 370 * 86_400_000) throw new Error("Choose a period of 370 days or less.");
    const params = new URLSearchParams({ after: range.after.toISOString(), before: range.before.toISOString(), label: range.label });
    await downloadPdfFrom(`/api/reports/orders.pdf?${params.toString()}`, `phase-one-orders-${range.after.toISOString().slice(0, 10)}.pdf`, button);
    closeOrdersReportDialog();
  } catch (error) {
    showToast("Check the report period", error instanceof Error ? error.message : "Choose valid dates.", false);
  }
}

function downloadActiveOrderPdf(): void {
  if (!activeOrder) return;
  const button = requiredElement<HTMLButtonElement>("#order-pdf-button");
  void downloadPdfFrom(`/api/reports/orders.pdf?orderId=${encodeURIComponent(String(activeOrder.id))}`, `phase-one-order-${activeOrder.number}.pdf`, button);
}

function downloadMonitorReport(): void {
  const analytics = latestSnapshot?.analytics;
  if (!analytics || !latestSnapshot) {
    showToast("Report not ready", "Wait for the live monitor to finish loading.", false);
    return;
  }
  const marketing = analytics.marketing;
  const carts = marketing?.carts.filter((cart) => timestampMatchesMonitorRange(cart.updatedAt, latestSnapshot!)) || [];
  const searches = marketing?.recentSearches.filter((search) => timestampMatchesMonitorRange(search.searchedAt, latestSnapshot!)) || [];
  const rows: string[][] = [
    ["PHASE ONE LABZ LIVE MONITOR REPORT"],
    ["Period", selectedRange === "date" && selectedDate ? selectedDate : selectedRange === "today" ? "Today" : selectedRange === "7" ? "Last 7 days" : selectedRange === "30" ? "Last 30 days" : "All time"],
    ["Generated", new Date().toISOString()],
    [],
    ["Metric", "Value"],
    ["Total views", String(analytics.totalViews)],
    ["Total sessions", String(analytics.totalSessions)],
    ["Unique visitors", String(analytics.uniqueVisitors)],
    ["Returning sessions", String(analytics.returningSessions || 0)],
    ["Completed orders", String(analytics.totalOrders || 0)],
    ["Visitors in last 30 minutes", String(analytics.visitorsLast30Minutes)],
    ["Captured carts in selected period", String(carts.length)],
    ["Captured searches in selected period", String(searches.length)],
    [],
    ["TRAFFIC SOURCES"],
    ["Source", "Visits", "Meaning"],
    ...analytics.topSources.map((source) => [displayLabel(source.label), String(source.count), trafficSourceExplanation(source.label)]),
    [],
    ["CART CONTENTS"],
    ["Visitor", "Status", "Updated", "Product", "SKU", "Quantity", "Unit price", "Cart total"],
    ...carts.flatMap((cart) => cart.items.map((item) => [monitorCartIdentity(cart), cart.status, cart.updatedAt, item.name, item.sku, String(item.quantity), item.price.toFixed(2), cart.total.toFixed(2)])),
    [],
    ["STORE SEARCHES"],
    ["Visitor", "Query", "Results", "Page", "Searched at"],
    ...searches.map((search) => [search.visitorNumber ? `Visitor #${search.visitorNumber}` : "Anonymous visitor", search.query, String(search.resultCount), search.path, search.searchedAt]),
  ];
  downloadCsv(rows, `phase-one-live-monitor-${new Date().toISOString().slice(0, 10)}.csv`, "Traffic, carts and storefront searches were exported.");
}

function showCoaEditorPanel(name: string): void {
  for (const panel of document.querySelectorAll<HTMLElement>("[data-coa-editor-panel]")) {
    panel.hidden = panel.dataset.coaEditorPanel !== name;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-coa-editor-tab]")) {
    button.classList.toggle("is-active", button.dataset.coaEditorTab === name);
  }
}

function updateCoaDocumentPreview(): void {
  const url = coaFileUrlInput.value.trim();
  const preview = requiredElement<HTMLElement>("#coa-document-preview");
  const title = preview.querySelector<HTMLElement>("strong");
  const detail = preview.querySelector<HTMLElement>("small");
  const open = requiredElement<HTMLAnchorElement>("#coa-document-open");
  if (title) title.textContent = url ? "Certificate PDF linked" : "No document linked";
  if (detail) detail.textContent = url ? url.replace(/^https?:\/\//, "") : "Add an HTTPS PDF address above.";
  open.hidden = !url;
  if (url) open.href = url;
  else open.removeAttribute("href");
}

function normalizeCoaProductMatch(value: string): string {
  return value.toLocaleLowerCase("en")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function suggestedCoaProduct(coa: CommerceCoa, products: CommerceProduct[]): CommerceProduct | undefined {
  const mapped = products.find((product) => product.id === coa.matchedProductId);
  if (mapped) return mapped;
  const skus = new Set((coa.skus || []).map((sku) => normalizeCoaProductMatch(sku)).filter(Boolean));
  const skuMatch = products.find((product) => product.sku && skus.has(normalizeCoaProductMatch(product.sku)));
  if (skuMatch) return skuMatch;
  const detected = normalizeCoaProductMatch([coa.productName, coa.familyName, coa.compound, coa.strength].filter(Boolean).join(" "));
  if (!detected) return undefined;
  return products
    .map((product) => {
      const name = normalizeCoaProductMatch(product.name);
      const meaningful = name.split(" ").filter((token) => token.length > 1 && !["research", "peptide", "vial", "formula"].includes(token));
      const matches = meaningful.filter((token) => detected.includes(token)).length;
      return { product, score: meaningful.length ? matches / meaningful.length : 0 };
    })
    .filter((candidate) => candidate.score >= .6)
    .sort((left, right) => right.score - left.score)[0]?.product;
}

function coaVariationName(variation: CommerceVariation): string {
  return variation.attributes.map((attribute) => attribute.option).filter(Boolean).join(" · ") || `Variation ${variation.id}`;
}

let coaVariationRequest = 0;

async function loadCoaProductVariations(productId: number, selectedVariationId = 0): Promise<void> {
  const requestId = ++coaVariationRequest;
  if (!productId) {
    coaPresentationMatch.hidden = true;
    coaVariationIdInput.innerHTML = '<option value="0">Select a product first</option>';
    coaVariationIdInput.disabled = true;
    return;
  }
  coaVariationIdInput.disabled = true;
  coaVariationIdInput.innerHTML = selectedVariationId
    ? `<option value="${selectedVariationId}">Loading presentation ${selectedVariationId}…</option>`
    : '<option value="0">Loading presentations…</option>';
  try {
    let details = skuStockDetails.get(productId);
    if (!details) {
      const response = await fetch(`/api/commerce/product?productId=${encodeURIComponent(String(productId))}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload) || !isRecord(payload.product) || !Array.isArray(payload.variations)) {
        throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Product presentations are unavailable");
      }
      details = {
        product: payload.product as unknown as CommerceProduct,
        variations: payload.variations as CommerceVariation[],
      };
      skuStockDetails.set(productId, details);
    }
    if (requestId !== coaVariationRequest) return;
    const variations = details.variations;
    coaPresentationMatch.hidden = variations.length === 0;
    const suggestedId = suggestedCoaVariationId(variations, coaStrengthInput.value, selectedVariationId);
    const selected = variations.find((variation) => variation.id === suggestedId);
    const parentLabel = variations.length ? "Choose the exact presentation…" : "Simple product (no variations)";
    coaVariationIdInput.innerHTML = `<option value="0">${parentLabel}</option>${variations.map((variation) => {
      const sku = variation.sku ? ` — ${escapeHtml(variation.sku)}` : "";
      return `<option value="${variation.id}">${escapeHtml(coaVariationName(variation))}${sku}</option>`;
    }).join("")}`;
    coaVariationIdInput.value = selected ? String(selected.id) : "0";
    coaVariationIdInput.disabled = variations.length === 0;
    const product = details.product;
    const presentation = selected ? coaVariationName(selected) : "All presentations";
    coaProductMatchMeta.textContent = [product.sku, presentation, selected ? `Variation ${selected.id}` : `Product ${product.id}`].filter(Boolean).join(" · ");
    if (selected?.sku) {
      const mappedSkus = new Set(coaTextList(coaSkusInput.value));
      mappedSkus.add(selected.sku);
      coaSkusInput.value = [...mappedSkus].join("\n");
    }
  } catch (error) {
    if (requestId !== coaVariationRequest) return;
    coaPresentationMatch.hidden = false;
    coaVariationIdInput.innerHTML = selectedVariationId
      ? `<option value="${selectedVariationId}">Variation ${selectedVariationId}</option>`
      : '<option value="0">Presentations unavailable</option>';
    coaVariationIdInput.disabled = false;
    coaProductMatchMeta.textContent = error instanceof Error ? error.message : "Product presentations could not be loaded";
  }
}

function openCoaEditor(coa: CommerceCoa): void {
  editingCoa = coa;
  requiredElement<HTMLElement>("#coa-editor-title").textContent = coa.productName || coa.familyName || "Edit COA";
  requiredElement<HTMLElement>("#coa-editor-badge").textContent = coa.coaNumber || `#${coa.wpPostId}`;
  requiredElement<HTMLElement>("#coa-editor-subtitle").textContent = `${coa.batch || coa.lot || "No batch"} · ${coa.strength || "Strength not assigned"}`;
  coaFamilyNameInput.value = coa.familyName || "";
  coaProductNameInput.value = coa.productName || "";
  coaCompoundInput.value = coa.compound || "";
  coaStrengthInput.value = coa.strength || "";
  coaNumberInput.value = coa.coaNumber || "";
  coaBatchInput.value = coa.batch || coa.lot || "";
  coaDateInput.value = coa.date || "";
  const dateDetection = coa.intakeAnalysis?.dateDetection;
  coaDateGuidance.classList.toggle("is-confirmed", dateDetection?.confidence === "explicit");
  coaDateGuidance.classList.toggle("is-warning", Boolean(dateDetection && dateDetection.confidence !== "explicit"));
  coaDateGuidance.textContent = dateDetection?.confidence === "explicit"
    ? `${dateDetection.label} detected in the PDF. Confirm it before publication.`
    : dateDetection?.confidence === "fallback"
      ? `${dateDetection.label} is only a fallback; replace it with the actual testing date if different.`
      : "Required for publication. Enter the date the laboratory performed the test.";
  coaPurityInput.value = coa.purity || "";
  coaLaboratoryInput.value = coa.laboratory || "";
  if (![...coaStatusInput.options].some((option) => option.value === coa.status)) {
    coaStatusInput.add(new Option(coa.status || "Available", coa.status || "Available"));
  }
  coaStatusInput.value = coa.status || "Available";
  coaMethodInput.value = coa.method || "";
  coaTestedInput.value = coa.tested || "";
  coaTestingCostInput.value = String(coa.testingCostTotal || 0);
  coaBatchUnitsInput.value = String(coa.batchUnitCount || 0);
  syncCoaTestingCost();
  coaCurrentLotInput.dataset.suggested = coa.intakeAnalysis?.suggestCurrent ? "true" : "false";
  coaCurrentLotInput.checked = coa.currentShippingLot;
  syncCoaDistributionControl();
  coaFileUrlInput.value = coa.fileUrl || "";
  coaVerifyUrlInput.value = coa.verifyUrl || "";
  const products = [...(commerceData?.products || [])].sort((left, right) => left.name.localeCompare(right.name, "en"));
  coaProductPicker.innerHTML = `<option value="">Select a product…</option>${products.map((product) => `<option value="${product.id}">${escapeHtml(product.name)}${product.sku ? ` — ${escapeHtml(product.sku)}` : ""}</option>`).join("")}`;
  const matchedProduct = suggestedCoaProduct(coa, products);
  coaProductIdInput.value = matchedProduct ? String(matchedProduct.id) : coa.matchedProductId ? String(coa.matchedProductId) : "";
  coaProductPicker.value = matchedProduct ? String(matchedProduct.id) : coa.matchedProductId ? String(coa.matchedProductId) : "";
  coaProductCorrection.hidden = Boolean(matchedProduct || coa.matchedProductId);
  requiredElement<HTMLButtonElement>("#coa-change-product").textContent = coaProductCorrection.hidden ? "Product incorrect? Change" : "Hide product list";
  coaProductMatchName.textContent = matchedProduct?.name || (coa.productName === "Needs product review" ? "Product not identified" : coa.productName || coa.familyName || "Product not identified");
  coaProductMatchMeta.textContent = matchedProduct
    ? [matchedProduct.sku, coa.matchedProductId ? `Product ${matchedProduct.id}` : "Suggested automatically"].filter(Boolean).join(" · ")
    : coa.matchedProductId
      ? `Connected to product ${coa.matchedProductId}`
      : "No reliable store match was found — choose the correct product below";
  coaSkusInput.value = (coa.skus || []).join("\n");
  if (matchedProduct?.sku) {
    const mappedSkus = new Set(coaTextList(coaSkusInput.value));
    mappedSkus.add(matchedProduct.sku);
    coaSkusInput.value = [...mappedSkus].join("\n");
  }
  void loadCoaProductVariations(Number(coaProductIdInput.value) || 0, coa.matchedVariationId || 0);
  coaFamilyKeyInput.value = coa.familyKey || "";
  coaAliasesInput.value = (coa.aliases || []).join("\n");
  coaKeywordsInput.value = (coa.keywords || []).join("\n");
  const selectedPanels = new Set(coa.panelTypes || []);
  for (const panel of document.querySelectorAll<HTMLInputElement>('input[name="coa-panel-type"]')) {
    panel.checked = selectedPanels.has(panel.value);
  }
  const assays = coa.intakeAnalysis?.assays || [];
  coaDetectedAssays.innerHTML = assays.length
    ? assays.map((assay) => `<article class="coa-detected-assay is-${assay.status}"><span>${assay.status === "pass" ? "✓" : assay.status === "attention" ? "!" : "•"}</span><div><strong>${escapeHtml(assay.name)}</strong><small>${escapeHtml(assay.result)}${assay.unit && !assay.result.includes(assay.unit) ? ` · ${escapeHtml(assay.unit)}` : ""}</small></div></article>`).join("")
    : '<div class="module-empty"><span>—</span><strong>No structured tests were detected.</strong><small>You can still enter or correct the results manually.</small></div>';
  const writeEnabled = Boolean(extensionsData?.coaWriteEnabled);
  const status = requiredElement<HTMLElement>("#coa-editor-status");
  const statusTitle = status.querySelector<HTMLElement>("strong");
  if (statusTitle) statusTitle.textContent = coa.status === "Review" ? "Private draft · approval required" : "Live business record";
  status.classList.toggle("is-read-only", !writeEnabled);
  requiredElement<HTMLElement>("#coa-editor-connection").textContent = writeEnabled
    ? `${extensionsData?.coaBridgeVersion || "Custom COA API"} · saved directly in the Phase One library`
    : "Editor preview available · custom certificate storage is unavailable";
  requiredElement<HTMLButtonElement>("#save-coa-editor").disabled = !writeEnabled;
  syncCoaDistributionControl();
  showCoaEditorPanel("basics");
  updateCoaDocumentPreview();
  if (coa.source === "custom" && coa.status === "Review" && coa.recordId) {
    const open = requiredElement<HTMLAnchorElement>("#coa-document-open");
    open.hidden = false;
    open.href = `/api/extensions/coa/${encodeURIComponent(coa.recordId)}/document`;
  }
  coaEditorDrawer.hidden = false;
  coaEditorBackdrop.hidden = false;
  document.body.classList.add("drawer-open");
}

coaProductPicker.addEventListener("change", () => {
  const productId = Number(coaProductPicker.value) || 0;
  const product = commerceData?.products.find((item) => item.id === productId);
  coaProductIdInput.value = productId ? String(productId) : "";
  if (product) {
    coaProductNameInput.value = product.name;
    coaFamilyNameInput.value = product.name;
    coaProductMatchName.textContent = product.name;
    coaProductMatchMeta.textContent = [product.sku, `Product ${product.id}`].filter(Boolean).join(" · ");
  }
  if (product?.sku) {
    const current = new Set(coaTextList(coaSkusInput.value));
    current.add(product.sku);
    coaSkusInput.value = [...current].join("\n");
  }
  void loadCoaProductVariations(productId);
});

coaVariationIdInput.addEventListener("change", () => {
  const productId = Number(coaProductIdInput.value) || 0;
  const details = skuStockDetails.get(productId);
  const variation = details?.variations.find((item) => item.id === Number(coaVariationIdInput.value));
  const product = details?.product || commerceData?.products.find((item) => item.id === productId);
  if (!product) return;
  if (variation) {
    const presentation = coaVariationName(variation);
    coaProductNameInput.value = `${product.name} — ${presentation}`;
    if (!coaStrengthInput.value.trim()) coaStrengthInput.value = presentation;
  }
  coaProductMatchMeta.textContent = [
    product.sku,
    variation ? coaVariationName(variation) : "All presentations",
    variation ? `Variation ${variation.id}` : `Product ${product.id}`,
  ].filter(Boolean).join(" · ");
  if (variation?.sku) {
    const current = new Set(coaTextList(coaSkusInput.value));
    current.add(variation.sku);
    coaSkusInput.value = [...current].join("\n");
  }
});

requiredElement<HTMLButtonElement>("#coa-change-product").addEventListener("click", () => {
  coaProductCorrection.hidden = !coaProductCorrection.hidden;
  const button = requiredElement<HTMLButtonElement>("#coa-change-product");
  button.textContent = coaProductCorrection.hidden ? "Product incorrect? Change" : "Keep detected product";
  if (!coaProductCorrection.hidden) window.setTimeout(() => coaProductPicker.focus(), 0);
});

function closeCoaEditor(): void {
  coaEditorDrawer.hidden = true;
  coaEditorBackdrop.hidden = true;
  document.body.classList.remove("drawer-open");
  editingCoa = null;
}

function coaTextList(value: string): string[] {
  return value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function syncUpdatedOrder(order: CommerceOrder): void {
  activeOrder = order;
  if (commerceData) {
    const index = commerceData.orders.findIndex((item) => item.id === order.id);
    if (index >= 0) commerceData.orders[index] = order;
    else commerceData.orders.unshift(order);
    renderCommerce();
  }
  renderOrderDetail(order);
}

async function submitOrderEvidence(form: HTMLFormElement): Promise<void> {
  if (!activeOrder || !activeOrderOperations) return;
  const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]');
  const file = fileInput?.files?.[0];
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!file) {
    showToast("Choose a file", "Select an image or PDF before uploading.", false);
    return;
  }
  button?.setAttribute("disabled", "");
  const body = new FormData();
  body.set("file", file);
  body.set("label", file.name.replace(/\.[^.]+$/, ""));
  try {
    const response = await fetch(`/api/commerce/order-evidence?orderId=${activeOrder.id}`, { method: "POST", credentials: "same-origin", body });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.evidence)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The evidence could not be uploaded");
    activeOrderOperations.evidence = payload.evidence as unknown as OrderOperations["evidence"];
    renderOrderDetail(activeOrder);
    showToast("Evidence attached", `${file.name} is now part of order #${activeOrder.number}.`);
  } catch (error) {
    showToast("Upload failed", error instanceof Error ? error.message : "Try again in a moment.", false);
  } finally {
    button?.removeAttribute("disabled");
  }
}

async function deleteOrderEvidence(evidenceId: string): Promise<void> {
  if (!activeOrder || !activeOrderOperations) return;
  try {
    const response = await fetch("/api/commerce/order-evidence-delete", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ orderId: activeOrder.id, evidenceId }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.evidence)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Evidence could not be removed");
    activeOrderOperations.evidence = payload.evidence as unknown as OrderOperations["evidence"];
    renderOrderDetail(activeOrder);
    showToast("Evidence removed", "The order record has been updated.");
  } catch (error) {
    showToast("Unable to remove evidence", error instanceof Error ? error.message : "Try again in a moment.", false);
  }
}

async function updateOrderCoa(input: { action: "assign" | "remove"; itemId: number; coaId?: string; quantity?: number; assignmentId?: string }): Promise<void> {
  if (!activeOrder || !activeOrderOperations) return;
  try {
    const response = await fetch("/api/commerce/order-coa", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ orderId: activeOrder.id, ...input }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.coas)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The COA assignment could not be updated");
    activeOrderOperations.coas = payload.coas as unknown as OrderCoaWorkspace;
    renderOrderDetail(activeOrder);
    showToast(input.action === "assign" ? "COA assigned" : "COA removed", `Order #${activeOrder.number} now shows the current lot allocation.`);
  } catch (error) {
    showToast("COA update failed", error instanceof Error ? error.message : "Try again in a moment.", false);
  }
}

async function notifyProductWaitlist(productId: number): Promise<boolean> {
  const product = commerceData?.products.find((item) => item.id === productId);
  try {
    const response = await fetch("/api/inventory-operations/notify", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ productId }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The waitlist could not be notified");
    showToast("Waitlist queued", `${product?.name || "The product"} is being sent to eligible customers.`);
    return true;
  } catch (error) {
    showToast("Notification failed", error instanceof Error ? error.message : "Try again in a moment.", false);
    return false;
  }
}

function closeWaitlistDrawer(): void {
  requiredElement<HTMLElement>("#waitlist-drawer").hidden = true;
  requiredElement<HTMLElement>("#waitlist-backdrop").hidden = true;
  activeWaitlistProductId = null;
  waitlistNotifyConfirmation = false;
  document.body.classList.remove("drawer-open");
}

function renderWaitlistDrawer(): void {
  if (!activeWaitlistProductId) return;
  const product = commerceData?.products.find((item) => item.id === activeWaitlistProductId);
  const subscribers = waitlistSubscribers.get(activeWaitlistProductId) || [];
  const coverageComplete = waitlistCoverageComplete.get(activeWaitlistProductId) !== false;
  const status = requiredElement<HTMLElement>("#waitlist-drawer-status");
  const list = requiredElement<HTMLElement>("#waitlist-subscriber-list");
  const footer = requiredElement<HTMLElement>("#waitlist-drawer-footer");
  const notify = requiredElement<HTMLButtonElement>("#waitlist-notify-button");
  requiredElement<HTMLElement>("#waitlist-drawer-title").textContent = product?.name || `Product ${activeWaitlistProductId}`;
  requiredElement<HTMLElement>("#waitlist-drawer-subtitle").textContent = `${product?.sku || `Product ${activeWaitlistProductId}`} · Back-in-stock audience`;
  status.hidden = !waitlistLoading;
  if (waitlistLoading) {
    list.innerHTML = '<div class="waitlist-empty"><span></span><strong>Loading real subscribers…</strong><p>Reading the store notification list.</p></div>';
    footer.hidden = true;
    return;
  }
  list.innerHTML = subscribers.length
    ? `<div class="waitlist-list-summary"><div><span>Subscribed customers</span><strong>${formatNumber(subscribers.length)}</strong></div><p>${coverageComplete ? "These records come directly from every connected store notifier. No customer data is recreated locally." : "Available records are shown. The store bridge update is still required to combine both notifier systems."}</p></div>${subscribers.map((subscriber) => {
      const initials = subscriber.name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "P1";
      return `<article class="waitlist-subscriber"><span>${escapeHtml(initials)}</span><div><strong>${escapeHtml(subscriber.name)}</strong><a href="mailto:${escapeHtml(subscriber.email)}">${escapeHtml(subscriber.email || "Email unavailable")}</a><small>${subscriber.variationId ? `Variation ${subscriber.variationId} · ` : ""}${escapeHtml(formatCommerceTimestamp(subscriber.subscribedAt))}</small></div><b>${escapeHtml(subscriber.status)}</b></article>`;
    }).join("")}`
    : coverageComplete
      ? '<div class="waitlist-empty"><span>◇</span><strong>No subscribers yet</strong><p>Nobody is currently waiting for this product.</p></div>'
      : '<div class="waitlist-empty"><span>↻</span><strong>Subscriber sync update pending</strong><p>Install the prepared store bridge update to combine the two active notification systems.</p></div>';
  const inStock = product?.stockStatus === "instock" && (product.stockQuantity === null || product.stockQuantity > 0);
  footer.hidden = false;
  notify.disabled = !coverageComplete || !subscribers.length || !inStock || commerceData?.mode !== "read_write";
  notify.classList.toggle("button--danger", waitlistNotifyConfirmation);
  notify.textContent = waitlistNotifyConfirmation ? `Send to ${subscribers.length} customer${subscribers.length === 1 ? "" : "s"}` : "Review manual send";
  const note = footer.querySelector<HTMLElement>("small");
  if (note) note.textContent = !coverageComplete
    ? "Manual delivery stays locked until the store bridge can verify the complete subscriber audience."
    : !inStock
      ? "Add available stock first. The notifier correctly blocks messages for unavailable products."
    : waitlistNotifyConfirmation
      ? "Confirm only if the automatic notification needs a manual retry. This action can email eligible subscribers."
      : "Normal back-in-stock emails continue through WordPress. Use manual send only when you need to retry.";
}

async function openWaitlistDrawer(productId: number): Promise<void> {
  activeWaitlistProductId = productId;
  waitlistNotifyConfirmation = false;
  requiredElement<HTMLElement>("#waitlist-drawer").hidden = false;
  requiredElement<HTMLElement>("#waitlist-backdrop").hidden = false;
  document.body.classList.add("drawer-open");
  waitlistLoading = true;
  renderWaitlistDrawer();
  try {
    const response = await fetch(`/api/inventory-operations/waitlist?productId=${encodeURIComponent(String(productId))}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !Array.isArray(payload.subscribers)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Subscriber records are unavailable");
    }
    waitlistSubscribers.set(productId, payload.subscribers as WaitlistSubscriber[]);
    waitlistCoverageComplete.set(productId, payload.complete === true);
  } catch (error) {
    waitlistSubscribers.set(productId, []);
    waitlistCoverageComplete.set(productId, false);
    showToast("Subscribers unavailable", error instanceof Error ? error.message : "Try again in a moment.", false);
  } finally {
    waitlistLoading = false;
    if (activeWaitlistProductId === productId) renderWaitlistDrawer();
  }
}

function closeOrderActionDialog(): void {
  orderActionDialog.hidden = true;
  orderActionBackdrop.hidden = true;
  pendingOrderAction = null;
}

function openOrderActionDialog(action: "confirm" | "complete" | "cancel"): void {
  if (!activeOrder) return;
  pendingOrderAction = action;
  const content = {
    confirm: {
      title: "Confirm this order?",
      message: `Order #${activeOrder.number} will move to Processing so fulfillment can begin.`,
      button: "Confirm order",
      danger: false,
    },
    complete: {
      title: "Mark this order completed?",
      message: `Order #${activeOrder.number} will be recorded as fulfilled and completed.`,
      button: "Mark completed",
      danger: false,
    },
    cancel: {
      title: "Cancel this order?",
      message: `Order #${activeOrder.number} will stop fulfillment. This does not automatically issue a refund.`,
      button: "Cancel order",
      danger: true,
    },
  }[action];
  requiredElement<HTMLElement>("#order-action-dialog-title").textContent = content.title;
  requiredElement<HTMLElement>("#order-action-dialog-message").textContent = content.message;
  requiredElement<HTMLElement>("#order-action-dialog-icon").textContent = content.danger ? "!" : "✓";
  orderActionConfirm.textContent = content.button;
  orderActionConfirm.className = `button ${content.danger ? "button--danger" : "button--primary"}`;
  orderActionDialog.hidden = false;
  orderActionBackdrop.hidden = false;
  orderActionConfirm.focus();
}

async function executeOrderAction(): Promise<void> {
  if (!activeOrder || !pendingOrderAction) return;
  const action = pendingOrderAction;
  const orderId = activeOrder.id;
  orderActionConfirm.disabled = true;
  try {
    const response = await fetch("/api/commerce/order-action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ orderId, action }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.order)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The order could not be updated");
    }
    closeOrderActionDialog();
    syncUpdatedOrder(payload.order as unknown as CommerceOrder);
    showToast("Order updated", `Order #${activeOrder?.number || orderId} now shows the latest status.`);
  } catch (error) {
    showToast("Order update failed", error instanceof Error ? error.message : "Try again in a moment.", false);
  } finally {
    orderActionConfirm.disabled = false;
  }
}

function closeRefundDialog(): void {
  refundDialog.hidden = true;
  refundBackdrop.hidden = true;
  refundForm.reset();
}

function openRefundDialog(): void {
  if (!activeOrder) return;
  refundAmount.max = activeOrder.refundableTotal.toFixed(2);
  refundAmount.value = activeOrder.refundableTotal.toFixed(2);
  requiredElement<HTMLElement>("#refund-currency").textContent = activeOrder.currency;
  requiredElement<HTMLElement>("#refund-balance").textContent =
    `Available balance ${formatCurrency(activeOrder.refundableTotal, activeOrder.currency)}`;
  refundDialog.hidden = false;
  refundBackdrop.hidden = false;
  refundAmount.focus();
  refundAmount.select();
}

async function submitRefund(): Promise<void> {
  if (!activeOrder) return;
  const submitButton = refundForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
    const response = await fetch("/api/commerce/order-refund", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        orderId: activeOrder.id,
        amount: Number(refundAmount.value),
        reason: refundReason.value.trim(),
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.order)) {
      throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The refund could not be issued");
    }
    closeRefundDialog();
    syncUpdatedOrder(payload.order as unknown as CommerceOrder);
    showToast("Refund submitted", "The refundable balance and order record have been updated.");
  } catch (error) {
    showToast("Refund failed", error instanceof Error ? error.message : "Try again in a moment.", false);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function renderProductImages(): void {
  for (const url of productImageUrls) URL.revokeObjectURL(url);
  productImageUrls = productImageFiles.map((file) => URL.createObjectURL(file));
  productImageCount.textContent = `${selectedProductMedia.length + productImageFiles.length} / 12`;
  const saved = selectedProductMedia.map((item, index) =>
    `<figure class="product-image-item product-image-item--library"><img src="${escapeHtml(item.thumbnailUrl || item.src)}" data-fallback-src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || item.name)}" loading="lazy" decoding="async" /><button type="button" data-remove-library-image="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button><small>LIBRARY</small></figure>`,
  );
  const local = productImageFiles.map((file, index) =>
    `<figure class="product-image-item product-image-item--local"><img src="${productImageUrls[index]}" alt="${escapeHtml(file.name)}" /><button type="button" data-remove-product-image="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button><small>STAGED</small></figure>`,
  );
  productImagePreview.innerHTML = [...saved, ...local].join("") || '<div class="product-media-empty"><span>▧</span><p>No images selected. Choose an asset from the media library.</p></div>';
}

function addProductImages(files: Iterable<File>): void {
  const supported = [...files].filter((file) =>
    ["image/png", "image/jpeg", "image/webp"].includes(file.type),
  );
  const existing = new Set(productImageFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  const additions = supported.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`));
  const combined = [...productImageFiles, ...additions];
  productImageFiles = combined.slice(0, Math.max(0, 12 - selectedProductMedia.length));
  renderProductImages();
  if (supported.length < [...files].length) {
    showToast("Some files were skipped", "Use PNG, JPG or WebP product images.", false);
  } else if (combined.length + selectedProductMedia.length > 12) {
    showToast("Image limit reached", "You can add up to twelve images per product.", false);
  }
}

function productCategoryPath(category: CommerceProductCategory, categories: CommerceProductCategory[]): string {
  const names = [category.name];
  const visited = new Set<number>([category.id]);
  let parentId = category.parentId;
  while (parentId > 0 && !visited.has(parentId)) {
    const parent = categories.find((item) => item.id === parentId);
    if (!parent) break;
    visited.add(parent.id);
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" › ");
}

function preferredProductCategoryId(): number {
  const categories = commerceData?.categories || [];
  return categories.find((category) => category.name.toLocaleLowerCase("en") === "research peptides")?.id
    || categories.find((category) => category.name.toLocaleLowerCase("en") === "uncategorized")?.id
    || categories[0]?.id
    || 0;
}

function renderProductCategoryOptions(selectedId = 0, selectedName = ""): void {
  const categories = commerceData?.categories || [];
  const sorted = [...categories].sort((left, right) =>
    productCategoryPath(left, categories).localeCompare(productCategoryPath(right, categories), "en", { sensitivity: "base" }),
  );
  const matchingName = selectedName
    ? sorted.find((category) => category.name.toLocaleLowerCase("en") === selectedName.toLocaleLowerCase("en"))
    : undefined;
  const selected = selectedId > 0 ? selectedId : matchingName?.id || preferredProductCategoryId();
  const missingCurrent = selectedId > 0 && !sorted.some((category) => category.id === selectedId);
  productCategoryInput.innerHTML = [
    '<option value="">Choose a catalog category</option>',
    ...(missingCurrent && selectedName
      ? [`<option value="${selectedId}">${escapeHtml(selectedName)} · current</option>`]
      : []),
    ...sorted.map((category) => `<option value="${category.id}">${escapeHtml(productCategoryPath(category, categories))} (${formatNumber(category.count)})</option>`),
  ].join("");
  productCategoryInput.value = selected > 0 ? String(selected) : "";
}

function setProductSkuStatus(message: string, state: "idle" | "checking" | "available" | "error"): void {
  productSkuStatus.textContent = message;
  productSkuStatus.dataset.state = state;
}

function refreshGeneratedVariantSkus(): void {
  if (editingProductId) return;
  const baseSku = productSkuInput.value.trim();
  if (!baseSku) return;
  for (const row of variantRows.querySelectorAll<HTMLElement>("[data-variant-row]")) {
    const option = row.querySelector<HTMLInputElement>("[data-variant-option]")?.value || "";
    const sku = row.querySelector<HTMLInputElement>("[data-variant-sku]");
    if (sku) sku.value = productVariantSku(baseSku, option);
  }
}

function scheduleAutomaticSkuSuggestion(immediate = false): void {
  if (skuSuggestionTimer) window.clearTimeout(skuSuggestionTimer);
  skuSuggestionSequence += 1;
  const sequence = skuSuggestionSequence;
  if (editingProductId) {
    setProductSkuStatus("Existing SKU protected. It will remain unchanged when you save.", "available");
    return;
  }
  const name = productNameInput.value.trim();
  if (!name) {
    productSkuInput.value = "";
    setProductSkuStatus("Enter the product name and availability will be checked for you.", "idle");
    return;
  }
  const provisional = productSkuBase(name);
  productSkuInput.value = provisional;
  refreshGeneratedVariantSkus();
  setProductSkuStatus("Checking this SKU against the complete catalog…", "checking");
  const verify = async (): Promise<void> => {
    try {
      const response = await fetch(`/api/commerce/product/sku-suggestion?name=${encodeURIComponent(name)}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload) || typeof payload.sku !== "string") {
        throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Availability could not be checked");
      }
      if (sequence !== skuSuggestionSequence || productNameInput.value.trim() !== name || editingProductId) return;
      productSkuInput.value = payload.sku;
      refreshGeneratedVariantSkus();
      setProductSkuStatus(
        payload.sku === provisional
          ? "Available · this SKU will be assigned automatically."
          : `Available · ${payload.sku} was selected to avoid a duplicate.`,
        "available",
      );
    } catch {
      if (sequence !== skuSuggestionSequence || editingProductId) return;
      productSkuInput.value = provisional;
      setProductSkuStatus("A preview is ready. Availability will be checked again securely when you save.", "error");
    }
  };
  skuSuggestionTimer = window.setTimeout(() => void verify(), immediate ? 0 : 450);
}

function resetVariantBuilder(): void {
  productVariantsToggle.checked = false;
  variantBuilder.hidden = true;
  variantAttributeInput.value = "";
  variantOptionsInput.value = "";
  variantRows.innerHTML = "";
  variantTable.hidden = true;
}

function generateVariantRows(): void {
  const options = [...new Set(variantOptionsInput.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean))];
  if (!options.length) {
    showToast("Add variant values", "Enter options separated by commas, then generate the variants.", false);
    variantOptionsInput.focus();
    return;
  }
  const baseSku = productSkuInput.value.trim() || "P1-PRODUCT";
  const price = Number(productPriceInput.value) || 0;
  const unitCost = Number(productCostInput.value) || 0;
  const stock = Number(productStockInput.value) || 0;
  variantRows.innerHTML = options.map((option) => {
    return variantRowMarkup({ option, sku: productVariantSku(baseSku, option), price, unitCost, stock });
  }).join("");
  variantTable.hidden = false;
}

function variantRowMarkup(input: { id?: number; option: string; sku: string; price: number; unitCost: number; stock: number; image?: CommerceMedia | null; testingCost?: number; testingLot?: string }): string {
  const image = input.image
    ? `<img src="${escapeHtml(input.image.thumbnailUrl || input.image.src)}" alt="" loading="lazy" decoding="async" />`
    : "<span>+</span>";
  const profitability = calculateProductProfitability(input.price, {
    unitCost: input.unitCost,
    packagingCost: Number(productPackagingInput.value) || 0,
    feeRate: Number(productFeeInput.value) || 0,
    affiliateRate: Number(productAffiliateRateInput.value) || 0,
    testingCost: input.testingCost || 0,
  });
  return `<div class="variant-row" data-variant-row data-testing-cost="${input.testingCost || 0}" data-testing-lot="${escapeHtml(input.testingLot || "")}"><button class="variant-image-button" type="button" data-choose-variant-image aria-label="Choose image for ${escapeHtml(input.option)}">${image}</button><strong>${escapeHtml(variantAttributeInput.value.trim() || "Option")}: ${escapeHtml(input.option)}</strong><input data-variant-sku type="text" value="${escapeHtml(input.sku)}" aria-label="Automatically generated SKU for ${escapeHtml(input.option)}" title="Generated automatically" readonly /><input data-variant-price type="number" min="0" step="0.01" value="${input.price}" aria-label="Price for ${escapeHtml(input.option)}" /><input data-variant-cost type="number" min="0" step="0.01" value="${input.unitCost}" aria-label="Unit cost for ${escapeHtml(input.option)}" /><span class="variant-profit" data-variant-profit>${escapeHtml(formatCurrency(profitability.estimatedProfit))}<small>${(profitability.margin ?? 0).toFixed(1)}% margin${input.testingCost ? ` · ${escapeHtml(formatCurrency(input.testingCost))} test` : ""}</small></span><input data-variant-stock type="number" min="0" value="${input.stock}" aria-label="Stock for ${escapeHtml(input.option)}" /><input data-variant-option type="hidden" value="${escapeHtml(input.option)}" /><input data-variant-id type="hidden" value="${input.id || ""}" /><input data-variant-image-id type="hidden" value="${input.image?.id || ""}" /></div>`;
}

function collectVariants(): Array<{ id?: number; option: string; sku: string; price: number; unitCost: number; stock: number; imageId?: number }> {
  return [...variantRows.querySelectorAll<HTMLElement>("[data-variant-row]")].map((row) => ({
    ...(Number(row.querySelector<HTMLInputElement>("[data-variant-id]")?.value) > 0
      ? { id: Number(row.querySelector<HTMLInputElement>("[data-variant-id]")?.value) }
      : {}),
    option: row.querySelector<HTMLInputElement>("[data-variant-option]")?.value || "",
    sku: row.querySelector<HTMLInputElement>("[data-variant-sku]")?.value.trim() || "",
    price: Number(row.querySelector<HTMLInputElement>("[data-variant-price]")?.value) || 0,
    unitCost: Number(row.querySelector<HTMLInputElement>("[data-variant-cost]")?.value) || 0,
    stock: Number(row.querySelector<HTMLInputElement>("[data-variant-stock]")?.value) || 0,
    ...(Number(row.querySelector<HTMLInputElement>("[data-variant-image-id]")?.value) > 0
      ? { imageId: Number(row.querySelector<HTMLInputElement>("[data-variant-image-id]")?.value) }
      : {}),
  }));
}

function calculateVariantProfits(): void {
  const packagingCost = Number(productPackagingInput.value) || 0;
  const feeRate = Number(productFeeInput.value) || 0;
  const affiliateRate = Number(productAffiliateRateInput.value) || 0;
  for (const row of variantRows.querySelectorAll<HTMLElement>("[data-variant-row]")) {
    const price = Number(row.querySelector<HTMLInputElement>("[data-variant-price]")?.value) || 0;
    const unitCost = Number(row.querySelector<HTMLInputElement>("[data-variant-cost]")?.value) || 0;
    const testingCost = Math.max(0, Number(row.dataset.testingCost) || 0);
    const result = calculateProductProfitability(price, { unitCost, packagingCost, feeRate, affiliateRate, testingCost });
    const output = row.querySelector<HTMLElement>("[data-variant-profit]");
    if (output) output.innerHTML = `${escapeHtml(formatCurrency(result.estimatedProfit))}<small>${(result.margin ?? 0).toFixed(1)}% margin${testingCost ? ` · ${escapeHtml(formatCurrency(testingCost))} test` : ""}</small>`;
  }
}

function calculateProductProfit(): void {
  const price = Number(productPriceInput.value) || 0;
  const cost = Number(productCostInput.value) || 0;
  const packaging = Number(productPackagingInput.value) || 0;
  const feeRate = Number(productFeeInput.value) || 0;
  const affiliateRate = Number(productAffiliateRateInput.value) || 0;
  const profitability = calculateProductProfitability(price, {
    unitCost: cost,
    packagingCost: packaging,
    feeRate,
    affiliateRate,
    testingCost: activeProductTestingCost,
  });
  requiredElement<HTMLElement>("#calculator-profit").textContent = formatCurrency(profitability.estimatedProfit);
  requiredElement<HTMLElement>("#calculator-margin").textContent = `${(profitability.margin || 0).toFixed(1)}%`;
  requiredElement<HTMLElement>("#calculator-equation").textContent =
    `${formatCurrency(price)} − ${formatCurrency(cost)} cost − ${formatCurrency(packaging)} operations${activeProductTestingCost ? ` − ${formatCurrency(activeProductTestingCost)} test (${activeProductTestingLot || "current lot"})` : ""} − ${formatCurrency(profitability.transactionFee)} fee − ${formatCurrency(profitability.affiliateReserve)} affiliate`;
  calculateVariantProfits();
}

function populateProductWorkspace(product: CommerceProduct, variations: CommerceVariation[] = []): void {
  editingProductId = product?.id ?? null;
  activeProductTestingCost = product.testingCostPerUnit || 0;
  activeProductTestingLot = product.testingLot || "";
  requiredElement<HTMLElement>("#product-drawer-title").textContent = product.name;
  requiredElement<HTMLElement>("#product-record-badge").textContent = `#${product.id}`;
  requiredElement<HTMLElement>("#product-drawer-subtitle").textContent = "Manage merchandising, inventory, economics and channel visibility.";
  productNameInput.value = product?.name || "";
  productSkuInput.value = product?.sku || "";
  productStockInput.value = String(product?.stockQuantity ?? 0);
  renderProductCategoryOptions(product?.categoryId || 0, product?.category || "");
  productStatusInput.value = product?.visibility || "draft";
  productCostInput.value = String(product?.cost?.unitCost ?? 0);
  productPriceInput.value = String(product?.price ?? 0);
  productPackagingInput.value = String(product?.cost?.packagingCost ?? 0);
  productFeeInput.value = String(product?.cost?.feeRate ?? 3.5);
  productAffiliateRateInput.value = String(product?.cost?.affiliateRate ?? 0);
  selectedProductMedia = [...(product.images || [])];
  productImageFiles = [];
  renderProductImages();
  resetVariantBuilder();
  if (variations.length || product.type === "variable") {
    productVariantsToggle.checked = true;
    variantBuilder.hidden = false;
    const attribute = product.attributes.find((item) => item.variation);
    variantAttributeInput.value = attribute?.name || variations[0]?.attributes[0]?.name || "Option";
    variantOptionsInput.value = variations.map((item) => item.attributes[0]?.option).filter(Boolean).join(", ");
    variantRows.innerHTML = variations.map((item) => variantRowMarkup({
      id: item.id,
      option: item.attributes[0]?.option || `Variant ${item.id}`,
      sku: item.sku,
      price: item.regularPrice || item.price,
      unitCost: item.cost?.unitCost ?? product.cost?.unitCost ?? 0,
      stock: item.stockQuantity || 0,
      image: item.image,
      testingCost: item.testingCostPerUnit || 0,
      testingLot: item.testingLot || "",
    })).join("");
    variantTable.hidden = variations.length === 0;
  }
  setProductSkuStatus("Existing SKU protected. It will remain unchanged when you save.", "available");
  calculateProductProfit();
}

async function loadProductWorkspace(product: CommerceProduct): Promise<void> {
  productDetailLoading.hidden = false;
  productForm.classList.add("is-loading-detail");
  try {
    const response = await fetch(`/api/commerce/product?productId=${encodeURIComponent(String(product.id))}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.product)) throw new Error("Product details unavailable");
    const detailedProduct = payload.product as unknown as CommerceProduct;
    detailedProduct.cost = isRecord(payload.cost) ? payload.cost as unknown as CommerceCost : product.cost;
    populateProductWorkspace(detailedProduct, Array.isArray(payload.variations) ? payload.variations as CommerceVariation[] : []);
  } catch (error) {
    showToast("Product details unavailable", error instanceof Error ? error.message : "Try again.", false);
  } finally {
    productDetailLoading.hidden = true;
    productForm.classList.remove("is-loading-detail");
  }
}

function openProductDrawer(product?: CommerceProduct): void {
  editingProductId = product?.id ?? null;
  activeProductTestingCost = product?.testingCostPerUnit || 0;
  activeProductTestingLot = product?.testingLot || "";
  productDrawer.classList.remove("is-cost-mode");
  requiredElement<HTMLElement>("#product-drawer-title").textContent = product ? product.name : "Add product";
  requiredElement<HTMLElement>("#product-record-badge").textContent = product ? `#${product.id}` : "NEW";
  requiredElement<HTMLElement>("#product-drawer-subtitle").textContent = product
    ? "Opening the complete product workspace…"
    : "Create a complete, profitable and sales-ready catalog item.";
  productNameInput.value = product?.name || "";
  productSkuInput.value = product?.sku || "";
  productStockInput.value = String(product?.stockQuantity ?? 0);
  renderProductCategoryOptions(product?.categoryId || 0, product?.category || "");
  productStatusInput.value = product?.visibility || "draft";
  productCostInput.value = String(product?.cost?.unitCost ?? 0);
  productPriceInput.value = String(product?.regularPrice || product?.price || 0);
  productPackagingInput.value = String(product?.cost?.packagingCost ?? 0);
  productFeeInput.value = String(product?.cost?.feeRate ?? 3.5);
  productAffiliateRateInput.value = String(product?.cost?.affiliateRate ?? 0);
  trashProductButton.hidden = !product || Boolean(product.localDraft);
  requiredElement<HTMLElement>(".product-lot-onboarding").hidden = Boolean(product);
  trashProductButton.classList.remove("is-confirming");
  trashProductButton.textContent = "Move to Trash";
  delete trashProductButton.dataset.confirming;
  for (const input of [productNameInput, productStockInput, productPriceInput]) input.readOnly = false;
  productSkuInput.readOnly = true;
  productCategoryInput.disabled = false;
  productStatusInput.disabled = false;
  const submitButton = productForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton) submitButton.textContent = product ? "Save changes" : "Create product";
  selectedProductMedia = [...(product?.images || [])];
  productImageFiles = [];
  renderProductImages();
  resetVariantBuilder();
  calculateProductProfit();
  if (product) setProductSkuStatus("Existing SKU protected. It will remain unchanged when you save.", "available");
  else scheduleAutomaticSkuSuggestion(true);
  productDrawer.hidden = false;
  drawerBackdrop.hidden = false;
  document.body.classList.add("drawer-open");
  if (product?.type === "variable" || product?.variationIds.length) void loadProductWorkspace(product);
  else if (product) populateProductWorkspace(product);
  else productNameInput.focus();
}

function closeProductDrawer(): void {
  if (skuSuggestionTimer) window.clearTimeout(skuSuggestionTimer);
  skuSuggestionSequence += 1;
  productDrawer.hidden = true;
  drawerBackdrop.hidden = true;
  document.body.classList.remove("drawer-open");
  for (const url of productImageUrls) URL.revokeObjectURL(url);
  productImageUrls = [];
  selectedProductMedia = [];
  editingProductId = null;
}

function renderMediaPicker(): void {
  const search = mediaPickerSearch.value.trim().toLocaleLowerCase("en");
  const media = (commerceData?.media || []).filter((item) =>
    !search || `${item.name} ${item.alt} ${(item.productNames || []).join(" ")}`.toLocaleLowerCase("en").includes(search),
  );
  mediaPickerGrid.innerHTML = media.length
    ? media.map((item) => `<button class="media-pick-card" type="button" data-pick-media="${item.id}"><img src="${escapeHtml(item.thumbnailUrl || item.src)}" data-fallback-src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || item.name)}" loading="lazy" decoding="async" /><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.productNames?.[0] || "Catalog asset")}</small></span></button>`).join("")
    : '<div class="media-empty"><span>▧</span><strong>No reusable images found.</strong></div>';
}

function openMediaPicker(variantRow: HTMLElement | null = null): void {
  mediaPickerVariantRow = variantRow;
  requiredElement<HTMLElement>("#media-picker-subtitle").textContent = variantRow
    ? "Select the image customers should see for this variant."
    : "Select one or more existing assets for the product gallery.";
  mediaPickerSearch.value = "";
  renderMediaPicker();
  mediaPicker.hidden = false;
  mediaPickerBackdrop.hidden = false;
  document.body.classList.add("modal-open");
  mediaPickerSearch.focus();
}

function closeMediaPicker(): void {
  mediaPicker.hidden = true;
  mediaPickerBackdrop.hidden = true;
  mediaPickerVariantRow = null;
  document.body.classList.remove("modal-open");
}

function selectMedia(mediaId: number): void {
  const item = commerceData?.media.find((media) => media.id === mediaId);
  if (!item) return;
  if (mediaPickerVariantRow) {
    const field = mediaPickerVariantRow.querySelector<HTMLInputElement>("[data-variant-image-id]");
    const button = mediaPickerVariantRow.querySelector<HTMLButtonElement>("[data-choose-variant-image]");
    if (field) field.value = String(item.id);
    if (button) button.innerHTML = `<img src="${escapeHtml(item.thumbnailUrl || item.src)}" alt="" loading="lazy" decoding="async" />`;
    closeMediaPicker();
    return;
  }
  if (!selectedProductMedia.some((media) => media.id === item.id) && selectedProductMedia.length + productImageFiles.length < 12) {
    selectedProductMedia.push(item);
    renderProductImages();
  }
}

for (const item of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  item.addEventListener("click", () => navigate(item.dataset.view || "overview"));
}
requiredElement<HTMLButtonElement>("#open-product-barcodes").addEventListener("click", () => {
  resetLabelSelection();
  showLabelWorkspace("print");
  navigate("labels");
});
requiredElement<HTMLButtonElement>("#back-to-products-from-labels").addEventListener("click", () => navigate("products"));
document.addEventListener("error", (event) => {
  const image = event.target instanceof HTMLImageElement ? event.target : null;
  if (image?.hasAttribute("data-customer-avatar-image")) {
    image.parentElement?.classList.remove("has-photo");
    image.parentElement?.classList.add("is-generated");
    image.remove();
    return;
  }
  const fallback = image?.dataset.fallbackSrc;
  if (image && fallback && image.src !== fallback) image.src = fallback;
}, true);
for (const item of document.querySelectorAll<HTMLButtonElement>("[data-go-view]")) {
  item.addEventListener("click", () => {
    navigate(item.dataset.goView || "overview");
    const accountMenu = item.closest<HTMLElement>(".account-menu");
    if (accountMenu) {
      accountMenu.classList.add("is-dismissed");
      item.blur();
    }
  });
}
for (const accountMenu of document.querySelectorAll<HTMLElement>(".account-menu")) {
  accountMenu.addEventListener("mouseleave", () => accountMenu.classList.remove("is-dismissed"));
  accountMenu.querySelector<HTMLButtonElement>(".account-button")?.addEventListener("click", () => accountMenu.classList.remove("is-dismissed"));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-settings-view]")) {
  button.addEventListener("click", () => {
    const view = button.dataset.settingsView;
    if (view === "general" || view === "team" || view === "security") showSettingsView(view);
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-label-workspace]")) {
  button.addEventListener("click", () => {
    const next = button.dataset.labelWorkspace;
    if (next === "print" || next === "locations" || next === "history") showLabelWorkspace(next);
  });
}
requiredElement<HTMLButtonElement>("#refresh-label-workspace").addEventListener("click", () => {
  void Promise.all([loadFulfillmentLocations(true), loadExtensions()]).then(() => {
    showToast("Warehouse data refreshed", "Storage locations, catalog details and COA batches are up to date.");
  });
});
requiredElement<HTMLInputElement>("#label-product-search").addEventListener("input", (event) => {
  labelProductSearch = (event.currentTarget as HTMLInputElement).value;
  renderLabelProductList();
});
requiredElement<HTMLSelectElement>("#label-category-filter").addEventListener("change", (event) => {
  labelProductCategory = (event.currentTarget as HTMLSelectElement).value || "all";
  renderLabelProductList();
});
requiredElement<HTMLSelectElement>("#label-product-sort").addEventListener("change", (event) => {
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (value !== "name" && value !== "stock-low" && value !== "location") return;
  labelProductSort = value;
  renderLabelProductList();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-label-product-view]")) {
  button.addEventListener("click", () => {
    const view = button.dataset.labelProductView;
    if (view !== "grid" && view !== "list") return;
    labelProductView = view;
    localStorage.setItem("phaseone:label-product-view", view);
    renderLabelProductList();
  });
}
requiredElement<HTMLElement>("#label-product-list").addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-label-product]")
    : null;
  const productId = Number(button?.dataset.labelProduct);
  if (Number.isSafeInteger(productId) && productId > 0) void selectLabelProduct(productId);
});
requiredElement<HTMLInputElement>("#label-location-search").addEventListener("input", (event) => {
  locationProductSearch = (event.currentTarget as HTMLInputElement).value;
  renderLocationProductList();
});
requiredElement<HTMLSelectElement>("#label-location-filter").addEventListener("change", (event) => {
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (value !== "all" && value !== "assigned" && value !== "unassigned") return;
  labelLocationFilter = value;
  renderLocationProductList();
});
requiredElement<HTMLElement>("#label-location-product-list").addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-location-product]")
    : null;
  const productId = Number(button?.dataset.locationProduct);
  if (Number.isSafeInteger(productId) && productId > 0) void selectLocationProduct(productId);
});
requiredElement<HTMLInputElement>("#label-history-search").addEventListener("input", (event) => {
  labelHistorySearch = (event.currentTarget as HTMLInputElement).value;
  renderRegisteredLabels();
});
requiredElement<HTMLSelectElement>("#label-history-type").addEventListener("change", (event) => {
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (value !== "all" && value !== "product" && value !== "variation" && value !== "batch") return;
  labelHistoryType = value;
  renderRegisteredLabels();
});
requiredElement<HTMLSelectElement>("#label-history-sort").addEventListener("change", (event) => {
  const value = (event.currentTarget as HTMLSelectElement).value;
  if (value !== "newest" && value !== "oldest" && value !== "product") return;
  labelHistorySort = value;
  renderRegisteredLabels();
});
requiredElement<HTMLElement>("#registered-label-list").addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-reprint-label]")
    : null;
  const token = button?.dataset.reprintLabel || "";
  if (token) openBarcodePrintWindow(token);
});
requiredElement<HTMLElement>("#label-effective-location").addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-open-location-for-product]")
    : null;
  const productId = Number(button?.dataset.openLocationForProduct);
  if (!Number.isSafeInteger(productId) || productId <= 0) return;
  showLabelWorkspace("locations");
  void selectLocationProduct(productId);
});
requiredElement<HTMLElement>("#label-location-editor").addEventListener("input", (event) => {
  const input = event.target instanceof HTMLInputElement && event.target.matches("[data-location-input]")
    ? event.target
    : null;
  if (input) input.value = input.value.toUpperCase().replace(/\s+/g, "");
});
requiredElement<HTMLElement>("#label-location-editor").addEventListener("click", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-save-location], [data-remove-location]")
    : null;
  const row = button?.closest<HTMLElement>("[data-location-row]");
  if (!button || !row) return;
  void saveProductLocation(row, button.hasAttribute("data-remove-location"));
});
requiredElement<HTMLButtonElement>("#label-change-product").addEventListener("click", resetLabelSelection);
requiredElement<HTMLButtonElement>("#label-start-over").addEventListener("click", resetLabelSelection);
requiredElement<HTMLButtonElement>("#label-back-to-details").addEventListener("click", () => {
  labelPrintStep = "details";
  renderLabelPrintStep();
});
requiredElement<HTMLButtonElement>("#location-change-product").addEventListener("click", resetLocationSelection);
requiredElement<HTMLSelectElement>("#label-type-select").addEventListener("change", (event) => {
  const type = (event.currentTarget as HTMLSelectElement).value;
  if (type !== "product" && type !== "variation" && type !== "batch") return;
  selectedLabelType = type;
  if (type === "product") selectedLabelVariationId = 0;
  if (type !== "batch") selectedLabelCoaId = "";
  clearBarcodePreview();
  renderLabelComposer();
});
requiredElement<HTMLSelectElement>("#label-variation-select").addEventListener("change", (event) => {
  selectedLabelVariationId = Number((event.currentTarget as HTMLSelectElement).value) || 0;
  selectedLabelCoaId = "";
  clearBarcodePreview();
  renderLabelComposer();
});
requiredElement<HTMLSelectElement>("#label-batch-select").addEventListener("change", (event) => {
  selectedLabelCoaId = (event.currentTarget as HTMLSelectElement).value;
  clearBarcodePreview();
  renderLabelComposer();
});
for (const field of [
  requiredElement<HTMLSelectElement>("#label-size-select"),
  requiredElement<HTMLInputElement>("#label-copy-count"),
]) {
  field.addEventListener("change", () => {
    clearBarcodePreview();
    renderLabelComposer();
  });
}
requiredElement<HTMLButtonElement>("#generate-barcode-label").addEventListener("click", () => {
  void generateBarcodeLabel();
});
requiredElement<HTMLButtonElement>("#copy-barcode-token").addEventListener("click", async () => {
  if (!activeBarcodeLabel) return;
  try {
    await navigator.clipboard.writeText(activeBarcodeLabel.token);
    showToast("Identifier copied", "The registered barcode value is ready to paste into a test tool.");
  } catch {
    showToast("Copy blocked", "Your browser did not allow clipboard access.", false);
  }
});
requiredElement<HTMLButtonElement>("#print-barcode-label").addEventListener("click", printBarcodeLabel);
for (const option of document.querySelectorAll<HTMLButtonElement>("[data-promo-option]")) {
  option.addEventListener("click", () => {
    selectedPromoType = normalizePromoType(option.dataset.promoOption || "general");
    markSiteControlsDirty();
    renderPromoEditorMode();
  });
}
requiredElement<HTMLElement>("[data-view-panel='site-controls']").addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
    markSiteControlsDirty();
  }
});
requiredElement<HTMLElement>("[data-view-panel='site-controls']").addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
    markSiteControlsDirty();
  }
});
requiredElement<HTMLInputElement>("#promo-enabled").addEventListener("change", (event) => {
  requiredElement<HTMLElement>("#promo-state").textContent = (event.currentTarget as HTMLInputElement).checked ? "READY" : "OFF";
});
requiredElement<HTMLSelectElement>("#promo-product-select").addEventListener("change", () => {
  const product = siteControlProduct();
  requiredElement<HTMLInputElement>("#promo-sale-price-input").value = product?.salePrice ? String(product.salePrice) : "";
  if (product?.slug) {
    requiredElement<HTMLInputElement>("#promo-cta-url").value = `/product/${encodeURIComponent(product.slug)}/`;
  }
  updatePromoProductPreview();
});
requiredElement<HTMLInputElement>("#promo-sale-price-input").addEventListener("input", updatePromoProductPreview);
requiredElement<HTMLInputElement>("#maintenance-enabled").addEventListener("change", updateMaintenancePreview);
requiredElement<HTMLInputElement>("#maintenance-title").addEventListener("input", updateMaintenancePreview);
requiredElement<HTMLTextAreaElement>("#maintenance-message").addEventListener("input", updateMaintenancePreview);
requiredElement<HTMLButtonElement>("#site-controls-save").addEventListener("click", () => void saveSiteControls());
requiredElement<HTMLButtonElement>("#site-controls-refresh").addEventListener("click", () => {
  void loadIndependentSiteControls(true).then(() => showToast("Control state reloaded", "Site Controls now shows the latest independent storefront decision."));
});
function showLoyaltySection(section: string): void {
  const next = ["overview", "settings", "customers", "history"].includes(section) ? section : "overview";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-loyalty-section]")) {
    const active = button.dataset.loyaltySection === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-loyalty-panel]")) panel.hidden = panel.dataset.loyaltyPanel !== next;
  requiredElement<HTMLElement>("[data-view-panel='loyalty']").scrollIntoView({ behavior: "smooth", block: "start" });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-loyalty-section]")) button.addEventListener("click", () => showLoyaltySection(button.dataset.loyaltySection || "overview"));
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-loyalty-open]")) button.addEventListener("click", () => showLoyaltySection(button.dataset.loyaltyOpen || "overview"));
requiredElement<HTMLButtonElement>("#loyalty-refresh").addEventListener("click", () => {
  loyaltyData = undefined;
  void loadLoyalty(true).then(() => showToast("Loyalty policy reloaded", "The workspace now shows the confirmed live program values."));
});
for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("#loyalty-policy-form input, #loyalty-policy-form select, #loyalty-example-order")) {
  input.addEventListener("input", updateLoyaltySimulator);
  input.addEventListener("change", updateLoyaltySimulator);
}
requiredElement<HTMLInputElement>("#loyalty-customer-search").addEventListener("input", renderLoyaltySearchResults);
requiredElement<HTMLElement>("#loyalty-search-results").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-loyalty-customer]");
  if (!button) return;
  loyaltySelectedCustomerId = Number(button.dataset.loyaltyCustomer) || null;
  renderLoyaltySelectedCustomer();
});
requiredElement<HTMLSelectElement>("#loyalty-adjustment-operation").addEventListener("change", updateLoyaltyAdjustmentPreview);
requiredElement<HTMLInputElement>("#loyalty-adjustment-amount").addEventListener("input", updateLoyaltyAdjustmentPreview);
requiredElement<HTMLFormElement>("#loyalty-policy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = loyaltySettingsFromForm();
  if (!settings.awardStatuses.length) {
    showToast("Choose an award status", "Select Processing, Completed, or both before publishing.", false);
    return;
  }
  const current = loyaltyData?.settings;
  const conversionChanged = Boolean(current && (current.redemptionBlockPoints !== settings.redemptionBlockPoints || current.redemptionBlockCredit !== settings.redemptionBlockCredit));
  const confirmed = requiredElement<HTMLInputElement>("#loyalty-policy-confirm").checked;
  if (conversionChanged && !confirmed) {
    showToast("Confirm the new point value", "This also changes what existing customer points are worth. Review the estimate, then tick the confirmation box before saving.", false);
    requiredElement<HTMLInputElement>("#loyalty-policy-confirm").focus();
    return;
  }
  const reason = requiredElement<HTMLTextAreaElement>("#loyalty-policy-reason").value.trim();
  if (reason.length < 5) {
    showToast("Change reason required", "Enter a short internal reason so the policy remains auditable.", false);
    return;
  }
  const save = requiredElement<HTMLButtonElement>("#loyalty-policy-save");
  save.disabled = true;
    save.textContent = "Saving program rules…";
  try {
    const response = await fetch("/api/rewards/settings", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ settings, reason, confirmLiabilityChange: confirmed }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.settings)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The policy could not be published");
    loyaltyData = payload as unknown as LoyaltyPayload;
    requiredElement<HTMLTextAreaElement>("#loyalty-policy-reason").value = "";
    requiredElement<HTMLInputElement>("#loyalty-policy-confirm").checked = false;
    applyLoyaltySettings(loyaltyData.settings || settings);
    renderLoyalty();
    showToast("Program rules saved", "New earning and redemption activity now follows these rules.");
  } catch (error) {
    showToast("Policy publication failed", error instanceof Error ? error.message : "Check the live connection and try again.", false);
  } finally {
    save.textContent = "Save program rules";
    save.disabled = !Boolean(loyaltyData?.canManage && loyaltyData.writeEnabled);
  }
});
requiredElement<HTMLFormElement>("#loyalty-adjustment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const customer = loyaltyEligibleCustomers().find((item) => item.id === loyaltySelectedCustomerId);
  const operation = requiredElement<HTMLSelectElement>("#loyalty-adjustment-operation").value as "add" | "subtract" | "set";
  const amount = Math.max(0, Math.round(Number(requiredElement<HTMLInputElement>("#loyalty-adjustment-amount").value) || 0));
  const reason = requiredElement<HTMLTextAreaElement>("#loyalty-adjustment-reason").value.trim();
  if (!customer || reason.length < 5) {
    showToast("Complete the adjustment", "Choose a customer and enter an internal reason.", false);
    return;
  }
  const save = requiredElement<HTMLButtonElement>("#loyalty-adjustment-save");
  save.disabled = true;
  save.textContent = "Applying adjustment…";
  try {
    const response = await fetch("/api/rewards/adjust", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ customerId: customer.id, operation, amount, reason, notifyCustomer: requiredElement<HTMLInputElement>("#loyalty-adjustment-notify").checked }),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload) || !isRecord(payload.adjustment)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The adjustment could not be completed");
    const adjustment = payload.adjustment as Record<string, unknown>;
    customer.pointsBalance = Number(adjustment.balanceAfter) || 0;
    customer.rewardHistory.unshift({
      id: `local:${Date.now()}`,
      change: Number(adjustment.change) || 0,
      balanceBefore: Number(adjustment.balanceBefore) || 0,
      balanceAfter: Number(adjustment.balanceAfter) || 0,
      type: "manual_adjustment",
      reason,
      createdAt: new Date().toISOString(),
      orderId: 0,
    });
    if (customerDirectory?.totals?.pointsOutstanding !== null && customerDirectory?.totals?.pointsOutstanding !== undefined) customerDirectory.totals.pointsOutstanding += Number(adjustment.change) || 0;
    requiredElement<HTMLInputElement>("#loyalty-adjustment-amount").value = "";
    requiredElement<HTMLTextAreaElement>("#loyalty-adjustment-reason").value = "";
    loyaltyData = undefined;
    renderLoyaltySelectedCustomer();
    requiredElement<HTMLElement>("#loyalty-activity-list").innerHTML = loyaltyActivityRows();
    showToast("Customer points updated", `${adjustment.change && Number(adjustment.change) > 0 ? "+" : ""}${formatNumber(Number(adjustment.change) || 0)} points were recorded with a complete audit entry.`);
    void loadLoyalty(true);
  } catch (error) {
    showToast("Adjustment failed", error instanceof Error ? error.message : "Check the live balance and try again.", false);
  } finally {
    save.textContent = "Apply adjustment";
    updateLoyaltyAdjustmentPreview();
  }
});
requiredElement<HTMLButtonElement>("#save-settings").addEventListener("click", saveSettings);
requiredElement<HTMLButtonElement>("#seo-connect").addEventListener("click", () => {
  location.assign("/api/seo/connect");
});
requiredElement<HTMLButtonElement>("#seo-sync").addEventListener("click", () => void loadSeo(true));
document.querySelectorAll<HTMLButtonElement>("[data-seo-ranking]").forEach((button) => button.addEventListener("click", () => {
  const view = button.dataset.seoRanking;
  if (!view) return;
  document.querySelectorAll<HTMLButtonElement>("[data-seo-ranking]").forEach((item) => {
    const active = item.dataset.seoRanking === view;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll<HTMLElement>("[data-seo-ranking-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.seoRankingPanel !== view;
  });
}));

requiredElement<HTMLButtonElement>("#open-user-create").addEventListener("click", () => setDialogVisibility("#user-dialog", "#user-dialog-backdrop", true));
requiredElement<HTMLButtonElement>("#user-dialog-cancel").addEventListener("click", closeUserDialog);
requiredElement<HTMLButtonElement>("#user-dialog-backdrop").addEventListener("click", closeUserDialog);
requiredElement<HTMLFormElement>("#user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = "Creating…"; }
  try {
    const response = await fetch("/api/users", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        displayName: requiredElement<HTMLInputElement>("#user-display-name").value.trim(),
        username: requiredElement<HTMLInputElement>("#user-username").value.trim(),
        email: requiredElement<HTMLInputElement>("#user-email").value.trim(),
        role: requiredElement<HTMLSelectElement>("#user-role").value,
        password: requiredElement<HTMLInputElement>("#user-password").value,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The account could not be created");
    closeUserDialog();
    await Promise.all([loadWorkspaceUsers(), loadNotifications()]);
    showToast("Account created", "The person can now sign in with their individual credentials.");
  } catch (error) { showToast("Unable to create account", error instanceof Error ? error.message : "Try again.", false); }
  finally { if (submit) { submit.disabled = false; submit.textContent = "Create account"; } }
});
requiredElement<HTMLInputElement>("#team-search").addEventListener("input", renderWorkspaceUsers);
requiredElement<HTMLElement>("#team-list").addEventListener("change", async (event) => {
  const select = event.target instanceof Element ? event.target.closest<HTMLSelectElement>("[data-user-role]") : null;
  const card = select?.closest<HTMLElement>("[data-user-id]");
  const user = workspaceUsers.find((item) => item.id === card?.dataset.userId);
  if (!select || !user) return;
  select.disabled = true;
  try {
    const response = await fetch("/api/users/update", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ id: user.id, role: select.value, status: user.status }) });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Role could not be updated");
    await loadWorkspaceUsers();
    showToast("Role updated", `${user.displayName}'s access has been updated.`);
  } catch (error) { select.value = user.role; showToast("Role update failed", error instanceof Error ? error.message : "Try again.", false); }
  finally { select.disabled = false; }
});
requiredElement<HTMLElement>("#team-list").addEventListener("click", async (event) => {
  const trigger = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-user-status], [data-user-reset]") : null;
  const card = trigger?.closest<HTMLElement>("[data-user-id]");
  const user = workspaceUsers.find((item) => item.id === card?.dataset.userId);
  if (!trigger || !user) return;
  if (trigger.hasAttribute("data-user-reset")) {
    resetPasswordUserId = user.id;
    requiredElement<HTMLElement>("#password-reset-copy").textContent = `Set a temporary password for ${user.displayName}. Every previous session will be closed.`;
    setDialogVisibility("#password-reset-dialog", "#password-reset-backdrop", true);
    return;
  }
  trigger.disabled = true;
  const status = user.status === "active" ? "suspended" : "active";
  try {
    const response = await fetch("/api/users/update", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ id: user.id, role: user.role, status }) });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Account status could not be updated");
    await loadWorkspaceUsers();
    showToast(status === "active" ? "Account reactivated" : "Account suspended", `${user.displayName}'s access is now ${status}.`);
  } catch (error) { showToast("Account update failed", error instanceof Error ? error.message : "Try again.", false); }
  finally { trigger.disabled = false; }
});
requiredElement<HTMLButtonElement>("#password-reset-cancel").addEventListener("click", closePasswordResetDialog);
requiredElement<HTMLButtonElement>("#password-reset-backdrop").addEventListener("click", closePasswordResetDialog);
requiredElement<HTMLFormElement>("#password-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const response = await fetch("/api/users/reset-password", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ id: resetPasswordUserId, password: requiredElement<HTMLInputElement>("#password-reset-value").value }) });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Password could not be reset");
    closePasswordResetDialog();
    await loadNotifications();
    showToast("Password reset", "Previous sessions were closed and the temporary password is active.");
  } catch (error) { showToast("Password reset failed", error instanceof Error ? error.message : "Try again.", false); }
});
requiredElement<HTMLFormElement>("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = requiredElement<HTMLInputElement>("#current-password").value;
  const newPassword = requiredElement<HTMLInputElement>("#new-password").value;
  if (newPassword !== requiredElement<HTMLInputElement>("#confirm-password").value) { showToast("Passwords do not match", "Confirm the new password exactly.", false); return; }
  try {
    const response = await fetch("/api/users/password", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "Password could not be updated");
    (event.currentTarget as HTMLFormElement).reset();
    await loadNotifications();
    showToast("Password updated", "Your older sessions have been closed securely.");
  } catch (error) { showToast("Password update failed", error instanceof Error ? error.message : "Try again.", false); }
});
requiredElement<HTMLButtonElement>("#download-monitor-report").addEventListener("click", downloadMonitorReport);
requiredElement<HTMLButtonElement>("#download-sales-report").addEventListener("click", () => void downloadSalesReport());
requiredElement<HTMLButtonElement>("#orders-report-open").addEventListener("click", openOrdersReportDialog);
requiredElement<HTMLButtonElement>("#orders-report-close").addEventListener("click", closeOrdersReportDialog);
requiredElement<HTMLButtonElement>("#orders-report-cancel").addEventListener("click", closeOrdersReportDialog);
requiredElement<HTMLButtonElement>("#orders-report-backdrop").addEventListener("click", closeOrdersReportDialog);
requiredElement<HTMLFormElement>("#orders-report-form").addEventListener("change", () => {
  const selected = requiredElement<HTMLInputElement>('#orders-report-form input[name="reportPeriod"]:checked').value;
  requiredElement<HTMLElement>("#orders-report-custom").hidden = selected !== "custom";
});
requiredElement<HTMLFormElement>("#orders-report-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void downloadOrdersPdf(requiredElement<HTMLButtonElement>("#orders-report-download"));
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sales-range]")) {
  button.addEventListener("click", () => {
    const range = button.dataset.salesRange;
    if (range !== "today" && range !== "week" && range !== "month") return;
    salesInsightRange = range;
    if (salesInsightComplete?.range !== range) salesInsightComplete = undefined;
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-sales-range]")) {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    }
    renderSalesPerformance();
    void loadCompleteSalesRange(range);
  });
}
customerTableBody.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-open-customer]")
    : null;
  const key = trigger?.dataset.openCustomer;
  if (key) openCustomerDrawer(key);
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-customer-filter]")) {
  button.addEventListener("click", () => {
    customerFilter = button.dataset.customerFilter || "all";
    customerPage = 1;
    for (const option of document.querySelectorAll<HTMLButtonElement>("[data-customer-filter]")) {
      option.classList.toggle("is-active", option === button);
    }
    renderCustomerDirectory();
  });
}
customerSearchInput.addEventListener("input", () => {
  customerSearch = customerSearchInput.value;
  customerPage = 1;
  renderCustomerDirectory();
});
customerSortInput.addEventListener("change", () => {
  customerSort = customerSortInput.value;
  customerPage = 1;
  renderCustomerDirectory();
});
customerPagePrevious.addEventListener("click", () => {
  customerPage = Math.max(1, customerPage - 1);
  renderCustomerDirectory();
});
customerPageNext.addEventListener("click", () => {
  customerPage += 1;
  renderCustomerDirectory();
});
requiredElement<HTMLButtonElement>("#refresh-customers").addEventListener("click", () => void loadCustomerDirectory(true));
requiredElement<HTMLButtonElement>("#close-customer-drawer").addEventListener("click", closeCustomerDrawer);
customerBackdrop.addEventListener("click", closeCustomerDrawer);
customerDetailContent.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element
    ? event.target.closest<HTMLElement>("[data-customer-order]")
    : null;
  const orderId = Number(trigger?.dataset.customerOrder);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return;
  closeCustomerDrawer();
  void openOrderDrawer(orderId);
});
requiredElement<HTMLButtonElement>("#menu-toggle").addEventListener("click", () => sidebar.classList.add("is-open"));
requiredElement<HTMLButtonElement>("#mobile-close").addEventListener("click", () => sidebar.classList.remove("is-open"));
requiredElement<HTMLButtonElement>("#search-trigger").addEventListener("click", openCommandPalette);
commandBackdrop.addEventListener("click", closeCommandPalette);
commandInput.addEventListener("input", () => {
  const search = commandInput.value.trim().toLocaleLowerCase("en");
  for (const item of commandPalette.querySelectorAll<HTMLButtonElement>(".command-results button")) {
    item.hidden = Boolean(search) && !item.textContent?.toLocaleLowerCase("en").includes(search);
  }
});

for (const tableId of ["#orders-table-body", "#orders-preview-body", "#payment-review-body"]) {
  requiredElement<HTMLElement>(tableId).addEventListener("click", (event) => {
    const trigger = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-open-order]")
      : null;
    const orderId = Number(trigger?.dataset.openOrder);
    if (Number.isSafeInteger(orderId) && orderId > 0) void openOrderDrawer(orderId);
  });
}
window.addEventListener("phaseone:open-order", (event) => {
  const orderId = Number((event as CustomEvent<{ orderId?: number }>).detail?.orderId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return;
  navigate("orders");
  void openOrderDrawer(orderId);
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-orders-workspace]")) {
  button.addEventListener("click", () => {
    const value = button.dataset.ordersWorkspace;
    if (value === "ledger" || value === "payments" || value === "reconciliation") {
      ordersWorkspace = value;
      renderOrdersWorkspace();
    }
  });
}
requiredElement<HTMLButtonElement>("#close-order-drawer").addEventListener("click", closeOrderDrawer);
orderBackdrop.addEventListener("click", closeOrderDrawer);
const orderDetailContent = requiredElement<HTMLElement>("#order-detail-content");
orderDetailContent.addEventListener("click", (event) => {
  const element = event.target instanceof Element ? event.target : null;
  const tab = element?.closest<HTMLButtonElement>("[data-order-tab]")?.dataset.orderTab;
  if (tab && ["overview", "payment", "documents", "coas", "shipping", "timeline"].includes(tab) && activeOrder) {
    activeOrderTab = tab as typeof activeOrderTab;
    renderOrderDetail(activeOrder);
    return;
  }
  const decision = element?.closest<HTMLButtonElement>("[data-payment-decision]")?.dataset.paymentDecision;
  if (decision === "approve") openOrderActionDialog("confirm");
  if (decision === "reject") openOrderActionDialog("cancel");
  const evidenceId = element?.closest<HTMLButtonElement>("[data-delete-evidence]")?.dataset.deleteEvidence;
  if (evidenceId) void deleteOrderEvidence(evidenceId);
  const removeCoa = element?.closest<HTMLButtonElement>("[data-remove-coa]");
  if (removeCoa?.dataset.removeCoa) {
    const itemId = Number(removeCoa.dataset.coaItem);
    if (Number.isSafeInteger(itemId) && itemId > 0) void updateOrderCoa({ action: "remove", itemId, assignmentId: removeCoa.dataset.removeCoa });
  }
});
orderDetailContent.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form) return;
  if (form.id === "order-evidence-form") {
    void submitOrderEvidence(form);
    return;
  }
  if (form.matches("[data-coa-assignment-form]")) {
    const data = new FormData(form);
    const itemId = Number(form.dataset.itemId);
    const coaId = String(data.get("coaId") || "");
    const quantity = Number(data.get("quantity"));
    if (Number.isSafeInteger(itemId) && itemId > 0 && coaId && Number.isSafeInteger(quantity) && quantity > 0) {
      void updateOrderCoa({ action: "assign", itemId, coaId, quantity });
    }
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-order-action]")) {
  button.addEventListener("click", () => {
    const action = button.dataset.orderAction;
    if (action === "confirm" || action === "complete" || action === "cancel") {
      openOrderActionDialog(action);
    }
  });
}
requiredElement<HTMLButtonElement>("#order-action-dismiss").addEventListener("click", closeOrderActionDialog);
orderActionBackdrop.addEventListener("click", closeOrderActionDialog);
orderActionConfirm.addEventListener("click", () => void executeOrderAction());
requiredElement<HTMLButtonElement>("#order-refund-button").addEventListener("click", openRefundDialog);
requiredElement<HTMLButtonElement>("#order-pdf-button").addEventListener("click", downloadActiveOrderPdf);
requiredElement<HTMLButtonElement>("#refund-dismiss").addEventListener("click", closeRefundDialog);
refundBackdrop.addEventListener("click", closeRefundDialog);
refundForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitRefund();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-open-product]")) {
  button.addEventListener("click", () => openProductDrawer());
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-products-workspace]")) {
  button.addEventListener("click", () => {
    const value = button.dataset.productsWorkspace;
    if (value === "catalog" || value === "inventory") {
      productsWorkspace = value;
      renderProductsWorkspace();
      if (value === "inventory") void loadInventoryOperations();
    }
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-inventory-view]")) {
  button.addEventListener("click", () => {
    const value = button.dataset.inventoryView;
    if (value !== "attention" && value !== "stock" && value !== "restocks") return;
    inventoryView = value;
    renderInventoryOperations();
  });
}
requiredElement<HTMLButtonElement>("#refresh-inventory-operations").addEventListener("click", () => void loadInventoryOperations(true));
requiredElement<HTMLInputElement>("#sku-stock-search").addEventListener("input", (event) => {
  skuStockSearch = (event.currentTarget as HTMLInputElement).value;
  renderSkuStockLedger();
});
requiredElement<HTMLElement>("#sku-stock-body").addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const lotButton = target?.closest<HTMLElement>("[data-assign-lot-product]");
  const lotProductId = Number(lotButton?.dataset.assignLotProduct);
  const lotVariationId = Number(lotButton?.dataset.assignLotVariation || 0);
  if (Number.isSafeInteger(lotProductId) && lotProductId > 0 && Number.isSafeInteger(lotVariationId) && lotVariationId >= 0) {
    openLotAssignment(lotProductId, lotVariationId);
    return;
  }
  const toggleId = Number(target?.closest<HTMLElement>("[data-toggle-sku-product]")?.dataset.toggleSkuProduct);
  if (Number.isSafeInteger(toggleId) && toggleId > 0) {
    void toggleSkuStockProduct(toggleId);
    return;
  }
  const editId = Number(target?.closest<HTMLElement>("[data-edit-stock-product]")?.dataset.editStockProduct);
  const product = commerceData?.products.find((item) => item.id === editId);
  if (product) openProductDrawer(product);
});
requiredElement<HTMLButtonElement>("#lot-assignment-close").addEventListener("click", closeLotAssignment);
lotAssignmentBackdrop.addEventListener("click", closeLotAssignment);
lotAssignmentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveLotAssignment();
});
lotAssignmentOpenCoa.addEventListener("click", () => {
  closeLotAssignment();
  navigate("coa");
  showToast("Map the exact product", "Open or upload the certificate, choose the exact product and strength, then approve it as Available.");
});
const handleInventoryAction = (event: Event) => {
  const element = event.target instanceof Element ? event.target : null;
  const waitlistId = Number(element?.closest<HTMLElement>("[data-view-waitlist]")?.getAttribute("data-view-waitlist"));
  if (Number.isSafeInteger(waitlistId) && waitlistId > 0) {
    void openWaitlistDrawer(waitlistId);
    return;
  }
  const productId = Number(element?.closest<HTMLElement>("[data-edit-product]")?.getAttribute("data-edit-product"));
  const product = commerceData?.products.find((item) => item.id === productId);
  if (product) openProductDrawer(product);
};
requiredElement<HTMLElement>("#inventory-exceptions-list").addEventListener("click", handleInventoryAction);
requiredElement<HTMLElement>("#waitlist-overview-list").addEventListener("click", handleInventoryAction);
requiredElement<HTMLButtonElement>("#waitlist-drawer-close").addEventListener("click", closeWaitlistDrawer);
requiredElement<HTMLButtonElement>("#waitlist-backdrop").addEventListener("click", closeWaitlistDrawer);
requiredElement<HTMLButtonElement>("#waitlist-notify-button").addEventListener("click", async () => {
  if (!activeWaitlistProductId) return;
  if (!waitlistNotifyConfirmation) {
    waitlistNotifyConfirmation = true;
    renderWaitlistDrawer();
    return;
  }
  const button = requiredElement<HTMLButtonElement>("#waitlist-notify-button");
  button.disabled = true;
  const sent = await notifyProductWaitlist(activeWaitlistProductId);
  if (sent) closeWaitlistDrawer();
  else {
    waitlistNotifyConfirmation = false;
    renderWaitlistDrawer();
  }
});
requiredElement<HTMLButtonElement>("#close-product-drawer").addEventListener("click", closeProductDrawer);
requiredElement<HTMLButtonElement>("#cancel-product").addEventListener("click", closeProductDrawer);
drawerBackdrop.addEventListener("click", closeProductDrawer);
for (const input of [productCostInput, productPriceInput, productPackagingInput, productFeeInput, productAffiliateRateInput]) {
  input.addEventListener("input", calculateProductProfit);
}
productImagesInput.addEventListener("change", () => {
  if (productImagesInput.files) addProductImages(productImagesInput.files);
  productImagesInput.value = "";
});
for (const eventName of ["dragenter", "dragover"]) {
  productDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    productDropzone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  productDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    productDropzone.classList.remove("is-dragging");
  });
}
productDropzone.addEventListener("drop", (event) => {
  const transfer = (event as DragEvent).dataTransfer;
  if (transfer?.files) addProductImages(transfer.files);
});
productImagePreview.addEventListener("click", (event) => {
  const localButton = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-remove-product-image]")
    : null;
  const libraryButton = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-remove-library-image]")
    : null;
  if (localButton) {
    const index = Number(localButton.dataset.removeProductImage);
    if (Number.isInteger(index)) productImageFiles.splice(index, 1);
    renderProductImages();
  } else if (libraryButton) {
    const index = Number(libraryButton.dataset.removeLibraryImage);
    if (Number.isInteger(index)) selectedProductMedia.splice(index, 1);
    renderProductImages();
  }
});
productVariantsToggle.addEventListener("change", () => {
  variantBuilder.hidden = !productVariantsToggle.checked;
  if (!productVariantsToggle.checked) {
    variantRows.innerHTML = "";
    variantTable.hidden = true;
  }
});
requiredElement<HTMLButtonElement>("#generate-variants").addEventListener("click", generateVariantRows);
productNameInput.addEventListener("input", () => scheduleAutomaticSkuSuggestion());
requiredElement<HTMLButtonElement>("#choose-product-media").addEventListener("click", () => openMediaPicker());
requiredElement<HTMLButtonElement>("#close-media-picker").addEventListener("click", closeMediaPicker);
mediaPickerBackdrop.addEventListener("click", closeMediaPicker);
mediaPickerSearch.addEventListener("input", renderMediaPicker);
mediaPickerGrid.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-pick-media]") : null;
  const mediaId = Number(button?.dataset.pickMedia);
  if (Number.isSafeInteger(mediaId) && mediaId > 0) selectMedia(mediaId);
});
variantRows.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-choose-variant-image]") : null;
  const row = button?.closest<HTMLElement>("[data-variant-row]");
  if (row) openMediaPicker(row);
});
variantRows.addEventListener("input", (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (target?.matches("[data-variant-price],[data-variant-cost]")) calculateVariantProfits();
});

productForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitButton = productForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  if (!productNameInput.value.trim()) {
    showToast("Product name required", "Add a clear customer-facing product name.", false);
    productNameInput.focus();
    if (submitButton) submitButton.disabled = false;
    return;
  }
  if (!productCategoryInput.value) {
    showToast("Category required", "Choose the catalog category for this product.", false);
    productCategoryInput.focus();
    if (submitButton) submitButton.disabled = false;
    return;
  }
  const operation = fetch("/api/commerce/product", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      productId: editingProductId,
      name: productNameInput.value.trim(),
      sku: productSkuInput.value.trim(),
      skuMode: editingProductId ? "preserve" : "auto",
      stockQuantity: Number(productStockInput.value) || 0,
      categoryId: Number(productCategoryInput.value) || 0,
      visibility: productStatusInput.value,
      regularPrice: Number(productPriceInput.value) || 0,
      unitCost: Number(productCostInput.value) || 0,
      packagingCost: Number(productPackagingInput.value) || 0,
      feeRate: Number(productFeeInput.value) || 0,
      affiliateRate: Number(productAffiliateRateInput.value) || 0,
      images: selectedProductMedia.map((item) => item.id > 0 ? { id: item.id } : { src: item.src }),
      attributeName: productVariantsToggle.checked ? variantAttributeInput.value.trim() : "",
      variants: productVariantsToggle.checked ? collectVariants() : [],
    }),
  }).then(async (response) => {
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The product could not be saved");
    await loadCommerce();
    inventoryOperations = undefined;
    skuStockDetails.clear();
    skuStockExpanded.clear();
    if (productsWorkspace === "inventory") await loadInventoryOperations(true);
    const warning = isRecord(payload) && typeof payload.warning === "string" ? payload.warning : "";
    showToast(
      editingProductId ? "Product updated" : "Product created",
      warning || (editingProductId
        ? "SKU, category, visibility, inventory, pricing and variants are now synchronized."
        : "The product is ready. Assign its shipping lot from Inventory once its COA is mapped and approved."),
      !warning,
    );
  });

  void operation.then(() => closeProductDrawer())
    .catch((error) => showToast("Unable to save", error instanceof Error ? error.message : "Check the connection and try again.", false))
    .finally(() => { if (submitButton) submitButton.disabled = false; });
});

trashProductButton.addEventListener("click", () => {
  if (!editingProductId || trashProductButton.disabled) return;
  if (trashProductButton.dataset.confirming !== "true") {
    trashProductButton.dataset.confirming = "true";
    trashProductButton.classList.add("is-confirming");
    trashProductButton.textContent = "Confirm move to Trash";
    showToast("Removal is recoverable", "Press the red button once more to move this product to the WordPress Trash.");
    return;
  }
  const productId = editingProductId;
  trashProductButton.disabled = true;
  void fetch(`/api/commerce/product?productId=${encodeURIComponent(String(productId))}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then(async (response) => {
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The product could not be removed");
    closeProductDrawer();
    await loadCommerce();
    inventoryOperations = undefined;
    showToast("Product moved to Trash", "It is no longer in the catalog and can still be restored from WordPress Trash.");
  }).catch((error) => {
    trashProductButton.dataset.confirming = "true";
    trashProductButton.classList.add("is-confirming");
    trashProductButton.textContent = "Try moving to Trash again";
    showToast("Unable to remove product", error instanceof Error ? error.message : "Try again.", false);
  }).finally(() => {
    trashProductButton.disabled = false;
  });
});

requiredElement<HTMLElement>("#products-table-body").addEventListener("click", (event) => {
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-product-id]") : null;
  if (!row) return;
  const product = commerceData?.products.find((item) => item.id === Number(row.dataset.productId));
  if (product) openProductDrawer(product);
});
requiredElement<HTMLElement>("#products-table-body").addEventListener("keydown", (event) => {
  if (!(event instanceof KeyboardEvent) || !["Enter", " "].includes(event.key)) return;
  const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-product-id]") : null;
  const product = commerceData?.products.find((item) => item.id === Number(row?.dataset.productId));
  if (product) {
    event.preventDefault();
    openProductDrawer(product);
  }
});
requiredElement<HTMLInputElement>("#products-search").addEventListener("input", (event) => {
  productSearch = (event.currentTarget as HTMLInputElement).value;
  renderProducts();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-product-filter]")) {
  button.addEventListener("click", () => {
    productFilter = button.dataset.productFilter || "all";
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-product-filter]")) item.classList.toggle("is-active", item === button);
    renderProducts();
  });
}
requiredElement<HTMLInputElement>("#media-search").addEventListener("input", (event) => {
  mediaSearch = (event.currentTarget as HTMLInputElement).value;
  renderMediaLibrary();
});
requiredElement<HTMLElement>("#media-grid").addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-media-open-product]") : null;
  const product = commerceData?.products.find((item) => item.id === Number(button?.dataset.mediaOpenProduct));
  if (product) openProductDrawer(product);
});
requiredElement<HTMLInputElement>("#orders-search").addEventListener("input", (event) => {
  orderSearch = (event.currentTarget as HTMLInputElement).value;
  renderOrders();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-order-filter]")) {
  button.addEventListener("click", () => {
    orderStatusFilter = button.dataset.orderFilter || "all";
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-order-filter]")) {
      item.classList.toggle("is-active", item === button);
    }
    renderOrders();
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-order-date]")) {
  button.addEventListener("click", () => {
    const value = button.dataset.orderDate;
    if (!value || !["today", "7", "30", "all", "custom"].includes(value)) return;
    orderDateFilter = value as typeof orderDateFilter;
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-order-date]")) {
      item.classList.toggle("is-active", item === button);
    }
    requiredElement<HTMLElement>("#order-custom-range").hidden = orderDateFilter !== "custom";
    renderOrders();
  });
}
requiredElement<HTMLSelectElement>("#orders-sort").addEventListener("change", (event) => {
  orderSort = (event.currentTarget as HTMLSelectElement).value;
  renderOrders();
});
requiredElement<HTMLInputElement>("#orders-date-from").addEventListener("change", (event) => {
  orderDateFrom = (event.currentTarget as HTMLInputElement).value;
  renderOrders();
});
requiredElement<HTMLInputElement>("#orders-date-to").addEventListener("change", (event) => {
  orderDateTo = (event.currentTarget as HTMLInputElement).value;
  renderOrders();
});
requiredElement<HTMLButtonElement>("#order-alert-toggle").addEventListener("click", () => { void toggleOrderAlerts(); });
requiredElement<HTMLButtonElement>("#new-order-dismiss").addEventListener("click", () => {
  requiredElement<HTMLElement>("#new-order-banner").hidden = true;
});
requiredElement<HTMLButtonElement>("#new-order-open").addEventListener("click", () => {
  requiredElement<HTMLElement>("#new-order-banner").hidden = true;
  navigate("orders");
  if (latestNotifiedOrderId) void openOrderDrawer(latestNotifiedOrderId);
});
requiredElement<HTMLButtonElement>("#notification-button").addEventListener("click", openNotificationCenter);
requiredElement<HTMLButtonElement>("#close-notifications").addEventListener("click", closeNotificationCenter);
requiredElement<HTMLButtonElement>("#notification-backdrop").addEventListener("click", closeNotificationCenter);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-notification-filter]")) {
  button.addEventListener("click", () => {
    notificationFilter = button.dataset.notificationFilter || "all";
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-notification-filter]")) item.classList.toggle("is-active", item === button);
    renderNotifications();
  });
}
requiredElement<HTMLButtonElement>("#mark-all-notifications").addEventListener("click", async () => {
  await fetch("/api/notifications/read", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ all: true }) });
  workspaceNotifications = workspaceNotifications.map((item) => ({ ...item, read: true }));
  catchupOrderNotifications = [];
  orderNotificationCount = 0;
  renderNotifications();
  renderOrderCatchup();
});
requiredElement<HTMLElement>("#notification-list").addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-notification-id]") : null;
  if (!button) return;
  const id = button.dataset.notificationId || "";
  const item = workspaceNotifications.find((notification) => notification.id === id);
  await markWorkspaceNotificationRead(id);
  closeNotificationCenter();
  navigate(button.dataset.notificationView || "overview");
  const orderId = item?.type === "order" ? notificationOrderId(item) : null;
  if (orderId) void openOrderDrawer(orderId);
});
requiredElement<HTMLElement>("#order-catchup-list").addEventListener("click", async (event) => {
  const card = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-catchup-notification]") : null;
  if (!card) return;
  const id = card.dataset.catchupNotification || "";
  const item = catchupOrderNotifications.find((notification) => notification.id === id);
  if (!item) return;
  const shouldOpen = event.target instanceof Element && Boolean(event.target.closest(".order-catchup-open"));
  try {
    await markWorkspaceNotificationRead(id);
  } catch (error) {
    showToast("Notification not updated", error instanceof Error ? error.message : "Try again shortly.", false);
  }
  if (shouldOpen) {
    navigate("orders");
    const orderId = notificationOrderId(item);
    if (orderId) void openOrderDrawer(orderId);
  }
});
requiredElement<HTMLButtonElement>("#order-catchup-dismiss-all").addEventListener("click", async () => {
  const ids = catchupOrderNotifications.map((item) => item.id);
  try {
    await Promise.all(ids.map((id) => markWorkspaceNotificationRead(id)));
  } catch (error) {
    showToast("Some notices remain", error instanceof Error ? error.message : "Try again shortly.", false);
  }
});
requiredElement<HTMLButtonElement>("#order-catchup-more").addEventListener("click", openNotificationCenter);
requiredElement<HTMLElement>("#monitor-order-list").addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-monitor-order]") : null;
  if (button) void openOrderDrawer(Number(button.dataset.monitorOrder));
});

function showCoaPanel(name: string): void {
  for (const panel of document.querySelectorAll<HTMLElement>("[data-coa-panel]")) {
    panel.hidden = panel.dataset.coaPanel !== name;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-coa-tab]")) {
    button.classList.toggle("is-active", button.dataset.coaTab === name);
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-coa-tab]")) {
  button.addEventListener("click", () => showCoaPanel(button.dataset.coaTab || "families"));
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-coa-tab-target]")) {
  button.addEventListener("click", () => showCoaPanel(button.dataset.coaTabTarget || "intake"));
}
requiredElement<HTMLInputElement>("#coa-search").addEventListener("input", (event) => {
  coaSearch = (event.currentTarget as HTMLInputElement).value;
  renderCoaManager();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-coa-filter]")) {
  button.addEventListener("click", () => {
    coaFilter = button.dataset.coaFilter || "all";
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-coa-filter]")) item.classList.toggle("is-active", item === button);
    renderCoaManager();
  });
}
requiredElement<HTMLInputElement>("#coa-files").addEventListener("change", (event) => {
  const count = (event.currentTarget as HTMLInputElement).files?.length || 0;
  const label = requiredElement<HTMLElement>(".coa-dropzone small");
  label.textContent = count ? `${count} PDF${count === 1 ? "" : "s"} ready to upload` : "Choose up to 40 PDF documents";
});
requiredElement<HTMLButtonElement>("#coa-stage-batch").addEventListener("click", async () => {
  const fileInput = requiredElement<HTMLInputElement>("#coa-files");
  const linkInput = requiredElement<HTMLTextAreaElement>("#coa-links");
  const button = requiredElement<HTMLButtonElement>("#coa-stage-batch");
  const files = [...(fileInput.files || [])];
  const links = [...new Set(linkInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  if (!files.length && !links.length) {
    showToast("Nothing to scan", "Add one or more PDF documents or laboratory links first.", false);
    return;
  }
  if (files.length + links.length > 40) {
    showToast("Batch is too large", "Choose up to 40 PDFs and links at a time.", false);
    return;
  }
  button.disabled = true;
  let staged = 0;
  let duplicates = 0;
  const reviewResults: Array<{ coa: CommerceCoa; duplicate: boolean }> = [];
  const errors: string[] = [];
  const suggestCurrent = requiredElement<HTMLInputElement>("#coa-current-lot").checked;
  try {
    if (links.length) {
      button.textContent = "Validating laboratory links…";
      const response = await fetch("/api/extensions/coa/intake", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ links, suggestCurrent }),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(isRecord(result) && typeof result.error === "string" ? result.error : "Laboratory links could not be staged");
      if (isRecord(result)) {
        staged += Number(result.staged || 0);
        duplicates += Number(result.duplicates || 0);
        if (Array.isArray(result.records)) {
          for (const item of result.records) {
            if (isRecord(item) && isRecord(item.coa)) reviewResults.push(item as unknown as { coa: CommerceCoa; duplicate: boolean });
          }
        }
      }
    }
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      button.textContent = `Securing PDF ${index + 1} of ${files.length}…`;
      try {
        const response = await fetch("/api/extensions/coa/intake-pdf", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/pdf",
            Accept: "application/json",
            "X-COA-File-Name": file.name.replace(/[^\x20-\x7e]/g, "_"),
            "X-COA-Current-Lot": String(suggestCurrent),
          },
          body: file,
        });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(isRecord(result) && typeof result.error === "string" ? result.error : `${file.name} could not be staged`);
        if (isRecord(result) && result.duplicate === true) duplicates += 1;
        else staged += 1;
        if (isRecord(result) && isRecord(result.coa)) reviewResults.push(result as unknown as { coa: CommerceCoa; duplicate: boolean });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${file.name} could not be staged`);
      }
    }
    const automaticallyPublished = reviewResults.filter((item) => item.coa.status === "Available").length;
    coaIntakeResults = reviewResults.filter((item) => item.coa.status !== "Available");
    await loadExtensions();
    fileInput.value = "";
    linkInput.value = "";
    requiredElement<HTMLElement>(".coa-dropzone small").textContent = "Choose up to 40 PDF documents";
    if (errors.length) {
      showToast("Batch saved with attention needed", `${staged} new · ${duplicates} already registered · ${errors.length} failed. ${errors[0]}`, false);
    } else if (automaticallyPublished) {
      showToast(
        "COA published immediately",
        `${automaticallyPublished} certificate${automaticallyPublished === 1 ? " is" : "s are"} live on the exact product. Storefront refresh takes about 5 seconds.`,
      );
    } else {
      showToast(
        duplicates && !staged ? "Certificate already registered" : "Manual review needed",
        duplicates && !staged
          ? "The existing certificate is shown below. Open it to inspect or update it."
          : `${staged} certificate${staged === 1 ? " needs" : "s need"} a product, strength or testing-date correction before publication.`,
      );
    }
  } catch (error) {
    showToast("COA intake failed", error instanceof Error ? error.message : "The review batch could not be saved.", false);
  } finally {
    button.disabled = false;
    button.textContent = "Upload COAs";
  }
});
requiredElement<HTMLElement>("#coa-review-list").addEventListener("click", (event) => {
  const deleteButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-delete-coa]") : null;
  if (deleteButton) {
    const id = deleteButton.dataset.deleteCoa || "";
    const coa = coaIntakeResults.find((item) => (item.coa.recordId || item.coa.id) === id)?.coa ||
      extensionsData?.coas.find((item) => (item.recordId || item.id) === id);
    if (!id || !coa || !window.confirm(`Discard the private draft for ${coa.productName || coa.coaNumber}? This removes the staged PDF and cannot be undone.`)) return;
    deleteButton.disabled = true;
    deleteButton.textContent = "…";
    void fetch(`/api/extensions/coa/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const payload: unknown = await response.json();
      if (!response.ok || !isRecord(payload)) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "The draft could not be discarded");
      coaIntakeResults = coaIntakeResults.filter((item) => (item.coa.recordId || item.coa.id) !== id);
      if (isRecord(payload.extensions)) extensionsData = payload.extensions as unknown as ExtensionsPayload;
      else await loadExtensions();
      renderCoaManager();
      showToast("Draft discarded", "The private COA record and its staged PDF were removed.");
    }).catch((error) => {
      deleteButton.disabled = false;
      deleteButton.textContent = "×";
      showToast("Unable to discard draft", error instanceof Error ? error.message : "Try again after reloading.", false);
    });
    return;
  }
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-review-coa]") : null;
  if (!button) return;
  const id = button.dataset.reviewCoa || "";
  const coa = coaIntakeResults.find((item) => (item.coa.recordId || item.coa.id) === id)?.coa ||
    extensionsData?.coas.find((item) => (item.recordId || item.id) === id);
  if (coa) openCoaEditor(coa);
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-coa-editor-tab]")) {
  button.addEventListener("click", () => showCoaEditorPanel(button.dataset.coaEditorTab || "basics"));
}
const openCoaFromTarget = (event: Event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-edit-coa]") : null;
  if (!button) return;
  const coa = extensionsData?.coas.find((item) => (item.recordId || item.id) === button.dataset.editCoa);
  if (coa) openCoaEditor(coa);
};
requiredElement<HTMLElement>("#coa-family-grid").addEventListener("click", openCoaFromTarget);
requiredElement<HTMLElement>("#coa-table-body").addEventListener("click", openCoaFromTarget);
requiredElement<HTMLButtonElement>("#close-coa-editor").addEventListener("click", closeCoaEditor);
requiredElement<HTMLButtonElement>("#cancel-coa-editor").addEventListener("click", closeCoaEditor);
coaEditorBackdrop.addEventListener("click", closeCoaEditor);
coaFileUrlInput.addEventListener("input", updateCoaDocumentPreview);
coaStatusInput.addEventListener("change", () => {
  if (coaStatusInput.value === "Available" && coaCurrentLotInput.dataset.suggested === "true") {
    coaCurrentLotInput.checked = true;
    coaCurrentLotInput.dataset.suggested = "false";
  }
  syncCoaDistributionControl();
});
coaCurrentLotInput.addEventListener("change", () => {
  coaCurrentLotInput.dataset.suggested = "false";
});
coaTestingCostInput.addEventListener("input", syncCoaTestingCost);
coaBatchUnitsInput.addEventListener("input", syncCoaTestingCost);
coaEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editingCoa || !extensionsData?.coaWriteEnabled) return;
  const testingTotal = Math.max(0, Number(coaTestingCostInput.value) || 0);
  const testingUnits = Math.max(0, Math.floor(Number(coaBatchUnitsInput.value) || 0));
  if ((testingTotal > 0 && testingUnits === 0) || (testingUnits > 0 && testingTotal === 0)) {
    showToast("Complete the testing allocation", "Enter both the laboratory invoice total and the number of units covered by this lot.", false);
    (testingTotal > 0 ? coaBatchUnitsInput : coaTestingCostInput).focus();
    return;
  }
  if (!coaPresentationMatch.hidden && coaStatusInput.value === "Available" && Number(coaVariationIdInput.value) <= 0) {
    showToast("Exact presentation required", "Choose the correct strength or mg before publishing this COA.", false);
    coaVariationIdInput.focus();
    return;
  }
  const submit = requiredElement<HTMLButtonElement>("#save-coa-editor");
  submit.disabled = true;
  submit.textContent = "Saving changes…";
  const payload = {
    id: editingCoa.recordId || editingCoa.id,
    expectedRevision: editingCoa.revision || 0,
    wpPostId: editingCoa.wpPostId,
    coaNumber: coaNumberInput.value.trim(),
    productName: coaProductNameInput.value.trim(),
    compound: coaCompoundInput.value.trim(),
    familyName: coaFamilyNameInput.value.trim(),
    familyKey: coaFamilyKeyInput.value.trim(),
    strength: coaStrengthInput.value.trim(),
    batch: coaBatchInput.value.trim(),
    lot: coaBatchInput.value.trim(),
    date: coaDateInput.value,
    status: coaStatusInput.value,
    purity: coaPurityInput.value.trim(),
    laboratory: coaLaboratoryInput.value.trim(),
    method: coaMethodInput.value.trim(),
    tested: coaTestedInput.value.trim(),
    testingCostTotal: testingTotal,
    batchUnitCount: testingUnits,
    currentShippingLot: coaCurrentLotInput.checked,
    fileUrl: coaFileUrlInput.value.trim(),
    verifyUrl: coaVerifyUrlInput.value.trim(),
    fileAttachmentId: editingCoa.fileAttachmentId || 0,
    matchedProductId: Number(coaProductIdInput.value) || 0,
    matchedVariationId: Number(coaVariationIdInput.value) || 0,
    skus: coaTextList(coaSkusInput.value),
    aliases: coaTextList(coaAliasesInput.value),
    keywords: coaTextList(coaKeywordsInput.value),
    panelTypes: [...document.querySelectorAll<HTMLInputElement>('input[name="coa-panel-type"]:checked')].map((item) => item.value),
  };
  void fetch("/api/extensions/coa", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(result) && typeof result.error === "string" ? result.error : "The COA could not be saved");
    if (isRecord(result) && isRecord(result.extensions)) {
      extensionsData = result.extensions as unknown as ExtensionsPayload;
      renderCoaManager();
      renderSiteControls();
    } else {
      await loadExtensions();
    }
    await loadCommerce();
    closeCoaEditor();
    showToast(
      payload.status === "Available" ? "COA approved and published" : "COA review saved",
      payload.status === "Available"
        ? "The approved certificate is now available through the Phase One storefront API."
        : "The detected information and product mapping remain private until status is changed to Available.",
    );
  }).catch((error) => {
    showToast("Unable to save COA", error instanceof Error ? error.message : "Reload the certificate and try again.", false);
  }).finally(() => {
    submit.textContent = "Save COA changes";
    submit.disabled = !extensionsData?.coaWriteEnabled;
  });
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key !== "Escape") return;
  if (!requiredElement<HTMLElement>("#picking-camera-dialog").hidden) {
    closeFulfillmentCamera();
    return;
  }
  if (!requiredElement<HTMLElement>("#packing-confirm-dialog").hidden) {
    closePackingConfirmation();
    return;
  }
  if (!requiredElement<HTMLElement>("#shipping-confirm-dialog").hidden) {
    closeShippingConfirmation();
    return;
  }
  if (!requiredElement<HTMLElement>("#notification-center").hidden) closeNotificationCenter();
  if (!requiredElement<HTMLElement>("#user-dialog").hidden) closeUserDialog();
  if (!requiredElement<HTMLElement>("#password-reset-dialog").hidden) closePasswordResetDialog();
  if (!mediaPicker.hidden) closeMediaPicker();
  if (!requiredElement<HTMLElement>("#orders-report-dialog").hidden) closeOrdersReportDialog();
  if (!lotAssignmentDrawer.hidden) closeLotAssignment();
  if (!requiredElement<HTMLElement>("#waitlist-drawer").hidden) closeWaitlistDrawer();
  if (!refundDialog.hidden) closeRefundDialog();
  if (!orderActionDialog.hidden) closeOrderActionDialog();
  if (!coaEditorDrawer.hidden) closeCoaEditor();
  else if (!customerDrawer.hidden) closeCustomerDrawer();
  else if (!orderDrawer.hidden) closeOrderDrawer();
  if (!commandPalette.hidden) closeCommandPalette();
  if (!productDrawer.hidden) closeProductDrawer();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-fulfillment-filter]")) {
  button.addEventListener("click", () => {
    const status = button.dataset.fulfillmentFilter;
    if (!status || !["waiting", "active", "paused", "blocked", "packed"].includes(status)) return;
    fulfillmentQueueFilter = status as FulfillmentQueueEntry["queueStatus"];
    selectedFulfillmentOrderId = null;
    fulfillmentScanFeedback = null;
    renderFulfillmentQueue();
  });
}

requiredElement<HTMLButtonElement>("#refresh-fulfillment").addEventListener("click", () => {
  void loadFulfillmentQueue(true);
});
function closeFulfillmentOrder(): void {
  closeFulfillmentCamera(false);
  selectedFulfillmentOrderId = null;
  fulfillmentScanFeedback = null;
  fulfillmentPackingAttempt = null;
  fulfillmentScannerBuffer = "";
  renderFulfillmentQueue();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
requiredElement<HTMLButtonElement>("#fulfillment-back").addEventListener("click", closeFulfillmentOrder);
requiredElement<HTMLButtonElement>("#fulfillment-close").addEventListener("click", closeFulfillmentOrder);

function handleFulfillmentClick(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  const open = target?.closest<HTMLElement>("[data-open-fulfillment]");
  if (open) {
    closeFulfillmentCamera(false);
    const nextOrderId = Number(open.dataset.openFulfillment);
    if (nextOrderId !== selectedFulfillmentOrderId) fulfillmentPackingAttempt = null;
    selectedFulfillmentOrderId = nextOrderId;
    fulfillmentScanFeedback = null;
    fulfillmentScannerBuffer = "";
    renderFulfillmentQueue();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const start = target?.closest<HTMLElement>("[data-start-fulfillment]");
  if (start) {
    void startFulfillment(Number(start.dataset.startFulfillment));
    return;
  }
  const pause = target?.closest<HTMLElement>("[data-pause-fulfillment]");
  if (pause?.dataset.pauseFulfillment) {
    closeFulfillmentCamera(false);
    void pauseFulfillment(pause.dataset.pauseFulfillment, Number(pause.dataset.version));
    return;
  }
  if (target?.closest("[data-open-picking-camera]")) {
    void startFulfillmentCamera();
    return;
  }
  if (target?.closest("[data-open-packing-confirm]")) {
    openPackingConfirmation();
    return;
  }
  if (target?.closest("[data-picking-sound]")) {
    fulfillmentScanSound = !fulfillmentScanSound;
    localStorage.setItem("phaseone-picking-sound", fulfillmentScanSound ? "on" : "off");
    renderFulfillmentQueue();
    return;
  }
  if (target?.closest("[data-sync-packed-coas]")) {
    void retryPackedCoaSync();
    return;
  }
  if (target?.closest("[data-refresh-evidence]")) {
    const order = selectedFulfillmentOrder();
    if (order) void loadFulfillmentEvidence(order, true);
    return;
  }
  if (target?.closest("[data-confirm-evidence]")) {
    void confirmFulfillmentEvidence();
    return;
  }
  if (target?.closest("[data-retry-evidence-email]")) {
    void retryFulfillmentEvidenceNotification();
    return;
  }
  const removeEvidence = target?.closest<HTMLElement>("[data-remove-evidence]");
  if (removeEvidence?.dataset.removeEvidence) {
    void removeFulfillmentEvidence(removeEvidence.dataset.removeEvidence);
    return;
  }
  const rate = target?.closest<HTMLElement>("[data-select-shipping-rate]");
  if (rate) {
    const order = selectedFulfillmentOrder();
    const fulfillmentId = order?.session?.id;
    const index = Number(rate.dataset.selectShippingRate);
    const state = fulfillmentId ? fulfillmentShippingStates.get(fulfillmentId) : undefined;
    if (order && state?.rates?.rates[index]) {
      state.selectedRateIndex = index;
      state.error = null;
      renderFulfillmentShipping(order);
    }
    return;
  }
  if (target?.closest("[data-generate-shipping-label]")) {
    void generateShippingLabel();
    return;
  }
  if (target?.closest("[data-review-live-label]")) {
    openShippingConfirmation("purchase");
    return;
  }
  if (target?.closest("[data-review-void-label]")) {
    openShippingConfirmation("void");
    return;
  }
  if (target?.closest("[data-sync-shipping-label]")) {
    void synchronizeShippingLabel();
    return;
  }
  if (target?.closest("[data-reconcile-shipping]")) {
    void reconcileShippingLabel();
    return;
  }
  if (target?.closest("[data-retry-shipping]")) {
    const order = selectedFulfillmentOrder();
    const fulfillmentId = order?.session?.id;
    const state = fulfillmentId ? fulfillmentShippingStates.get(fulfillmentId) : undefined;
    if (order && state?.label?.state === "failed") {
      state.label = null;
      state.printUrl = null;
      state.labelAttemptId = null;
      state.selectedRateIndex = null;
      state.error = null;
      renderFulfillmentShipping(order);
    }
    return;
  }
  const print = target?.closest<HTMLElement>("[data-print-shipping-label]");
  if (print) {
    const url = print.dataset.printShippingLabel || "";
    if (url.startsWith("/api/shipping/label/print?")) {
      window.open(url, "_blank", "noopener,noreferrer");
      const order = selectedFulfillmentOrder();
      if (order) window.setTimeout(() => { void loadFulfillmentShipping(order, true); }, 800);
    }
    return;
  }
  if (target?.closest("[data-refresh-shipping]")) {
    const order = selectedFulfillmentOrder();
    if (order) void loadFulfillmentShipping(order, true);
    return;
  }
  if (target?.closest("[data-refresh-fulfillment]")) void loadFulfillmentQueue(true);
}

requiredElement<HTMLElement>("#fulfillment-queue-view").addEventListener("click", handleFulfillmentClick);
requiredElement<HTMLElement>("#fulfillment-detail-view").addEventListener("click", handleFulfillmentClick);
requiredElement<HTMLElement>("#fulfillment-detail-view").addEventListener("change", (event) => {
  const shippingSelect = event.target instanceof HTMLSelectElement
    ? event.target.closest<HTMLSelectElement>("#shipping-rate-form select")
    : null;
  if (shippingSelect) {
    const order = selectedFulfillmentOrder();
    const fulfillmentId = order?.session?.id;
    const state = fulfillmentId ? fulfillmentShippingStates.get(fulfillmentId) : undefined;
    if (!order || !state) return;
    if (shippingSelect.name === "carrierId") {
      const policyCarrier = state.capabilities ? phaseOneShippingCarrier(state.capabilities) : null;
      state.selectedCarrierId = policyCarrier?.id || "";
      state.package.packageCode = PHASE_ONE_SHIPPING_POLICY.packageCode;
      state.package.packageName = PHASE_ONE_SHIPPING_POLICY.packageName;
    } else if (shippingSelect.name === "packageCode") {
      state.package.packageCode = PHASE_ONE_SHIPPING_POLICY.packageCode;
      state.package.packageName = PHASE_ONE_SHIPPING_POLICY.packageName;
    }
    delete state.rates;
    state.selectedRateIndex = null;
    state.error = null;
    renderFulfillmentShipping(order);
    return;
  }
  const input = event.target instanceof HTMLInputElement
    ? event.target.closest<HTMLInputElement>("[data-evidence-file]")
    : null;
  const kind = input?.dataset.evidenceFile;
  const file = input?.files?.[0];
  if (!input || !file || (kind !== "contents" && kind !== "sealed_label")) return;
  void uploadFulfillmentEvidence(kind, file);
});
requiredElement<HTMLElement>("#fulfillment-detail-view").addEventListener("submit", (event) => {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (form?.matches("#shipping-rate-form")) {
    event.preventDefault();
    void compareShippingRates();
    return;
  }
  if (!form?.matches("#picking-scan-form")) return;
  event.preventDefault();
  const input = form.querySelector<HTMLInputElement>("#picking-scan-input");
  queueFulfillmentScan(input?.value || "");
});
requiredElement<HTMLElement>("#fulfillment-detail-view").addEventListener("keydown", (event) => {
  if (!(event instanceof KeyboardEvent) || event.key !== "Tab") return;
  const input = event.target instanceof HTMLInputElement && event.target.matches("#picking-scan-input")
    ? event.target
    : null;
  if (!input?.value.trim()) return;
  event.preventDefault();
  queueFulfillmentScan(input.value);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-close-picking-camera]")) {
  button.addEventListener("click", () => closeFulfillmentCamera());
}
requiredElement<HTMLButtonElement>("#picking-camera-backdrop").addEventListener("click", () => closeFulfillmentCamera());
requiredElement<HTMLButtonElement>("#picking-camera-retry").addEventListener("click", () => {
  void startFulfillmentCamera();
});
requiredElement<HTMLButtonElement>("#packing-confirm-cancel").addEventListener("click", closePackingConfirmation);
requiredElement<HTMLButtonElement>("#packing-confirm-backdrop").addEventListener("click", closePackingConfirmation);
requiredElement<HTMLButtonElement>("#packing-confirm-submit").addEventListener("click", () => {
  void completePacking();
});
requiredElement<HTMLButtonElement>("#shipping-confirm-cancel").addEventListener("click", closeShippingConfirmation);
requiredElement<HTMLButtonElement>("#shipping-confirm-backdrop").addEventListener("click", closeShippingConfirmation);
requiredElement<HTMLButtonElement>("#shipping-confirm-submit").addEventListener("click", () => {
  const action = shippingConfirmationAction;
  closeShippingConfirmation();
  if (action === "purchase") void generateShippingLabel();
  if (action === "void") void voidShippingLabel();
});

document.addEventListener("keydown", (event) => {
  const order = selectedFulfillmentOrder();
  if (!order?.session || order.session.state !== "open" || order.verifiedUnits >= order.unitCount) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target?.matches("#picking-scan-input")) return;
  if (target?.matches("input, textarea, select, button") || target?.isContentEditable) return;
  const now = performance.now();
  if (now - fulfillmentScannerLastKeyAt > 120) fulfillmentScannerBuffer = "";
  fulfillmentScannerLastKeyAt = now;
  if (/^[0-9]$/.test(event.key)) {
    fulfillmentScannerBuffer += event.key;
    event.preventDefault();
    return;
  }
  if ((event.key === "Enter" || event.key === "Tab") && fulfillmentScannerBuffer) {
    const barcode = fulfillmentScannerBuffer;
    fulfillmentScannerBuffer = "";
    event.preventDefault();
    queueFulfillmentScan(barcode);
  }
});

const initialView = location.hash.slice(1);
loadSavedSettings();
initAffiliateAdmin();
navigate(initialView === "analytics" ? "monitor" : viewNames[initialView] ? initialView : "overview");
window.addEventListener("hashchange", () => {
  const requestedView = location.hash.slice(1);
  navigate(requestedView === "analytics" ? "monitor" : viewNames[requestedView] ? requestedView : "overview");
});
updateOrderAlertControl();
void loadWorkspaceSession().then(() => {
  void loadNotifications();
  const activeView = location.hash.slice(1);
  if (activeView === "team") void loadWorkspaceUsers();
  if (activeView === "seo") void loadSeo();
  if (activeView === "loyalty") void loadLoyalty();
});
void loadExtensions();
void loadIndependentSiteControls();
void (async () => {
  await loadCommerce();
  await Promise.all([loadLiveOrders(true), loadMonthToDateFinancials(true)]);
})();
window.setInterval(() => {
  if (!document.hidden) void loadLiveOrders();
}, 15_000);
window.setInterval(() => {
  if (!document.hidden) void loadMonthToDateFinancials(true);
}, 5 * 60_000);
window.setInterval(updatePromoCountdown, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) closeFulfillmentCamera(false);
  if (!document.hidden) {
    void loadLiveOrders();
    if (Date.now() - monthlyFinanceUpdatedAt >= 60_000) void loadMonthToDateFinancials(true);
  }
});
document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.matches("[data-cart-product-image]")) return;
  image.hidden = true;
  image.closest<HTMLElement>("[data-cart-product-visual]")?.classList.add("is-image-unavailable");
}, true);
window.addEventListener("pagehide", stopFulfillmentCamera);

connect();
void refreshSnapshotFallback(true);
