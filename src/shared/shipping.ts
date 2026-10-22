export type ShippingDataMode = "live" | "mock";
export type ShippingLabelPurchaseMode = "mock_only" | "live_disabled" | "live_enabled";
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
