import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardRoot = new URL("../src/dashboard/", import.meta.url);

function pngDimensions(fileName: string): { width: number; height: number } {
  const bytes = readFileSync(new URL(fileName, dashboardRoot));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("PWA manifest exposes square branded any and maskable icons", () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.webmanifest", dashboardRoot), "utf8")) as {
    icons: Array<{ src: string; sizes: string; purpose: string }>;
  };
  assert.deepEqual(manifest.icons.map(({ sizes, purpose }) => ({ sizes, purpose })), [
    { sizes: "192x192", purpose: "any" },
    { sizes: "512x512", purpose: "any" },
    { sizes: "512x512", purpose: "maskable" },
  ]);
  for (const icon of manifest.icons) {
    const dimensions = pngDimensions(icon.src.split("/").at(-1)!);
    assert.equal(`${dimensions.width}x${dimensions.height}`, icon.sizes);
  }
});

test("Apple home-screen icon uses the required square dimensions", () => {
  assert.deepEqual(pngDimensions("phase-one-ops-apple-180-v1.png"), { width: 180, height: 180 });
});
