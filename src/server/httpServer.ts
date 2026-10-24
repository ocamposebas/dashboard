import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip, gzipSync } from "node:zlib";
import {
  clearSessionCookie,
  createSessionCookie,
  hashPassword,
  readSessionCookie,
  verifyPassword,
} from "./auth.js";
import {
  clearAffiliateSessionCookie,
  createAffiliateSessionCookie,
  readAffiliateSession,
} from "./affiliateAuth.js";
import { AffiliateRepository } from "./affiliateRepository.js";
import {
  AffiliateManagementError,
  affiliateCouponInput,
  affiliateStatusInput,
} from "./affiliateManagement.js";
import type { AppConfig } from "./config.js";
import type { Database } from "./database.js";
import { BarcodeLabelError, BarcodeLabelService } from "./barcodeLabels.js";
import {
  BarcodeRegistryError,
  BarcodeRegistryRepository,
} from "./barcodeRegistryRepository.js";
import { CoaScanIdentifierRepository } from "./coaScanIdentifierRepository.js";
import { resolveExternalCoaQr } from "./coaExternalQrResolver.js";
import { resolveCoaQrScan } from "./coaScanResolver.js";
import {
  CoaRepository,
  type CoaTestingCost,
  type CoaUpdateInput,
  type OrderTestingCostAllocation,
} from "./coaRepository.js";
import { buildThermalLabelDocument } from "../shared/labelPrint.js";
import {
  allocatedTestingCost,
  calculateProductProfitability,
  productCostForCatalogLine,
} from "../shared/productProfitability.js";
import { coaNeedsExactVariation } from "../shared/coaCatalogMapping.js";
import {
  canAutomaticallyPublishCoa,
  exactAutomaticCoaProduct,
  exactAutomaticCoaVariation,
} from "../shared/coaAutomaticPublishing.js";
import { productVariantSku } from "../shared/productSku.js";
import { fulfillmentAccessForRole } from "./fulfillmentAccess.js";
import {
  FulfillmentRepository,
  FulfillmentRepositoryError,
} from "./fulfillmentRepository.js";
import { decideFulfillmentScan } from "./fulfillmentPicking.js";
import { buildPackingSnapshot, FulfillmentPackingError } from "./fulfillmentPacking.js";
import { syncPackedCoaAssignments } from "./fulfillmentCoaSync.js";
import {
  FulfillmentEvidenceRepository,
  FulfillmentEvidenceRepositoryError,
} from "./fulfillmentEvidenceRepository.js";
import {
  FulfillmentEvidenceService,
  FulfillmentEvidenceServiceError,
} from "./fulfillmentEvidenceService.js";
import {
  FulfillmentEvidenceStorage,
  FulfillmentEvidenceStorageError,
} from "./fulfillmentEvidenceStorage.js";
import { FulfillmentEvidenceNotificationWorkflow } from "./fulfillmentEvidenceNotification.js";
import {
  orderNotificationPayload,
  ordersMissingFromSnapshot,
} from "./orderNotifications.js";
import {
  buildMockShippingLabelDocument,
  FulfillmentShippingError,
  packedOrderStatusBlocker,
  shippingDestination,
  shippingExternalShipmentKey,
  shippingDestinationHash,
  shippingDestinationSummary,
  shippingPackageInput,
} from "./fulfillmentShipping.js";
import {
  FulfillmentShippingRepository,
  FulfillmentShippingRepositoryError,
} from "./fulfillmentShippingRepository.js";
import {
  FulfillmentShippingWorkflow,
  FulfillmentShippingWorkflowError,
  sourceShippingBlocksPurchase,
} from "./fulfillmentShippingWorkflow.js";
import {
  buildFulfillmentQueueEntry,
  compareFulfillmentQueueEntries,
  fulfillmentSourceSnapshot,
  initialFulfillmentProgress,
  shouldIncludeFulfillmentOrder,
} from "./fulfillmentQueue.js";
import type {
  FulfillmentQueuePayload,
  FulfillmentPackingSnapshot,
  FulfillmentSession,
} from "../shared/fulfillment.js";
import {
  matchesPhaseOneShippingPolicy,
  PHASE_ONE_SHIPPING_POLICY,
  type ShippingLabel,
  type ShippingRateQuote,
} from "../shared/shipping.js";
import {
  createShippingQuoteToken,
  ShippingQuoteTokenError,
  verifyShippingQuoteToken,
} from "./shippingQuoteToken.js";
import {
  ShipStationGateway,
  ShipStationGatewayError,
} from "./shipStationGateway.js";
import type { ManagedUserRecord, ManagedUserRole, PresenceStore } from "./presenceStore.js";
import {
  ProductLocationError,
  ProductLocationRepository,
} from "./productLocationRepository.js";
import { SearchConsoleGateway } from "./searchConsoleGateway.js";
import { buildOrderReportPdf } from "./orderReportPdf.js";
import { LoginAttemptThrottle } from "./loginAttemptThrottle.js";
import {
  buildIndependentSiteControls,
  defaultIndependentSiteControls,
  publicSiteControls,
  type IndependentSiteControls,
  type IndependentSiteControlsWrite,
  type SiteControlProductSnapshot,
} from "./siteControls.js";
import {
  SiteControlRepository,
  SiteControlRepositoryError,
} from "./siteControlRepository.js";
import {
  CommerceServiceError,
  WooCommerceGateway,
  type CommerceCoa,
  type CommerceOrder,
  type CommerceProduct,
  type CommerceProductWrite,
  type CommerceRewardAdjustmentWrite,
  type CommerceRewardControl,
  type CommerceRewardSettings,
  type CommerceVariation,
} from "./wooCommerceGateway.js";

const dashboardDirectory = fileURLToPath(
  new URL("../../dashboard/", import.meta.url),
);
const MAX_LOGIN_BODY_BYTES = 8_192;
const MAX_EVIDENCE_BODY_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function serveDashboardAsset(
  request: IncomingMessage,
  response: ServerResponse,
  relativePath: string,
): Promise<boolean> {
  const filePath = resolve(dashboardDirectory, relativePath);
  const safeRoot = resolve(dashboardDirectory) + sep;
  if (!filePath.startsWith(safeRoot) || !existsSync(filePath)) return false;
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) return false;
  response.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] || "application/octet-stream");
  response.setHeader("Content-Length", String(fileStats.size));
  response.setHeader("Cache-Control", relativePath.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "private, no-cache");
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(filePath).pipe(response);
  return true;
}

function securityHeaders(
  response: ServerResponse,
  nonce?: string,
  trustedImageOrigins: Iterable<string> = [],
): void {
  const styleSource = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  const scriptSource = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  const imageSource = ["'self'", "data:", "blob:", ...new Set(trustedImageOrigins)]
    .filter((source) => Boolean(source))
    .join(" ");
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src ${scriptSource}; style-src ${styleSource}; connect-src 'self' ws: wss:; img-src ${imageSource}; media-src 'self' blob:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  response.setHeader("Cache-Control", "no-store");
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { Location: location });
  response.end();
}

function json(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  const acceptedEncoding = response.req.headers["accept-encoding"] || "";
  const shouldCompress = body.byteLength >= 1_024 && acceptedEncoding.includes("gzip");
  const payload = shouldCompress ? gzipSync(body, { level: 6 }) : body;
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Vary", "Accept-Encoding");
  response.setHeader("Content-Length", String(payload.byteLength));
  if (shouldCompress) response.setHeader("Content-Encoding", "gzip");
  response.end(payload);
}

