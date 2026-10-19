import assert from "node:assert/strict";
import test from "node:test";

import { fulfillmentAccessForRole } from "../src/server/fulfillmentAccess.js";

test("owners and administrators can manage locations and print labels", () => {
  for (const role of ["owner", "administrator"] as const) {
    assert.deepEqual(fulfillmentAccessForRole(role), {
      read: true,
      operateQueue: true,
      printLabels: true,
      manageLocations: true,
    });
  }
});

test("operations can print but analysts remain read only", () => {
  assert.deepEqual(fulfillmentAccessForRole("operations"), {
    read: true,
    operateQueue: true,
    printLabels: true,
    manageLocations: false,
  });
  assert.deepEqual(fulfillmentAccessForRole("analyst"), {
    read: true,
    operateQueue: false,
    printLabels: false,
    manageLocations: false,
  });
});
