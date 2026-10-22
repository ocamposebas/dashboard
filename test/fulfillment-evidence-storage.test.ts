import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";

import {
  FulfillmentEvidenceStorage,
  FulfillmentEvidenceStorageError,
} from "../src/server/fulfillmentEvidenceStorage.js";

const secret = "test-only-evidence-secret-with-more-than-32-characters";

test("evidence storage encrypts bytes at rest and restores the exact photo", async () => {
  const root = await mkdtemp(join(tmpdir(), "phaseone-evidence-"));
  try {
    const storage = new FulfillmentEvidenceStorage(root, secret);
    const photo = Buffer.from([0xff, 0xd8, 0xff, ...Buffer.from("private-photo-payload"), 0xff, 0xd9]);
    const key = await storage.save("7faee5df-2afc-4e7e-87ac-2b5e044629ae", photo, new Date("2026-10-17T12:00:00Z"));
    const encrypted = await readFile(join(root, ...key.split("/")));
    assert.equal(encrypted.includes(Buffer.from("private-photo-payload")), false);
    assert.deepEqual(await storage.read(key), photo);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence storage prepares a missing private directory and verifies it is writable", async () => {
  const root = await mkdtemp(join(tmpdir(), "phaseone-evidence-parent-"));
  const nested = join(root, "private", "evidence");
  try {
    const storage = new FulfillmentEvidenceStorage(nested, secret);
    await storage.ensureReady();
    const key = await storage.save(
      "8f934ca7-14d1-4f1f-a654-aa9ae28ca522",
      Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd9]),
      new Date("2026-10-21T12:00:00Z"),
    );
    assert.deepEqual(await storage.read(key), Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd9]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence storage reports an unavailable vault before accepting a photo", async () => {
  const root = await mkdtemp(join(tmpdir(), "phaseone-evidence-blocked-"));
  const blocked = join(root, "not-a-directory");
  try {
    await mkdir(root, { recursive: true });
    await writeFile(blocked, "occupied");
    const storage = new FulfillmentEvidenceStorage(blocked, secret);
    await assert.rejects(
      storage.ensureReady(),
      (error: unknown) => error instanceof FulfillmentEvidenceStorageError && error.code === "unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence storage rejects tampered ciphertext and the wrong secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "phaseone-evidence-"));
  try {
    const storage = new FulfillmentEvidenceStorage(root, secret);
    const key = await storage.save(
      "4c70f8a2-f20f-4d14-bd15-6bb09c1a5f43",
      Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]),
      new Date("2026-10-17T12:00:00Z"),
    );
    const target = join(root, ...key.split("/"));
    const payload = await readFile(target);
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0xff;
    await writeFile(target, payload);
    await assert.rejects(
      storage.read(key),
      (error: unknown) => error instanceof FulfillmentEvidenceStorageError && error.code === "integrity_failed",
    );

    const second = new FulfillmentEvidenceStorage(root, `${secret}-different`);
    await assert.rejects(
      second.read(key),
      (error: unknown) => error instanceof FulfillmentEvidenceStorageError && error.code === "integrity_failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evidence storage rejects unsafe storage keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "phaseone-evidence-"));
  try {
    const storage = new FulfillmentEvidenceStorage(root, secret);
    await assert.rejects(
      storage.read("../../outside.p1ev"),
      (error: unknown) => error instanceof FulfillmentEvidenceStorageError && error.code === "invalid_input",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

