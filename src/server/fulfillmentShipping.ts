import { createHash } from "node:crypto";

import type { ShippingPackageInput } from "../shared/shipping.js";
import type { CommerceAddress, CommerceOrder } from "./wooCommerceGateway.js";

export class FulfillmentShippingError extends Error {
  constructor(message: string, readonly code: "invalid_input" | "invalid_address" | "order_ineligible") {
    super(message);
    this.name = "FulfillmentShippingError";
  }
}

export interface ShippingDestination {
  name: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phone: string;
}

export function packedOrderStatusBlocker(
  order: Pick<CommerceOrder, "status" | "refundedTotal">,
): string | null {
  if (order.refundedTotal > 0) {
    return "This WooCommerce order contains a refund and requires review before buying postage.";
  }
  const status = order.status.trim().toLowerCase();
  if (status === "processing" || status === "completed") return null;
  const label = status ? status.replaceAll("-", " ") : "unknown";
  return `This WooCommerce order is ${label}, not Processing.`;
}

function finiteInRange(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function shippingPackageInput(value: unknown): ShippingPackageInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FulfillmentShippingError("Enter package weight and dimensions", "invalid_input");
  }
  const input = value as Record<string, unknown>;
  const weightOz = finiteInRange(input.weightOz, 0.1, 2_400);
  const lengthIn = finiteInRange(input.lengthIn, 0.1, 120);
  const widthIn = finiteInRange(input.widthIn, 0.1, 120);
  const heightIn = finiteInRange(input.heightIn, 0.1, 120);
  const packageCode = typeof input.packageCode === "string" && input.packageCode.trim()
    ? input.packageCode.trim().toLowerCase()
    : "package";
  if (weightOz === null || lengthIn === null || widthIn === null || heightIn === null) {
    throw new FulfillmentShippingError(
      "Package values must be positive and within standard parcel limits",
      "invalid_input",
    );
  }
  if (!/^[a-z0-9_]{1,80}$/.test(packageCode)) {
    throw new FulfillmentShippingError("The selected package type is invalid", "invalid_input");
  }
  return {
    weightOz,
    lengthIn,
    widthIn,
    heightIn,
    packageCode,
    packageName: packageCode === "package" ? "Your own box" : packageCode.replaceAll("_", " "),
  };
}

export function shippingDestination(address: CommerceAddress): ShippingDestination {
  const name = `${address.firstName} ${address.lastName}`.trim();
  const countryCode = address.country.trim().toUpperCase();
  const destination = {
    name,
    company: address.company.trim(),
    address1: address.address1.trim(),
    address2: address.address2.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    postalCode: address.postcode.trim(),
    countryCode,
    phone: address.phone.trim(),
  };
  if (
    (!destination.name && !destination.company) || !destination.address1 ||
    !destination.city || !destination.state || !destination.postalCode ||
    !/^[A-Z]{2}$/.test(destination.countryCode)
  ) {
    throw new FulfillmentShippingError(
      "The order shipping address is incomplete. Correct it at the source before comparing rates.",
      "invalid_address",
    );
  }
  return destination;
}

export function shippingDestinationHash(destination: ShippingDestination): string {
  return createHash("sha256").update(JSON.stringify([
    destination.name,
    destination.company,
    destination.address1,
    destination.address2,
    destination.city,
    destination.state,
    destination.postalCode,
    destination.countryCode,
  ])).digest("base64url");
}

export function shippingExternalShipmentKey(fulfillmentId: string): string {
  const normalized = fulfillmentId.trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(normalized)) {
    throw new FulfillmentShippingError("The fulfillment id is invalid", "invalid_input");
  }
  return `p1-${normalized}`;
}

