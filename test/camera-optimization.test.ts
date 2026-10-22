import assert from "node:assert/strict";
import test from "node:test";

import {
  cameraOptimizationLabel,
  cameraOptimizationPlan,
} from "../src/shared/cameraOptimization.js";

test("camera optimization enables continuous focus and a useful vial close-up", () => {
  assert.deepEqual(
    cameraOptimizationPlan({ focusMode: ["manual", "continuous"], zoom: { min: 1, max: 8, step: 0.1 } }),
    { focusMode: "continuous", zoom: 2 },
  );
});

test("camera optimization clamps zoom to the phone capability", () => {
  assert.deepEqual(cameraOptimizationPlan({ zoom: { min: 1, max: 1.5, step: 0.1 } }), { zoom: 1.5 });
  assert.deepEqual(cameraOptimizationPlan({ zoom: { min: 2.5, max: 6, step: 0.5 } }), { zoom: 2.5 });
});

test("camera optimization never invents unsupported controls", () => {
  assert.deepEqual(cameraOptimizationPlan({ focusMode: ["manual"] }), {});
  assert.deepEqual(cameraOptimizationPlan({ zoom: { min: 1, max: 1 } }), {});
});

test("camera optimization label explains active automatic assistance", () => {
  assert.equal(
    cameraOptimizationLabel({ focusMode: "continuous", zoom: 2 }),
    "continuous focus · 2x close-up",
  );
  assert.equal(cameraOptimizationLabel({}), "");
});