function loginHtml(nonce: string, errorKind: "invalid" | "limited" | null): string {
  const error = errorKind === "invalid"
    ? '<p class="error" role="alert">The username or password is incorrect.</p>'
    : errorKind === "limited"
      ? '<p class="error" role="alert"><strong>Too many incorrect attempts.</strong><br>Wait a few seconds, then enter the correct credentials. A correct sign-in will unlock access immediately.</p>'
      : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="theme-color" content="#111113" />
  <title>Phase One — Secure Administration</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 32px; background: #f1f1ee; color: #171719; }
    main { width: min(100%, 980px); }
    .brand { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; color: #171719; font-size: 12px; font-weight: 800; letter-spacing: .16em; }
    .brand span { color: #77777c; font-size: 10px; font-weight: 650; letter-spacing: .08em; }
    .access-shell { display: grid; grid-template-columns: 1fr 430px; overflow: hidden; border: 1px solid #d5dad7; border-radius: 6px; background: #fff; }
    .story { position: relative; min-height: 560px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; padding: 48px; background: #151517; color: #fff; }
    .status { display: inline-flex; align-items: center; gap: 10px; color: #b8b8bd; font-size: 10px; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
    .status i { width: 7px; height: 7px; border-radius: 50%; background: #52b788; }
    .story-copy { position: relative; z-index: 1; }
    .story h1 { max-width: 430px; margin: 0; font-size: 44px; font-weight: 680; line-height: 1.03; letter-spacing: -.045em; }
    .story p { max-width: 410px; margin: 20px 0 0; color: #aaaab0; font-size: 14px; line-height: 1.7; }
    .login-panel { display: flex; flex-direction: column; justify-content: center; padding: 48px; }
    .panel-label { margin: 0 0 10px; color: #77777c; font-size: 10px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
    h2 { margin: 0 0 8px; font-size: 28px; letter-spacing: -.035em; }
    .intro { margin: 0 0 25px; color: #77777c; font-size: 13px; line-height: 1.55; }
    label { display: block; margin: 15px 0 7px; color: #45454a; font-size: 12px; font-weight: 650; }
    input { width: 100%; min-height: 46px; border: 1px solid #d6d6d2; border-radius: 4px; outline: 0; background: #fbfbfa; padding: 0 13px; color: #171719; font: inherit; }
    input:focus { border-color: #245e53; outline: 2px solid #b9d2cc; outline-offset: 1px; }
    button, .shop-link { width: 100%; min-height: 46px; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 12px; font-weight: 720; cursor: pointer; }
    button { margin-top: 21px; border: 1px solid #245e53; background: #245e53; color: #fff; }
    button:hover { background: #000; }
    .divider { display: flex; align-items: center; gap: 12px; margin: 22px 0; color: #9aa4b2; font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .divider::before, .divider::after { content: ""; height: 1px; flex: 1; background: #e7eaf0; }
    .shop-link { border: 1px solid #dce1e8; color: #596579; text-decoration: none; background: #fff; }
    .shop-link:hover { border-color: #bfc7d3; background: #f8f9fb; }
    .error { margin: 0 0 11px; border: 1px solid #f0cdd2; border-radius: 4px; background: #fff4f5; padding: 11px; color: #a74450; font-size: 11px; }
    .secure { margin: 18px 0 0; color: #929daa; font-size: 9px; text-align: center; }
    @media (prefers-color-scheme: dark) { body { background: #0a0a0b; color: #f1f1ef; } .brand { color: #f1f1ef; } .access-shell { border-color: #29292d; background: #121214; } .login-panel { background: #121214; } h2 { color: #f5f5f3; } .intro { color: #8b8b91; } label { color: #c4c4c7; } input { border-color: #343438; background: #0f0f11; color: #f3f3f1; } .shop-link { border-color: #343438; background: #171719; color: #c6c6c9; } .shop-link:hover { border-color: #505056; background: #1d1d20; } .divider::before, .divider::after { background: #29292d; } }
    @media (max-width: 760px) { body { padding: 16px; } .brand span { display: none; } .access-shell { grid-template-columns: 1fr; } .story { min-height: 215px; padding: 28px; } .story h1 { font-size: 31px; } .story p { margin-top: 12px; } .login-panel { padding: 30px 27px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand">PHASE ONE LABZ <span>OPERATIONS SUITE</span></div>
    <div class="access-shell">
      <section class="story">
        <div class="status"><i></i> Operations platform online</div>
        <div class="story-copy"><h1>Every operation, one clear view.</h1><p>Orders, products, profitability and real-time activity in one secure business workspace.</p></div>
      </section>
      <section class="login-panel">
        <p class="panel-label">Secure administration</p>
        <h2>Welcome back</h2>
        <p class="intro">Enter your credentials to open the Phase One operations workspace.</p>
        <form method="post" action="/login">
          ${error}
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" required autofocus />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button type="submit">Open command center →</button>
        </form>
        <div class="divider">or visit</div>
        <a class="shop-link" href="https://phaseonelabz.com/">Phase One Labz storefront ↗</a>
        <p class="secure">Private session · encrypted transport</p>
      </section>
    </div>
  </main>
</body>
</html>`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_LOGIN_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBodyBuffer(request: IncomingMessage, limit = MAX_EVIDENCE_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requestIp(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const realIp = Array.isArray(request.headers["x-real-ip"])
      ? request.headers["x-real-ip"][0]
      : request.headers["x-real-ip"];
    if (realIp?.trim() && realIp.trim().length <= 64) return realIp.trim();
    const forwardedFor = Array.isArray(request.headers["x-forwarded-for"])
      ? request.headers["x-forwarded-for"][0]
      : request.headers["x-forwarded-for"];
    const firstForwarded = forwardedFor?.split(",")[0]?.trim() || "";
    if (firstForwarded && firstForwarded.length <= 64) return firstForwarded;
  }
  return request.socket.remoteAddress || "unknown";
}

function firstHeaderValue(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] || "" : value || "";
  return raw.split(",")[0]?.trim() || "";
}

function affiliateServiceRequestAllowed(request: IncomingMessage, config: AppConfig): boolean {
  const expected = config.affiliateServiceSecret;
  const supplied = firstHeaderValue(request.headers["x-phaseone-affiliate-service"]);
  if (!expected || !supplied) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return expectedDigest.equals(suppliedDigest);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestOrigin(request: IncomingMessage, config: AppConfig): string | null {
  const host = config.trustProxy
    ? firstHeaderValue(request.headers["x-forwarded-host"]) || request.headers.host || ""
    : request.headers.host || "";
  const protocol = config.trustProxy
    ? firstHeaderValue(request.headers["x-forwarded-proto"]) ||
      (config.cookieSecure ? "https" : "http")
    : config.cookieSecure
      ? "https"
      : "http";

  return host ? normalizeOrigin(`${protocol}://${host}`) : null;
}

export function isLoginOriginAllowed(
  request: IncomingMessage,
  config: AppConfig,
): boolean {
  const fetchSite = firstHeaderValue(request.headers["sec-fetch-site"]);
  if (fetchSite === "cross-site") return false;

  const suppliedOrigin = firstHeaderValue(request.headers.origin);
  if (!suppliedOrigin) return fetchSite === "same-origin" || fetchSite === "none";

  const normalizedSuppliedOrigin = normalizeOrigin(suppliedOrigin);
  return (
    normalizedSuppliedOrigin === config.dashboardOrigin ||
    normalizedSuppliedOrigin === requestOrigin(request, config)
  );
}

export interface MonitorServerDependencies {
  fulfillmentDatabase?: Database;
  barcodeLabels?: BarcodeLabelService;
  shipStationGateway?: ShipStationGateway;
  siteControlRepository?: SiteControlRepository;
}

export function createMonitorServer(
  config: AppConfig,
  store: PresenceStore,
  dependencies: MonitorServerDependencies = {},
) {
  const loginAttempts = new LoginAttemptThrottle();
  const commerceConfig = config.wooCommerce;
  const commerce = commerceConfig
    ? new WooCommerceGateway(commerceConfig)
    : undefined;
  const commerceImageOrigin = commerceConfig
    ? new URL(commerceConfig.baseUrl).origin
    : undefined;
  const trustedImageOrigins = [
    ...config.trackerOrigins,
    ...(commerceImageOrigin ? [commerceImageOrigin] : []),
  ];
  const searchConsole = config.googleSearchConsole
    ? new SearchConsoleGateway(config.googleSearchConsole, store, config.sessionSecret)
    : undefined;
  const productLocations = dependencies.fulfillmentDatabase
    ? new ProductLocationRepository(dependencies.fulfillmentDatabase)
    : undefined;
  const barcodeRegistry = dependencies.fulfillmentDatabase
    ? new BarcodeRegistryRepository(dependencies.fulfillmentDatabase)
    : undefined;
  const coaScanIdentifiers = dependencies.fulfillmentDatabase
    ? new CoaScanIdentifierRepository(dependencies.fulfillmentDatabase)
    : undefined;
  const customCoas = dependencies.fulfillmentDatabase
    ? new CoaRepository(dependencies.fulfillmentDatabase, config.coaPublicOrigin)
    : undefined;
  const fulfillmentRepository = dependencies.fulfillmentDatabase
    ? new FulfillmentRepository(dependencies.fulfillmentDatabase)
    : undefined;
  const fulfillmentShipping = dependencies.fulfillmentDatabase
    ? new FulfillmentShippingRepository(dependencies.fulfillmentDatabase)
    : undefined;
  const fulfillmentEvidence = dependencies.fulfillmentDatabase && config.evidenceStorage
    ? new FulfillmentEvidenceService(
        new FulfillmentEvidenceRepository(dependencies.fulfillmentDatabase),
        new FulfillmentEvidenceStorage(
          config.evidenceStorage.path,
          config.evidenceStorage.encryptionSecret,
        ),
      )
    : undefined;
  const fulfillmentEvidenceNotifications = fulfillmentEvidence && commerce && config.evidenceStorage?.notificationMode === "outbox"
    ? new FulfillmentEvidenceNotificationWorkflow(fulfillmentEvidence, commerce)
    : undefined;
  const affiliates = dependencies.fulfillmentDatabase
    ? new AffiliateRepository(dependencies.fulfillmentDatabase)
    : undefined;
  const affiliateLoginAttempts = new LoginAttemptThrottle();
  let affiliateLegacySyncAt = 0;
  const shipStation = dependencies.shipStationGateway || new ShipStationGateway(config.shipStation);
  const fulfillmentShippingWorkflow = fulfillmentShipping
    ? FulfillmentShippingWorkflow.withShipStation(
        fulfillmentShipping,
        shipStation,
        config.shipStation.labelPurchaseEnabled,
      )
    : undefined;
  const barcodeLabels = dependencies.barcodeLabels;
  const siteControlRepository = dependencies.siteControlRepository || (
    dependencies.fulfillmentDatabase
      ? new SiteControlRepository(dependencies.fulfillmentDatabase)
      : undefined
  );

  const publicUser = (user: ManagedUserRecord) => ({
    id: user.id, username: user.username, displayName: user.displayName, email: user.email,
    role: user.role, status: user.status, createdAt: user.createdAt,
    updatedAt: user.updatedAt, lastLoginAt: user.lastLoginAt,
  });

  async function orderWithProfitability(order: CommerceOrder) {
    const catalogIds = order.lineItems.flatMap((item) => [item.productId, item.variationId]).filter((id) => id > 0);
    const [costs, currentTestingCosts, recordedTestingCosts] = await Promise.all([
      store.getProductCosts(catalogIds),
      customCoas?.currentTestingCosts(catalogIds) ?? Promise.resolve<Record<string, CoaTestingCost>>({}),
      customCoas?.orderTestingCostAllocations(order.id) ?? Promise.resolve<Record<string, OrderTestingCostAllocation>>({}),
    ]);
    let costOfGoods = 0;
    let operatingCost = 0;
    let feeCost = 0;
    let affiliateCost = 0;
    let testingCost = 0;
    let coveredItems = 0;
    let totalItems = 0;
    for (const item of order.lineItems) {
      totalItems += item.quantity;
      const cost = productCostForCatalogLine(costs, item.productId, item.variationId);
      if (!cost) continue;
      coveredItems += item.quantity;
      costOfGoods += cost.unitCost * item.quantity;
      operatingCost += cost.packagingCost * item.quantity;
      feeCost += item.total * (cost.feeRate / 100);
      affiliateCost += item.total * (cost.affiliateRate / 100);
      const recorded = recordedTestingCosts[String(item.id)];
      const current = item.variationId > 0 && currentTestingCosts[String(item.variationId)]
        ? currentTestingCosts[String(item.variationId)]
        : currentTestingCosts[String(item.productId)];
      testingCost += allocatedTestingCost(item.quantity, recorded, current?.perUnit || 0);
    }
    const completeCostCoverage = totalItems > 0 && coveredItems >= totalItems;
    return {
      ...order,
      profitability: {
        costOfGoods,
        operatingCost,
        feeCost,
        affiliateCost,
        testingCost,
        completeCostCoverage,
        estimatedProfit: completeCostCoverage
          ? order.total - costOfGoods - operatingCost - feeCost - affiliateCost - testingCost
          : null,
      },
    };
  }

  async function affiliateCommissionsForOrders(
    orders: Array<{ id: number }>,
  ) {
    if (!affiliates) return [];
    try {
      return await affiliates.commissionsForOrders(orders.map((order) => order.id));
    } catch (error: unknown) {
      console.error("Affiliate commission summary fetch failed", error);
      return [];
    }
  }

  let commerceCache: { payload: Record<string, unknown>; updatedAt: number } | undefined;
  let commerceRefresh: Promise<Record<string, unknown>> | undefined;
  let commerceCacheRestored = false;
  let commerceCacheRestore: Promise<void> | undefined;
  let ordersUpdatedAt = 0;
  let ordersRefresh: Promise<Record<string, unknown>> | undefined;
  let customersCache: { payload: Record<string, unknown>; updatedAt: number } | undefined;
  let customersRefresh: Promise<Record<string, unknown>> | undefined;
  let customersCacheRestored = false;
  let customersCacheRestore: Promise<void> | undefined;
  let extensionsCache: { payload: Record<string, unknown>; updatedAt: number } | undefined;
  let extensionsRefresh: Promise<Record<string, unknown>> | undefined;
  let fulfillmentCoasCache: { coas: CommerceCoa[]; updatedAt: number } | undefined;
  let fulfillmentCoasRefresh: Promise<CommerceCoa[]> | undefined;

  async function automaticallyPublishExactCoas(
    candidates: Awaited<ReturnType<CoaRepository["list"]>>,
    actorId: string,
  ): Promise<Map<string, Awaited<ReturnType<CoaRepository["update"]>>>> {
    const published = new Map<string, Awaited<ReturnType<CoaRepository["update"]>>>();
    if (!customCoas || !commerce) return published;
    const eligible = candidates.filter(canAutomaticallyPublishCoa);
    if (!eligible.length) return published;

    const products = await commerce.listProducts();
    const variationsByProduct = new Map<number, CommerceVariation[]>();
    for (const coa of eligible) {
      const product = exactAutomaticCoaProduct(coa, products);
      if (!product) {
        console.info("Exact COA product match unavailable", {
          certificateId: coa.recordId || coa.id,
          coaNumber: coa.coaNumber,
          productName: coa.productName,
          familyName: coa.familyName,
          strength: coa.strength,
        });
        continue;
      }
      let variation = null;
      if (product.type === "variable") {
        let variations = variationsByProduct.get(product.id);
        if (!variations) {
          variations = await commerce.listProductVariations(product.id);
          variationsByProduct.set(product.id, variations);
        }
        variation = exactAutomaticCoaVariation(coa, product, variations);
        if (!variation) {
          console.info("Exact COA variation match unavailable", {
            certificateId: coa.recordId || coa.id,
            coaNumber: coa.coaNumber,
            productId: product.id,
            strength: coa.strength,
          });
          continue;
        }
      }
      const skus = [...new Set([...(coa.skus || []), product.sku, variation?.sku || ""].map((sku) => sku.trim()).filter(Boolean))];
      try {
        const updated = await customCoas.update({
          id: coa.recordId || coa.id,
          expectedRevision: coa.revision,
          coaNumber: coa.coaNumber,
          productName: coa.productName,
          compound: coa.compound,
          familyName: coa.familyName,
          familyKey: coa.familyKey,
          strength: coa.strength,
          batch: coa.batch,
          lot: coa.lot || coa.batch,
          date: coa.date,
          status: "Available",
          purity: coa.purity,
          laboratory: coa.laboratory,
          method: coa.method,
          tested: coa.tested,
          currentShippingLot: true,
          fileUrl: coa.externalFileUrl || "",
          verifyUrl: coa.verifyUrl,
          fileAttachmentId: coa.fileAttachmentId,
          matchedProductId: product.id,
          matchedVariationId: variation?.id || 0,
          skus,
          aliases: coa.aliases,
          keywords: coa.keywords,
          panelTypes: coa.panelTypes,
        }, actorId);
        published.set(coa.recordId || coa.id, updated);
      } catch (error: unknown) {
        console.error("Exact COA automatic publication failed", {
          certificateId: coa.recordId || coa.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return published;
  }
  let customCoaBootstrap: Promise<void> | undefined;
  let rewardsCache: { payload: CommerceRewardControl; updatedAt: number } | undefined;
  const productDetailCache = new Map<number, { payload: Record<string, unknown>; updatedAt: number }>();
  const orderDetailCache = new Map<number, { payload: Record<string, unknown>; updatedAt: number }>();
  const salesReportCache = new Map<string, { orders: CommerceOrder[]; updatedAt: number }>();
  let reconciledProductCampaign: { revision: number; controls: IndependentSiteControls } | undefined;
  let productCampaignReconciliation: Promise<IndependentSiteControls> | undefined;
  let productCampaignRetryAt = 0;

  async function independentSiteControls(): Promise<IndependentSiteControls> {
    const durable = await siteControlRepository?.get().catch((error: unknown) => {
      console.error("PostgreSQL Site Controls read failed; using the independent cache", error);
      return null;
    });
    if (durable) return durable;
    const stored = await store.getIndependentSiteControls();
    return stored
      ? stored as IndependentSiteControls
      : defaultIndependentSiteControls();
  }

  async function reconcilePublishedProductCampaign(controls: IndependentSiteControls): Promise<IndependentSiteControls> {
    const campaignProduct = controls.promo.type === "product" ? controls.promo.product : null;
    if (!commerce || !campaignProduct) return controls;
    if (reconciledProductCampaign?.revision === controls.revision) return reconciledProductCampaign.controls;
    if (productCampaignReconciliation) return productCampaignReconciliation;
    if (Date.now() < productCampaignRetryAt) return controls;

    productCampaignReconciliation = (async () => {
      const authoritative = await commerce.getProduct(campaignProduct.id);
      const slug = String(authoritative.slug || campaignProduct.slug || "").trim();
      const url = slug ? `/product/${encodeURIComponent(slug)}/` : "/research-peptides/";
      const endsAt = controls.promo.endsAt ? Date.parse(controls.promo.endsAt) : 0;
      const active = Boolean(
        controls.promo.enabled &&
        campaignProduct.salePriceActive &&
        campaignProduct.promoPrice > 0 &&
        endsAt > Date.now()
      );
      const endMatches = Boolean(
        authoritative.saleEndsAt &&
        Math.abs(Date.parse(authoritative.saleEndsAt) - endsAt) < 2_000
      );
      const priceMatches = Math.abs((authoritative.salePrice || 0) - campaignProduct.promoPrice) < 0.005;

      if (active && (!priceMatches || !endMatches)) {
        await commerce.setProductSale(authoritative.id, {
          salePrice: campaignProduct.promoPrice,
          startsAt: new Date().toISOString(),
          endsAt: controls.promo.endsAt,
        });
        await invalidateCommerceCache();
      }

      const reconciled: IndependentSiteControls = {
        ...controls,
        promo: {
          ...controls.promo,
          ctaUrl: url,
          product: {
            ...campaignProduct,
            slug,
            url,
            salePriceActive: active,
          },
        },
      };
      reconciledProductCampaign = { revision: controls.revision, controls: reconciled };
      return reconciled;
    })().catch((error: unknown) => {
      productCampaignRetryAt = Date.now() + 30_000;
      console.error("Published product campaign reconciliation failed", error);
      return controls;
    }).finally(() => {
      productCampaignReconciliation = undefined;
    });

    return productCampaignReconciliation;
  }

  async function ensureCustomCoaHistory(): Promise<void> {
    if (!customCoas || await customCoas.count() > 0 || !commerce) return;
    if (customCoaBootstrap) return customCoaBootstrap;
    customCoaBootstrap = (async () => {
      const legacy = await commerce.listCoas();
      const result = await customCoas.importLegacy(legacy, "wordpress-bootstrap");
      console.log(`Custom COA library preserved ${result.imported} WordPress records (${result.total} total)`);
    })().finally(() => { customCoaBootstrap = undefined; });
    return customCoaBootstrap;
  }

  async function fulfillmentCoas(): Promise<CommerceCoa[]> {
    if (!customCoas && !commerce) throw new Error("The live COA service is not connected");
    if (fulfillmentCoasCache && Date.now() - fulfillmentCoasCache.updatedAt < 10_000) {
      return fulfillmentCoasCache.coas;
    }
    if (fulfillmentCoasRefresh) return fulfillmentCoasRefresh;
    fulfillmentCoasRefresh = (customCoas
      ? ensureCustomCoaHistory().then(() => customCoas.list({ limit: 500 }))
      : commerce!.listCoas())
      .then((coas) => {
        fulfillmentCoasCache = { coas, updatedAt: Date.now() };
        return coas;
      })
      .finally(() => { fulfillmentCoasRefresh = undefined; });
    return fulfillmentCoasRefresh;
  }

  async function synchronizePackedCoas(
    session: FulfillmentSession,
    snapshot: FulfillmentPackingSnapshot,
    actorId: string,
  ): Promise<{
    session: FulfillmentSession;
    coaSync: { state: "synced" | "pending" | "failed"; message: string; assignedUnits: number };
  }> {
    const requiresCoaSync = snapshot.lines.some((line) =>
      Boolean(line.allocations?.length || (line.coaId && line.lot)));
    if (!requiresCoaSync && fulfillmentRepository) {
      const updated = session.wordpressSyncState === "synced"
        ? session
        : await fulfillmentRepository.recordWordPressSync({
            fulfillmentId: session.id,
            actorId,
            state: "synced",
            details: {
              orderId: snapshot.orderId,
              clientEventId: snapshot.clientEventId,
              assignedUnits: 0,
              reason: "no_coa_required",
            },
          });
      return {
        session: updated,
        coaSync: {
          state: "synced",
          message: "Product barcode verification is saved. No customer COA assignment is required.",
          assignedUnits: 0,
        },
      };
    }
    if (!commerce || !fulfillmentRepository || commerceConfig?.accessMode !== "read_write") {
      return {
        session,
        coaSync: {
          state: "pending",
          message: "Packing is saved. Connect WordPress with write access to assign the scanned lots to the customer order.",
          assignedUnits: 0,
        },
      };
    }
    if (session.wordpressSyncState === "synced") {
      return {
        session,
        coaSync: {
          state: "synced",
          message: "The scanned lots are already assigned to this customer order.",
          assignedUnits: 0,
        },
      };
    }
    try {
      const synchronized = await syncPackedCoaAssignments({ snapshot, gateway: commerce });
      const updated = await fulfillmentRepository.recordWordPressSync({
        fulfillmentId: session.id,
        actorId,
        state: "synced",
        details: {
          orderId: snapshot.orderId,
          clientEventId: snapshot.clientEventId,
          assignedUnits: synchronized.assignedUnits,
        },
      });
      return {
        session: updated,
        coaSync: {
          state: "synced",
          message: "The QR-scanned lots are assigned to the customer order.",
          assignedUnits: synchronized.assignedUnits,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "WordPress did not confirm the COA assignment";
      let updated = session;
      try {
        updated = await fulfillmentRepository.recordWordPressSync({
          fulfillmentId: session.id,
          actorId,
          state: "failed",
          error: message,
          details: { orderId: snapshot.orderId, clientEventId: snapshot.clientEventId },
        });
      } catch (stateError) {
        console.error("Fulfillment COA sync state could not be saved", stateError);
      }
      return {
        session: updated,
        coaSync: {
          state: "failed",
          message: `Packing is safe, but the customer COA assignment needs attention: ${message}`,
          assignedUnits: 0,
        },
      };
    }
  }

  async function restoreCommerceCache(): Promise<void> {
    if (commerceCacheRestored) return;
    if (commerceCacheRestore) return commerceCacheRestore;
    commerceCacheRestore = (async () => {
      try {
        const persisted = await store.getCommerceCache();
        if (persisted && !commerceCache) {
          commerceCache = persisted;
          ordersUpdatedAt = persisted.updatedAt;
        }
      } catch (error: unknown) {
        console.error("Commerce cache restore failed", error);
      } finally {
        commerceCacheRestored = true;
        commerceCacheRestore = undefined;
      }
    })();
    return commerceCacheRestore;
  }

  async function restoreCustomersCache(): Promise<void> {
    if (customersCacheRestored) return;
    if (customersCacheRestore) return customersCacheRestore;
    customersCacheRestore = (async () => {
      try {
        const persisted = await store.getCustomerCache();
        if (persisted && !customersCache) customersCache = persisted;
      } catch (error: unknown) {
        console.error("Customer cache restore failed", error);
      } finally {
        customersCacheRestored = true;
        customersCacheRestore = undefined;
      }
    })();
    return customersCacheRestore;
  }

  async function refreshCommerce(): Promise<Record<string, unknown>> {
    if (!commerce || !commerceConfig) {
      return {
        connected: false,
        mode: "not_configured",
        message: "Connect the live catalog service to load orders and products.",
        products: [],
        orders: [],
        media: [],
      };
    }
    if (commerceRefresh) return commerceRefresh;
    commerceRefresh = (async () => {
      const previousOrders = commerceCache?.payload.orders;
      const [products, orders, categories] = await Promise.all([
        commerce.listProducts(),
        commerce.listOrders(),
        commerce.listProductCategories(),
      ]);
      const productIds = [
        ...products.map((product) => product.id),
        ...orders.flatMap((order) => order.lineItems.flatMap((item) => [item.productId, item.variationId]).filter((id) => id > 0)),
      ];
      const [costs, testingCosts] = await Promise.all([
        store.getProductCosts(productIds),
        customCoas?.currentTestingCosts(productIds) ?? Promise.resolve<Record<string, CoaTestingCost>>({}),
      ]);
      const productsWithProfit = products.map((product) => {
        const cost = costs[String(product.id)] || null;
        const testing = testingCosts[String(product.id)] || null;
        const profitability = cost ? calculateProductProfitability(product.price, {
          ...cost,
          testingCost: testing?.perUnit || 0,
        }) : null;
        const estimatedProfit = profitability?.estimatedProfit ?? null;
        return {
          ...product,
          cost,
          testingCostPerUnit: testing?.perUnit || 0,
          testingCostTotal: testing?.total || 0,
          testingBatchUnitCount: testing?.batchUnits || 0,
          testingLot: testing?.lot || "",
          estimatedProfit,
          margin: profitability?.margin ?? null,
        };
      });
      const ordersWithProfit = await Promise.all(orders.map(orderWithProfitability));
      const affiliateCommissions = await affiliateCommissionsForOrders(ordersWithProfit);
      await recordNewOrderNotifications(ordersWithProfit, previousOrders);
      const mediaMap = new Map<string, {
        id: number;
        name: string;
        alt: string;
        src: string;
        thumbnailUrl: string;
        productIds: number[];
        productNames: string[];
      }>();
      for (const product of products) {
        for (const image of product.images) {
          const key = image.id > 0 ? `id:${image.id}` : image.src;
          const existing = mediaMap.get(key);
          if (existing) {
            if (!existing.productIds.includes(product.id)) existing.productIds.push(product.id);
            if (!existing.productNames.includes(product.name)) existing.productNames.push(product.name);
          } else {
            mediaMap.set(key, { ...image, productIds: [product.id], productNames: [product.name] });
          }
        }
      }
      const payload: Record<string, unknown> = {
        connected: true,
        mode: commerceConfig.accessMode,
        store: new URL(commerceConfig.baseUrl).hostname,
        syncIntervalSeconds: Math.round(commerceConfig.syncIntervalMs / 1_000),
        products: productsWithProfit,
        categories,
        orders: ordersWithProfit,
        affiliateCommissions,
        media: [...mediaMap.values()],
        cachedAt: new Date().toISOString(),
      };
      const updatedAt = Date.now();
      commerceCache = { payload, updatedAt };
      ordersUpdatedAt = updatedAt;
      try {
        await store.setCommerceCache(payload, updatedAt);
      } catch (error: unknown) {
        console.error("Commerce cache persistence failed", error);
      }
      return payload;
    })().finally(() => { commerceRefresh = undefined; });
    return commerceRefresh;
  }

  async function invalidateCommerceCache(): Promise<void> {
    commerceCache = undefined;
    try {
      await store.clearCommerceCache();
    } catch (error: unknown) {
      console.error("Commerce cache invalidation failed", error);
    }
  }

  function updateCachedOrder(order: CommerceOrder): void {
    orderDetailCache.delete(order.id);
    if (!commerceCache) return;
    const existingOrders = commerceCache.payload.orders;
    if (!Array.isArray(existingOrders)) return;
    const nextOrders = existingOrders.map((item) => {
      if (!item || typeof item !== "object") return item;
      return Number((item as Record<string, unknown>).id) === order.id ? order : item;
    });
    ordersUpdatedAt = Date.now();
    commerceCache = {
      payload: { ...commerceCache.payload, orders: nextOrders, cachedAt: new Date().toISOString() },
      updatedAt: commerceCache.updatedAt,
    };
    void store.setCommerceCache(commerceCache.payload, commerceCache.updatedAt).catch((error: unknown) => {
      console.error("Updated order cache persistence failed", error);
    });
  }

  function markCustomersStale(): void {
    if (customersCache) customersCache.updatedAt = Math.min(customersCache.updatedAt, Date.now() - 5 * 60_000);
    refreshCustomersInBackground();
  }

  async function recordNewOrderNotifications(
    orders: CommerceOrder[],
    previousOrders: unknown,
  ): Promise<void> {
    const newlyReceived = ordersMissingFromSnapshot(orders, previousOrders);
    await Promise.all(newlyReceived.map((order) => {
      const payload = orderNotificationPayload(order);
      return store.addNotificationOnce(payload.dedupeKey, payload.notification);
    }));
  }

  async function refreshOrders(): Promise<Record<string, unknown>> {
    if (!commerce || !commerceConfig) {
      return { connected: false, orders: [], message: "The live order service is not connected." };
    }
    if (ordersRefresh) return ordersRefresh;
    ordersRefresh = (async () => {
      const cachedOrders = commerceCache?.payload.orders;
      const orders = await commerce.listOrders(Array.isArray(cachedOrders) ? 20 : 100);
      const freshOrdersWithProfit = await Promise.all(orders.map(orderWithProfitability));
      await recordNewOrderNotifications(freshOrdersWithProfit, cachedOrders);
      const freshIds = new Set(freshOrdersWithProfit.map((order) => order.id));
      const ordersWithProfit = [
        ...freshOrdersWithProfit,
        ...(Array.isArray(cachedOrders)
          ? cachedOrders.filter((item) => item && typeof item === "object" && !freshIds.has(Number((item as Record<string, unknown>).id)))
          : []),
      ].sort((left, right) => {
        const leftDate = left && typeof left === "object" ? Date.parse(String((left as Record<string, unknown>).createdAt || "")) || 0 : 0;
        const rightDate = right && typeof right === "object" ? Date.parse(String((right as Record<string, unknown>).createdAt || "")) || 0 : 0;
        return rightDate - leftDate;
      }).slice(0, 100);
      const affiliateCommissions = await affiliateCommissionsForOrders(ordersWithProfit as Array<{ id: number }>);
      ordersUpdatedAt = Date.now();
      if (commerceCache) {
        commerceCache = {
          payload: { ...commerceCache.payload, orders: ordersWithProfit, affiliateCommissions, cachedAt: new Date().toISOString() },
          updatedAt: commerceCache.updatedAt,
        };
        try {
          await store.setCommerceCache(commerceCache.payload, commerceCache.updatedAt);
        } catch (error: unknown) {
          console.error("Live order cache persistence failed", error);
        }
      }
      return {
        connected: true,
        orders: ordersWithProfit,
        affiliateCommissions,
        updatedAt: new Date(ordersUpdatedAt).toISOString(),
      };
    })().finally(() => { ordersRefresh = undefined; });
    return ordersRefresh;
  }

  async function refreshCustomers(): Promise<Record<string, unknown>> {
    if (!commerce || !commerceConfig) {
      return {
        connected: false,
        rewardsLive: false,
        customers: [],
        message: "The live customer service is not connected.",
      };
    }
    if (customersRefresh) return customersRefresh;
    customersRefresh = commerce.getCustomerDirectory()
      .then((directory) => directory as unknown as Record<string, unknown>)
      .then(async (payload) => {
        const updatedAt = Date.now();
        customersCache = { payload, updatedAt };
        try {
          await store.setCustomerCache(payload, updatedAt);
        } catch (error: unknown) {
          console.error("Customer cache persistence failed", error);
        }
        return payload;
      })
      .finally(() => { customersRefresh = undefined; });
    return customersRefresh;
  }

  function refreshCustomersInBackground(): void {
    void refreshCustomers().catch((error: unknown) => {
      console.error("Customer background refresh failed", error);
    });
  }

  async function refreshExtensions(): Promise<Record<string, unknown>> {
    if (extensionsRefresh) return extensionsRefresh;
    extensionsRefresh = (async () => {
      const siteControls = await independentSiteControls();
      const [coasResult, bridgeResult] = await Promise.allSettled([
        customCoas
          ? ensureCustomCoaHistory().then(async () => {
              let coas = await customCoas.list({ limit: 500 });
              const automaticallyPublished = await automaticallyPublishExactCoas(coas, "system:exact-coa-publisher");
              if (automaticallyPublished.size) {
                fulfillmentCoasCache = undefined;
                coas = await customCoas.list({ limit: 500 });
              }
              return coas;
            })
          : commerce
            ? commerce.listCoas()
            : Promise.reject(new Error("COA storage is not configured")),
        commerce
          ? commerce.getOperationsBridgeStatus()
          : Promise.reject(new Error("Commerce is not configured")),
      ]);
      const bridge = bridgeResult.status === "fulfilled" ? bridgeResult.value : null;
      const payload: Record<string, unknown> = {
        connected: coasResult.status === "fulfilled",
        coas: coasResult.status === "fulfilled" ? coasResult.value : [],
        siteControls,
        siteControlsSource: "operations-control-plane",
        siteControlsStorage: siteControlRepository ? "postgresql" : "redis-fallback",
        storefrontDelivery: "research-peptides-direct",
        wordpressSyncAvailable: false,
        coaWriteEnabled: Boolean(customCoas),
        coaSource: customCoas ? "phase-one-postgresql" : "wordpress-legacy",
        siteControlsWriteEnabled: true,
        coaBridgeVersion: customCoas ? "Custom COA API v1" : bridge?.version || null,
        cachedAt: new Date().toISOString(),
      };
      extensionsCache = { payload, updatedAt: Date.now() };
      return payload;
    })().finally(() => { extensionsRefresh = undefined; });
    return extensionsRefresh;
  }

  async function fulfillmentCatalogRecord(
    productId: number,
    variationId: number,
  ): Promise<{ product: CommerceProduct; variation: CommerceVariation | null }> {
    if (!commerce) throw new Error("The live catalog service is not connected");
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new ProductLocationError("A valid product is required", "invalid_input");
    }
    if (!Number.isSafeInteger(variationId) || variationId < 0) {
      throw new ProductLocationError("A valid variation is required", "invalid_input");
    }
    const product = await commerce.getProduct(productId);
    if (variationId === 0) return { product, variation: null };
    const variations = await commerce.listProductVariations(productId);
    const variation = variations.find((item) => item.id === variationId) || null;
    if (!variation) throw new ProductLocationError("The variation does not belong to this product", "not_found");
    return { product, variation };
  }

  function coaMatchesCatalogRecord(
    coa: CommerceCoa,
    product: CommerceProduct,
    variation: CommerceVariation | null,
  ): boolean {
    if (coa.matchedProductId > 0 && coa.matchedProductId !== product.id) return false;
    if (coa.matchedVariationId > 0 && coa.matchedVariationId !== (variation?.id || 0)) return false;
    if (coa.matchedProductId === product.id) return true;
    const sku = (variation?.sku || product.sku).trim().toLocaleLowerCase("en");
    return Boolean(sku && coa.skus.some((item) => item.trim().toLocaleLowerCase("en") === sku));
  }

  function fulfillmentError(
    response: ServerResponse,
    error: unknown,
    fallback: string,
  ): void {
    if (
      error instanceof ProductLocationError ||
      error instanceof BarcodeLabelError ||
      error instanceof BarcodeRegistryError ||
      error instanceof FulfillmentPackingError ||
      error instanceof FulfillmentRepositoryError ||
      error instanceof FulfillmentEvidenceRepositoryError ||
      error instanceof FulfillmentEvidenceServiceError ||
      error instanceof FulfillmentEvidenceStorageError ||
      error instanceof FulfillmentShippingError ||
      error instanceof FulfillmentShippingRepositoryError ||
      error instanceof FulfillmentShippingWorkflowError ||
      error instanceof ShippingQuoteTokenError ||
      error instanceof ShipStationGatewayError
    ) {
      const status = error.code === "not_found"
        ? 404
        : error.code === "unauthorized"
          ? 401
        : error.code === "forbidden" || error.code === "label_purchase_disabled"
            ? 403
            : ["not_configured", "no_origin", "upstream_unavailable", "rate_limited", "unavailable"].includes(error.code)
              ? 503
        : ["conflict", "invalid_state", "order_ineligible", "active_conflict", "version_conflict", "idempotency_conflict", "purchase_unknown"].includes(error.code)
          ? 409
          : 400;
      json(response, status, { error: error.message });
      return;
    }
    console.error(fallback, error);
    json(response, 502, { error: fallback });
  }

  async function packedShippingOrder(fulfillmentId: string): Promise<{
    session: FulfillmentSession;
    order: CommerceOrder;
    destination: ReturnType<typeof shippingDestination>;
    sourceShipping: CommerceOrder["shippingOperations"];
  }> {
    if (!commerce || !fulfillmentRepository) {
      throw new FulfillmentShippingError("Shipping services are not configured", "order_ineligible");
    }
    const session = await fulfillmentRepository.getById(fulfillmentId);
    if (!session) {
      throw new FulfillmentRepositoryError("The fulfillment does not exist", "not_found");
    }
    if (session.state !== "packed") {
      throw new FulfillmentShippingError("Only packed orders can enter shipping", "order_ineligible");
    }
    const order = await commerce.getOrder(session.orderId);
    const statusBlocker = packedOrderStatusBlocker(order);
    if (statusBlocker) {
      const existingShipment = sourceShippingBlocksPurchase(order.shippingOperations);
      throw new FulfillmentShippingError(
        `${statusBlocker}${existingShipment ? ` ${existingShipment}` : ""} No new label was created.`,
        "order_ineligible",
      );
    }
    return {
      session,
      order,
      destination: shippingDestination(order.shipping),
      sourceShipping: order.shippingOperations,
    };
  }

  async function synchronizeNativeShippingLabel(
    label: ShippingLabel,
    actorId: string,
  ): Promise<ShippingLabel> {
    if (!fulfillmentShipping || label.providerMode !== "live" ||
        (label.state !== "label_ready" && label.state !== "voided")) return label;
    if (!commerce || commerceConfig?.accessMode !== "read_write") {
      return fulfillmentShipping.markWordPressSync({
        fulfillmentId: label.fulfillmentId,
        actorId,
        state: "failed",
        message: "The source order bridge is not configured for write access.",
      });
    }
    try {
      const result = label.state === "voided"
        ? await commerce.voidNativeShippingLabel({
            orderId: label.orderId,
            eventId: label.id,
            labelId: label.labelId || "",
          })
        : await commerce.saveNativeShippingLabel({
            orderId: label.orderId,
            eventId: label.id,
            labelId: label.labelId || "",
            shipmentId: label.shipmentId,
            trackingNumber: label.trackingNumber || "",
            carrier: label.carrierName,
            service: label.serviceName,
            amount: label.amount,
            currency: label.currency,
            purchasedAt: label.updatedAt,
          });
      return fulfillmentShipping.markWordPressSync({
        fulfillmentId: label.fulfillmentId,
        actorId,
        state: "synced",
        message: result.message,
      });
    } catch (error) {
      return fulfillmentShipping.markWordPressSync({
        fulfillmentId: label.fulfillmentId,
        actorId,
        state: "failed",
        message: error instanceof Error ? error.message : "The source order could not be updated.",
      });
    }
  }

  async function queueSources(): Promise<{
    orders: CommerceOrder[];
    products: CommerceProduct[];
    coas: CommerceCoa[];
    sessions: FulfillmentSession[];
    locations: Awaited<ReturnType<ProductLocationRepository["list"]>>;
  }> {
    if (!commerce || !productLocations || !fulfillmentRepository) {
      throw new Error("Fulfillment queue services are not configured");
    }
    const [recentOrders, products, coas, sessions, locations] = await Promise.all([
      commerce.listFulfillmentOrders(),
      commerce.listProducts(),
      fulfillmentCoas(),
      fulfillmentRepository.list(),
      productLocations.list(),
    ]);
    const known = new Set(recentOrders.map((order) => order.id));
    const missingSessionOrders = await Promise.all(
      sessions
        .filter((session) => !known.has(session.orderId))
        .map((session) => commerce.getOrder(session.orderId).catch(() => null)),
    );
    return {
      orders: [...recentOrders, ...missingSessionOrders.filter((order): order is CommerceOrder => Boolean(order))],
      products,
      coas,
      sessions,
      locations,
    };
  }

  async function buildQueuePayload(role: ManagedUserRole): Promise<FulfillmentQueuePayload> {
    const access = fulfillmentAccessForRole(role);
    const { orders, products, coas, sessions, locations } = await queueSources();
    const sessionsByOrder = new Map(sessions.map((session) => [session.orderId, session]));
    const candidateOrders = orders.filter((order) =>
      shouldIncludeFulfillmentOrder(order, sessionsByOrder.get(order.id) ?? null));
    const queueOrders = candidateOrders.map((order) => buildFulfillmentQueueEntry({
      order,
      products,
      coas,
      locations,
      session: sessionsByOrder.get(order.id) ?? null,
    }));
    queueOrders.sort(compareFulfillmentQueueEntries);
    return {
      configured: true,
      connected: true,
      generatedAt: new Date().toISOString(),
      activeSessionId: sessions.find((session) => session.state === "open")?.id || null,
      permissions: { read: access.read, operateQueue: access.operateQueue },
      orders: queueOrders,
    };
  }

  async function prepareBarcodeLabel(
    input: Record<string, unknown>,
    actorId: string,
  ) {
    if (!productLocations || !barcodeLabels || !barcodeRegistry || !commerce) {
      throw new Error("Barcode labels are not fully configured");
    }
    const type = String(input.type || "product");
    const productId = Number(input.productId);
    const variationId = Number(input.variationId || 0);
    if (!["product", "variation", "batch"].includes(type)) {
      throw new BarcodeLabelError("Select a valid label type", "invalid_input");
    }
    const { product, variation } = await fulfillmentCatalogRecord(productId, variationId);
    if (type === "product" && variationId !== 0) {
      throw new BarcodeLabelError("Product labels cannot identify a variation", "invalid_input");
    }
    if (type === "variation" && !variation) {
      throw new BarcodeLabelError("Select a valid variation", "invalid_input");
    }
    const effective = await productLocations.getEffective(productId, variationId);
    let coa: CommerceCoa | undefined;
    if (type === "batch") {
      const coaId = typeof input.coaId === "string" ? input.coaId.trim() : "";
      coa = (await fulfillmentCoas()).find((item) => item.id === coaId);
      if (!coa) throw new ProductLocationError("Select an existing COA batch", "not_found");
      if (!coaMatchesCatalogRecord(coa, product, variation)) {
        throw new BarcodeLabelError(
          "The selected COA is not mapped to this product or variation",
          "invalid_input",
        );
      }
      if (!(coa.lot || coa.batch).trim()) {
        throw new BarcodeLabelError(
          "The selected COA does not contain a lot or batch",
          "invalid_input",
        );
      }
    }
    const barcodePayload = {
      type: type as "product" | "variation" | "batch",
      productId,
      variationId,
      ...(coa ? { coaId: coa.id, lot: coa.lot || coa.batch } : {}),
    };
    const registered = await barcodeRegistry.createOrGet({
      barcodeValue: barcodeLabels.identifierFor(barcodePayload),
      payload: { version: 1, ...barcodePayload },
      createdBy: actorId,
    });
    const label = barcodeLabels.createLabel({
      ...barcodePayload,
      barcodeValue: registered.barcodeValue,
      productName: product.name,
      variantName: variation?.attributes.map((item) => item.option).filter(Boolean).join(" · ") || "",
      sku: variation?.sku || product.sku,
      locationCode: effective.location?.locationCode || "STORAGE",
      coaNumber: coa?.coaNumber || "",
      size: input.size === "3x1" ? "3x1" : "2x1",
      copies: Number(input.copies),
    });
    return {
      label,
      inheritedLocation: effective.inherited,
      registeredLabel: registered,
    };
  }

  async function rewardControlPayload(force = false): Promise<Record<string, unknown>> {
    if (!commerce || !commerceConfig) {
      return { connected: false, writeEnabled: false, settings: null, metrics: null, audit: [] };
    }
    const bridge = await commerce.getOperationsBridgeStatus().catch(() => null);
    const supported = Boolean(
      bridge?.connected &&
      bridge.capabilities.includes("manage_reward_settings") &&
      bridge.capabilities.includes("adjust_customer_points"),
    );
    const writeEnabled = commerceConfig.accessMode === "read_write" && supported;
    if (!supported) {
      return {
        connected: true,
        writeEnabled: false,
        requiresBridgeUpdate: true,
        bridgeVersion: bridge?.version || null,
        settings: null,
        metrics: null,
        audit: [],
      };
    }
    if (!force && rewardsCache && Date.now() - rewardsCache.updatedAt < 60_000) {
      return { connected: true, writeEnabled, bridgeVersion: bridge?.version || null, ...rewardsCache.payload };
    }
    const payload = await commerce.getRewardControl();
    rewardsCache = { payload, updatedAt: Date.now() };
    return { connected: true, writeEnabled, bridgeVersion: bridge?.version || payload.version, ...payload };
  }

  async function syncAffiliateLegacy(force = false): Promise<void> {
    if (!affiliates || !commerce) return;
    if (!force && Date.now() - affiliateLegacySyncAt < 60_000) return;
    await affiliates.importLegacy(await commerce.listLegacyAffiliateCoupons());
    affiliateLegacySyncAt = Date.now();
  }

  if (customCoas && commerce) {
    void ensureCustomCoaHistory()
      .then(() => customCoas.list({ limit: 500 }))
      .then((coas) => automaticallyPublishExactCoas(coas, "system:exact-coa-publisher"))
      .then((published) => {
        if (!published.size) return;
        extensionsCache = undefined;
        fulfillmentCoasCache = undefined;
        console.info("Exact COAs published automatically", { certificateIds: [...published.keys()] });
      })
      .catch((error: unknown) => {
        console.error("Automatic COA startup reconciliation failed", error instanceof Error ? error.message : error);
      });
  }

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url || "/", config.dashboardOrigin);
      const nonce = randomBytes(16).toString("base64");
      securityHeaders(response, nonce, trustedImageOrigins);

      if (url.pathname === "/health" && request.method === "GET") {
        const redisHealthy = await store.ping().catch(() => false);
        response.statusCode = redisHealthy ? 200 : 503;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ status: redisHealthy ? "ok" : "degraded" }));
        return;
      }

      if (url.pathname === "/api/public/site-control" && request.method === "GET") {
        const suppliedOrigin = firstHeaderValue(request.headers.origin);
        const normalizedOrigin = suppliedOrigin ? normalizeOrigin(suppliedOrigin) : null;
        if (normalizedOrigin && config.trackerOrigins.has(normalizedOrigin)) {
          response.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
          response.setHeader("Access-Control-Allow-Methods", "GET");
        }
        const storedControls = await independentSiteControls();
        const deliveryControls = reconciledProductCampaign?.revision === storedControls.revision
          ? reconciledProductCampaign.controls
          : storedControls;
        if (deliveryControls === storedControls) {
          void reconcilePublishedProductCampaign(storedControls);
        }
        const controls = publicSiteControls(deliveryControls);
        const body = Buffer.from(JSON.stringify(controls));
        const etag = `\"${createHash("sha256").update(body).digest("base64url")}\"`;
        response.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=30, stale-if-error=86400");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("ETag", etag);
        response.setHeader("Vary", "Origin");
        response.setHeader("X-Site-Control-Source", "operations-control-plane");
        response.setHeader("X-Site-Control-Revision", String(controls.revision || 0));
        if (firstHeaderValue(request.headers["if-none-match"]) === etag) {
          response.statusCode = 304;
          response.end();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Length", String(body.byteLength));
        response.end(body);
        return;
      }

      if (["/api/public/coas", "/api/public/v1/coas"].includes(url.pathname) && request.method === "GET") {
        const suppliedOrigin = firstHeaderValue(request.headers.origin);
        const normalizedOrigin = suppliedOrigin ? normalizeOrigin(suppliedOrigin) : null;
        if (normalizedOrigin && config.trackerOrigins.has(normalizedOrigin)) {
          response.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
          response.setHeader("Access-Control-Allow-Methods", "GET");
        }
        response.setHeader("Vary", "Origin, Accept-Encoding");
        if (!customCoas) {
          json(response, 503, { error: "The custom COA library is not configured" });
          return;
        }
        const productId = Number(url.searchParams.get("productId") || 0);
        const variationId = Number(url.searchParams.get("variationId") || 0);
        const current = url.searchParams.get("current");
        try {
          await ensureCustomCoaHistory();
          const records = await customCoas.list({
            ...(Number.isSafeInteger(productId) && productId > 0 ? { productId } : {}),
            ...(Number.isSafeInteger(variationId) && variationId > 0 ? { variationId } : {}),
            ...(url.searchParams.get("sku")?.trim() ? { sku: url.searchParams.get("sku")!.trim() } : {}),
            ...(url.searchParams.get("search")?.trim() ? { search: url.searchParams.get("search")!.trim() } : {}),
            currentOnly: current === "1" || current === "true",
            publishedOnly: true,
            limit: 250,
          });
          const body = Buffer.from(JSON.stringify(records));
          const etag = `\"${createHash("sha256").update(body).digest("base64url")}\"`;
          response.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=10, stale-if-error=300");
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("ETag", etag);
          response.setHeader("X-COA-Source", "phase-one-postgresql");
          if (firstHeaderValue(request.headers["if-none-match"]) === etag) {
            response.statusCode = 304;
            response.end();
            return;
          }
          response.statusCode = 200;
          response.setHeader("Content-Length", String(body.byteLength));
          response.end(body);
        } catch (error: unknown) {
          console.error("Public custom COA lookup failed", error);
          json(response, 503, { error: "The certificate library is temporarily unavailable" });
        }
        return;
      }

      const publicCoaDocumentMatch = url.pathname.match(/^\/api\/public\/(?:v1\/)?coas\/([^/]+)\/document$/);
      if (publicCoaDocumentMatch && (request.method === "GET" || request.method === "HEAD")) {
        if (!customCoas) {
          json(response, 503, { error: "The custom COA library is not configured" });
          return;
        }
        const document = await customCoas.document(decodeURIComponent(publicCoaDocumentMatch[1]!));
        if (!document) {
          json(response, 404, { error: "Certificate document not found" });
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", document.mimeType);
        response.setHeader("Content-Length", String(document.byteSize));
        response.setHeader("Content-Disposition", `inline; filename=\"${document.fileName.replace(/[\"\r\n]/g, "-")}\"`);
        response.setHeader("Cache-Control", "public, max-age=3600, immutable");
        response.setHeader("ETag", `\"${document.sha256}\"`);
        if (request.method === "HEAD") response.end();
        else response.end(document.content);
        return;
      }

      if (url.pathname === "/api/internal/affiliate/storefront-dashboard" && request.method === "POST") {
        if (!affiliateServiceRequestAllowed(request, config)) {
          json(response, 401, { error: "Affiliate service authentication failed" });
          return;
        }
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
        const wpUserId = Number(payload.wpUserId || 0);
        const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 ||
          (wpUserId !== 0 && (!Number.isSafeInteger(wpUserId) || wpUserId < 1)) || displayName.length > 200) {
          json(response, 400, { error: "The verified storefront identity is invalid" });
          return;
        }
        const dashboard = await affiliates.portalDashboardForStorefrontIdentity({
          email,
          wpUserId: wpUserId || null,
          displayName,
        });
        if (!dashboard) {
          json(response, 404, { affiliate: false, error: "No active affiliate profile is linked to this account" });
          return;
        }
        json(response, 200, { affiliate: true, dashboard });
        return;
      }

      if (url.pathname === "/api/internal/affiliate/application-status" && request.method === "POST") {
        if (!affiliateServiceRequestAllowed(request, config)) {
          json(response, 401, { error: "Affiliate service authentication failed" });
          return;
        }
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
        const wpUserId = Number(payload.wpUserId || 0);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 ||
          !Number.isSafeInteger(wpUserId) || wpUserId < 1) {
          json(response, 400, { error: "The verified storefront identity is invalid" });
          return;
        }
        const application = await affiliates.applicationStatusForStorefrontIdentity({ email, wpUserId });
        json(response, 200, { application });
        return;
      }

      if (url.pathname === "/api/internal/affiliate/applications" && request.method === "POST") {
        if (!affiliateServiceRequestAllowed(request, config)) {
          json(response, 401, { error: "Affiliate service authentication failed" });
          return;
        }
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const clientEventId = typeof payload.clientEventId === "string" ? payload.clientEventId : "";
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
        const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
        const preferredCoupon = typeof payload.preferredCoupon === "string" ? payload.preferredCoupon.trim().toUpperCase() : "";
        const platform = typeof payload.platform === "string" ? payload.platform.trim() : "";
        const socialHandle = typeof payload.socialHandle === "string" ? payload.socialHandle.trim() : "";
        const audienceSize = typeof payload.audienceSize === "string" ? payload.audienceSize.trim() : "";
        const promotionNotes = typeof payload.promotionNotes === "string" ? payload.promotionNotes.trim() : "";
        const source = payload.source === "account_form" ? "account_form" : "public_form";
        const wpUserId = Number(payload.wpUserId || 0);
        const confirmations = payload.confirmations && typeof payload.confirmations === "object"
          ? payload.confirmations as Record<string, unknown>
          : {};
        const confirmed = ["confirmAge", "confirmResearchOnly", "confirmNoMedicalClaims", "confirmPaidAdsApproval"]
          .every((key) => confirmations[key] === true);
        if (!/^[a-f0-9-]{36}$/i.test(clientEventId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 320 || displayName.length < 2 || displayName.length > 200 ||
          !/^[A-Z0-9_-]{2,24}$/.test(preferredCoupon) || !platform || platform.length > 60 ||
          !socialHandle || socialHandle.length > 240 || !audienceSize || audienceSize.length > 60 ||
          promotionNotes.length < 10 || promotionNotes.length > 5_000 || !confirmed ||
          (wpUserId !== 0 && (!Number.isSafeInteger(wpUserId) || wpUserId < 1))) {
          json(response, 400, { error: "The affiliate application is incomplete" });
          return;
        }
        try {
          const application = await affiliates.submitApplication({
            clientEventId, wpUserId: wpUserId || null, email, displayName, preferredCoupon,
            platform, socialHandle, audienceSize, promotionNotes, source,
            confirmations: {
              confirmAge: true,
              confirmResearchOnly: true,
              confirmNoMedicalClaims: true,
              confirmPaidAdsApproval: true,
            },
          });
          let notificationCreated = true;
          try {
            await store.addNotification({
              type: "system", severity: "info",
              title: `New affiliate application from ${application.displayName}`,
              message: `${application.source === "account_form" ? "Account" : "Public"} application requesting ${application.preferredCoupon}.`,
              actionView: "affiliates",
            });
          } catch (notificationError: unknown) {
            notificationCreated = false;
            console.error("Affiliate application notification failed", {
              applicationId: application.id,
              source: application.source,
              error: notificationError instanceof Error ? notificationError.message : "unknown_error",
            });
          }
          console.info("Affiliate application stored", {
            applicationId: application.id,
            source: application.source,
            status: application.status,
            notificationCreated,
          });
          json(response, 201, { saved: true, notificationCreated, application });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          json(response, message === "affiliate_already_exists" ? 409 : 400, {
            error: message === "affiliate_already_exists"
              ? "This email already belongs to an affiliate account"
              : "The affiliate application could not be saved",
          });
        }
        return;
      }

      if (url.pathname === "/api/internal/affiliate/accept-invitation" && request.method === "POST") {
        if (!affiliateServiceRequestAllowed(request, config)) {
          json(response, 401, { error: "Affiliate service authentication failed" });
          return;
        }
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const token = typeof payload.token === "string" ? payload.token.trim() : "";
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
        const wpUserId = Number(payload.wpUserId || 0);
        const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
        if (token.length < 32 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          !Number.isSafeInteger(wpUserId) || wpUserId < 1 || displayName.length > 200) {
          json(response, 400, { error: "The invitation request is invalid" });
          return;
        }
        try {
          const affiliate = await affiliates.acceptStorefrontInvitation({ token, email, wpUserId, displayName });
          json(response, 200, { accepted: true, affiliate });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          json(response, message === "invitation_identity_mismatch" ? 403 : 409, {
            error: message === "invitation_identity_mismatch"
              ? "Sign in with the email address that received this invitation"
              : "This invitation is invalid, expired or already used",
          });
        }
        return;
      }

      if (url.pathname === "/api/internal/affiliate/storefront-payout" && request.method === "POST") {
        if (!affiliateServiceRequestAllowed(request, config)) {
          json(response, 401, { error: "Affiliate service authentication failed" });
          return;
        }
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
        const wpUserId = Number(payload.wpUserId || 0);
        const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
        const clientEventId = typeof payload.clientEventId === "string" ? payload.clientEventId : "";
        const amount = Number(payload.amount);
        const payoutMethod = typeof payload.payoutMethod === "string" ? payload.payoutMethod.trim() : "";
        const payoutDestination = typeof payload.payoutDestination === "string" ? payload.payoutDestination.trim() : "";
        const note = typeof payload.note === "string" ? payload.note.trim() : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-f0-9-]{36}$/i.test(clientEventId) ||
          !Number.isFinite(amount) || amount <= 0 || !["zelle", "venmo", "paypal", "bank"].includes(payoutMethod) ||
          !payoutDestination || payoutDestination.length > 320 || note.length > 500) {
          json(response, 400, { error: "The payout request is incomplete" });
          return;
        }
        const profile = await affiliates.linkVerifiedStorefrontAccount({ email, wpUserId: wpUserId || null, displayName });
        if (!profile || profile.status !== "active") {
          json(response, 403, { error: "This storefront account is not an active affiliate" });
          return;
        }
        try {
          const payout = await affiliates.requestPayout({
            affiliateId: profile.id, clientEventId, amount, payoutMethod, payoutDestination, note,
          });
          await store.addNotification({
            type: "system", severity: "warning",
            title: `Payout requested by ${profile.displayName}`,
            message: `${payout.currency} ${payout.amount.toFixed(2)} requested through ${payout.payoutMethod}.`,
            actionView: "affiliates",
          });
          json(response, 201, { saved: true, payout });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          const status = message === "payout_below_minimum" || message === "payout_exceeds_balance" ? 409 : 400;
          json(response, status, {
            error: message === "payout_below_minimum"
              ? "The request is below the minimum payout"
              : message === "payout_exceeds_balance"
                ? "The request exceeds the available balance"
                : "The payout request could not be created",
          });
        }
        return;
      }

      if (
        (url.pathname === "/affiliates" || url.pathname === "/affiliates/") &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        response.statusCode = 307;
        response.setHeader("Location", "https://phaseonelabz.com/account/#affiliate");
        response.end();
        return;
      }

      if (url.pathname.startsWith("/assets/") && (request.method === "GET" || request.method === "HEAD")) {
        if (!await serveDashboardAsset(request, response, url.pathname.slice(1))) {
          response.statusCode = 404;
          response.end("Not found");
        }
        return;
      }

      if (url.pathname === "/api/affiliate-portal/login" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        const ip = requestIp(request, config.trustProxy);
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
        const password = typeof payload.password === "string" ? payload.password : "";
        const profile = email ? await affiliates.findActiveByEmail(email) : null;
        const attemptIdentity = profile?.email || "<unknown>";
        const attempt = affiliateLoginAttempts.beforeAttempt(ip, attemptIdentity);
        if (!attempt.allowed) {
          response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
          json(response, 429, {
            error: `Too many incorrect attempts. Try the correct password in ${attempt.retryAfterSeconds} seconds.`,
          });
          return;
        }
        const valid = Boolean(
          profile && profile.status === "active" && profile.passwordHash &&
          await verifyPassword(password, profile.passwordHash).catch(() => false),
        );
        if (!valid || !profile) {
          affiliateLoginAttempts.recordFailure(ip, attemptIdentity);
          json(response, 401, { error: "Email or password is incorrect" });
          return;
        }
        affiliateLoginAttempts.clear(ip, attemptIdentity);
        await affiliates.recordLogin(profile.id);
        response.setHeader("Set-Cookie", createAffiliateSessionCookie({
          affiliateId: profile.id,
          email: profile.email,
          authVersion: profile.authVersion,
          sessionSecret: config.sessionSecret,
          cookieSecure: config.cookieSecure,
        }));
        json(response, 200, { authenticated: true, affiliate: { id: profile.id, email: profile.email, displayName: profile.displayName } });
        return;
      }

      if (url.pathname === "/api/affiliate-portal/activate" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const token = typeof payload.token === "string" ? payload.token.trim() : "";
        const password = typeof payload.password === "string" ? payload.password : "";
        if (token.length < 32 || password.length < 12) {
          json(response, 400, { error: "The invitation or password is invalid" });
          return;
        }
        try {
          const profile = await affiliates.activate(token, password);
          response.setHeader("Set-Cookie", createAffiliateSessionCookie({
            affiliateId: profile.id,
            email: profile.email,
            authVersion: profile.authVersion,
            sessionSecret: config.sessionSecret,
            cookieSecure: config.cookieSecure,
          }));
          json(response, 200, { activated: true, affiliate: { id: profile.id, email: profile.email, displayName: profile.displayName } });
        } catch {
          json(response, 409, { error: "This invitation is invalid or has expired" });
        }
        return;
      }

      if (url.pathname === "/api/affiliate-portal/logout" && request.method === "POST") {
        response.setHeader("Set-Cookie", clearAffiliateSessionCookie(config.cookieSecure));
        json(response, 200, { authenticated: false });
        return;
      }

      if (url.pathname.startsWith("/api/affiliate-portal/") && (request.method === "GET" || request.method === "POST")) {
        if (!affiliates) {
          json(response, 503, { error: "The affiliate platform is not configured" });
          return;
        }
        const session = readAffiliateSession(request.headers.cookie, config.sessionSecret);
        const profile = session ? await affiliates.getSessionProfile(session.sub) : null;
        const authenticated = Boolean(
          session && profile && profile.status === "active" && profile.authVersion === session.authVersion,
        );
        if (!authenticated || !profile) {
          json(response, 401, { authenticated: false });
          return;
        }
        if (url.pathname === "/api/affiliate-portal/dashboard" && request.method === "GET") {
          json(response, 200, { authenticated: true, dashboard: await affiliates.portalDashboard(profile.id) });
          return;
        }
        if (url.pathname === "/api/affiliate-portal/payouts" && request.method === "POST") {
          if (!isLoginOriginAllowed(request, config)) {
            json(response, 403, { error: "Origin not allowed" });
            return;
          }
          let payload: Record<string, unknown>;
          try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
          catch { json(response, 400, { error: "Invalid request" }); return; }
          const clientEventId = typeof payload.clientEventId === "string" ? payload.clientEventId : "";
          const amount = Number(payload.amount);
          const payoutMethod = typeof payload.payoutMethod === "string" ? payload.payoutMethod.trim() : "";
          const payoutDestination = typeof payload.payoutDestination === "string" ? payload.payoutDestination.trim() : "";
          const note = typeof payload.note === "string" ? payload.note.trim() : "";
          if (!/^[a-f0-9-]{36}$/i.test(clientEventId) || !Number.isFinite(amount) || amount <= 0 ||
            !["zelle", "venmo", "paypal", "bank"].includes(payoutMethod) ||
            !payoutDestination || payoutDestination.length > 320 || note.length > 500) {
            json(response, 400, { error: "The payout request is incomplete" });
            return;
          }
          try {
            const payout = await affiliates.requestPayout({
              affiliateId: profile.id, clientEventId, amount, payoutMethod, payoutDestination, note,
            });
            await store.addNotification({
              type: "system", severity: "warning",
              title: `Payout requested by ${profile.displayName}`,
              message: `${payout.currency} ${payout.amount.toFixed(2)} requested through ${payout.payoutMethod}.`,
              actionView: "affiliates",
            });
            json(response, 201, { saved: true, payout });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "";
            const status = message === "payout_below_minimum" || message === "payout_exceeds_balance" ? 409 : 400;
            const publicMessage = message === "payout_below_minimum"
              ? "The request is below the minimum payout"
              : message === "payout_exceeds_balance"
                ? "The request exceeds the available balance"
                : "The payout request could not be created";
            json(response, status, { error: publicMessage });
          }
          return;
        }
        json(response, 404, { error: "Affiliate portal endpoint not found" });
        return;
      }

      const session = readSessionCookie(request.headers.cookie, config.sessionSecret);
      const authenticatedUser = session
        ? await store.getUserById(session.sub) ?? await store.getUserByUsername(session.username)
        : null;
      const authenticated = Boolean(
        authenticatedUser && authenticatedUser.status === "active" &&
        session && authenticatedUser.authVersion === session.authVersion,
      );

      // Google returns from a different site, so the browser intentionally omits
      // our SameSite=Strict session cookie on this request. Authenticate this one
      // callback with the short-lived, single-use server-side OAuth state instead.
      if (url.pathname === "/api/seo/callback" && request.method === "GET") {
        if (!searchConsole) { redirect(response, "/?seo=not-configured#seo"); return; }
        const state = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code") || "";
        const ownerId = state ? await store.consumeSeoOauthState(state) : null;
        const owner = ownerId ? await store.getUserById(ownerId) : null;
        const ownerCanAdminister = owner?.role === "owner" || owner?.role === "administrator";
        if (!owner || owner.status !== "active" || !ownerCanAdminister || !code) {
          redirect(response, "/?seo=invalid#seo");
          return;
        }
        try {
          await searchConsole.exchangeCode(code);
          await searchConsole.sync();
          await store.addNotification({ type: "seo", severity: "success", title: "Search performance connected", message: "Google organic search data is now synchronized with the operations suite.", actionView: "seo" });
          redirect(response, "/?seo=connected#seo");
        } catch (error: unknown) {
          console.error("Search Console connection failed", error instanceof Error ? error.message : error);
          redirect(response, "/?seo=failed#seo");
        }
        return;
      }

      if (url.pathname === "/login" && request.method === "GET") {
        if (commerce) {
          void restoreCommerceCache().then(() => {
            if (!commerceCache) return refreshCommerce();
            if (Date.now() - commerceCache.updatedAt >= Math.max(15_000, commerceConfig?.syncIntervalMs || 0)) {
              return refreshCommerce();
            }
          }).catch((error: unknown) => {
            console.error("Commerce cache warmup failed", error);
          });
        }
        if (authenticated) {
          redirect(response, "/");
          return;
        }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(loginHtml(nonce, url.searchParams.has("invalid") ? "invalid" : null));
        return;
      }

      if (url.pathname === "/login" && request.method === "POST") {
        const ip = requestIp(request, config.trustProxy);
        const form = new URLSearchParams(await readBody(request));
        const username = form.get("username") || "";
        const password = form.get("password") || "";
        const user = await store.getUserByUsername(username);
        const attemptIdentity = user?.username || "<unknown>";
        const attempt = loginAttempts.beforeAttempt(ip, attemptIdentity);
        if (!attempt.allowed) {
          response.statusCode = 429;
          response.setHeader("Retry-After", String(attempt.retryAfterSeconds));
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(loginHtml(nonce, "limited"));
          return;
        }
        const passwordMatches = user
          ? await verifyPassword(password, user.passwordHash).catch(() => false)
          : false;
        const valid = Boolean(user && user.status === "active" && passwordMatches);

        if (!valid) {
          loginAttempts.recordFailure(ip, attemptIdentity);
          redirect(response, "/login?invalid=1");
          return;
        }

        loginAttempts.clear(ip, attemptIdentity);
        await store.recordUserLogin(user!.id);
        response.setHeader(
          "Set-Cookie",
          createSessionCookie({
            username: user!.username,
            userId: user!.id,
            role: user!.role,
            authVersion: user!.authVersion,
            sessionSecret: config.sessionSecret,
            sessionTtlMs: config.sessionTtlMs,
            cookieSecure: config.cookieSecure,
          }),
        );
        redirect(response, "/");
        return;
      }

      if (url.pathname === "/logout" && request.method === "POST") {
        response.setHeader("Set-Cookie", clearSessionCookie(config.cookieSecure));
        redirect(response, "/login");
        return;
      }

      if (!authenticated) {
        redirect(response, "/login");
        return;
      }

      const currentUser = authenticatedUser!;
      const canAdminister = currentUser.role === "owner" || currentUser.role === "administrator";
      const canOperate = canAdminister || currentUser.role === "operations";

      if (url.pathname === "/api/session" && request.method === "GET") {
        json(response, 200, { authenticated: true, user: publicUser(currentUser), permissions: { administer: canAdminister, operate: canOperate } });
        return;
      }

      if (url.pathname === "/api/live-snapshot" && request.method === "GET") {
        const snapshot = config.upstreamMonitor
          ? await store.getUpstreamSnapshot()
          : await store.snapshot();
        if (!snapshot) {
          json(response, 503, { connected: false, error: "No live snapshot is available yet" });
          return;
        }
        const capturedAt = Date.parse(snapshot.serverTime);
        json(response, 200, {
          connected: true,
          transport: "http-fallback",
          ageSeconds: Number.isFinite(capturedAt) ? Math.max(0, Math.floor((Date.now() - capturedAt) / 1_000)) : null,
          snapshot,
        });
        return;
      }

      if (url.pathname === "/api/affiliates" && request.method === "GET") {
        if (!affiliates) {
          json(response, 503, { configured: false, error: "The affiliate database is not configured" });
          return;
        }
        try {
          await syncAffiliateLegacy(url.searchParams.get("refresh") === "1");
          const directory = await affiliates.adminDirectory();
          json(response, 200, {
            ...directory,
            management: {
              couponProvisioningEnabled: commerceConfig?.accessMode === "read_write",
            },
          });
        } catch (error: unknown) {
          console.error("Affiliate directory load failed", error);
          json(response, 502, { configured: true, error: "The affiliate directory could not be synchronized" });
        }
        return;
      }

      if (url.pathname === "/api/affiliates/coupon" && request.method === "POST") {
        if (!canAdminister || !affiliates || !commerce || !isLoginOriginAllowed(request, config)) {
          json(response, !canAdminister ? 403 : 503, { error: !canAdminister ? "Administrator access is required" : "Affiliate coupon management is unavailable" });
          return;
        }
        if (commerceConfig?.accessMode !== "read_write") {
          json(response, 409, { error: "Store coupon write access is disabled" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        try {
          const input = affiliateCouponInput(payload);
          let target = await affiliates.affiliateManagementTarget(input.affiliateId);
          if (!target) {
            json(response, 404, { error: "The affiliate was not found" });
            return;
          }
          if (!target.wpUserId) {
            const identity = await commerce.findCustomerIdentityByEmail(target.email);
            if (!identity) {
              json(response, 409, { error: "No Phase One customer account matches this email yet. Ask the affiliate to sign in and accept the invitation first" });
              return;
            }
            await affiliates.linkStorefrontAccountByAdmin({
              affiliateId: target.id,
              wpUserId: identity.id,
              verifiedEmail: identity.email,
              displayName: identity.displayName,
              actorId: currentUser.id,
            });
            target = await affiliates.affiliateManagementTarget(input.affiliateId);
            if (!target?.wpUserId) throw new Error("affiliate_storefront_account_required");
          }
          if (target.status !== "active") {
            json(response, 409, { error: "Reactivate the affiliate before assigning a coupon" });
            return;
          }
          const currentCoupon = input.couponId
            ? target.coupons.find((coupon) => coupon.id === input.couponId)
            : target.coupons[0];
          if (input.couponId && !currentCoupon) {
            json(response, 404, { error: "The selected affiliate coupon was not found" });
            return;
          }
          const referralUrl = new URL("https://phaseonelabz.com/");
          referralUrl.searchParams.set("coupon", input.code);
          const saved = await commerce.saveManagedAffiliateCoupon({
            wpCouponId: currentCoupon?.wpCouponId || null,
            wpUserId: target.wpUserId,
            code: input.code,
            discountValue: input.discountValue,
            commissionValue: input.commissionValue,
            referralUrl: referralUrl.toString(),
          });
          const couponId = await affiliates.saveManagedCoupon({
            affiliateId: target.id,
            couponId: currentCoupon?.id || null,
            wpCouponId: saved.wpCouponId,
            code: input.code,
            discountValue: input.discountValue,
            commissionValue: input.commissionValue,
            referralUrl: referralUrl.toString(),
            actorId: currentUser.id,
          });
          affiliateLegacySyncAt = 0;
          json(response, currentCoupon ? 200 : 201, { saved: true, couponId });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          const clientError = error instanceof AffiliateManagementError;
          const conflict = message.includes("conflict") || message.includes("inactive") || message.includes("required");
          console.error("Affiliate coupon management failed", error);
          json(response, clientError ? 400 : conflict ? 409 : 502, {
            error: clientError ? error.message : message.includes("conflict")
              ? "That coupon code is already assigned"
              : "The coupon could not be saved in both systems",
          });
        }
        return;
      }

      if (url.pathname === "/api/affiliates/status" && request.method === "POST") {
        if (!canAdminister || !affiliates || !isLoginOriginAllowed(request, config)) {
          json(response, !canAdminister ? 403 : 503, { error: !canAdminister ? "Administrator access is required" : "Affiliate management is unavailable" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        try {
          const input = affiliateStatusInput(payload);
          const target = await affiliates.affiliateManagementTarget(input.affiliateId);
          if (!target) {
            json(response, 404, { error: "The affiliate was not found" });
            return;
          }
          const wpCouponIds = target.coupons.flatMap((coupon) => coupon.wpCouponId ? [coupon.wpCouponId] : []);
          if (wpCouponIds.length && (!commerce || commerceConfig?.accessMode !== "read_write")) {
            json(response, 409, { error: "Store coupon write access is required to change this affiliate safely" });
            return;
          }
          if (wpCouponIds.length) {
            await commerce!.setManagedAffiliateCouponsActive(wpCouponIds, input.status === "active");
          }
          try {
            await affiliates.setAffiliateStatus({ ...input, actorId: currentUser.id });
          } catch (error: unknown) {
            if (input.status === "active" && wpCouponIds.length) {
              await commerce!.setManagedAffiliateCouponsActive(wpCouponIds, false).catch(() => undefined);
            }
            throw error;
          }
          json(response, 200, { saved: true, status: input.status });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          const clientError = error instanceof AffiliateManagementError;
          console.error("Affiliate status management failed", error);
          json(response, clientError ? 400 : message === "affiliate_not_found" ? 404 : 409, {
            error: clientError ? error.message : message === "affiliate_storefront_account_required"
              ? "The affiliate must connect their store account before reactivation"
              : "The affiliate status could not be changed safely",
          });
        }
        return;
      }

      if (url.pathname === "/api/affiliates/invite" && request.method === "POST") {
        if (!canAdminister || !affiliates || !isLoginOriginAllowed(request, config)) {
          json(response, canAdminister ? 503 : 403, { error: canAdminister ? "The affiliate database is not configured" : "Administrator access is required" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const affiliateId = typeof payload.affiliateId === "string" ? payload.affiliateId : "";
        const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
        const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
        const existingAffiliate = /^[a-f0-9-]{36}$/i.test(affiliateId);
        if (!existingAffiliate && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || displayName.length < 2 || displayName.length > 200)) {
          json(response, 400, { error: "Enter the affiliate's name and valid email address" });
          return;
        }
        try {
          const token = randomBytes(32).toString("base64url");
          const invitation = existingAffiliate
            ? { affiliateId, expiresAt: await affiliates.createInvitation(affiliateId, token, currentUser.id) }
            : await affiliates.createDirectInvitation({ email, displayName, token, actorId: currentUser.id });
          const activationUrl = new URL("/account/", "https://phaseonelabz.com");
          activationUrl.searchParams.set("affiliateInvite", token);
          activationUrl.hash = "affiliate";
          json(response, 201, { created: true, affiliateId: invitation.affiliateId, activationUrl: activationUrl.toString(), expiresAt: invitation.expiresAt.toISOString() });
        } catch {
          json(response, 404, { error: "The affiliate could not be invited" });
        }
        return;
      }

      if (url.pathname === "/api/affiliates/payout-status" && request.method === "POST") {
        if (!canAdminister || !affiliates || !isLoginOriginAllowed(request, config)) {
          json(response, canAdminister ? 503 : 403, { error: canAdminister ? "The affiliate database is not configured" : "Administrator access is required" });
          return;
        }
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(await readBody(request)) as Record<string, unknown>; }
        catch { json(response, 400, { error: "Invalid request" }); return; }
        const payoutId = typeof payload.payoutId === "string" ? payload.payoutId : "";
        const status = typeof payload.status === "string" ? payload.status : "";
        const reference = typeof payload.reference === "string" ? payload.reference.trim().slice(0, 180) : "";
        if (!/^[a-f0-9-]{36}$/i.test(payoutId) || !["approved", "processing", "paid", "rejected", "cancelled"].includes(status)) {
          json(response, 400, { error: "The payout action is invalid" });
          return;
        }
        try {
          const payout = await affiliates.updatePayoutStatus({
            payoutId,
            status: status as "approved" | "processing" | "paid" | "rejected" | "cancelled",
            actorId: currentUser.id,
            reference,
          });
          json(response, 200, { saved: true, payout });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          json(response, message === "payout_not_found" ? 404 : 409, { error: "The payout status could not be changed" });
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/locations" && request.method === "GET") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!productLocations) {
          json(response, 503, {
            configured: false,
            locations: [],
            registeredLabels: [],
            permissions: access,
            error: "Warehouse location database is not configured",
          });
          return;
        }
        try {
          json(response, 200, {
            configured: true,
            locations: await productLocations.list(),
            registeredLabels: barcodeRegistry ? await barcodeRegistry.list() : [],
            permissions: access,
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "Storage locations could not be loaded");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/queue" && request.method === "GET") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!commerce || !productLocations || !fulfillmentRepository) {
          json(response, 503, {
            configured: false,
            connected: Boolean(commerce),
            generatedAt: new Date().toISOString(),
            activeSessionId: null,
            permissions: { read: access.read, operateQueue: access.operateQueue },
            orders: [],
            error: "Fulfillment queue services are not fully configured",
          } satisfies FulfillmentQueuePayload);
          return;
        }
        try {
          json(response, 200, await buildQueuePayload(currentUser.role));
        } catch (error: unknown) {
          console.error("Fulfillment queue could not be loaded", error);
          json(response, 502, {
            configured: true,
            connected: false,
            generatedAt: new Date().toISOString(),
            activeSessionId: null,
            permissions: { read: access.read, operateQueue: access.operateQueue },
            orders: [],
            error: "Live orders could not be verified. Nothing can be started until the connection recovers.",
          } satisfies FulfillmentQueuePayload);
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/start" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!commerce || !productLocations || !fulfillmentRepository) {
          json(response, 503, { error: "Fulfillment queue services are not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const orderId = Number(payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).orderId
          : 0);
        if (!Number.isSafeInteger(orderId) || orderId <= 0) {
          json(response, 400, { error: "Select a valid order" });
          return;
        }
        try {
          const [order, products, coas, locations, session] = await Promise.all([
            commerce.getOrder(orderId),
            commerce.listProducts(),
            fulfillmentCoas(),
            productLocations.list(),
            fulfillmentRepository.getByOrderId(orderId),
          ]);
          const entry = buildFulfillmentQueueEntry({ order, products, coas, locations, session });
          if (!["waiting", "paused", "active"].includes(entry.queueStatus)) {
            json(response, 409, {
              error: entry.reasons[0]?.message || "This order cannot be started",
              order: entry,
            });
            return;
          }
          const started = await fulfillmentRepository.createOrResume({
            orderId: order.id,
            orderNumber: order.number,
            sourceModifiedAt: order.modifiedAt,
            sourceSnapshot: fulfillmentSourceSnapshot(order, entry.lines),
            progress: session?.progress || initialFulfillmentProgress(entry.lines),
            actorId: currentUser.id,
          });
          json(response, started.created ? 201 : 200, {
            created: started.created,
            session: started.session,
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The live order could not be started safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/pause" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentRepository) {
          json(response, 503, { error: "Fulfillment queue services are not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        try {
          const session = await fulfillmentRepository.pauseOpenSession({
            fulfillmentId: typeof input.fulfillmentId === "string" ? input.fulfillmentId : "",
            expectedVersion: Number(input.expectedVersion),
            actorId: currentUser.id,
          });
          json(response, 200, { saved: true, session });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The active order could not be paused");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/scan" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!commerce || !fulfillmentRepository || !barcodeRegistry || !coaScanIdentifiers) {
          json(response, 503, { error: "QR Picking services are not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
        const clientEventId = typeof input.clientEventId === "string" ? input.clientEventId : "";
        const rawBarcode = typeof input.barcode === "string" ? input.barcode.trim() : "";
        if (!rawBarcode || rawBarcode.length > 2048) {
          json(response, 400, { error: "Scan a valid vial QR or enter its verification link" });
          return;
        }
        try {
          const replay = await fulfillmentRepository.getRecordedScan({
            fulfillmentId,
            clientEventId,
            rawBarcode,
            actorId: currentUser.id,
          });
          if (replay) {
            json(response, 200, {
              ...replay,
              feedback: replay.event.responseSnapshot,
            });
            return;
          }
          const session = await fulfillmentRepository.getById(fulfillmentId);
          if (!session) {
            json(response, 404, { error: "The picking session does not exist" });
            return;
          }
          const [order, coas, legacyBarcode, storedIdentifier] = await Promise.all([
            commerce.getOrder(session.orderId),
            fulfillmentCoas(),
            barcodeRegistry.resolve(rawBarcode).catch((error: unknown) => {
              if (error instanceof BarcodeRegistryError && error.code === "invalid_input") return null;
              throw error;
            }),
            coaScanIdentifiers.resolve(rawBarcode),
          ]);
          let registeredIdentifier = storedIdentifier;
          if (!registeredIdentifier) {
            const externalResolution = await resolveExternalCoaQr({ rawValue: rawBarcode, coas });
            if (externalResolution) {
              registeredIdentifier = await coaScanIdentifiers.register({
                rawValue: rawBarcode,
                coaReference: externalResolution.coaReference,
                provider: externalResolution.provider,
                createdBy: currentUser.id,
              });
            }
          }
          const registeredBarcode = resolveCoaQrScan({
            rawValue: rawBarcode,
            coas,
            registeredIdentifier,
          }) || legacyBarcode;
          const recorded = await fulfillmentRepository.recordIdempotentScan({
            fulfillmentId,
            clientEventId,
            rawBarcode,
            actorId: currentUser.id,
          }, (lockedSession) => decideFulfillmentScan({
            session: lockedSession,
            barcode: registeredBarcode,
            order,
            coas,
          }));
          json(response, 200, {
            replayed: recorded.replayed,
            session: recorded.session,
            event: recorded.event,
            feedback: recorded.event.responseSnapshot,
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The vial QR could not be verified safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/pack" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!commerce || !fulfillmentRepository) {
          json(response, 503, { error: "Packing services are not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
        const clientEventId = typeof input.clientEventId === "string" ? input.clientEventId : "";
        const expectedVersion = Number(input.expectedVersion);
        try {
          const session = await fulfillmentRepository.getById(fulfillmentId);
          if (!session) {
            json(response, 404, { error: "The picking session does not exist" });
            return;
          }
          if (session.state === "packed") {
            const replay = await fulfillmentRepository.completePacking({
              fulfillmentId,
              clientEventId,
              expectedVersion,
              actorId: currentUser.id,
            }, () => {
              throw new FulfillmentPackingError("A packed session cannot be rebuilt", "invalid_state");
            });
            const synchronized = await synchronizePackedCoas(
              replay.session,
              replay.snapshot,
              currentUser.id,
            );
            json(response, 200, {
              ...replay,
              session: synchronized.session,
              coaSync: synchronized.coaSync,
            });
            return;
          }
          const [order, coas] = await Promise.all([
            commerce.getOrder(session.orderId),
            fulfillmentCoas(),
          ]);
          const packed = await fulfillmentRepository.completePacking({
            fulfillmentId,
            clientEventId,
            expectedVersion,
            actorId: currentUser.id,
          }, (lockedSession) => buildPackingSnapshot({
            session: lockedSession,
            order,
            coas,
            clientEventId,
            actorId: currentUser.id,
          }));
          const synchronized = await synchronizePackedCoas(
            packed.session,
            packed.snapshot,
            currentUser.id,
          );
          json(response, 200, {
            ...packed,
            session: synchronized.session,
            coaSync: synchronized.coaSync,
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The order could not be confirmed as packed safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/coa-sync" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentRepository) {
          json(response, 503, { error: "Fulfillment services are not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
        try {
          const session = await fulfillmentRepository.getById(fulfillmentId);
          if (!session || session.state !== "packed" || !session.completionSnapshot) {
            json(response, 409, { error: "Only a packed fulfillment can synchronize customer COAs" });
            return;
          }
          const synchronized = await synchronizePackedCoas(
            session,
            session.completionSnapshot as unknown as FulfillmentPackingSnapshot,
            currentUser.id,
          );
          json(response, 200, synchronized);
        } catch (error: unknown) {
          fulfillmentError(response, error, "The scanned lots could not be synchronized safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/evidence" && request.method === "GET") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!access.read) {
          json(response, 403, { error: "Fulfillment access required" });
          return;
        }
        if (!fulfillmentEvidence) {
          json(response, 503, { error: "Packaging evidence storage is not configured" });
          return;
        }
        try {
          const workspace = await fulfillmentEvidence.repository.getWorkspace(
            url.searchParams.get("fulfillmentId") || "",
          );
          json(response, 200, { workspace });
        } catch (error: unknown) {
          fulfillmentError(response, error, "Packaging evidence could not be loaded");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/evidence/upload" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentEvidence) {
          json(response, 503, { error: "Packaging evidence storage is not configured" });
          return;
        }
        try {
          const bytes = await readBodyBuffer(request, 12 * 1024 * 1024);
          const saved = await fulfillmentEvidence.upload({
            fulfillmentId: url.searchParams.get("fulfillmentId") || "",
            clientEventId: url.searchParams.get("clientEventId") || "",
            kind: url.searchParams.get("kind") || "",
            mime: firstHeaderValue(request.headers["content-type"]),
            bytes,
            width: Number(firstHeaderValue(request.headers["x-evidence-width"])),
            height: Number(firstHeaderValue(request.headers["x-evidence-height"])),
            actorId: currentUser.id,
          });
          json(response, saved.replayed ? 200 : 201, saved);
        } catch (error: unknown) {
          fulfillmentError(response, error, "The evidence photo could not be stored safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/evidence/remove" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentEvidence) {
          json(response, 503, { error: "Packaging evidence storage is not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        try {
          const workspace = await fulfillmentEvidence.repository.removeFile({
            fulfillmentId: typeof input.fulfillmentId === "string" ? input.fulfillmentId : "",
            evidenceId: typeof input.evidenceId === "string" ? input.evidenceId : "",
            clientEventId: typeof input.clientEventId === "string" ? input.clientEventId : "",
            actorId: currentUser.id,
          });
          json(response, 200, { workspace });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The evidence photo could not be removed safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/evidence/confirm" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentEvidence) {
          json(response, 503, { error: "Packaging evidence storage is not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        try {
          const confirmed = await fulfillmentEvidence.repository.confirm({
            fulfillmentId: typeof input.fulfillmentId === "string" ? input.fulfillmentId : "",
            clientEventId: typeof input.clientEventId === "string" ? input.clientEventId : "",
            actorId: currentUser.id,
          });
          let workspace = confirmed.workspace;
          if (
            fulfillmentEvidenceNotifications &&
            workspace.notificationState !== "sent" &&
            workspace.notificationState !== "uncertain"
          ) {
            workspace = await fulfillmentEvidenceNotifications.send({
              fulfillmentId: workspace.fulfillmentId,
              clientEventId: typeof input.clientEventId === "string" ? input.clientEventId : "",
              actorId: currentUser.id,
            });
          }
          json(response, 200, { ...confirmed, workspace });
        } catch (error: unknown) {
          fulfillmentError(response, error, "Packaging evidence could not be confirmed safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/evidence/notify" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentEvidenceNotifications) {
          json(response, 503, { error: "WordPress evidence email is disabled in this environment" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        try {
          const workspace = await fulfillmentEvidenceNotifications.send({
            fulfillmentId: typeof input.fulfillmentId === "string" ? input.fulfillmentId : "",
            clientEventId: typeof input.clientEventId === "string" ? input.clientEventId : "",
            actorId: currentUser.id,
          });
          json(response, 200, { workspace });
        } catch (error: unknown) {
          fulfillmentError(response, error, "Customer evidence email could not be retried safely");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/evidence/file" && request.method === "GET") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!access.read) {
          json(response, 403, { error: "Fulfillment access required" });
          return;
        }
        if (!fulfillmentEvidence) {
          json(response, 503, { error: "Packaging evidence storage is not configured" });
          return;
        }
        try {
          const file = await fulfillmentEvidence.read(url.searchParams.get("id") || "");
          response.statusCode = 200;
          response.setHeader("Content-Type", file.mime);
          response.setHeader("Content-Length", String(file.bytes.byteLength));
          response.setHeader("Content-Disposition", `inline; filename="phase-one-evidence-${file.id}.${file.mime === "image/png" ? "png" : file.mime === "image/webp" ? "webp" : "jpg"}"`);
          response.setHeader("Cache-Control", "private, no-store, max-age=0");
          response.setHeader("X-Content-Type-Options", "nosniff");
          response.end(file.bytes);
        } catch (error: unknown) {
          fulfillmentError(response, error, "The evidence photo could not be opened");
        }
        return;
      }

      if (url.pathname === "/api/shipping/capabilities" && request.method === "GET") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!access.read) {
          json(response, 403, { error: "Fulfillment access required" });
          return;
        }
        json(response, 200, await shipStation.capabilities());
        return;
      }

      if (url.pathname === "/api/shipping/label" && request.method === "GET") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!access.read) {
          json(response, 403, { error: "Fulfillment access required" });
          return;
        }
        if (!fulfillmentShipping) {
          json(response, 503, { error: "Shipping persistence is not configured" });
          return;
        }
        try {
          const fulfillmentId = url.searchParams.get("fulfillmentId") || "";
          const label = await fulfillmentShipping.getByFulfillmentId(fulfillmentId);
          json(response, 200, {
            label,
            ...(label?.state === "label_ready" ? {
              printUrl: `/api/shipping/label/print?fulfillmentId=${encodeURIComponent(fulfillmentId)}`,
            } : {}),
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The shipping record could not be loaded");
        }
        return;
      }

      if (url.pathname === "/api/shipping/rates" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        try {
          const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
          const requestedCarrierIds = Array.isArray(input.carrierIds)
            ? input.carrierIds.filter((item): item is string => typeof item === "string")
              .map((item) => item.trim()).filter(Boolean)
            : [];
          let parcel = shippingPackageInput(input.package);
          const { destination, order } = await packedShippingOrder(fulfillmentId);
          const capabilities = await shipStation.capabilities();
          if (!capabilities.rateShoppingAvailable) {
            throw new ShipStationGatewayError(
              capabilities.error || "ShipStation rate shopping is not available",
              capabilities.credentialConfigured ? "no_origin" : "not_configured",
            );
          }
          const selectedCarrier = capabilities.carriers.find((carrier) =>
            carrier.code.trim().toLowerCase() === PHASE_ONE_SHIPPING_POLICY.carrierCode &&
            carrier.packages.some((candidate) =>
              candidate.code === PHASE_ONE_SHIPPING_POLICY.packageCode && candidate.domestic
            )
          );
          if (!selectedCarrier) {
            throw new FulfillmentShippingError(
              "FedEx One Rate Pak is not enabled on the connected ShipStation account",
              "invalid_input",
            );
          }
          if (
            requestedCarrierIds.length !== 1 || requestedCarrierIds[0] !== selectedCarrier.id ||
            parcel.packageCode !== PHASE_ONE_SHIPPING_POLICY.packageCode
          ) {
            throw new FulfillmentShippingError(
              "Only FedEx One Rate Pak can be used for fulfillment",
              "invalid_input",
            );
          }
          const carrierIds = [selectedCarrier.id];
          parcel = {
            ...parcel,
            packageCode: PHASE_ONE_SHIPPING_POLICY.packageCode,
            packageName: PHASE_ONE_SHIPPING_POLICY.packageName,
          };
          const reconciliation = capabilities.dataMode === "live"
            ? await shipStation.reconcileOrderByNumber(order.number)
            : { purchasedLabels: [], protectedShipmentFound: false, reusableShipmentId: null };
          if (reconciliation.protectedShipmentFound) {
            throw new FulfillmentShippingError(
              "ShipStation already has a purchased or processing label for this order. No new rate or label was created.",
              "order_ineligible",
            );
          }
          const rates = (await shipStation.rates({
            carrierIds,
            package: parcel,
            destination,
            externalShipmentId: shippingExternalShipmentKey(fulfillmentId),
            orderNumber: order.number,
            existingShipmentId: reconciliation.reusableShipmentId,
          })).filter((rate) => matchesPhaseOneShippingPolicy({
            carrierCode: rate.carrierCode,
            serviceCode: rate.serviceCode,
            packageCode: parcel.packageCode,
          }));
          const destinationHash = shippingDestinationHash(destination);
          const quotedRates: ShippingRateQuote[] = rates.map((rate) => ({
            ...rate,
            quoteToken: createShippingQuoteToken(config.sessionSecret, {
              fulfillmentId,
              destinationHash,
              dataMode: capabilities.dataMode,
              package: parcel,
              rate,
            }),
          }));
          json(response, 200, {
            dataMode: capabilities.dataMode,
            fulfillmentId,
            destination: shippingDestinationSummary(destination),
            package: parcel,
            rates: quotedRates,
            quotedAt: new Date().toISOString(),
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "Shipping rates could not be retrieved safely");
        }
        return;
      }

      if (
        (url.pathname === "/api/shipping/label" || url.pathname === "/api/shipping/mock-label") &&
        request.method === "POST"
      ) {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentShipping || !fulfillmentShippingWorkflow) {
          json(response, 503, { error: "Shipping persistence is not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        try {
          const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
          const clientEventId = typeof input.clientEventId === "string" ? input.clientEventId : "";
          const quoteToken = typeof input.quoteToken === "string" ? input.quoteToken : "";
          const claims = verifyShippingQuoteToken(config.sessionSecret, quoteToken);
          if (claims.fulfillmentId !== fulfillmentId) {
            throw new ShippingQuoteTokenError("The selected rate belongs to another fulfillment", "invalid");
          }
          if (!matchesPhaseOneShippingPolicy({
            carrierCode: claims.rate.carrierCode,
            serviceCode: claims.rate.serviceCode,
            packageCode: claims.package.packageCode,
          })) {
            throw new ShippingQuoteTokenError(
              "Only FedEx One Rate Pak can be purchased from this workspace",
              "invalid",
            );
          }
          const { destination, order, sourceShipping } = await packedShippingOrder(fulfillmentId);
          if (shippingDestinationHash(destination) !== claims.destinationHash) {
            throw new ShippingQuoteTokenError(
              "The shipping address changed. Compare rates again.",
              "invalid",
            );
          }
          const conflict = sourceShippingBlocksPurchase(sourceShipping);
          if (conflict && claims.dataMode === "live") {
            throw new FulfillmentShippingError(
              `${conflict} Native label creation is blocked to prevent a duplicate shipment.`,
              "order_ineligible",
            );
          }
          if (claims.dataMode === "live") {
            const reconciliation = await shipStation.reconcileOrderByNumber(order.number);
            if (reconciliation.protectedShipmentFound) {
              throw new FulfillmentShippingError(
                "ShipStation already has a purchased or processing label for this order. The existing tracking must be reconciled; no second label was purchased.",
                "order_ineligible",
              );
            }
          }
          const created = await fulfillmentShippingWorkflow.create({
            fulfillmentId,
            clientEventId,
            actorId: currentUser.id,
            providerMode: claims.dataMode,
            destination,
            package: claims.package,
            rate: claims.rate,
            sourceShipping,
          });
          const label = created.label.state === "label_ready"
            ? await synchronizeNativeShippingLabel(created.label, currentUser.id)
            : created.label;
          json(response, 200, {
            ...created,
            label,
            ...(label.state === "label_ready" ? {
              printUrl: `/api/shipping/label/print?fulfillmentId=${encodeURIComponent(fulfillmentId)}`,
            } : {}),
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The shipping label could not be generated safely");
        }
        return;
      }

      if (url.pathname === "/api/shipping/label/reconcile" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!access.operateQueue) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!fulfillmentShippingWorkflow) {
          json(response, 503, { error: "Shipping persistence is not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        try {
          const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
          await packedShippingOrder(fulfillmentId);
          const reconciled = await fulfillmentShippingWorkflow.reconcile({
            fulfillmentId,
            actorId: currentUser.id,
          });
          const label = reconciled.state === "label_ready"
            ? await synchronizeNativeShippingLabel(reconciled, currentUser.id)
            : reconciled;
          json(response, 200, {
            label,
            ...(label.state === "label_ready" ? {
              printUrl: `/api/shipping/label/print?fulfillmentId=${encodeURIComponent(fulfillmentId)}`,
            } : {}),
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The label status could not be reconciled safely");
        }
        return;
      }

      if (url.pathname === "/api/shipping/label/sync" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!access.operateQueue) { json(response, 403, { error: "Operations access required" }); return; }
        if (!fulfillmentShipping) { json(response, 503, { error: "Shipping persistence is not configured" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        try {
          const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
          const label = await fulfillmentShipping.getByFulfillmentId(fulfillmentId);
          if (!label) throw new FulfillmentShippingRepositoryError("The shipping label does not exist", "not_found");
          json(response, 200, { label: await synchronizeNativeShippingLabel(label, currentUser.id) });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The source order could not be synchronized");
        }
        return;
      }

      if (url.pathname === "/api/shipping/label/void" && request.method === "POST") {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!access.operateQueue) { json(response, 403, { error: "Operations access required" }); return; }
        if (!fulfillmentShippingWorkflow) { json(response, 503, { error: "Shipping persistence is not configured" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        try {
          const fulfillmentId = typeof input.fulfillmentId === "string" ? input.fulfillmentId : "";
          if (input.confirmation !== "VOID") {
            throw new FulfillmentShippingWorkflowError("Explicit void confirmation is required", "invalid_state");
          }
          const voided = await fulfillmentShippingWorkflow.void({ fulfillmentId, actorId: currentUser.id });
          const label = await synchronizeNativeShippingLabel(voided, currentUser.id);
          json(response, 200, { label });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The shipping label could not be voided safely");
        }
        return;
      }

      if (
        (url.pathname === "/api/shipping/label/print" || url.pathname === "/api/shipping/mock-label/print") &&
        request.method === "GET"
      ) {
        const access = fulfillmentAccessForRole(currentUser.role);
        if (!access.read) {
          json(response, 403, { error: "Fulfillment access required" });
          return;
        }
        if (!fulfillmentShipping) {
          json(response, 503, { error: "Shipping persistence is not configured" });
          return;
        }
        try {
          const record = await fulfillmentShipping.getPrintRecord(
            url.searchParams.get("fulfillmentId") || "",
          );
          if (!record) {
            json(response, 404, { error: "The test label does not exist" });
            return;
          }
          if (record.label.state !== "label_ready" || !record.label.trackingNumber) {
            json(response, 409, { error: "The label is not ready to print" });
            return;
          }
          if (record.label.providerMode === "live") {
            if (!record.label.labelDownloadUrl) {
              json(response, 409, { error: "The purchased label has no downloadable PDF" });
              return;
            }
            const body = await shipStation.downloadLabelPdf(record.label.labelDownloadUrl);
            await fulfillmentShipping.recordPrint(record.label.fulfillmentId, currentUser.id);
            response.statusCode = 200;
            response.setHeader("Content-Type", "application/pdf");
            response.setHeader("Content-Disposition", `inline; filename="phase-one-order-${record.label.orderNumber.replace(/[^a-zA-Z0-9_-]/g, "")}.pdf"`);
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader("Cache-Control", "private, no-store");
            response.setHeader("Content-Length", String(body.byteLength));
            response.end(Buffer.from(body));
          } else {
            await fulfillmentShipping.recordPrint(record.label.fulfillmentId, currentUser.id);
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(buildMockShippingLabelDocument({
              nonce,
              orderNumber: record.label.orderNumber,
              carrierName: record.label.carrierName,
              serviceName: record.label.serviceName,
              trackingNumber: record.label.trackingNumber,
              destination: record.destination,
              package: record.label.package,
            }));
          }
        } catch (error: unknown) {
          fulfillmentError(response, error, "The test label could not be opened");
        }
        return;
      }

      if (url.pathname === "/api/site-controls" && request.method === "GET") {
        json(response, 200, {
          siteControls: await independentSiteControls(),
          source: "operations-control-plane",
          canManage: canOperate,
          storage: siteControlRepository ? "postgresql" : "redis-fallback",
          storefrontDelivery: "research-peptides-direct",
          wordpressSyncAvailable: false,
        });
        return;
      }

      if (url.pathname === "/api/users" && request.method === "GET") {
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        json(response, 200, { users: (await store.listUsers()).map(publicUser), currentUserId: currentUser.id });
        return;
      }

      if (url.pathname === "/api/users" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const username = typeof input.username === "string" ? input.username.trim() : "";
        const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
        const email = typeof input.email === "string" ? input.email.trim() : "";
        const password = typeof input.password === "string" ? input.password : "";
        const role = String(input.role || "analyst") as ManagedUserRole;
        if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username) || !displayName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          json(response, 400, { error: "Enter a valid name, username and email address" }); return;
        }
        if (!["owner", "administrator", "operations", "analyst"].includes(role)) { json(response, 400, { error: "Select a valid role" }); return; }
        try {
          const passwordHash = await hashPassword(password);
          const user = await store.createUser({ username, displayName, email, role, passwordHash });
          await store.addNotification({ type: "security", severity: "info", title: `${displayName} joined the workspace`, message: `${role} access was created by ${currentUser.displayName}.`, actionView: "team" });
          json(response, 201, { user: publicUser(user) });
        } catch (error: unknown) {
          json(response, error instanceof Error && error.message === "USERNAME_EXISTS" ? 409 : 400, { error: error instanceof Error && error.message === "USERNAME_EXISTS" ? "That username is already in use" : error instanceof Error ? error.message : "The user could not be created" });
        }
        return;
      }

      if (url.pathname === "/api/users/update" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const id = typeof input.id === "string" ? input.id : "";
        const role = String(input.role || "") as ManagedUserRole;
        const status = input.status === "suspended" ? "suspended" : "active";
        if (!id || !["owner", "administrator", "operations", "analyst"].includes(role)) { json(response, 400, { error: "Invalid user update" }); return; }
        if (id === currentUser.id && (status === "suspended" || role !== currentUser.role)) { json(response, 409, { error: "You cannot suspend or change your own administrator role" }); return; }
        const target = await store.getUserById(id);
        if (!target) { json(response, 404, { error: "User not found" }); return; }
        if (target.role === "owner" && (role !== "owner" || status === "suspended")) {
          const activeOwners = (await store.listUsers()).filter((user) => user.role === "owner" && user.status === "active");
          if (activeOwners.length <= 1) { json(response, 409, { error: "The workspace must keep one active owner" }); return; }
        }
        const updated = await store.updateUser(id, { role, status });
        json(response, 200, { user: updated ? publicUser(updated) : null });
        return;
      }

      if (url.pathname === "/api/users/password" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
        const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
        if (!await verifyPassword(currentPassword, currentUser.passwordHash).catch(() => false)) { json(response, 403, { error: "The current password is incorrect" }); return; }
        try {
          const updated = await store.setUserPassword(currentUser.id, await hashPassword(newPassword));
          if (!updated) throw new Error("User not found");
          response.setHeader("Set-Cookie", createSessionCookie({ username: updated.username, userId: updated.id, role: updated.role, authVersion: updated.authVersion, sessionSecret: config.sessionSecret, sessionTtlMs: config.sessionTtlMs, cookieSecure: config.cookieSecure }));
          await store.addNotification({ type: "security", severity: "success", title: "Password updated", message: `${updated.displayName} changed their account password.`, actionView: "team" });
          json(response, 200, { saved: true });
        } catch (error: unknown) { json(response, 400, { error: error instanceof Error ? error.message : "The password could not be changed" }); }
        return;
      }

      if (url.pathname === "/api/users/reset-password" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const id = typeof input.id === "string" ? input.id : "";
        const password = typeof input.password === "string" ? input.password : "";
        try {
          const updated = await store.setUserPassword(id, await hashPassword(password));
          if (!updated) { json(response, 404, { error: "User not found" }); return; }
          await store.addNotification({ type: "security", severity: "warning", title: `Password reset for ${updated.displayName}`, message: `The account was secured by ${currentUser.displayName}; all previous sessions were closed.`, actionView: "team" });
          json(response, 200, { saved: true });
        } catch (error: unknown) { json(response, 400, { error: error instanceof Error ? error.message : "The password could not be reset" }); }
        return;
      }

      if (url.pathname === "/api/notifications" && request.method === "GET") {
        const notifications = await store.listNotifications(currentUser.id);
        json(response, 200, { notifications: notifications.map((item) => ({ ...item, read: item.readBy.includes(currentUser.id), readBy: undefined })), unread: notifications.filter((item) => !item.readBy.includes(currentUser.id)).length });
        return;
      }

      if (url.pathname === "/api/notifications/read" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        if (input.all === true) await store.markAllNotificationsRead(currentUser.id);
        else if (typeof input.id === "string") await store.markNotificationRead(input.id, currentUser.id);
        json(response, 200, { saved: true });
        return;
      }

      if (url.pathname === "/api/seo/connect" && request.method === "GET") {
        if (!searchConsole) { json(response, 503, { error: "Search Console credentials are not configured" }); return; }
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        const state = randomBytes(24).toString("base64url");
        await store.saveSeoOauthState(state, currentUser.id);
        redirect(response, searchConsole.authorizationUrl(state));
        return;
      }

      if (url.pathname === "/api/seo" && request.method === "GET") {
        const report = await store.getSeoReport();
        if (!searchConsole) { json(response, 200, { configured: false, connected: false, report: null }); return; }
        json(response, 200, { ...(await searchConsole.status()), report });
        return;
      }

      if (url.pathname === "/api/seo/sync" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!searchConsole) { json(response, 503, { error: "Search Console is not configured" }); return; }
        if (!canOperate) { json(response, 403, { error: "Operations access required" }); return; }
        try { json(response, 200, { report: await searchConsole.sync() }); }
        catch (error: unknown) { json(response, 502, { error: error instanceof Error ? error.message : "Search data could not be synchronized" }); }
        return;
      }

      if (url.pathname === "/api/seo/property" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!searchConsole || !canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const siteUrl = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).siteUrl === "string" ? String((payload as Record<string, unknown>).siteUrl) : "";
        try { await searchConsole.selectSite(siteUrl); json(response, 200, { report: await searchConsole.sync() }); }
        catch (error: unknown) { json(response, 400, { error: error instanceof Error ? error.message : "The property could not be selected" }); }
        return;
      }

      if (url.pathname === "/api/seo/disconnect" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!searchConsole || !canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        await searchConsole.disconnect();
        json(response, 200, { saved: true });
        return;
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/") && !canOperate) {
        json(response, 403, { error: "Your role has read-only access" });
        return;
      }

      if (url.pathname === "/api/fulfillment/location" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!fulfillmentAccessForRole(currentUser.role).manageLocations) {
          json(response, 403, { error: "Administrator access required" });
          return;
        }
        if (!productLocations || !commerce) {
          json(response, 503, { error: "Storage locations or the live catalog are not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const productId = Number(input.productId);
        const variationId = Number(input.variationId || 0);
        const locationCode = typeof input.locationCode === "string" ? input.locationCode : "";
        try {
          await fulfillmentCatalogRecord(productId, variationId);
          const removed = input.remove === true;
          const location = removed
            ? null
            : await productLocations.upsert({
                productId,
                variationId,
                locationCode,
                updatedBy: currentUser.id,
              });
          if (removed) await productLocations.remove(productId, variationId);
          json(response, 200, {
            saved: true,
            location,
            locations: await productLocations.list(),
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The storage location could not be saved");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/barcode/validate" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!barcodeLabels || !barcodeRegistry) {
          json(response, 503, { error: "Barcode validation is not configured" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const token = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).token === "string"
          ? String((payload as Record<string, unknown>).token)
          : "";
        try {
          const registered = await barcodeRegistry.resolve(token);
          if (!registered) {
            throw new BarcodeRegistryError("The barcode is not registered", "not_found");
          }
          json(response, 200, {
            valid: true,
            barcodeValue: registered.barcodeValue,
            payload: {
              version: registered.version,
              type: registered.type,
              productId: registered.productId,
              variationId: registered.variationId,
              ...(registered.coaId ? { coaId: registered.coaId } : {}),
              ...(registered.lot ? { lot: registered.lot } : {}),
            },
            registeredAt: registered.createdAt,
          });
        } catch (error: unknown) {
          fulfillmentError(response, error, "The barcode could not be validated");
        }
        return;
      }

      if (url.pathname === "/api/fulfillment/barcode-label" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!fulfillmentAccessForRole(currentUser.role).printLabels) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        try {
          json(response, 200, await prepareBarcodeLabel(input, currentUser.id));
        } catch (error: unknown) {
          fulfillmentError(response, error, "The barcode label could not be generated");
        }
        return;
      }

      if (
        url.pathname === "/api/fulfillment/barcode-label/print" &&
        request.method === "GET"
      ) {
        if (!fulfillmentAccessForRole(currentUser.role).printLabels) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        if (!barcodeRegistry) {
          json(response, 503, { error: "Barcode printing is not configured" });
          return;
        }
        try {
          const registered = await barcodeRegistry.resolve(url.searchParams.get("token") || "");
          if (!registered) {
            throw new BarcodeRegistryError("The barcode is not registered", "not_found");
          }
          const result = await prepareBarcodeLabel({
            type: registered.type,
            productId: registered.productId,
            variationId: registered.variationId,
            ...(registered.coaId ? { coaId: registered.coaId } : {}),
            size: url.searchParams.get("size") === "3x1" ? "3x1" : "2x1",
            copies: Number(url.searchParams.get("copies")),
          }, currentUser.id);
          if (result.label.token !== registered.barcodeValue) {
            throw new BarcodeRegistryError("The registered barcode identity changed", "conflict");
          }
          const document = buildThermalLabelDocument(result.label, nonce);
          const body = Buffer.from(document);
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Content-Length", String(body.byteLength));
          response.setHeader("Content-Disposition", "inline; filename=phase-one-labels.html");
          response.end(body);
        } catch (error: unknown) {
          fulfillmentError(response, error, "The print document could not be prepared");
        }
        return;
      }

      if (url.pathname === "/api/commerce" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 200, {
            connected: false,
            mode: "not_configured",
            message: "Connect the live catalog service to load orders and products.",
            products: [],
            orders: [],
            media: [],
          });
          return;
        }

        try {
          await restoreCommerceCache();
          const maxAge = Math.max(15_000, config.wooCommerce.syncIntervalMs);
          if (commerceCache) {
            json(response, 200, {
              ...commerceCache.payload,
              cacheAgeSeconds: Math.floor((Date.now() - commerceCache.updatedAt) / 1_000),
              refreshing: Date.now() - commerceCache.updatedAt >= maxAge,
            });
            if (Date.now() - commerceCache.updatedAt >= maxAge) {
              void refreshCommerce().catch((error: unknown) => console.error("Commerce background refresh failed", error));
            }
            return;
          }
          json(response, 200, await refreshCommerce());
        } catch (error: unknown) {
          console.error("Commerce dashboard fetch failed", error);
          json(response, 502, {
            connected: false,
            mode: "unavailable",
            message: "The live catalog service did not respond. Live monitoring remains operational.",
            products: [],
            orders: [],
            media: [],
          });
        }
        return;
      }

      if (url.pathname === "/api/commerce/orders" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 200, { connected: false, orders: [] });
          return;
        }
        try {
          await restoreCommerceCache();
          const cachedOrders = commerceCache?.payload.orders;
          if (Array.isArray(cachedOrders)) {
            const orderReferences = cachedOrders
              .filter((order): order is { id: number } => Boolean(order) && typeof order === "object" && Number.isSafeInteger(Number((order as Record<string, unknown>).id)))
              .map((order) => ({ id: Number((order as Record<string, unknown>).id) }));
            const affiliateCommissions = await affiliateCommissionsForOrders(orderReferences);
            const stale = Date.now() - ordersUpdatedAt >= 15_000;
            json(response, 200, {
              connected: true,
              orders: cachedOrders,
              affiliateCommissions,
              updatedAt: new Date(ordersUpdatedAt).toISOString(),
              stale,
            });
            if (stale) {
              void refreshOrders().catch((error: unknown) => {
                console.error("Live order background refresh failed", error);
              });
            }
            return;
          }
          json(response, 200, await refreshOrders());
        } catch (error: unknown) {
          console.error("Live order refresh failed", error);
          json(response, 502, { connected: false, orders: [], error: "Live orders could not be refreshed" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/sales-report" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live order service is not connected" });
          return;
        }
        const after = new Date(url.searchParams.get("after") || "");
        const before = new Date(url.searchParams.get("before") || "");
        const rangeMs = before.getTime() - after.getTime();
        if (!Number.isFinite(after.getTime()) || !Number.isFinite(before.getTime()) || rangeMs <= 0 || rangeMs > 370 * 86_400_000) {
          json(response, 400, { error: "A valid reporting period of 370 days or less is required" });
          return;
        }
        const cacheKey = `${after.toISOString()}:${before.toISOString()}`;
        const cached = salesReportCache.get(cacheKey);
        const forceRefresh = url.searchParams.get("fresh") === "1";
        if (!forceRefresh && cached && Date.now() - cached.updatedAt < 5 * 60_000) {
          json(response, 200, {
            orders: cached.orders,
            generatedAt: new Date(cached.updatedAt).toISOString(),
            cacheAgeSeconds: Math.floor((Date.now() - cached.updatedAt) / 1_000),
          });
          return;
        }
        try {
          const sourceOrders = await commerce.listOrdersForPeriod(after.toISOString(), before.toISOString());
          const orders = await Promise.all(sourceOrders.map(orderWithProfitability));
          const updatedAt = Date.now();
          salesReportCache.set(cacheKey, { orders, updatedAt });
          if (salesReportCache.size > 24) {
            const oldest = [...salesReportCache.entries()].sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0]?.[0];
            if (oldest) salesReportCache.delete(oldest);
          }
          json(response, 200, { orders, generatedAt: new Date(updatedAt).toISOString(), cacheAgeSeconds: 0 });
        } catch (error: unknown) {
          console.error("Sales report fetch failed", error);
          json(response, 502, { error: "The complete sales period could not be loaded" });
        }
        return;
      }

      if (url.pathname === "/api/reports/orders.pdf" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live order service is not connected" });
          return;
        }
        const orderId = Number(url.searchParams.get("orderId") || 0);
        let orders: CommerceOrder[];
        let periodLabel: string;
        try {
          if (Number.isSafeInteger(orderId) && orderId > 0) {
            const selectedOrder = await commerce.getOrder(orderId);
            orders = [selectedOrder];
            periodLabel = `Order #${selectedOrder.number}`;
          } else {
            const after = new Date(url.searchParams.get("after") || "");
            const before = new Date(url.searchParams.get("before") || "");
            const rangeMs = before.getTime() - after.getTime();
            if (!Number.isFinite(after.getTime()) || !Number.isFinite(before.getTime()) || rangeMs <= 0 || rangeMs > 370 * 86_400_000) {
              json(response, 400, { error: "A valid reporting period of 370 days or less is required" });
              return;
            }
            orders = await commerce.listOrdersForPeriod(after.toISOString(), before.toISOString());
            const requestedLabel = (url.searchParams.get("label") || "").replace(/[^a-zA-Z0-9 ,.'-]/g, "").trim();
            periodLabel = requestedLabel || `${after.toISOString().slice(0, 10)} to ${before.toISOString().slice(0, 10)}`;
          }
          const report = await buildOrderReportPdf(orders, { periodLabel });
          const filePart = Number.isSafeInteger(orderId) && orderId > 0 ? `order-${orders[0]?.number || orderId}` : `orders-${new Date().toISOString().slice(0, 10)}`;
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/pdf");
          response.setHeader("Content-Disposition", `attachment; filename="phase-one-${filePart}.pdf"`);
          response.setHeader("Content-Length", String(report.byteLength));
          response.end(report);
        } catch (error: unknown) {
          console.error("Order PDF report generation failed", error);
          json(response, 502, { error: "The order PDF could not be generated" });
        }
        return;
      }

      if (url.pathname === "/api/customers" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 200, {
            connected: false,
            rewardsLive: false,
            customers: [],
            message: "Connect the live customer service to load customer records.",
          });
          return;
        }
        try {
          await restoreCustomersCache();
          const forceRefresh = url.searchParams.get("refresh") === "1";
          const maxAge = 5 * 60_000;
          if (!forceRefresh && customersCache) {
            const cacheAge = Date.now() - customersCache.updatedAt;
            json(response, 200, {
              ...customersCache.payload,
              cacheAgeSeconds: Math.floor(cacheAge / 1_000),
              refreshing: cacheAge >= maxAge,
            });
            if (cacheAge >= maxAge) refreshCustomersInBackground();
            return;
          }
          json(response, 200, await refreshCustomers());
        } catch (error: unknown) {
          console.error("Customer directory refresh failed", error);
          if (customersCache) {
            json(response, 200, {
              ...customersCache.payload,
              stale: true,
              cacheAgeSeconds: Math.floor((Date.now() - customersCache.updatedAt) / 1_000),
            });
          } else {
            json(response, 502, {
              connected: false,
              rewardsLive: false,
              customers: [],
              error: "The customer directory could not be loaded",
            });
          }
        }
        return;
      }

      if (url.pathname === "/api/rewards" && request.method === "GET") {
        try {
          const payload = await rewardControlPayload(url.searchParams.get("refresh") === "1");
          json(response, 200, { ...payload, canManage: canAdminister && Boolean(payload.writeEnabled) });
        } catch (error: unknown) {
          console.error("Loyalty control refresh failed", error);
          json(response, 502, { connected: false, writeEnabled: false, settings: null, metrics: null, audit: [], error: "Loyalty control could not be loaded" });
        }
        return;
      }

      if (url.pathname === "/api/rewards/settings" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        if (!commerce || !commerceConfig) { json(response, 503, { error: "The live loyalty service is not connected" }); return; }
        if (commerceConfig.accessMode !== "read_write") { json(response, 403, { error: "This connection is read only" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const raw = root.settings && typeof root.settings === "object" ? root.settings as Record<string, unknown> : {};
        const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        const integer = (value: unknown, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, Math.round(finite(value, minimum))));
        const decimal = (value: unknown, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, finite(value, minimum)));
        const rounding = String(raw.rounding || "floor");
        const statuses = Array.isArray(raw.awardStatuses)
          ? raw.awardStatuses.filter((value): value is "processing" | "completed" => value === "processing" || value === "completed")
          : [];
        const reason = typeof root.reason === "string" ? root.reason.trim().slice(0, 300) : "";
        if (reason.length < 5 || !["floor", "round", "ceil"].includes(rounding) || statuses.length === 0) {
          json(response, 400, { error: "Complete the loyalty policy and enter an internal change reason" });
          return;
        }
        const settings: CommerceRewardSettings = {
          earningEnabled: Boolean(raw.earningEnabled),
          redemptionEnabled: Boolean(raw.redemptionEnabled),
          pointsPerCurrency: decimal(raw.pointsPerCurrency, 0.01, 100),
          redemptionBlockPoints: integer(raw.redemptionBlockPoints, 1, 1_000_000),
          redemptionBlockCredit: decimal(raw.redemptionBlockCredit, 0.01, 100_000),
          minimumOrderAmount: decimal(raw.minimumOrderAmount, 0, 1_000_000),
          maximumPointsPerOrder: integer(raw.maximumPointsPerOrder, 0, 1_000_000),
          includeShipping: Boolean(raw.includeShipping),
          includeTax: Boolean(raw.includeTax),
          rounding: rounding as CommerceRewardSettings["rounding"],
          awardStatuses: [...new Set(statuses)],
        };
        try {
          const control = await commerce.saveRewardSettings({
            settings,
            reason,
            confirmLiabilityChange: Boolean(root.confirmLiabilityChange),
          });
          rewardsCache = { payload: control, updatedAt: Date.now() };
          await store.addNotification({
            type: "system",
            severity: "info",
            title: "Loyalty policy updated",
            message: `${currentUser.displayName} published a governed rewards policy change.`,
            actionView: "loyalty",
          });
          json(response, 200, { connected: true, writeEnabled: true, canManage: true, ...control });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "The loyalty policy could not be published";
          const confirmationRequired = message.includes("liability_confirmation_required") || message.includes("409");
          console.error("Loyalty policy update failed", error);
          json(response, confirmationRequired ? 409 : 502, {
            error: confirmationRequired
              ? "Confirm the financial impact before changing the value of outstanding points"
              : "The loyalty policy could not be published. Install the latest Operations Bridge and try again.",
          });
        }
        return;
      }

      if (url.pathname === "/api/rewards/adjust" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        if (!commerce || !commerceConfig) { json(response, 503, { error: "The live loyalty service is not connected" }); return; }
        if (commerceConfig.accessMode !== "read_write") { json(response, 403, { error: "This connection is read only" }); return; }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const customerId = Number(input.customerId);
        const operation = String(input.operation || "add");
        const amount = Math.round(Number(input.amount));
        const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
        if (!Number.isSafeInteger(customerId) || customerId < 1 || !["add", "subtract", "set"].includes(operation) || !Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000 || reason.length < 5) {
          json(response, 400, { error: "Choose a customer, enter a valid point amount and include an internal reason" });
          return;
        }
        const adjustmentInput: CommerceRewardAdjustmentWrite = {
          operation: operation as CommerceRewardAdjustmentWrite["operation"],
          amount,
          reason,
          notifyCustomer: Boolean(input.notifyCustomer),
        };
        try {
          const adjustment = await commerce.adjustCustomerPoints(customerId, adjustmentInput);
          rewardsCache = undefined;
          customersCache = undefined;
          customersCacheRestored = true;
          refreshCustomersInBackground();
          await store.addNotification({
            type: "system",
            severity: adjustment.change < 0 ? "warning" : "success",
            title: `Points updated for ${adjustment.customerName}`,
            message: `${adjustment.change > 0 ? "+" : ""}${adjustment.change.toLocaleString("en-US")} points · ${reason}`,
            actionView: "loyalty",
          });
          json(response, 200, { saved: true, adjustment });
        } catch (error: unknown) {
          console.error("Customer points adjustment failed", error);
          json(response, 502, { error: "The points adjustment could not be completed. Check the balance and the latest Operations Bridge." });
        }
        return;
      }

      if (url.pathname === "/api/extensions" && request.method === "GET") {
        try {
          if (extensionsCache && Date.now() - extensionsCache.updatedAt < 60_000) {
            json(response, 200, extensionsCache.payload);
            return;
          }
          json(response, 200, await refreshExtensions());
        } catch (error: unknown) {
          console.error("Business module refresh failed", error);
          json(response, 200, {
            connected: false,
            coas: [],
            siteControls: await independentSiteControls(),
            siteControlsSource: "operations-control-plane",
            siteControlsWriteEnabled: true,
            wordpressSyncAvailable: false,
            error: "Connected business modules could not be refreshed",
          });
        }
        return;
      }

      if (url.pathname === "/api/extensions/coa/intake" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canOperate) { json(response, 403, { error: "Operations access required" }); return; }
        if (!customCoas) { json(response, 503, { error: "The custom COA library is not configured" }); return; }
        let payload: unknown;
        try { payload = JSON.parse((await readBodyBuffer(request, 96 * 1024)).toString("utf8")); }
        catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const links = Array.isArray(input.links)
          ? input.links.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
          : [];
        if (!links.length || links.length > 40) {
          json(response, 400, { error: "Add between 1 and 40 certificate links" });
          return;
        }
        try {
          const stagedResults = await customCoas.stageLinks(links, Boolean(input.suggestCurrent), currentUser.id);
          const automaticallyPublished = await automaticallyPublishExactCoas(
            stagedResults.map((item) => item.coa),
            currentUser.id,
          );
          const results = stagedResults.map((item) => {
            const published = automaticallyPublished.get(item.coa.recordId || item.coa.id);
            return { ...item, coa: published || item.coa, automaticallyPublished: Boolean(published) };
          });
          extensionsCache = undefined;
          fulfillmentCoasCache = undefined;
          json(response, 201, {
            staged: results.filter((item) => !item.duplicate).length,
            duplicates: results.filter((item) => item.duplicate).length,
            records: results,
            extensions: await refreshExtensions(),
          });
        } catch (error: unknown) {
          json(response, 400, { error: error instanceof Error ? error.message : "The links could not be staged" });
        }
        return;
      }

      if (url.pathname === "/api/extensions/coa/intake-pdf" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canOperate) { json(response, 403, { error: "Operations access required" }); return; }
        if (!customCoas) { json(response, 503, { error: "The custom COA library is not configured" }); return; }
        if (firstHeaderValue(request.headers["content-type"]).split(";")[0]?.trim() !== "application/pdf") {
          json(response, 415, { error: "Only PDF certificate files are accepted" });
          return;
        }
        try {
          const bytes = await readBodyBuffer(request, 12 * 1024 * 1024);
          const stagedResult = await customCoas.stagePdf({
            fileName: firstHeaderValue(request.headers["x-coa-file-name"]) || "certificate.pdf",
            content: bytes,
            suggestCurrent: firstHeaderValue(request.headers["x-coa-current-lot"]) === "true",
            actorId: currentUser.id,
          });
          const automaticallyPublished = await automaticallyPublishExactCoas([stagedResult.coa], currentUser.id);
          const published = automaticallyPublished.get(stagedResult.coa.recordId || stagedResult.coa.id);
          const result = {
            ...stagedResult,
            coa: published || stagedResult.coa,
            automaticallyPublished: Boolean(published),
          };
          extensionsCache = undefined;
          fulfillmentCoasCache = undefined;
          json(response, result.duplicate ? 200 : 201, result);
        } catch (error: unknown) {
          json(response, 400, { error: error instanceof Error ? error.message : "The PDF could not be staged" });
        }
        return;
      }

      const privateCoaDocumentMatch = url.pathname.match(/^\/api\/extensions\/coa\/([^/]+)\/document$/);
      if (privateCoaDocumentMatch && (request.method === "GET" || request.method === "HEAD")) {
        if (!customCoas) { json(response, 503, { error: "The custom COA library is not configured" }); return; }
        const document = await customCoas.document(decodeURIComponent(privateCoaDocumentMatch[1]!), false);
        if (!document) { json(response, 404, { error: "Certificate document not found" }); return; }
        response.statusCode = 200;
        response.setHeader("Content-Type", document.mimeType);
        response.setHeader("Content-Length", String(document.byteSize));
        response.setHeader("Content-Disposition", `inline; filename="${document.fileName.replace(/["\r\n]/g, "-")}"`);
        response.setHeader("Cache-Control", "private, no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (request.method === "HEAD") response.end();
        else response.end(document.content);
        return;
      }

      const deleteCoaDraftMatch = url.pathname.match(/^\/api\/extensions\/coa\/([^/]+)$/);
      if (deleteCoaDraftMatch && request.method === "DELETE") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canOperate) { json(response, 403, { error: "Operations access required" }); return; }
        if (!customCoas) { json(response, 503, { error: "The custom COA library is not configured" }); return; }
        try {
          const id = decodeURIComponent(deleteCoaDraftMatch[1] || "").trim();
          if (!id) { json(response, 400, { error: "A COA draft id is required" }); return; }
          await customCoas.deleteDraft(id, currentUser.id);
          extensionsCache = undefined;
          fulfillmentCoasCache = undefined;
          json(response, 200, { deleted: true, id, extensions: await refreshExtensions() });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "The draft could not be deleted";
          json(response, message.includes("not found") ? 404 : message.includes("Only unpublished") ? 409 : 400, { error: message });
        }
        return;
      }

      if (url.pathname === "/api/extensions/coa/import-wordpress" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) { json(response, 403, { error: "Origin not allowed" }); return; }
        if (!canAdminister) { json(response, 403, { error: "Administrator access required" }); return; }
        if (!customCoas || !commerce) { json(response, 503, { error: "Custom storage and the historical WordPress source are required" }); return; }
        try {
          const result = await customCoas.importLegacy(await commerce.listCoas(), currentUser.id);
          extensionsCache = undefined;
          fulfillmentCoasCache = undefined;
          json(response, 200, { completed: true, ...result, extensions: await refreshExtensions() });
        } catch (error: unknown) {
          console.error("WordPress COA history import failed", error);
          json(response, 502, { error: "The WordPress COA history could not be imported" });
        }
        return;
      }

      if (url.pathname === "/api/extensions/coa" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!canOperate) { json(response, 403, { error: "Operations access required" }); return; }
        if (!customCoas) { json(response, 503, { error: "The custom COA library is not configured" }); return; }

        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const recordId = typeof input.id === "string" ? input.id.trim() : "";
        const wpPostId = Number(input.wpPostId);
        const productName = typeof input.productName === "string" ? input.productName.trim() : "";
        const familyName = typeof input.familyName === "string" ? input.familyName.trim() : "";
        const date = typeof input.date === "string" ? input.date.trim() : "";
        const fileUrl = typeof input.fileUrl === "string" ? input.fileUrl.trim() : "";
        const verifyUrl = typeof input.verifyUrl === "string" ? input.verifyUrl.trim() : "";
        const validUrl = (value: string) => {
          if (!value) return true;
          try {
            const parsed = new URL(value, config.coaPublicOrigin);
            return parsed.protocol === "https:" || ["localhost", "127.0.0.1"].includes(parsed.hostname);
          } catch { return false; }
        };
        let resolvedId = recordId;
        if (!resolvedId && Number.isSafeInteger(wpPostId) && wpPostId > 0) {
          const match = (await customCoas.list({ limit: 500 })).find((item) => item.wpPostId === wpPostId);
          resolvedId = match?.id || "";
        }
        if (!resolvedId) {
          json(response, 400, { error: "A valid COA record id is required" });
          return;
        }
        if (!productName && !familyName) {
          json(response, 400, { error: "A product or family name is required" });
          return;
        }
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          json(response, 400, { error: "Certificate date must use YYYY-MM-DD" });
          return;
        }
        if (!validUrl(fileUrl) || !validUrl(verifyUrl)) {
          json(response, 400, { error: "Certificate links must use HTTPS" });
          return;
        }
        const textValue = (key: string) => typeof input[key] === "string" ? input[key].trim() : "";
        const textList = (key: string) => Array.isArray(input[key])
          ? input[key].filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
          : [];
        const coaWrite: CoaUpdateInput = {
          id: resolvedId,
          ...(Math.max(0, Number(input.expectedRevision) || 0)
            ? { expectedRevision: Math.max(0, Number(input.expectedRevision) || 0) }
            : {}),
          coaNumber: textValue("coaNumber"), productName, compound: textValue("compound"),
          familyName, familyKey: textValue("familyKey"), strength: textValue("strength"),
          batch: textValue("batch"), lot: textValue("lot"), date, status: textValue("status") || "Available",
          purity: textValue("purity"), laboratory: textValue("laboratory"), method: textValue("method"), tested: textValue("tested"),
          testingCostTotal: Math.max(0, Number(input.testingCostTotal) || 0),
          batchUnitCount: Math.max(0, Math.floor(Number(input.batchUnitCount) || 0)),
          currentShippingLot: Boolean(input.currentShippingLot), fileUrl, verifyUrl,
          fileAttachmentId: Math.max(0, Number(input.fileAttachmentId) || 0),
          matchedProductId: Math.max(0, Number(input.matchedProductId) || 0),
          matchedVariationId: Math.max(0, Number(input.matchedVariationId) || 0),
          skus: textList("skus"), aliases: textList("aliases"), keywords: textList("keywords"), panelTypes: textList("panelTypes"),
        };
        try {
          if (coaWrite.matchedVariationId > 0 && coaWrite.matchedProductId <= 0) {
            throw new ProductLocationError("Choose the store product before selecting a presentation", "invalid_input");
          }
          if (coaWrite.matchedProductId > 0) {
            const catalog = await fulfillmentCatalogRecord(coaWrite.matchedProductId, coaWrite.matchedVariationId);
            if (coaNeedsExactVariation(catalog.product.type, coaWrite.status, coaWrite.matchedVariationId)) {
              throw new ProductLocationError(
                "Choose the exact presentation or strength before publishing this COA",
                "invalid_input",
              );
            }
          }
          const coa = await customCoas.update(coaWrite, currentUser.id);
          extensionsCache = undefined;
          fulfillmentCoasCache = undefined;
          await invalidateCommerceCache();
          const extensions = await refreshExtensions();
          json(response, 200, { coa, extensions });
        } catch (error: unknown) {
          console.error("COA update failed", error);
          const message = error instanceof Error ? error.message : "The COA could not be updated";
          json(response, message.includes("not found") ? 404 : message.includes("another session") ? 409 : 400, { error: message });
        }
        return;
      }

      if (url.pathname === "/api/extensions/site-controls" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!canOperate) {
          json(response, 403, { error: "Operations access required" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const promo = root.promo && typeof root.promo === "object" ? root.promo as Record<string, unknown> : {};
        const maintenance = root.maintenance && typeof root.maintenance === "object" ? root.maintenance as Record<string, unknown> : {};
        const productInput = promo.product && typeof promo.product === "object" ? promo.product as Record<string, unknown> : {};
        const cleanText = (value: unknown, maximum: number) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
        const integer = (value: unknown, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, Math.floor(Number(value) || 0)));
        const expectedRevision = root.expectedRevision === undefined
          ? undefined
          : integer(root.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
        const promoType = cleanText(promo.type, 24);
        if (!["general", "product", "simple_gifts"].includes(promoType)) {
          json(response, 400, { error: "Select a valid promotion type" });
          return;
        }
        const title = cleanText(promo.title, 120);
        if (!title) {
          json(response, 400, { error: "The promotion title is required" });
          return;
        }
        const maintenanceTitle = cleanText(maintenance.title, 120);
        const maintenanceMessage = cleanText(maintenance.message, 320);
        const supportEmail = cleanText(maintenance.supportEmail, 190);
        if (!maintenanceTitle || !maintenanceMessage || (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))) {
          json(response, 400, { error: "Enter valid maintenance copy and a valid support email" });
          return;
        }
        const siteControlsWrite: IndependentSiteControlsWrite = {
          promo: {
            enabled: Boolean(promo.enabled),
            type: promoType as IndependentSiteControlsWrite["promo"]["type"],
            productId: integer(promo.productId, 0, Number.MAX_SAFE_INTEGER),
            salePrice: Math.max(0, Number(promo.salePrice) || 0),
            sitewideLabel: cleanText(promo.sitewideLabel, 80),
            eyebrow: cleanText(promo.eyebrow, 80),
            title,
            info: cleanText(promo.info, 220),
            ctaLabel: cleanText(promo.ctaLabel, 60),
            ctaUrl: cleanText(promo.ctaUrl, 500),
            durationDays: integer(promo.durationDays, 0, 30),
            durationHours: integer(promo.durationHours, 0, 23),
            durationMinutes: integer(promo.durationMinutes, 0, 59),
            restart: Boolean(promo.restart),
          },
          maintenance: {
            enabled: Boolean(maintenance.enabled),
            title: maintenanceTitle,
            message: maintenanceMessage,
            supportEmail,
          },
        };
        if (siteControlsWrite.promo.enabled && siteControlsWrite.promo.type === "product" && (!siteControlsWrite.promo.productId || siteControlsWrite.promo.salePrice <= 0)) {
          json(response, 400, { error: "Choose a product and enter a valid sale price before activating the campaign" });
          return;
        }
        try {
          const current = await independentSiteControls();
          if (expectedRevision !== undefined && expectedRevision !== Number(current.revision || 0)) {
            throw new SiteControlRepositoryError(
              "Site Controls changed in another session. Reload the current state before publishing.",
              "revision_conflict",
            );
          }
          let authoritativeProduct: CommerceProduct | null = null;
          let product: SiteControlProductSnapshot | null = null;
          if (siteControlsWrite.promo.type === "product" && siteControlsWrite.promo.productId > 0) {
            if (!commerce || !config.wooCommerce) {
              throw new Error("The live catalog must be connected before publishing a product campaign.");
            }
            authoritativeProduct = await commerce.getProduct(siteControlsWrite.promo.productId);
            const catalogPrice = authoritativeProduct.regularPrice || authoritativeProduct.price;
            if (authoritativeProduct.type !== "simple") {
              throw new Error("This product has multiple presentations. Choose an exact presentation before assigning one promotional price.");
            }
            if (siteControlsWrite.promo.enabled && (
              catalogPrice <= 0 ||
              siteControlsWrite.promo.salePrice >= catalogPrice
            )) {
              throw new Error("The promotional price must be lower than the current catalog price.");
            }
            const existingCampaignProduct = current.promo.type === "product" && current.promo.product?.id === authoritativeProduct.id
              ? current.promo.product
              : null;
            const storefrontSlug = String(authoritativeProduct.slug || "").trim();
            const storefrontUrl = storefrontSlug
              ? `/product/${encodeURIComponent(storefrontSlug)}/`
              : "/research-peptides/";
            siteControlsWrite.promo.ctaUrl = storefrontUrl;
            const existingSaleIsControlled = Boolean(
              existingCampaignProduct &&
              Math.abs((authoritativeProduct.salePrice || 0) - existingCampaignProduct.promoPrice) < 0.005,
            );
            product = {
              id: authoritativeProduct.id,
              name: authoritativeProduct.name,
              slug: storefrontSlug,
              url: storefrontUrl,
              sku: authoritativeProduct.sku,
              image: authoritativeProduct.thumbnailUrl || authoritativeProduct.imageUrl || cleanText(productInput.image, 1_000),
              originalPrice: catalogPrice,
              previousSalePrice: existingCampaignProduct && existingSaleIsControlled
                ? existingCampaignProduct.previousSalePrice ?? null
                : authoritativeProduct.salePrice,
              previousSaleStartsAt: existingCampaignProduct && existingSaleIsControlled
                ? existingCampaignProduct.previousSaleStartsAt ?? null
                : authoritativeProduct.saleStartsAt,
              previousSaleEndsAt: existingCampaignProduct && existingSaleIsControlled
                ? existingCampaignProduct.previousSaleEndsAt ?? null
                : authoritativeProduct.saleEndsAt,
            };
          }
          const now = new Date();
          const next = buildIndependentSiteControls(
            siteControlsWrite,
            current,
            product,
            `${currentUser.displayName} (${currentUser.username})`,
            now,
          );
          const priceRollbacks: CommerceProduct[] = [];
          const currentProduct = current.promo.type === "product" ? current.promo.product : null;
          const nextProductActive = next.promo.enabled && next.promo.type === "product" && next.promo.product;
          let stored: IndependentSiteControls;
          try {
            if (commerce && currentProduct && (!nextProductActive || currentProduct.id !== nextProductActive.id)) {
              const existing = await commerce.getProduct(currentProduct.id);
              const controlledPrice = Math.abs((existing.salePrice || 0) - currentProduct.promoPrice) < 0.005;
              if (controlledPrice) {
                priceRollbacks.push(existing);
                await commerce.setProductSale(existing.id, {
                  salePrice: currentProduct.previousSalePrice ?? null,
                  startsAt: currentProduct.previousSaleStartsAt ?? null,
                  endsAt: currentProduct.previousSaleEndsAt ?? null,
                });
              }
            }
            if (commerce && nextProductActive && authoritativeProduct) {
              priceRollbacks.push(authoritativeProduct);
              await commerce.setProductSale(authoritativeProduct.id, {
                salePrice: nextProductActive.promoPrice,
                startsAt: now.toISOString(),
                endsAt: next.promo.endsAt,
              });
            }
            stored = (siteControlRepository
              ? await siteControlRepository.save(next, expectedRevision)
              : await store.saveIndependentSiteControls(next)) as IndependentSiteControls;
          } catch (error: unknown) {
            if (commerce) {
              for (const snapshot of priceRollbacks.reverse()) {
                await commerce.setProductSale(snapshot.id, {
                  salePrice: snapshot.salePrice,
                  startsAt: snapshot.saleStartsAt,
                  endsAt: snapshot.saleEndsAt,
                }).catch((rollbackError: unknown) => console.error("Promotion price rollback failed", rollbackError));
              }
            }
            throw error;
          }
          const siteControls = stored;
          reconciledProductCampaign = undefined;
          productCampaignRetryAt = 0;
          await invalidateCommerceCache();
          await store.cacheIndependentSiteControls(siteControls).catch((error: unknown) => {
            console.warn("Could not refresh the Redis Site Controls cache", error);
          });
          extensionsCache = undefined;
          await store.addNotification({
            type: "system",
            severity: siteControls.maintenance.enabled ? "warning" : "success",
            title: siteControls.maintenance.enabled ? "Storefront maintenance activated" : "Site Controls updated",
            message: `${currentUser.displayName} published revision ${siteControls.revision} directly to the Phase One storefront.`,
            actionView: "site-controls",
          });
          json(response, 200, {
            siteControls,
            source: "operations-control-plane",
            storage: siteControlRepository ? "postgresql" : "redis-fallback",
            storefrontDelivery: "research-peptides-direct",
            commercePricing: nextProductActive ? "woocommerce-sale-synchronized" : "no-active-product-sale",
          });
        } catch (error: unknown) {
          console.error("Site Controls update failed", error);
          const conflict = error instanceof SiteControlRepositoryError && error.code === "revision_conflict";
          const message = error instanceof Error ? error.message : "Site Controls could not be published to the independent control plane.";
          const invalidCampaign = message.includes("promotional price") || message.includes("multiple presentations") || message.includes("live catalog");
          json(response, conflict ? 409 : invalidCampaign ? 400 : 500, {
            error: conflict
              ? error.message
              : invalidCampaign
                ? message
                : "Site Controls could not be saved to the independent control plane.",
          });
        }
        return;
      }

      if (url.pathname === "/api/commerce/product" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live catalog service is not connected" });
          return;
        }
        const productId = Number(url.searchParams.get("productId"));
        if (!Number.isSafeInteger(productId) || productId <= 0) {
          json(response, 400, { error: "A valid product id is required" });
          return;
        }
        try {
          const detailCache = productDetailCache.get(productId);
          if (detailCache && Date.now() - detailCache.updatedAt < 5 * 60_000) {
            json(response, 200, { ...detailCache.payload, cacheAgeSeconds: Math.floor((Date.now() - detailCache.updatedAt) / 1_000) });
            return;
          }
          const cachedProducts = commerceCache?.payload.products;
          const cachedProduct = Array.isArray(cachedProducts)
            ? cachedProducts.find((item) => item && typeof item === "object" && Number((item as Record<string, unknown>).id) === productId) as Record<string, unknown> | undefined
            : undefined;
          const product = cachedProduct || await commerce.getProduct(productId);
          const productType = (product as Record<string, unknown>).type;
          const variations = productType === "variable"
            ? await commerce.listProductVariations(productId)
            : [];
          const detailIds = [productId, ...variations.map((variation) => variation.id)];
          const [detailCosts, detailTestingCosts] = await Promise.all([
            store.getProductCosts(detailIds),
            customCoas?.currentTestingCosts(detailIds) ?? Promise.resolve<Record<string, CoaTestingCost>>({}),
          ]);
          const defaultCost = detailCosts[String(productId)] || null;
          const defaultTesting = detailTestingCosts[String(productId)] || null;
          const variationsWithProfit = variations.map((variation) => {
            const exactCost = detailCosts[String(variation.id)] || null;
            const variationCost = exactCost || defaultCost;
            const testing = detailTestingCosts[String(variation.id)] || defaultTesting;
            const profitability = variationCost
              ? calculateProductProfitability(variation.regularPrice || variation.price, {
                  ...variationCost,
                  testingCost: testing?.perUnit || 0,
                })
              : null;
            return {
              ...variation,
              cost: variationCost,
              costInherited: !exactCost && Boolean(defaultCost),
              testingCostPerUnit: testing?.perUnit || 0,
              testingCostTotal: testing?.total || 0,
              testingBatchUnitCount: testing?.batchUnits || 0,
              testingLot: testing?.lot || "",
              estimatedProfit: profitability?.estimatedProfit ?? null,
              margin: profitability?.margin ?? null,
            };
          });
          const detailPayload: Record<string, unknown> = {
            product: {
              ...product,
              testingCostPerUnit: defaultTesting?.perUnit || 0,
              testingCostTotal: defaultTesting?.total || 0,
              testingBatchUnitCount: defaultTesting?.batchUnits || 0,
              testingLot: defaultTesting?.lot || "",
            },
            variations: variationsWithProfit,
            cost: defaultCost,
            mode: config.wooCommerce.accessMode,
          };
          productDetailCache.set(productId, { payload: detailPayload, updatedAt: Date.now() });
          json(response, 200, detailPayload);
        } catch (error: unknown) {
          console.error("Product detail fetch failed", error);
          json(response, 502, { error: "The product details could not be loaded" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/product/sku-suggestion" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live catalog service is not connected" });
          return;
        }
        const name = (url.searchParams.get("name") || "").trim();
        const excludeProductId = Number(url.searchParams.get("excludeProductId"));
        if (!name || name.length > 200) {
          json(response, 400, { error: "Enter a product name to generate its SKU" });
          return;
        }
        try {
          const sku = await commerce.suggestAvailableProductSku(
            name,
            Number.isSafeInteger(excludeProductId) && excludeProductId > 0 ? [excludeProductId] : [],
          );
          json(response, 200, { sku, available: true });
        } catch (error: unknown) {
          console.error("Product SKU suggestion failed", error);
          json(response, 502, { error: "An available SKU could not be confirmed" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/product" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live catalog service is not connected" });
          return;
        }
        if (config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "This connection is read only" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const productId = input.productId === null || input.productId === undefined ? null : Number(input.productId);
        const visibility = typeof input.visibility === "string" ? input.visibility : "draft";
        const name = typeof input.name === "string" ? input.name.trim() : "";
        const regularPrice = Number(input.regularPrice);
        const stockQuantity = Number(input.stockQuantity);
        const categoryId = Number(input.categoryId || 0);
        if (
          (productId !== null && (!Number.isSafeInteger(productId) || productId <= 0)) ||
          !name || name.length > 200 || !["public", "hidden", "private", "draft"].includes(visibility) ||
          !Number.isFinite(regularPrice) || regularPrice < 0 || regularPrice > 1_000_000_000 ||
          !Number.isFinite(stockQuantity) || stockQuantity < 0 || stockQuantity > 1_000_000_000 ||
          !Number.isSafeInteger(categoryId) || categoryId <= 0
        ) {
          json(response, 400, { error: "The product values are invalid" });
          return;
        }
        const images: Array<{ id?: number; src?: string }> = [];
        for (const value of Array.isArray(input.images) ? input.images.slice(0, 12) : []) {
          if (!value || typeof value !== "object") continue;
          const image = value as Record<string, unknown>;
          const id = Number(image.id);
          const src = typeof image.src === "string" ? image.src : "";
          if (Number.isSafeInteger(id) && id > 0) images.push({ id });
          else if (src.startsWith("https://")) images.push({ src });
        }
        let variants = Array.isArray(input.variants) ? input.variants.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const variant = value as Record<string, unknown>;
          const option = typeof variant.option === "string" ? variant.option.trim() : "";
          const price = Number(variant.price);
          const unitCost = variant.unitCost === undefined ? null : Number(variant.unitCost);
          const stock = Number(variant.stock);
          if (
            !option || !Number.isFinite(price) || price < 0 ||
            (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) ||
            !Number.isFinite(stock) || stock < 0
          ) return [];
          const id = Number(variant.id);
          const imageId = Number(variant.imageId);
          return [{
            ...(Number.isSafeInteger(id) && id > 0 ? { id } : {}),
            option,
            sku: typeof variant.sku === "string" ? variant.sku.trim().slice(0, 100) : "",
            price,
            unitCost,
            stock,
            ...(Number.isSafeInteger(imageId) && imageId > 0 ? { imageId } : {}),
          }];
        }).slice(0, 100) : [];
        try {
          const automaticSku = productId === null;
          const sku = automaticSku
            ? await commerce.suggestAvailableProductSku(name)
            : typeof input.sku === "string" ? input.sku.trim().slice(0, 100) : "";
          if (automaticSku) {
            const generated = [];
            const reservedSkus = new Set<string>([sku.toLocaleUpperCase("en")]);
            for (const variant of variants) {
              const variantSku = await commerce.suggestAvailableProductSku(
                productVariantSku(sku, variant.option),
                [],
                [...reservedSkus],
              );
              reservedSkus.add(variantSku.toLocaleUpperCase("en"));
              generated.push({
                ...variant,
                sku: variantSku,
              });
            }
            variants = generated;
          }
          const write: CommerceProductWrite = {
            name,
            sku,
            regularPrice,
            stockQuantity,
            categoryId,
            visibility: visibility as CommerceProductWrite["visibility"],
            images,
            ...(typeof input.attributeName === "string"
              ? { attributeName: input.attributeName.trim().slice(0, 100) }
              : {}),
            variants,
          };
          const saved = await commerce.saveProduct(productId, write);
          let profitabilitySaved = true;
          try {
            const defaultCost = {
              unitCost: Math.max(0, Number(input.unitCost) || 0),
              packagingCost: Math.max(0, Number(input.packagingCost) || 0),
              feeRate: Math.min(100, Math.max(0, Number(input.feeRate) || 0)),
              affiliateRate: Math.min(100, Math.max(0, Number(input.affiliateRate) || 0)),
            };
            await store.setProductCost(saved.id, defaultCost);
            if (variants.length) {
              const savedVariations = await commerce.listProductVariations(saved.id);
              const normalizedOption = (value: string) => value.trim().toLocaleLowerCase("en");
              for (const variant of variants) {
                const savedVariation = savedVariations.find((item) => item.id === variant.id) ||
                  savedVariations.find((item) => item.attributes.some((attribute) =>
                    normalizedOption(attribute.option) === normalizedOption(variant.option)));
                if (!savedVariation) throw new Error(`Saved variant ${variant.option} could not be reconciled`);
                await store.setProductCost(savedVariation.id, {
                  ...defaultCost,
                  unitCost: variant.unitCost ?? defaultCost.unitCost,
                });
              }
            }
          } catch (costError: unknown) {
            profitabilitySaved = false;
            console.error("Product saved but profitability metadata could not be saved", costError);
          }
          productDetailCache.delete(saved.id);
          await invalidateCommerceCache();
          void refreshCommerce().catch((error: unknown) => console.error("Commerce refresh after product save failed", error));
          json(response, 200, {
            saved: true,
            product: saved,
            profitabilitySaved,
            ...(profitabilitySaved ? {} : { warning: "The product was saved, but its internal cost details need to be saved again." }),
          });
        } catch (error: unknown) {
          console.error("Product save failed", error);
          if (error instanceof CommerceServiceError && error.code === "product_invalid_sku") {
            const suggestedSku = typeof error.details.unique_sku === "string" ? error.details.unique_sku : "";
            const conflictingProductId = Number(error.details.resource_id);
            json(response, 409, {
              code: "duplicate_sku",
              error: suggestedSku
                ? `That SKU is already in use. Use the automatic suggestion ${suggestedSku}, or edit the existing product.`
                : "That SKU is already in use. Let the dashboard generate another one, or edit the existing product.",
              suggestedSku,
              conflictingProductId: Number.isSafeInteger(conflictingProductId) && conflictingProductId > 0
                ? conflictingProductId
                : null,
            });
          } else if (error instanceof CommerceServiceError && error.status >= 400 && error.status < 500) {
            json(response, 422, { code: error.code || "catalog_validation", error: error.serviceMessage });
          } else {
            json(response, 502, { error: "The catalog could not save this product. Try again in a moment." });
          }
        }
        return;
      }

      if (url.pathname === "/api/commerce/product" && request.method === "DELETE") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!canAdminister) {
          json(response, 403, { error: "Administrator access is required to remove products" });
          return;
        }
        if (!commerce || !config.wooCommerce || config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "A read/write store connection is required" });
          return;
        }
        const productId = Number(url.searchParams.get("productId"));
        if (!Number.isSafeInteger(productId) || productId <= 0) {
          json(response, 400, { error: "A valid product id is required" });
          return;
        }
        try {
          const removed = await commerce.trashProduct(productId);
          productDetailCache.delete(productId);
          await invalidateCommerceCache();
          void refreshCommerce().catch((error: unknown) => console.error("Commerce refresh after product removal failed", error));
          json(response, 200, { removed: true, recoverable: true, product: removed });
        } catch (error: unknown) {
          console.error("Product removal failed", error);
          json(response, 502, { error: "The product could not be moved to Trash" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/order" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live order service is not connected" });
          return;
        }
        const orderId = Number(url.searchParams.get("orderId"));
        if (!Number.isSafeInteger(orderId) || orderId <= 0) {
          json(response, 400, { error: "A valid order id is required" });
          return;
        }
        try {
          const detailCache = orderDetailCache.get(orderId);
          if (detailCache && Date.now() - detailCache.updatedAt < 30_000) {
            json(response, 200, { ...detailCache.payload, cacheAgeSeconds: Math.floor((Date.now() - detailCache.updatedAt) / 1_000) });
            return;
          }
          const [order, evidenceResult, coaResult, notesResult, affiliateCommission] = await Promise.all([
            commerce.getOrder(orderId),
            commerce.getOrderEvidence(orderId).catch((error: unknown) => {
              console.error("Order evidence fetch failed", error);
              return null;
            }),
            commerce.getOrderCoas(orderId).catch((error: unknown) => {
              console.error("Order COA fetch failed", error);
              return null;
            }),
            commerce.listOrderNotes(orderId).catch((error: unknown) => {
              console.error("Order notes fetch failed", error);
              return [];
            }),
            affiliates?.commissionForOrder(orderId).catch((error: unknown) => {
              console.error("Order affiliate attribution fetch failed", error);
              return null;
            }) ?? Promise.resolve(null),
          ]);
          const detailPayload: Record<string, unknown> = {
            order: await orderWithProfitability(order),
            mode: config.wooCommerce.accessMode,
            operations: {
              evidence: evidenceResult || { orderId, items: [], unavailable: true },
              coas: coaResult || { orderId, items: [], unavailable: true },
              notes: notesResult,
              affiliateCommission,
            },
          };
          orderDetailCache.set(orderId, { payload: detailPayload, updatedAt: Date.now() });
          json(response, 200, detailPayload);
        } catch (error: unknown) {
          console.error("Order detail fetch failed", error);
          json(response, 502, { error: "The order details could not be loaded" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/order-agreement" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live order service is not connected" });
          return;
        }
        const orderId = Number(url.searchParams.get("orderId"));
        if (!Number.isSafeInteger(orderId) || orderId <= 0) {
          json(response, 400, { error: "A valid order id is required" });
          return;
        }
        try {
          const agreement = await commerce.getAgreementPdf(orderId);
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/pdf");
          response.setHeader("Content-Disposition", `inline; filename="${agreement.fileName}"`);
          response.setHeader("Content-Length", String(agreement.body.byteLength));
          response.end(agreement.body);
        } catch (error: unknown) {
          console.error("Agreement download failed", error);
          json(response, 404, { error: "No signed agreement is available for this order" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/order-evidence" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!commerce || !config.wooCommerce || config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "A read/write store connection is required" });
          return;
        }
        const orderId = Number(url.searchParams.get("orderId"));
        const contentType = request.headers["content-type"] || "";
        if (!Number.isSafeInteger(orderId) || orderId <= 0 || !contentType.startsWith("multipart/form-data;")) {
          json(response, 400, { error: "A valid order and multipart evidence file are required" });
          return;
        }
        try {
          const body = await readBodyBuffer(request);
          const evidence = await commerce.uploadOrderEvidence(orderId, body, contentType);
          orderDetailCache.delete(orderId);
          json(response, 200, { saved: true, evidence });
        } catch (error: unknown) {
          console.error("Order evidence upload failed", error);
          json(response, 502, { error: error instanceof Error && error.message === "Request body too large" ? "Evidence files must be smaller than 20 MB" : "The evidence could not be uploaded" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/order-evidence-delete" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!commerce || !config.wooCommerce || config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "A read/write store connection is required" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const orderId = Number(input.orderId);
        const evidenceId = typeof input.evidenceId === "string" ? input.evidenceId : "";
        if (!Number.isSafeInteger(orderId) || orderId <= 0 || !/^[a-f0-9-]{36}$/i.test(evidenceId)) {
          json(response, 400, { error: "The evidence selection is invalid" });
          return;
        }
        try {
          const evidence = await commerce.deleteOrderEvidence(orderId, evidenceId);
          orderDetailCache.delete(orderId);
          json(response, 200, { saved: true, evidence });
        } catch (error: unknown) {
          console.error("Order evidence removal failed", error);
          json(response, 502, { error: "The evidence could not be removed" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/order-coa" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!commerce || !config.wooCommerce || config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "A read/write store connection is required" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const orderId = Number(input.orderId);
        const itemId = Number(input.itemId);
        const quantity = Number(input.quantity);
        const coaId = typeof input.coaId === "string" ? input.coaId.trim() : "";
        const assignmentId = typeof input.assignmentId === "string" ? input.assignmentId.trim() : "";
        const action = input.action === "remove" ? "remove" : "assign";
        if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isSafeInteger(itemId) || itemId <= 0 ||
          (action === "assign" && (!coaId || !Number.isSafeInteger(quantity) || quantity <= 0)) ||
          (action === "remove" && !assignmentId)) {
          json(response, 400, { error: "The COA assignment is invalid" });
          return;
        }
        try {
          const coas = action === "remove"
            ? await commerce.removeOrderCoa(orderId, itemId, assignmentId)
            : await commerce.assignOrderCoa(orderId, itemId, coaId, quantity);
          orderDetailCache.delete(orderId);
          json(response, 200, { saved: true, coas });
        } catch (error: unknown) {
          console.error("Order COA update failed", error);
          json(response, 502, { error: "The COA assignment could not be updated" });
        }
        return;
      }

      if (url.pathname === "/api/inventory-operations" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live inventory service is not connected" });
          return;
        }
        const products = Array.isArray(commerceCache?.payload.products) ? commerceCache?.payload.products : [];
        let bridgeAvailable = true;
        const restocks = await commerce.listRestocks().catch((error: unknown) => {
          bridgeAvailable = false;
          console.error("Restock program fetch failed", error);
          return [];
        });
        const waitlistProductIds = [...new Set([
          ...restocks.map((item) => item.productId),
          ...products.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const product = item as Record<string, unknown>;
            return product.stockStatus === "outofstock" ? [Number(product.id)] : [];
          }),
        ].filter((value) => Number.isSafeInteger(value) && value > 0))].slice(0, 50);
        const waitlistEntries = await Promise.all(waitlistProductIds.map(async (productId) => {
          try {
            return [String(productId), (await commerce.listWaitlistSubscribers(productId)).length] as const;
          } catch (error: unknown) {
            bridgeAvailable = false;
            console.error(`Waitlist count fetch failed for product ${productId}`, error);
            return [String(productId), null] as const;
          }
        }));
        const waitlistCounts = Object.fromEntries(waitlistEntries);
        json(response, 200, {
          restocks: restocks.map((item) => ({
            ...item,
            waitlistCount: waitlistCounts[String(item.productId)] ?? item.waitlistCount,
          })),
          products,
          waitlistCounts,
          bridgeAvailable,
          syncedAt: new Date().toISOString(),
        });
        return;
      }

      if (url.pathname === "/api/inventory-operations/waitlist" && request.method === "GET") {
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live waitlist service is not connected" });
          return;
        }
        const productId = Number(url.searchParams.get("productId") || 0);
        if (!Number.isSafeInteger(productId) || productId <= 0) {
          json(response, 400, { error: "A valid product is required" });
          return;
        }
        try {
          const [subscribers, bridge] = await Promise.all([
            commerce.listWaitlistSubscribers(productId),
            commerce.getOperationsBridgeStatus().catch(() => null),
          ]);
          json(response, 200, {
            productId,
            subscribers,
            complete: Boolean(bridge?.capabilities.includes("waitlist_subscribers")),
            bridgeVersion: bridge?.version || null,
            syncedAt: new Date().toISOString(),
          });
        } catch (error: unknown) {
          console.error("Waitlist subscriber fetch failed", error);
          json(response, 502, { error: "The product subscribers could not be loaded" });
        }
        return;
      }

      if (url.pathname === "/api/inventory-operations/notify" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!commerce || !config.wooCommerce || config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "A read/write store connection is required" });
          return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await readBody(request)); } catch { json(response, 400, { error: "Invalid JSON request" }); return; }
        const productId = Number(payload && typeof payload === "object" ? (payload as Record<string, unknown>).productId : 0);
        if (!Number.isSafeInteger(productId) || productId <= 0) {
          json(response, 400, { error: "A valid product is required" });
          return;
        }
        try {
          await commerce.notifyWaitlist(productId);
          json(response, 200, { sent: true, productId });
        } catch (error: unknown) {
          console.error("Waitlist notification failed", error);
          json(response, 502, { error: "The eligible waitlist could not be notified" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/order-action" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live order service is not connected" });
          return;
        }
        if (config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "This connection is read only" });
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(await readBody(request));
        } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        const orderId = Number(input.orderId);
        const action = typeof input.action === "string" ? input.action : "";
        const targetStatus = {
          confirm: "processing",
          complete: "completed",
          cancel: "cancelled",
        }[action] as "processing" | "completed" | "cancelled" | undefined;
        if (!Number.isSafeInteger(orderId) || orderId <= 0 || !targetStatus) {
          json(response, 400, { error: "The order action is invalid" });
          return;
        }
        try {
          const current = await commerce.getOrder(orderId);
          const allowed: Record<string, string[]> = {
            confirm: ["pending", "on-hold", "failed"],
            complete: ["processing", "on-hold"],
            cancel: ["pending", "on-hold", "processing", "failed"],
          };
          if (!allowed[action]?.includes(current.status)) {
            json(response, 409, {
              error: `Order #${current.number} cannot be changed from ${current.status}`,
            });
            return;
          }
          const updated = action === "confirm"
            ? await commerce.approveOrderPayment(orderId)
            : await commerce.updateOrderStatus(orderId, targetStatus);
          const profitableOrder = await orderWithProfitability(updated);
          updateCachedOrder(profitableOrder);
          markCustomersStale();
          json(response, 200, {
            saved: true,
            order: profitableOrder,
          });
        } catch (error: unknown) {
          console.error("Order status update failed", error);
          json(response, 502, { error: "The order status could not be updated" });
        }
        return;
      }

      if (url.pathname === "/api/commerce/order-refund" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origin not allowed" });
          return;
        }
        if (!commerce || !config.wooCommerce) {
          json(response, 503, { error: "The live order service is not connected" });
          return;
        }
        if (config.wooCommerce.accessMode !== "read_write") {
          json(response, 403, { error: "This connection is read only" });
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(await readBody(request));
        } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        const orderId = Number(input.orderId);
        const amount = Number(input.amount);
        const reason = typeof input.reason === "string" ? input.reason.trim() : "";
        if (
          !Number.isSafeInteger(orderId) || orderId <= 0 ||
          !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 ||
          reason.length > 160
        ) {
          json(response, 400, { error: "The refund values are invalid" });
          return;
        }
        try {
          const current = await commerce.getOrder(orderId);
          if (!["processing", "completed"].includes(current.status)) {
            json(response, 409, { error: "Only paid orders can be refunded" });
            return;
          }
          const roundedAmount = Math.round(amount * 100) / 100;
          if (roundedAmount > current.refundableTotal + 0.001) {
            json(response, 409, {
              error: `The refundable balance is ${current.refundableTotal.toFixed(2)} ${current.currency}`,
            });
            return;
          }
          await commerce.createRefund(orderId, roundedAmount, reason || "Refund issued from operations");
          const updated = await commerce.getOrder(orderId);
          const profitableOrder = await orderWithProfitability(updated);
          updateCachedOrder(profitableOrder);
          markCustomersStale();
          json(response, 200, {
            saved: true,
            order: profitableOrder,
          });
        } catch (error: unknown) {
          console.error("Order refund failed", error);
          json(response, 502, { error: "The refund could not be completed" });
        }
        return;
      }

      if (url.pathname === "/api/product-cost" && request.method === "POST") {
        if (!isLoginOriginAllowed(request, config)) {
          json(response, 403, { error: "Origen no permitido" });
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(await readBody(request));
        } catch {
          json(response, 400, { error: "Invalid JSON request" });
          return;
        }
        const input = payload && typeof payload === "object"
          ? payload as Record<string, unknown>
          : {};
        const productId = Number(input.productId);
        const unitCost = Number(input.unitCost);
        const packagingCost = Number(input.packagingCost);
        const feeRate = Number(input.feeRate);
        const affiliateRate = input.affiliateRate === undefined ? 0 : Number(input.affiliateRate);
        const validMoney = (value: number) =>
          Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;
        if (
          !Number.isSafeInteger(productId) || productId <= 0 ||
          !validMoney(unitCost) || !validMoney(packagingCost) ||
          !Number.isFinite(feeRate) || feeRate < 0 || feeRate > 100 ||
          !Number.isFinite(affiliateRate) || affiliateRate < 0 || affiliateRate > 100
        ) {
          json(response, 400, { error: "The profitability values are invalid" });
          return;
        }
        await store.setProductCost(productId, { unitCost, packagingCost, feeRate, affiliateRate });
        await invalidateCommerceCache();
        json(response, 200, {
          saved: true,
          productId,
          cost: { unitCost, packagingCost, feeRate, affiliateRate },
        });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.statusCode = 405;
        response.setHeader("Allow", "GET, HEAD");
        response.end();
        return;
      }

      const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const filePath = resolve(dashboardDirectory, relativePath);
      const safeRoot = resolve(dashboardDirectory) + sep;
      if (!filePath.startsWith(safeRoot) || !existsSync(filePath)) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      response.setHeader(
        "Content-Type",
        CONTENT_TYPES[extname(filePath)] || "application/octet-stream",
      );
      const etag = `W/\"${fileStats.size}-${Math.trunc(fileStats.mtimeMs)}\"`;
      response.setHeader("ETag", etag);
      response.setHeader("Last-Modified", fileStats.mtime.toUTCString());
      response.setHeader("Content-Length", String(fileStats.size));
      response.setHeader(
        "Cache-Control",
        relativePath.startsWith("assets/")
          ? "public, max-age=31536000, immutable"
          : relativePath === "index.html"
            ? "private, no-cache"
            : "public, max-age=86400",
      );
      if (request.headers["if-none-match"] === etag) {
        response.statusCode = 304;
        response.end();
        return;
      }
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const compressible = [".css", ".html", ".js", ".json", ".map", ".svg"].includes(extname(filePath));
      if (compressible && fileStats.size >= 1_024 && String(request.headers["accept-encoding"] || "").includes("gzip")) {
        response.removeHeader("Content-Length");
        response.setHeader("Content-Encoding", "gzip");
        response.setHeader("Vary", "Accept-Encoding");
        createReadStream(filePath).pipe(createGzip({ level: 6 })).pipe(response);
        return;
      }
      createReadStream(filePath).pipe(response);
    })().catch((error: unknown) => {
      console.error("HTTP request failed", error);
      if (!response.headersSent) {
        securityHeaders(response, undefined, trustedImageOrigins);
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      response.end("Internal server error");
    });
  });
}
