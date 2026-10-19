import { createHash, randomUUID } from "node:crypto";

import type { FulfillmentEvidenceKind } from "../shared/fulfillmentEvidence.js";
import { FulfillmentEvidenceRepository } from "./fulfillmentEvidenceRepository.js";
import { FulfillmentEvidenceStorage } from "./fulfillmentEvidenceStorage.js";

const MAX_FILE_BYTES = 12 * 1024 * 1024;

export class FulfillmentEvidenceServiceError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "integrity_failed",
  ) {
    super(message);
    this.name = "FulfillmentEvidenceServiceError";
  }
}

function supportedMime(mimeInput: string): "image/jpeg" | "image/png" | "image/webp" {
  const mime = mimeInput.split(";")[0]!.trim().toLowerCase();
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return mime;
  throw new FulfillmentEvidenceServiceError("Use a JPEG, PNG or WebP evidence photo", "invalid_input");
}

function matchesSignature(bytes: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function positiveDimension(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 12_000) {
    throw new FulfillmentEvidenceServiceError(`${field} is invalid`, "invalid_input");
  }
  return value;
}

function evidenceKind(value: string): FulfillmentEvidenceKind {
  if (value === "contents" || value === "sealed_label") return value;
  throw new FulfillmentEvidenceServiceError("Evidence type is invalid", "invalid_input");
}

export class FulfillmentEvidenceService {
  constructor(
    readonly repository: FulfillmentEvidenceRepository,
    readonly storage: FulfillmentEvidenceStorage,
  ) {}

  async upload(input: {
    fulfillmentId: string;
    clientEventId: string;
    kind: string;
    mime: string;
    bytes: Buffer;
    width: number;
    height: number;
    actorId: string;
  }) {
    const kind = evidenceKind(input.kind);
    const mime = supportedMime(input.mime);
    if (input.bytes.byteLength <= 0 || input.bytes.byteLength > MAX_FILE_BYTES) {
      throw new FulfillmentEvidenceServiceError("Evidence photos must be smaller than 12 MB", "invalid_input");
    }
    if (!matchesSignature(input.bytes, mime)) {
      throw new FulfillmentEvidenceServiceError("The uploaded file does not match its image type", "invalid_input");
    }
    const width = positiveDimension(input.width, "Image width");
    const height = positiveDimension(input.height, "Image height");
    const id = randomUUID();
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const storageKey = await this.storage.save(id, input.bytes);
    try {
      const result = await this.repository.saveFile({
        id,
        fulfillmentId: input.fulfillmentId,
        clientEventId: input.clientEventId,
        kind,
        label: kind === "contents" ? "Packed contents" : "Sealed package & label",
        mime,
        bytes: input.bytes.byteLength,
        width,
        height,
        sha256,
        storageKey,
        customerVisible: true,
        actorId: input.actorId,
      });
      if (result.replayed) await this.storage.discard(storageKey).catch(() => undefined);
      return result;
    } catch (error) {
      await this.storage.discard(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async read(evidenceId: string) {
    const record = await this.repository.getFile(evidenceId);
    const bytes = await this.storage.read(record.storageKey);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== record.file.sha256) {
      throw new FulfillmentEvidenceServiceError("The evidence file failed its integrity check", "integrity_failed");
    }
    return { ...record.file, bytes };
  }
}

