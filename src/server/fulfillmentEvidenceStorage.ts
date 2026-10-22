import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const MAGIC = Buffer.from("P1EV1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class FulfillmentEvidenceStorageError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "not_found" | "integrity_failed" | "unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FulfillmentEvidenceStorageError";
  }
}

function unavailable(error: unknown): FulfillmentEvidenceStorageError {
  return new FulfillmentEvidenceStorageError(
    "Private packaging-evidence storage is temporarily unavailable. No photo was saved.",
    "unavailable",
    { cause: error },
  );
}

function storagePath(root: string, key: string): string {
  if (!/^[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.p1ev$/i.test(key)) {
    throw new FulfillmentEvidenceStorageError("The evidence storage key is invalid", "invalid_input");
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, key);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${sep}`)) {
    throw new FulfillmentEvidenceStorageError("The evidence storage path is invalid", "invalid_input");
  }
  return target;
}

export class FulfillmentEvidenceStorage {
  private readonly key: Buffer;
  private readonly root: string;

  constructor(root: string, secret: string) {
    if (!root.trim()) throw new FulfillmentEvidenceStorageError("Evidence storage path is required", "invalid_input");
    if (secret.trim().length < 32) {
      throw new FulfillmentEvidenceStorageError("Evidence encryption secret must contain at least 32 characters", "invalid_input");
    }
    this.root = resolve(root);
    this.key = createHash("sha256").update(secret, "utf8").digest();
  }

  async ensureReady(): Promise<void> {
    const probe = resolve(this.root, `.phaseone-write-probe-${randomUUID()}`);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await writeFile(probe, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (error: unknown) {
      throw unavailable(error);
    } finally {
      await rm(probe, { force: true }).catch(() => undefined);
    }
  }

  async save(id: string, plaintext: Buffer, now = new Date()): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(id) || plaintext.byteLength === 0) {
      throw new FulfillmentEvidenceStorageError("Evidence file input is invalid", "invalid_input");
    }
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.p1ev`;
    const target = storagePath(this.root, key);
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(MAGIC);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      await writeFile(target, Buffer.concat([MAGIC, iv, tag, encrypted]), { mode: 0o600, flag: "wx" });
    } catch (error: unknown) {
      throw unavailable(error);
    }
    return key;
  }

  async read(key: string): Promise<Buffer> {
    let payload: Buffer;
    try {
      payload = await readFile(storagePath(this.root, key));
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new FulfillmentEvidenceStorageError("The evidence file was not found", "not_found");
      }
      throw error;
    }
    if (payload.byteLength <= MAGIC.byteLength + IV_BYTES + TAG_BYTES || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new FulfillmentEvidenceStorageError("The evidence file failed its integrity check", "integrity_failed");
    }
    const ivStart = MAGIC.length;
    const tagStart = ivStart + IV_BYTES;
    const dataStart = tagStart + TAG_BYTES;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, payload.subarray(ivStart, tagStart));
      decipher.setAAD(MAGIC);
      decipher.setAuthTag(payload.subarray(tagStart, dataStart));
      return Buffer.concat([decipher.update(payload.subarray(dataStart)), decipher.final()]);
    } catch {
      throw new FulfillmentEvidenceStorageError("The evidence file failed its integrity check", "integrity_failed");
    }
  }

  async discard(key: string): Promise<void> {
    await rm(storagePath(this.root, key), { force: true });
  }
}

