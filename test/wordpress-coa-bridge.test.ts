import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridgeSource = readFileSync(
  new URL("../wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php", import.meta.url),
  "utf8",
);

test("WordPress COA bridge requires and forwards physical packing confirmation", () => {
  assert.match(
    bridgeSource,
    /filter_var\(\$input\['confirmed'\]\s*\?\?\s*false,\s*FILTER_VALIDATE_BOOLEAN\)/,
  );
  assert.match(
    bridgeSource,
    /\['coa_id'\s*=>\s*\$coa_id,\s*'quantity'\s*=>\s*\$quantity,\s*'confirmed'\s*=>\s*true\]/,
  );
  assert.match(bridgeSource, /phaseone_coa_confirmation_required/);
});

test("verified fulfillment scans bypass legacy COA mapping and preserve the customer snapshot", () => {
  assert.match(bridgeSource, /verified_scan/);
  assert.match(bridgeSource, /assign_verified_fulfillment_coa/);
  assert.match(bridgeSource, /_phaseone_fulfillment_coas/);
  assert.match(bridgeSource, /fulfillment_verified_scan/);
  assert.match(bridgeSource, /phaseone_verified_scan_mismatch/);
});
