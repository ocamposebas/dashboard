import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the dashboard runtime image excludes npm build tooling", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(dockerfile, /FROM node:22-alpine AS build/);
  assert.match(dockerfile, /FROM node:22-alpine AS runtime/);
  assert.match(dockerfile, /apk upgrade --no-cache/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /rm -rf[^\n]*\/usr\/local\/lib\/node_modules\/npm/);
});
