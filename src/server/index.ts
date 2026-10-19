import { loadConfig } from "./config.js";
import { createMonitorServer } from "./httpServer.js";
import { PresenceStore } from "./presenceStore.js";
import { SocketHub } from "./socketHub.js";
import { WooOrderSync } from "./wooOrderSync.js";
import { UpstreamMonitorClient } from "./upstreamMonitorClient.js";
import { importCommerceSiteControls } from "./siteControls.js";
import { WooCommerceGateway } from "./wooCommerceGateway.js";
import { Database } from "./database.js";
import { migrateDatabase } from "./databaseMigrations.js";
import { BarcodeLabelService } from "./barcodeLabels.js";
import { AffiliateRepository } from "./affiliateRepository.js";
import { AffiliateShadowSync } from "./affiliateShadowSync.js";
import { ShipStationGateway } from "./shipStationGateway.js";

const config = loadConfig();
const fulfillmentDatabase = config.fulfillmentDatabase
  ? new Database(config.fulfillmentDatabase)
  : undefined;
if (fulfillmentDatabase) {
  const migrationsApplied = await migrateDatabase(fulfillmentDatabase);
  console.log(migrationsApplied
    ? `Applied ${migrationsApplied} PostgreSQL migration${migrationsApplied === 1 ? "" : "s"}`
    : "PostgreSQL schema is current");
}
const barcodeLabels = config.barcodeSigningSecret
  ? new BarcodeLabelService(config.barcodeSigningSecret)
  : undefined;
const shipStationGateway = new ShipStationGateway(config.shipStation);
const store = new PresenceStore(
  config.redisUrl,
  config.redisKeyPrefix,
  config.presenceTtlMs,
  config.analyticsTimeZone,
);
const server = createMonitorServer(config, store, {
  ...(fulfillmentDatabase ? { fulfillmentDatabase } : {}),
  ...(barcodeLabels ? { barcodeLabels } : {}),
  shipStationGateway,
});
const hub = new SocketHub(config, store);
const upstreamMonitor = config.upstreamMonitor
  ? new UpstreamMonitorClient(config.upstreamMonitor, (snapshot) => {
      hub.publishUpstreamSnapshot(snapshot);
      void store.setUpstreamSnapshot(snapshot).catch((error: unknown) => {
        console.warn("Could not persist the upstream visitor snapshot", error);
      });
    })
  : undefined;
const orderSync = config.wooCommerce
  ? new WooOrderSync(
      {
        ...config.wooCommerce,
        analyticsHmacSecret: config.analyticsHmacSecret,
      },
      store,
    )
  : undefined;
const affiliateShadowSync = config.wooCommerce && fulfillmentDatabase
  ? new AffiliateShadowSync(
      config.wooCommerce,
      new AffiliateRepository(fulfillmentDatabase),
    )
  : undefined;
if (!orderSync) {
  console.warn(
    "Woo order reconciliation is disabled; configure the WOOCOMMERCE_* variables",
  );
}

void shipStationGateway.capabilities()
  .then((capabilities) => {
    const carriers = capabilities.carriers.map((carrier) => ({
      code: carrier.code,
      name: carrier.name,
      services: carrier.services.map((service) => service.name),
    }));
    console.log("ShipStation connection check", JSON.stringify({
      credentialConfigured: capabilities.credentialConfigured,
      connected: capabilities.connected,
      rateMode: capabilities.dataMode,
      rateShoppingAvailable: capabilities.rateShoppingAvailable,
      labelPurchaseMode: capabilities.labelPurchaseMode,
      originConfigured: Boolean(capabilities.originName),
      carriers,
      ...(capabilities.error ? { error: capabilities.error } : {}),
    }));
  })
  .catch((error: unknown) => {
    console.warn(
      "ShipStation connection check failed safely",
      error instanceof Error ? error.message : "Unknown validation error",
    );
  });

if (fulfillmentDatabase) {
  void fulfillmentDatabase.ping()
    .then(() => console.log("Barcode Fulfillment database connection is ready"))
    .catch((error: unknown) => {
      console.warn("Barcode Fulfillment database is configured but unavailable", error);
    });
} else {
  console.warn(
    "Barcode Fulfillment persistence is disabled; configure DATABASE_URL after Phase 1 migration approval",
  );
}

await store.connect(() => hub.scheduleSnapshot());
if (config.upstreamMonitor) {
  const cachedSnapshot = await store.getUpstreamSnapshot().catch(() => null);
  if (cachedSnapshot) hub.publishUpstreamSnapshot(cachedSnapshot);
}
await store.ensureBootstrapAdmin(config.monitorUsername, config.monitorPasswordHash);
if (config.monitorPasswordResetHash) {
  const passwordWasReset = await store.applyBootstrapPasswordResetOnce(
    config.monitorUsername,
    config.monitorPasswordResetHash,
  );
  console.log(passwordWasReset
    ? "One-time administrator password recovery applied; previous sessions were invalidated"
    : "One-time administrator password recovery was already applied");
}
if (config.wooCommerce) {
  void (async () => {
    if (await store.getIndependentSiteControls()) return;
    const imported = await new WooCommerceGateway(config.wooCommerce!).getSiteControls();
    await store.seedIndependentSiteControls(importCommerceSiteControls(imported));
    console.log("Independent Site Controls imported from the existing storefront configuration");
  })().catch((error: unknown) => {
    console.warn(
      "Independent Site Controls started with safe defaults; the WordPress bootstrap was unavailable",
      error,
    );
  });
}
hub.attach(server);
upstreamMonitor?.start();
orderSync?.start();
affiliateShadowSync?.start();

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Phase One Live Monitor listening on port ${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);
  server.close();
  await upstreamMonitor?.close();
  await orderSync?.close();
  await affiliateShadowSync?.close();
  await fulfillmentDatabase?.close();
  await hub.close();
  await store.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
