import { createHmac } from "node:crypto";

export function analyticsFingerprint(
  secret: string,
  purpose: "visitor" | "order",
  value: string,
): string {
  return createHmac("sha256", secret)
    .update(`${purpose}:${value}`)
    .digest("hex");
}