export function shippingDestinationSummary(destination: ShippingDestination) {
  return {
    city: destination.city,
    state: destination.state,
    postalCode: destination.postalCode,
    countryCode: destination.countryCode,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildMockShippingLabelDocument(input: {
  nonce: string;
  orderNumber: string;
  carrierName: string;
  serviceName: string;
  trackingNumber: string;
  destination: ShippingDestination;
  package: ShippingPackageInput;
}): string {
  const addressLine = [input.destination.city, input.destination.state, input.destination.postalCode]
    .filter(Boolean).join(", ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test label — Order ${escapeHtml(input.orderNumber)}</title>
<style nonce="${input.nonce}">
  @page{size:4in 6in;margin:0}*{box-sizing:border-box}body{margin:0;background:#ececea;color:#111;font-family:Arial,sans-serif}.sheet{position:relative;width:4in;height:6in;margin:0 auto;padding:.22in;background:#fff;overflow:hidden}.test{position:absolute;inset:2.25in -.7in auto;transform:rotate(-34deg);border:6px solid rgba(150,22,22,.2);color:rgba(150,22,22,.2);font-size:42px;font-weight:900;text-align:center;letter-spacing:.04em;padding:10px;z-index:2}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid #111;padding-bottom:.13in}.head strong{font-size:25px}.head span{text-align:right;font-size:12px;font-weight:700}.warning{margin:.14in 0;padding:.1in;border:3px solid #9b1c1c;color:#9b1c1c;text-align:center;font-size:15px;font-weight:900}.to{min-height:1.62in;border-bottom:2px solid #111;padding:.12in .08in}.to small,.meta small{display:block;font-size:10px;font-weight:800;letter-spacing:.12em}.to strong{display:block;margin:.13in 0 .07in;font-size:21px}.to p{margin:3px 0;font-size:15px;line-height:1.25}.service{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:.16in .08in;border-bottom:2px solid #111}.service strong{font-size:22px}.service span{font-size:12px;text-align:right}.tracking{padding:.2in .08in;text-align:center}.tracking b{display:block;font-size:17px;letter-spacing:.05em;word-break:break-all}.fakebars{height:.67in;margin:.12in 0;background:repeating-linear-gradient(90deg,#111 0 2px,#fff 2px 5px,#111 5px 6px,#fff 6px 10px);opacity:.14}.meta{display:flex;justify-content:space-between;border-top:1px solid #111;padding:.12in .08in 0;font-size:11px}.screen{display:flex;justify-content:center;gap:10px;padding:18px}.screen button{border:0;border-radius:9px;background:#171719;color:#fff;padding:12px 20px;font-weight:800}@media print{body{background:#fff}.screen{display:none}.sheet{margin:0}.test{color:rgba(150,22,22,.28);border-color:rgba(150,22,22,.28)}}
</style></head><body><main class="sheet"><div class="test">TEST ONLY</div><header class="head"><strong>P1 LABZ</strong><span>${escapeHtml(input.carrierName)}<br>${escapeHtml(input.serviceName)}</span></header><div class="warning">NOT VALID POSTAGE · NO LABEL PURCHASED</div><section class="to"><small>SHIP TO — TEST PREVIEW</small><strong>${escapeHtml(input.destination.name || input.destination.company)}</strong><p>${escapeHtml(input.destination.address1)}</p>${input.destination.address2 ? `<p>${escapeHtml(input.destination.address2)}</p>` : ""}<p>${escapeHtml(addressLine)}</p><p>${escapeHtml(input.destination.countryCode)}</p></section><section class="service"><strong>${escapeHtml(input.serviceName)}</strong><span>Order #${escapeHtml(input.orderNumber)}<br>${input.package.weightOz} oz · ${input.package.lengthIn} × ${input.package.widthIn} × ${input.package.heightIn} in</span></section><section class="tracking"><small>TEST REFERENCE — NOT A CARRIER TRACKING NUMBER</small><div class="fakebars"></div><b>${escapeHtml(input.trackingNumber)}</b></section><footer class="meta"><span><small>FORMAT</small>4 × 6 thermal</span><span><small>MODE</small>Mock purchase</span></footer></main><div class="screen"><button id="print-label" type="button">Print test label</button></div><script nonce="${input.nonce}">document.querySelector('#print-label').addEventListener('click',()=>window.print());</script></body></html>`;
}
