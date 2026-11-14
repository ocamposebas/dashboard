export type ShippingDataMode = "live" | "mock";
export type ShippingLabelPurchaseMode = "mock_only" | "live_disabled" | "live_enabled";

// Phase One keeps each approved warehouse path locked as one carrier, package
// and service. The destination selector chooses the safe exception for Puerto
// Rico and PO Boxes without letting the browser invent another rate.
export interface PhaseOneShippingPolicy {
  carrierCode: string;
  carrierCodes: readonly string[];
  carrierName: string;
  packageCode: string;
  packageName: string;
  serviceCode: string;
  serviceName: string;
  carrierPackage: boolean;
}

export const PHASE_ONE_SHIPPING_POLICY: PhaseOneShippingPolicy = {
  carrierCodes: ["fedex"],
  carrierCode: "fedex",
  packageCode: "fedex_pak_onerate",
  packageName: "FedEx One Rate Pak",
  serviceCode: "fedex_2day",
  serviceName: "FedEx 2Day One Rate Pak",
  carrierName: "FedEx",
  carrierPackage: true,
};

export const PHASE_ONE_USPS_POLICY: PhaseOneShippingPolicy = {
  carrierCode: "stamps_com",
  carrierCodes: ["stamps_com", "usps"],
  carrierName: "USPS",
  packageCode: "package",
  packageName: "Phase One shipping box",
  serviceCode: "usps_priority_mail",
  serviceName: "USPS Priority Mail",
  carrierPackage: false,
};

export function shippingPolicyForDestination(input: {
  state: string;
  address1?: string;
  address2?: string;
}): PhaseOneShippingPolicy {
  const state = input.state.trim().toUpperCase();
  const address = `${input.address1 || ""} ${input.address2 || ""}`.replace(/\s+/g, " ").trim();
  const poBox = /\b(?:P(?:OST)?\.?\s*O(?:FFICE)?\.?\s*BOX|POB)\s*#?\s*[A-Z0-9-]+\b/i.test(address);
  return state === "PR" || poBox ? PHASE_ONE_USPS_POLICY : PHASE_ONE_SHIPPING_POLICY;
}

export function matchesPhaseOneShippingPolicy(input: {
  carrierCode: string;
  serviceCode: string;
  packageCode: string | undefined;
}, policy: PhaseOneShippingPolicy = PHASE_ONE_SHIPPING_POLICY): boolean {
  return policy.carrierCodes.includes(input.carrierCode.trim().toLowerCase()) &&
    input.serviceCode.trim().toLowerCase() === policy.serviceCode &&
    input.packageCode?.trim().toLowerCase() === policy.packageCode;
}
export type ShippingLabelState =
  | "purchase_pending"
  | "purchase_unknown"
  | "label_ready"
  | "failed"
  | "voided";

export interface ShippingCarrierService {
  code: string;
  name: string;
  domestic: boolean;
  international: boolean;
}

export interface ShippingCarrierPackage {
  code: string;
  name: string;
  domestic: boolean;
  international: boolean;
}

export interface ShippingCarrier {
  id: string;
  code: string;
  name: string;
  nickname: string;
  services: ShippingCarrierService[];
  packages: ShippingCarrierPackage[];
}

export interface ShippingCapabilitiesPayload {
  credentialConfigured: boolean;
  connected: boolean;
  dataMode: ShippingDataMode;
  labelPurchaseMode: ShippingLabelPurchaseMode;
  rateShoppingAvailable: boolean;
  carriers: ShippingCarrier[];
  originName: string | null;
  checkedAt: string;
  error?: string;
}

export interface ShippingPackageInput {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  packageCode?: string;
  packageName?: string;
}

export interface ShippingRateQuote {
  quoteToken: string;
  rateId: string;
  shipmentId: string | null;
  carrierId: string;
  carrierCode: string;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  amount: number;
  currency: string;
  deliveryDays: number | null;
  estimatedDeliveryDate: string | null;
  guaranteed: boolean;
  isEstimate: boolean;
}

export interface ShippingRatesPayload {
  dataMode: ShippingDataMode;
  fulfillmentId: string;
  destination: {
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  };
  package: ShippingPackageInput;
  policy?: {
    carrierName: string;
    packageName: string;
    serviceName: string;
  };
  rates: ShippingRateQuote[];
  quotedAt: string;
}

export interface ShippingLabel {
  id: string;
  fulfillmentId: string;
  orderId: number;
  orderNumber: string;
  state: ShippingLabelState;
  provider: "shipstation";
  providerMode: ShippingDataMode;
  carrierId: string;
  carrierCode: string;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  amount: number;
  currency: string;
  package: ShippingPackageInput;
  externalShipmentKey: string;
  shipmentId: string | null;
  labelId: string | null;
  trackingNumber: string | null;
  labelDownloadUrl: string | null;
  labelFormat: "4x6";
  wordpressSyncState: "not_required" | "pending" | "synced" | "failed";
  wordpressSyncedAt: string | null;
  wordpressSyncMessage: string | null;
  voidedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  printCount: number;
  lastPrintedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type MockShippingLabel = ShippingLabel;

export interface ShippingLabelPayload {
  replayed: boolean;
  label: ShippingLabel;
  printUrl?: string;
}

export type MockShippingLabelPayload = ShippingLabelPayload;
