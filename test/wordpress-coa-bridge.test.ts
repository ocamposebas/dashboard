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
