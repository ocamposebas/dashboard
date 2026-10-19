export interface CameraBarcodeCandidate {
  accepted: boolean;
  value: string | null;
  reason: "accepted" | "unsupported_format" | "invalid_value";
}

/**
 * Camera decoding is only an input method. The server remains authoritative for
 * QR registration, product, variation, batch, COA and order validation.
 */
export function cameraBarcodeCandidate(
  rawValue: string,
  formatName: string,
): CameraBarcodeCandidate {
  const value = rawValue.trim();
  const format = formatName.toUpperCase();
  if (format === "QR_CODE") {
    if (value.length > 2048) return { accepted: false, value: null, reason: "invalid_value" };
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        return { accepted: false, value: null, reason: "invalid_value" };
      }
      return { accepted: true, value, reason: "accepted" };
    } catch {
      return { accepted: false, value: null, reason: "invalid_value" };
    }
  }
  // Legacy warehouse labels remain readable during the transition, but the
  // operator-facing generator is retired in favor of the QR already on a vial.
  if (format !== "CODE_128") {
    return { accepted: false, value: null, reason: "unsupported_format" };
  }
  if (!/^[0-9]{20}$/.test(value)) {
    return { accepted: false, value: null, reason: "invalid_value" };
  }
  return { accepted: true, value, reason: "accepted" };
}
