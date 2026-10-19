import { createHmac } from "node:crypto";

import bwipjs from "bwip-js";

import type {
  BarcodeEntityType,
  BarcodeLabel,
  FulfillmentBarcodePayload,
  ThermalLabelSize,
} from "../shared/barcodeFulfillment.js";
import { normalizeThermalLabelLayout } from "../shared/labelPrint.js";

const MAX_TEXT_LENGTH = 120;
const IDENTIFIER_MODULUS = 1_000_000_000_000_000_000n;
const TYPE_PREFIX: Record<BarcodeEntityType, string> = {
  product: "11",
  variation: "12",
  batch: "13",
};

export class BarcodeLabelError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "invalid_signature" | "unsupported_version",
  ) {
    super(message);
    this.name = "BarcodeLabelError";
  }
}

function positiveIdentifier(value: number, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new BarcodeLabelError(`${field} is invalid`, "invalid_input");
  }
  return value;
}

function compactText(value: string | undefined, field: string, required = false): string | undefined {
  const normalized = value?.trim();
  if ((required && !normalized) || (normalized && normalized.length > MAX_TEXT_LENGTH)) {
    throw new BarcodeLabelError(`${field} is invalid`, "invalid_input");
  }
  return normalized || undefined;
}

function validatePayload(payload: FulfillmentBarcodePayload): FulfillmentBarcodePayload {
  if (payload.version !== 1) {
    throw new BarcodeLabelError("The barcode version is not supported", "unsupported_version");
  }
  if (!["product", "variation", "batch"].includes(payload.type)) {
    throw new BarcodeLabelError("The barcode type is invalid", "invalid_input");
  }
  const productId = positiveIdentifier(payload.productId, "Product id");
  const variationId = positiveIdentifier(payload.variationId, "Variation id", true);
  if (payload.type === "product" && variationId !== 0) {
    throw new BarcodeLabelError("Product labels cannot identify a variation", "invalid_input");
  }
  if (payload.type === "variation" && variationId === 0) {
    throw new BarcodeLabelError("Variation labels require a variation id", "invalid_input");
  }
  const coaId = compactText(payload.coaId, "COA id", payload.type === "batch");
  const lot = compactText(payload.lot, "Lot", payload.type === "batch");
  if (payload.type !== "batch" && (coaId || lot)) {
    throw new BarcodeLabelError("Only batch labels can contain lot data", "invalid_input");
  }
  return {
    version: 1,
    type: payload.type,
    productId,
    variationId,
    ...(coaId ? { coaId } : {}),
    ...(lot ? { lot } : {}),
  };
}

export class BarcodeLabelService {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret.trim();
    if (this.secret.length < 32) {
      throw new BarcodeLabelError(
        "BARCODE_SIGNING_SECRET must contain at least 32 characters",
        "invalid_input",
      );
    }
  }

  identifierFor(input: Omit<FulfillmentBarcodePayload, "version">): string {
    const payload = validatePayload({ version: 1, ...input });
    const canonical = JSON.stringify([
      payload.version,
      payload.type,
      payload.productId,
      payload.variationId,
      payload.coaId || "",
      payload.lot || "",
    ]);
    const digest = createHmac("sha256", this.secret)
      .update(`phase-one-label:${canonical}`)
      .digest();
    const numericBody = (digest.readBigUInt64BE(0) % IDENTIFIER_MODULUS)
      .toString()
      .padStart(18, "0");
    return `${TYPE_PREFIX[payload.type]}${numericBody}`;
  }

  createLabel(input: {
    type: BarcodeEntityType;
    productId: number;
    variationId?: number;
    coaId?: string;
    lot?: string;
    productName: string;
    variantName?: string;
    sku: string;
    locationCode: string;
    coaNumber?: string;
    barcodeValue?: string;
    size?: ThermalLabelSize;
    copies?: number;
  }): BarcodeLabel {
    const payload = validatePayload({
      version: 1,
      type: input.type,
      productId: input.productId,
      variationId: input.variationId ?? 0,
      ...(input.coaId ? { coaId: input.coaId } : {}),
      ...(input.lot ? { lot: input.lot } : {}),
    });
    const generatedToken = this.identifierFor(payload);
    const token = input.barcodeValue?.trim() || generatedToken;
    if (!/^[0-9]{20}$/.test(token) || !token.startsWith(TYPE_PREFIX[payload.type])) {
      throw new BarcodeLabelError("The registered barcode identifier is invalid", "invalid_input");
    }
    const layout = normalizeThermalLabelLayout(input.size, input.copies);
    const productName = compactText(input.productName, "Product name", true)!;
    const sku = compactText(input.sku, "SKU", true)!;
    const locationCode = compactText(input.locationCode, "Location", true)!;
    const svg = bwipjs.toSVG({
      bcid: "code128",
      text: token,
      scale: 3,
      height: layout.barcodeHeightMillimeters,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
      backgroundcolor: "FFFFFF",
      barcolor: "000000",
    });
    return {
      token,
      svg,
      payload,
      productName,
      variantName: compactText(input.variantName, "Variant name") || "",
      sku,
      locationCode,
      coaNumber: compactText(input.coaNumber, "COA number") || "",
      lot: compactText(input.lot, "Lot") || "",
      layout,
    };
  }
}
