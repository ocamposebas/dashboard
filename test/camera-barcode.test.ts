import assert from "node:assert/strict";
import test from "node:test";

import { cameraBarcodeCandidate } from "../src/shared/cameraBarcode.js";

test("camera accepts a registered-shape Code 128 value", () => {
  assert.deepEqual(cameraBarcodeCandidate(" 13123456789012345678\n", "CODE_128"), {
    accepted: true,
    value: "13123456789012345678",
    reason: "accepted",
  });
});

test("camera accepts external COA verification URLs encoded as QR", () => {
  for (const value of [
    "https://coas.freedomdiagnosticstesting.com/Phas2610130018.pdf",
    "https://portal.ils-lab.com/verify/OvcWN_fh0ANZIlJe",
    "http://portal.ils-lab.com/verify/MkH533f-jOUYkKsp",
    "https://koveralabs.com/#/verify?t=50b6901a3b56c532f05f2c1a",
  ]) {
    assert.deepEqual(cameraBarcodeCandidate(value, "QR_CODE"), {
      accepted: true,
      value,
      reason: "accepted",
    });
  }
});

test("camera rejects non-link QR payloads before server submission", () => {
  assert.deepEqual(cameraBarcodeCandidate("just-some-text", "QR_CODE"), {
    accepted: false,
    value: null,
    reason: "invalid_value",
  });
  assert.deepEqual(cameraBarcodeCandidate("https://user:secret@example.com/coa", "QR_CODE"), {
    accepted: false,
    value: null,
    reason: "invalid_value",
  });
});

test("camera rejects malformed Code 128 values before server submission", () => {
  for (const value of ["", "131234", "1312345678901234567X", "131234567890123456789"]) {
    assert.deepEqual(cameraBarcodeCandidate(value, "CODE_128"), {
      accepted: false,
      value: null,
      reason: "invalid_value",
    });
  }
});
