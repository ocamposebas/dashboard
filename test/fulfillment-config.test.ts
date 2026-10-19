import assert from "node:assert/strict";
import test from "node:test";

import {
  loadBarcodeSigningSecret,
  loadEvidenceStorageConfig,
  loadFulfillmentDatabaseConfig,
  loadShipStationConfig,
} from "../src/server/config.js";

const managedKeys = [
  "DATABASE_URL",
  "DATABASE_SSL",
  "DATABASE_POOL_MAX",
  "DATABASE_CONNECTION_TIMEOUT_MS",
  "DATABASE_IDLE_TIMEOUT_MS",
  "BARCODE_SIGNING_SECRET",
  "SHIPSTATION_API_KEY",
  "SHIPSTATION_RATE_MODE",
  "SHIPSTATION_WAREHOUSE_ID",
  "SHIPSTATION_LABEL_PURCHASE_ENABLED",
  "EVIDENCE_STORAGE_PATH",
  "EVIDENCE_ENCRYPTION_SECRET",
  "EVIDENCE_NOTIFICATION_MODE",
] as const;

function withDatabaseEnvironment(
  values: Partial<Record<(typeof managedKeys)[number], string>>,
  operation: () => void,
): void {
  const previous = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of managedKeys) delete process.env[key];
    Object.assign(process.env, values);
    operation();
  } finally {
    for (const key of managedKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("fulfillment database remains optional until the module is enabled", () => {
  withDatabaseEnvironment({}, () => {
    assert.equal(loadFulfillmentDatabaseConfig(), undefined);
  });
});

test("fulfillment database configuration validates and applies bounded defaults", () => {
  withDatabaseEnvironment({
    DATABASE_URL: "postgresql://phaseone:test@localhost:5432/phaseone_fulfillment_test",
    DATABASE_SSL: "true",
    DATABASE_POOL_MAX: "3",
  }, () => {
    assert.deepEqual(loadFulfillmentDatabaseConfig(), {
      connectionString: "postgresql://phaseone:test@localhost:5432/phaseone_fulfillment_test",
      ssl: true,
      maxConnections: 3,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 30_000,
    });
  });
});

test("fulfillment database configuration rejects unsafe or malformed values", () => {
  withDatabaseEnvironment({ DATABASE_URL: "https://example.com/not-postgres" }, () => {
    assert.throws(() => loadFulfillmentDatabaseConfig(), /postgres or postgresql/);
  });
  withDatabaseEnvironment({
    DATABASE_URL: "postgresql://localhost/phaseone_fulfillment_test",
    DATABASE_SSL: "sometimes",
  }, () => {
    assert.throws(() => loadFulfillmentDatabaseConfig(), /DATABASE_SSL/);
  });
  withDatabaseEnvironment({
    DATABASE_URL: "postgresql://localhost/phaseone_fulfillment_test",
    DATABASE_POOL_MAX: "0",
  }, () => {
    assert.throws(() => loadFulfillmentDatabaseConfig(), /positive integer/);
  });
});

test("barcode signing secret is optional but must be strong when configured", () => {
  withDatabaseEnvironment({}, () => {
    assert.equal(loadBarcodeSigningSecret(), undefined);
  });
  withDatabaseEnvironment({ BARCODE_SIGNING_SECRET: "too-short" }, () => {
    assert.throws(() => loadBarcodeSigningSecret(), /at least 32 characters/);
  });
  withDatabaseEnvironment({
    BARCODE_SIGNING_SECRET: "stable-test-barcode-secret-with-32-chars",
  }, () => {
    assert.equal(
      loadBarcodeSigningSecret(),
      "stable-test-barcode-secret-with-32-chars",
    );
  });
});

test("packaging evidence storage is optional and requires a stable private secret", () => {
  withDatabaseEnvironment({}, () => {
    assert.equal(loadEvidenceStorageConfig(), undefined);
  });
  withDatabaseEnvironment({ EVIDENCE_STORAGE_PATH: "/private/evidence" }, () => {
    assert.throws(() => loadEvidenceStorageConfig(), /must be set together/);
  });
  withDatabaseEnvironment({
    EVIDENCE_STORAGE_PATH: "/private/evidence",
    EVIDENCE_ENCRYPTION_SECRET: "short",
  }, () => {
    assert.throws(() => loadEvidenceStorageConfig(), /at least 32 characters/);
  });
  withDatabaseEnvironment({
    EVIDENCE_STORAGE_PATH: "/private/evidence",
    EVIDENCE_ENCRYPTION_SECRET: "stable-test-evidence-secret-with-32-characters",
    EVIDENCE_NOTIFICATION_MODE: "disabled",
  }, () => {
    assert.deepEqual(loadEvidenceStorageConfig(), {
      path: "/private/evidence",
      encryptionSecret: "stable-test-evidence-secret-with-32-characters",
      notificationMode: "disabled",
    });
  });
});

test("ShipStation credentials stay optional and use an explicit safe data mode", () => {
  withDatabaseEnvironment({}, () => {
    assert.deepEqual(loadShipStationConfig(), { rateMode: "live", labelPurchaseEnabled: false });
  });
  withDatabaseEnvironment({
    SHIPSTATION_API_KEY: "server-only-key",
    SHIPSTATION_RATE_MODE: "live",
    SHIPSTATION_WAREHOUSE_ID: "se-main-origin",
    SHIPSTATION_LABEL_PURCHASE_ENABLED: "false",
  }, () => {
    assert.deepEqual(loadShipStationConfig(), {
      apiKey: "server-only-key",
      rateMode: "live",
      warehouseId: "se-main-origin",
      labelPurchaseEnabled: false,
    });
  });
  withDatabaseEnvironment({ SHIPSTATION_RATE_MODE: "purchase" }, () => {
    assert.throws(() => loadShipStationConfig(), /live or mock/);
  });
  withDatabaseEnvironment({ SHIPSTATION_LABEL_PURCHASE_ENABLED: "yes" }, () => {
    assert.throws(() => loadShipStationConfig(), /must be true or false/);
  });
});
