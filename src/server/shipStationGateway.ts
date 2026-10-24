import { createHash } from "node:crypto";

import {
  PHASE_ONE_SHIPPING_POLICY,
  type ShippingCarrier,
  type ShippingCapabilitiesPayload,
  type ShippingDataMode,
  type ShippingPackageInput,
} from "../shared/shipping.js";

const SHIPSTATION_BASE_URL = "https://api.shipstation.com/v2";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const READ_REQUEST_TIMEOUT_MS = 10_000;
const LABEL_PURCHASE_TIMEOUT_MS = 25_000;

export interface ShipStationConfig {
  apiKey?: string;
  rateMode: ShippingDataMode;
  warehouseId?: string;
  labelPurchaseEnabled: boolean;
}

interface ShipStationAddress {
  name?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
}

interface ShipStationWarehouse {
  id: string;
  name: string;
  origin: ShipStationAddress;
}

export interface ShipStationRateInput {
  carrierIds: string[];
  package: ShippingPackageInput;
  destination: ShipStationAddress;
  externalShipmentId: string;
  orderNumber: string;
  existingShipmentId?: string | null;
}

export interface ShipStationRate {
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

export interface ShipStationLabelResult {
  labelId: string;
  shipmentId: string | null;
  status: "completed" | "processing" | "error" | "voided";
  trackingNumber: string | null;
  carrierId: string;
  carrierCode: string;
  serviceCode: string;
  amount: number;
  currency: string;
  labelDownloadUrl: string | null;
}

export interface ShipStationOrderReconciliation {
  purchasedLabels: ShipStationLabelResult[];
  protectedShipmentFound: boolean;
  reusableShipmentId: string | null;
}

export interface ShipStationVoidResult {
  approved: boolean;
  message: string;
}

export class ShipStationGatewayError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "unauthorized"
      | "forbidden"
      | "rate_limited"
      | "invalid_response"
      | "no_origin"
      | "upstream_unavailable"
      | "label_purchase_disabled"
      | "purchase_rejected"
      | "purchase_unknown",
  ) {
    super(message);
    this.name = "ShipStationGatewayError";
  }
}

type FetchLike = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyAmount(source: Record<string, unknown>, key: string): number {
  const value = numberValue(record(source[key])?.amount);
  return value === null ? 0 : Math.max(0, value);
}

function serviceList(value: unknown): ShippingCarrier["services"] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const source = record(item);
    if (!source) return [];
    const code = textValue(source.service_code || source.code);
    if (!code || seen.has(code)) return [];
    seen.add(code);
    return [{
      code,
      name: textValue(source.name || source.service_name) || code.replaceAll("_", " "),
      domestic: source.domestic === undefined ? true : boolValue(source.domestic),
      international: boolValue(source.international),
    }];
  });
}

function packageList(value: unknown): ShippingCarrier["packages"] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const source = record(item);
    if (!source) return [];
    const code = textValue(source.package_code || source.code);
    if (!code || seen.has(code)) return [];
    seen.add(code);
    return [{
      code,
      name: textValue(source.name || source.package_name) || code.replaceAll("_", " "),
      domestic: source.domestic === undefined ? true : boolValue(source.domestic),
      international: boolValue(source.international),
    }];
  });
}

function carrierList(value: unknown): ShippingCarrier[] {
  const root = record(value);
  const items = Array.isArray(value) ? value : root?.carriers;
  if (!Array.isArray(items)) {
    throw new ShipStationGatewayError("ShipStation returned an invalid carrier list", "invalid_response");
  }
  return items.flatMap((item) => {
    const source = record(item);
    if (!source) return [];
    const id = textValue(source.carrier_id || source.id);
    const code = textValue(source.carrier_code || source.code);
    if (!id || !code) return [];
    return [{
      id,
      code,
      name: textValue(source.friendly_name || source.name) || code.replaceAll("_", " "),
      nickname: textValue(source.nickname),
      services: serviceList(source.services),
      packages: packageList(source.packages),
    }];
  });
}

function address(value: unknown): ShipStationAddress | null {
  const source = record(value);
  if (!source) return null;
  const result = {
    city: textValue(source.city_locality || source.city),
    state: textValue(source.state_province || source.state),
    postalCode: textValue(source.postal_code || source.postcode),
    countryCode: textValue(source.country_code || source.country).toUpperCase(),
  };
  return result.city && result.state && result.postalCode && /^[A-Z]{2}$/.test(result.countryCode)
    ? result
    : null;
}

function warehouseList(value: unknown): ShipStationWarehouse[] {
  const root = record(value);
  const items = Array.isArray(value) ? value : root?.warehouses;
  if (!Array.isArray(items)) {
    throw new ShipStationGatewayError("ShipStation returned an invalid warehouse list", "invalid_response");
  }
  return items.flatMap((item) => {
    const source = record(item);
    if (!source) return [];
    const id = textValue(source.warehouse_id || source.id);
    const origin = address(source.origin_address || source.address);
    if (!id || !origin) return [];
    return [{ id, name: textValue(source.name) || "Shipping origin", origin }];
  });
}

function labelResult(value: unknown): ShipStationLabelResult {
  const source = record(value);
  const cost = record(source?.shipment_cost);
  const download = record(source?.label_download);
  const labelId = textValue(source?.label_id);
  const rawStatus = textValue(source?.status).toLowerCase();
  const status = rawStatus === "completed" || rawStatus === "processing" ||
      rawStatus === "error" || rawStatus === "voided"
    ? rawStatus
    : null;
  const amount = numberValue(cost?.amount);
  const currency = textValue(cost?.currency).toUpperCase();
  if (!labelId || !status || amount === null || amount < 0 || !currency) {
    throw new ShipStationGatewayError("ShipStation returned an invalid label record", "invalid_response");
  }
  return {
    labelId,
    shipmentId: textValue(source?.shipment_id) || null,
    status,
    trackingNumber: textValue(source?.tracking_number) || null,
    carrierId: textValue(source?.carrier_id),
    carrierCode: textValue(source?.carrier_code),
    serviceCode: textValue(source?.service_code),
    amount,
    currency,
    labelDownloadUrl: textValue(download?.pdf || download?.href) || null,
  };
}

function labelList(value: unknown): ShipStationLabelResult[] {
  const root = record(value);
  const items = Array.isArray(value) ? value : root?.labels;
  if (!Array.isArray(items)) {
    throw new ShipStationGatewayError("ShipStation returned an invalid label list", "invalid_response");
  }
  return items.map(labelResult);
}

function shipmentList(value: unknown): Array<{ shipmentId: string; shipmentNumber: string; status: string }> {
  const root = record(value);
  const items = Array.isArray(value) ? value : root?.shipments;
  if (!Array.isArray(items)) {
    throw new ShipStationGatewayError("ShipStation returned an invalid shipment list", "invalid_response");
  }
  return items.flatMap((item) => {
    const source = record(item);
    if (!source) return [];
    const shipmentId = textValue(source.shipment_id);
    const shipmentNumber = textValue(source.shipment_number);
    const status = textValue(source.shipment_status).toLowerCase();
    return shipmentId ? [{ shipmentId, shipmentNumber, status }] : [];
  });
}

function mockCarriers(): ShippingCarrier[] {
  return [
    {
      id: "mock-ups",
      code: "ups",
      name: "UPS",
      nickname: "Test connection",
      services: [
        { code: "ups_ground", name: "UPS Ground", domestic: true, international: false },
        { code: "ups_2nd_day_air", name: "UPS 2nd Day Air", domestic: true, international: false },
      ],
      packages: [],
    },
    {
      id: "mock-usps",
      code: "stamps_com",
      name: "USPS",
      nickname: "Test connection",
      services: [
        { code: "usps_ground_advantage", name: "USPS Ground Advantage", domestic: true, international: false },
        { code: "usps_priority_mail", name: "USPS Priority Mail", domestic: true, international: false },
      ],
      packages: [],
    },
    {
      id: "mock-fedex",
      code: "fedex",
      name: "FedEx",
      nickname: "Test connection",
      services: [
        { code: "fedex_ground", name: "FedEx Ground", domestic: true, international: false },
        { code: "fedex_2day", name: "FedEx 2Day", domestic: true, international: false },
      ],
      packages: [
        { code: PHASE_ONE_SHIPPING_POLICY.packageCode, name: PHASE_ONE_SHIPPING_POLICY.packageName, domestic: true, international: false },
        { code: "fedex_small_box_onerate", name: "FedEx One Rate Small Box", domestic: true, international: false },
        { code: "fedex_medium_box_onerate", name: "FedEx One Rate Medium Box", domestic: true, international: false },
        { code: "fedex_large_box_onerate", name: "FedEx One Rate Large Box", domestic: true, international: false },
      ],
    },
  ];
}

function mockRateId(parts: unknown[]): string {
  return `mock-rate-${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;
}

function mockRates(input: ShipStationRateInput): ShipStationRate[] {
  const carriers = mockCarriers().filter((carrier) => input.carrierIds.includes(carrier.id));
  const packageCode = input.package.packageCode || "package";
  if (packageCode.includes("_onerate")) {
    const carrier = carriers.find((item) => item.code === "fedex");
    if (!carrier) return [];
    const delivery = new Date();
    delivery.setUTCDate(delivery.getUTCDate() + 2);
    return [{
      rateId: mockRateId([carrier.id, "fedex_2day", packageCode, input.destination]),
      shipmentId: null,
      carrierId: carrier.id,
      carrierCode: carrier.code,
      carrierName: carrier.name,
      serviceCode: "fedex_2day",
      serviceName: "FedEx 2Day One Rate",
      amount: 14.2,
      currency: "USD",
      deliveryDays: 2,
      estimatedDeliveryDate: delivery.toISOString(),
      guaranteed: false,
      isEstimate: true,
    }];
  }
  const dimensionalWeight = (input.package.lengthIn * input.package.widthIn * input.package.heightIn) / 139;
  const billablePounds = Math.max(input.package.weightOz / 16, dimensionalWeight, 0.25);
  const today = new Date();
  const specs = [
    { carrier: "mock-usps", code: "usps_ground_advantage", name: "USPS Ground Advantage", base: 4.68, days: 4 },
    { carrier: "mock-usps", code: "usps_priority_mail", name: "USPS Priority Mail", base: 8.92, days: 2 },
    { carrier: "mock-ups", code: "ups_ground", name: "UPS Ground", base: 9.74, days: 4 },
    { carrier: "mock-ups", code: "ups_2nd_day_air", name: "UPS 2nd Day Air", base: 18.84, days: 2 },
    { carrier: "mock-fedex", code: "fedex_ground", name: "FedEx Ground", base: 10.16, days: 4 },
    { carrier: "mock-fedex", code: "fedex_2day", name: "FedEx 2Day", base: 19.42, days: 2 },
  ];
  return specs.flatMap((spec) => {
    const carrier = carriers.find((item) => item.id === spec.carrier);
    if (!carrier) return [];
    const amount = Number((spec.base + Math.max(0, billablePounds - 1) * 0.84).toFixed(2));
    const delivery = new Date(today);
    delivery.setUTCDate(delivery.getUTCDate() + spec.days);
    return [{
      rateId: mockRateId([spec.carrier, spec.code, input.package, input.destination]),
      shipmentId: null,
      carrierId: carrier.id,
      carrierCode: carrier.code,
      carrierName: carrier.name,
      serviceCode: spec.code,
      serviceName: spec.name,
      amount,
      currency: "USD",
      deliveryDays: spec.days,
      estimatedDeliveryDate: delivery.toISOString(),
      guaranteed: false,
      isEstimate: true,
    }];
  }).sort((left, right) => left.amount - right.amount);
}

export class ShipStationGateway {
  private readonly baseUrl: string;
  private accountCache?: {
    carriers: ShippingCarrier[];
    warehouses: ShipStationWarehouse[];
    expiresAt: number;
  };
  private accountRequest: Promise<{
    carriers: ShippingCarrier[];
    warehouses: ShipStationWarehouse[];
  }> | undefined;

  constructor(
    private readonly config: ShipStationConfig,
    private readonly fetchImpl: FetchLike = fetch,
    baseUrl = SHIPSTATION_BASE_URL,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request(
    path: string,
    init: RequestInit = {},
    outcomeSensitive = false,
  ): Promise<unknown> {
    if (!this.config.apiKey) {
      throw new ShipStationGatewayError("ShipStation API access is not configured", "not_configured");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "API-Key": this.config.apiKey,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: init.signal || AbortSignal.timeout(
          outcomeSensitive ? LABEL_PURCHASE_TIMEOUT_MS : READ_REQUEST_TIMEOUT_MS,
        ),
      });
    } catch {
      throw new ShipStationGatewayError(
        outcomeSensitive
          ? "The label request outcome is uncertain and must be reconciled before retrying"
          : "ShipStation is temporarily unreachable",
        outcomeSensitive ? "purchase_unknown" : "upstream_unavailable",
      );
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new ShipStationGatewayError("The ShipStation API credential was not accepted", "unauthorized");
      }
      if (response.status === 403) {
        throw new ShipStationGatewayError("This ShipStation account cannot access the requested capability", "forbidden");
      }
      if (response.status === 429) {
        throw new ShipStationGatewayError("ShipStation rate limits are temporarily active", "rate_limited");
      }
      if (outcomeSensitive && response.status >= 500) {
        throw new ShipStationGatewayError(
          "The label request outcome is uncertain and must be reconciled before retrying",
          "purchase_unknown",
        );
      }
      throw new ShipStationGatewayError(
        outcomeSensitive
          ? `ShipStation rejected the label request with status ${response.status}`
          : `ShipStation returned status ${response.status}`,
        outcomeSensitive ? "purchase_rejected" : "upstream_unavailable",
      );
    }
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) {
      throw new ShipStationGatewayError("ShipStation returned an oversized response", "invalid_response");
    }
    try {
      return body ? JSON.parse(body) : {};
    } catch {
      throw new ShipStationGatewayError("ShipStation returned invalid JSON", "invalid_response");
    }
  }

  private async liveCarriers(): Promise<ShippingCarrier[]> {
    return carrierList(await this.request("/carriers?page_size=100&include_extended_details=true"));
  }

  private async liveWarehouses(): Promise<ShipStationWarehouse[]> {
    return warehouseList(await this.request("/warehouses?page_size=100"));
  }

  private async liveAccount(): Promise<{
    carriers: ShippingCarrier[];
    warehouses: ShipStationWarehouse[];
  }> {
    if (this.accountCache && this.accountCache.expiresAt > Date.now()) {
      return this.accountCache;
    }
    if (!this.accountRequest) {
      this.accountRequest = Promise.all([this.liveCarriers(), this.liveWarehouses()])
        .then(([carriers, warehouses]) => {
          this.accountCache = { carriers, warehouses, expiresAt: Date.now() + 5 * 60_000 };
          return { carriers, warehouses };
        })
        .finally(() => { this.accountRequest = undefined; });
    }
    return this.accountRequest;
  }

  async capabilities(): Promise<ShippingCapabilitiesPayload> {
    if (this.config.rateMode === "mock") {
      return {
        credentialConfigured: Boolean(this.config.apiKey),
        connected: true,
        dataMode: "mock",
        labelPurchaseMode: "mock_only",
        rateShoppingAvailable: true,
        carriers: mockCarriers(),
        originName: "Local test origin",
        checkedAt: new Date().toISOString(),
      };
    }
    if (!this.config.apiKey) {
      return {
        credentialConfigured: false,
        connected: false,
        dataMode: "live",
        labelPurchaseMode: this.config.labelPurchaseEnabled ? "live_enabled" : "live_disabled",
        rateShoppingAvailable: false,
        carriers: [],
        originName: null,
        checkedAt: new Date().toISOString(),
        error: "Add the ShipStation V2 API key to the server environment to validate this connection.",
      };
    }
    try {
      const { carriers, warehouses } = await this.liveAccount();
      const selectedOrigin = this.selectOrigin(warehouses, false);
      return {
        credentialConfigured: true,
        connected: true,
        dataMode: "live",
        labelPurchaseMode: this.config.labelPurchaseEnabled ? "live_enabled" : "live_disabled",
        rateShoppingAvailable: carriers.length > 0 && Boolean(selectedOrigin),
        carriers,
        originName: selectedOrigin?.name || null,
        checkedAt: new Date().toISOString(),
        ...(!carriers.length ? { error: "No connected carriers were returned by ShipStation." } : {}),
      };
    } catch (error) {
      const message = error instanceof ShipStationGatewayError
        ? error.message
        : "ShipStation validation failed safely";
      return {
        credentialConfigured: true,
        connected: false,
        dataMode: "live",
        labelPurchaseMode: this.config.labelPurchaseEnabled ? "live_enabled" : "live_disabled",
        rateShoppingAvailable: false,
        carriers: [],
        originName: null,
        checkedAt: new Date().toISOString(),
        error: message,
      };
    }
  }

  private selectOrigin(
    warehouses: ShipStationWarehouse[],
    required = true,
  ): ShipStationWarehouse | null {
    const selected = this.config.warehouseId
      ? warehouses.find((item) => item.id === this.config.warehouseId)
      : warehouses[0];
    if (!selected && required) {
      throw new ShipStationGatewayError(
        this.config.warehouseId
          ? "The configured ShipStation warehouse was not found or has no complete origin address"
          : "ShipStation has no warehouse with a complete origin address",
        "no_origin",
      );
    }
    return selected || null;
  }

  async rates(input: ShipStationRateInput): Promise<ShipStationRate[]> {
    if (this.config.rateMode === "mock") return mockRates(input);
    if (!input.carrierIds.length) {
      throw new ShipStationGatewayError("Choose at least one carrier", "invalid_response");
    }
    const { carriers, warehouses } = await this.liveAccount();
    const allowedIds = new Set(carriers.map((carrier) => carrier.id));
    if (input.carrierIds.some((id) => !allowedIds.has(id))) {
      throw new ShipStationGatewayError("A selected carrier is not connected to this account", "invalid_response");
    }
    const origin = this.selectOrigin(warehouses)!;
    const packageCode = input.package.packageCode?.trim() || "package";
    if (packageCode !== "package") {
      if (input.carrierIds.length !== 1) {
        throw new ShipStationGatewayError(
          "Carrier packaging can only be rated with its matching carrier account",
          "invalid_response",
        );
      }
      const carrier = carriers.find((candidate) => candidate.id === input.carrierIds[0]);
      if (!carrier?.packages.some((candidate) => candidate.code === packageCode)) {
        throw new ShipStationGatewayError(
          "The selected package is not available for this connected carrier",
          "invalid_response",
        );
      }
    }
    const externalShipmentId = input.externalShipmentId.trim();
    if (!externalShipmentId || externalShipmentId.length > 50) {
      throw new ShipStationGatewayError("The external shipment identifier is invalid", "invalid_response");
    }
    const phaseOnePolicySelected = packageCode === PHASE_ONE_SHIPPING_POLICY.packageCode;
    const rateOptions = {
      carrier_ids: input.carrierIds,
      preferred_currency: "USD",
      rate_type: "shipment",
      ...(phaseOnePolicySelected ? {
        service_codes: [PHASE_ONE_SHIPPING_POLICY.serviceCode],
        package_types: [PHASE_ONE_SHIPPING_POLICY.packageCode],
      } : {}),
    };
    const shipmentDetails = {
      validate_address: "validate_only",
      warehouse_id: origin.id,
      confirmation: "none",
      ship_to: {
        name: input.destination.name || input.destination.company || "Customer",
        company_name: input.destination.company || "",
        phone: input.destination.phone || "",
        address_line1: input.destination.address1 || "",
        address_line2: input.destination.address2 || null,
        city_locality: input.destination.city,
        state_province: input.destination.state,
        postal_code: input.destination.postalCode,
        country_code: input.destination.countryCode,
        address_residential_indicator: "unknown",
      },
      packages: [{
        package_code: packageCode,
        weight: { value: input.package.weightOz, unit: "ounce" },
        ...(packageCode === "package" ? {
          dimensions: {
            unit: "inch",
            length: input.package.lengthIn,
            width: input.package.widthIn,
            height: input.package.heightIn,
          },
        } : {}),
      }],
    };
    const existingShipmentId = input.existingShipmentId?.trim() || "";
    if (existingShipmentId && !/^se-[a-z0-9-]+$/.test(existingShipmentId)) {
      throw new ShipStationGatewayError("The existing ShipStation shipment identifier is invalid", "invalid_response");
    }
    if (existingShipmentId) {
      await this.request(`/shipments/${encodeURIComponent(existingShipmentId)}`, {
        method: "PUT",
        body: JSON.stringify(shipmentDetails),
      });
    }
    const shipmentForRate = existingShipmentId
      ? { shipment_id: existingShipmentId }
      : {
          shipment: {
            ...shipmentDetails,
            external_shipment_id: externalShipmentId,
            shipment_number: input.orderNumber.trim().slice(0, 50) || externalShipmentId,
          },
        };
    const payload = await this.request("/rates", {
      method: "POST",
      body: JSON.stringify({
        rate_options: rateOptions,
        ...shipmentForRate,
      }),
    });
    const root = record(payload);
    const rateResponse = record(root?.rate_response);
    const rateItems = rateResponse?.rates;
    const shipmentId = textValue(root?.shipment_id || rateResponse?.shipment_id) || existingShipmentId || null;
    if (!Array.isArray(rateItems) || !shipmentId) {
      throw new ShipStationGatewayError("ShipStation returned an invalid rate list", "invalid_response");
    }
    const parsed = rateItems.flatMap((item) => {
      const source = record(item);
      const money = record(source?.shipping_amount);
      if (!source || !money) return [];
      const rateId = textValue(source.rate_id);
      const carrierId = textValue(source.carrier_id);
      const serviceCode = textValue(source.service_code);
      const shippingAmount = numberValue(money.amount);
      const amount = shippingAmount === null ? null : Number((
        Math.max(0, shippingAmount) + moneyAmount(source, "insurance_amount") +
        moneyAmount(source, "confirmation_amount") + moneyAmount(source, "other_amount")
      ).toFixed(2));
      const currency = textValue(money.currency).toUpperCase();
      if (!rateId || !carrierId || !serviceCode || amount === null || amount < 0 || !currency) return [];
      const carrier = carriers.find((candidate) => candidate.id === carrierId);
      const deliveryDays = numberValue(source.delivery_days);
      const estimatedDeliveryDate = textValue(source.estimated_delivery_date) || null;
      const carrierCode = textValue(source.carrier_code) || carrier?.code || "carrier";
      const carrierName = textValue(source.carrier_friendly_name) || carrier?.name || carrierCode;
      let serviceName = textValue(source.service_type) ||
        carrier?.services.find((service) => service.code === serviceCode)?.name || serviceCode;
      if (packageCode.includes("_onerate") && !/one\s*rate/i.test(serviceName)) {
        serviceName = `${serviceName} One Rate`;
      }
      return [{
        rateId,
        shipmentId,
        carrierId,
        carrierCode,
        carrierName,
        serviceCode,
        serviceName,
        amount,
        currency,
        deliveryDays: deliveryDays === null ? null : Math.max(0, Math.round(deliveryDays)),
        estimatedDeliveryDate,
        guaranteed: boolValue(source.guaranteed_service),
        isEstimate: false,
      }];
    });
    return parsed
      .filter((rate) => !phaseOnePolicySelected || (
        rate.carrierCode.toLowerCase() === PHASE_ONE_SHIPPING_POLICY.carrierCode &&
        rate.serviceCode.toLowerCase() === PHASE_ONE_SHIPPING_POLICY.serviceCode
      ))
      .sort((left, right) => left.amount - right.amount);
  }

  async purchaseLabelFromRate(rateId: string): Promise<ShipStationLabelResult> {
    if (!this.config.labelPurchaseEnabled) {
      throw new ShipStationGatewayError(
        "Real label purchase is disabled by the server safety flag",
        "label_purchase_disabled",
      );
    }
    if (this.config.rateMode !== "live") {
      throw new ShipStationGatewayError(
        "Real label purchase is unavailable in mock mode",
        "label_purchase_disabled",
      );
    }
    const normalizedRateId = rateId.trim();
    if (!normalizedRateId || normalizedRateId.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(normalizedRateId)) {
      throw new ShipStationGatewayError("The ShipStation rate identifier is invalid", "purchase_rejected");
    }
    const result = labelResult(await this.request(
      `/labels/rates/${encodeURIComponent(normalizedRateId)}`,
      {
        method: "POST",
        body: JSON.stringify({
          label_format: "pdf",
          label_layout: "4x6",
          label_download_type: "url",
        }),
      },
      true,
    ));
    if (result.status === "error") {
      throw new ShipStationGatewayError("ShipStation could not create the label", "purchase_rejected");
    }
    return result;
  }

  async findLabelsByRateId(rateId: string): Promise<ShipStationLabelResult[]> {
    const normalizedRateId = rateId.trim();
    if (!normalizedRateId || normalizedRateId.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(normalizedRateId)) {
      throw new ShipStationGatewayError("The ShipStation rate identifier is invalid", "invalid_response");
    }
    return labelList(await this.request(
      `/labels?rate_id=${encodeURIComponent(normalizedRateId)}&page_size=2&sort_dir=desc&sort_by=created_at`,
    ));
  }

  async reconcileOrderByNumber(orderNumber: string): Promise<ShipStationOrderReconciliation> {
    if (this.config.rateMode !== "live") {
      return { purchasedLabels: [], protectedShipmentFound: false, reusableShipmentId: null };
    }
    const normalized = orderNumber.trim().replace(/^#/, "");
    if (!normalized || normalized.length > 50) {
      throw new ShipStationGatewayError("The order number is invalid for ShipStation reconciliation", "invalid_response");
    }
    const shipments = shipmentList(await this.request(
      `/shipments?shipment_number=${encodeURIComponent(normalized)}&page_size=25&sort_dir=desc&sort_by=modified_at`,
    )).filter((shipment) => shipment.shipmentNumber.replace(/^#/, "") === normalized);
    const purchased = shipments.filter((shipment) => shipment.status === "label_purchased");
    const labels = await Promise.all(purchased.map((shipment) => this.request(
      `/labels?shipment_id=${encodeURIComponent(shipment.shipmentId)}&page_size=10&sort_dir=desc&sort_by=created_at`,
    ).then(labelList)));
    const pending = shipments.filter((shipment) => shipment.status === "pending");
    if (pending.length > 1) {
      throw new ShipStationGatewayError(
        "ShipStation has multiple pending shipments for this order. Reconcile them before buying postage.",
        "invalid_response",
      );
    }
    return {
      purchasedLabels: labels.flat().filter((label) => label.status === "completed" || label.status === "processing"),
      protectedShipmentFound: purchased.length > 0 || shipments.some((shipment) => shipment.status === "processing"),
      reusableShipmentId: pending[0]?.shipmentId || null,
    };
  }

  async findPurchasedLabelsByOrderNumber(orderNumber: string): Promise<ShipStationLabelResult[]> {
    return (await this.reconcileOrderByNumber(orderNumber)).purchasedLabels;
  }

  async getLabelById(labelId: string): Promise<ShipStationLabelResult> {
    const normalized = labelId.trim();
    if (!normalized || normalized.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
      throw new ShipStationGatewayError("The ShipStation label identifier is invalid", "invalid_response");
    }
    return labelResult(await this.request(`/labels/${encodeURIComponent(normalized)}`));
  }

  async voidLabel(labelId: string): Promise<ShipStationVoidResult> {
    if (!this.config.labelPurchaseEnabled || this.config.rateMode !== "live") {
      throw new ShipStationGatewayError("Live label changes are disabled by the server safety flag", "label_purchase_disabled");
    }
    const normalized = labelId.trim();
    if (!normalized || normalized.length > 160 || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
      throw new ShipStationGatewayError("The ShipStation label identifier is invalid", "purchase_rejected");
    }
    const payload = record(await this.request(
      `/labels/${encodeURIComponent(normalized)}/void`,
      { method: "PUT" },
      true,
    ));
    if (!payload || typeof payload.approved !== "boolean") {
      throw new ShipStationGatewayError("ShipStation returned an invalid void response", "invalid_response");
    }
    return { approved: payload.approved, message: textValue(payload.message) || "No carrier message was returned." };
  }

  async downloadLabelPdf(downloadUrl: string): Promise<Uint8Array> {
    if (!this.config.apiKey) {
      throw new ShipStationGatewayError("ShipStation API access is not configured", "not_configured");
    }
    let parsed: URL;
    try { parsed = new URL(downloadUrl); } catch {
      throw new ShipStationGatewayError("The stored label download URL is invalid", "invalid_response");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "api.shipstation.com" ||
        !parsed.pathname.startsWith("/v2/downloads/")) {
      throw new ShipStationGatewayError("The stored label download URL is not trusted", "invalid_response");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(parsed, {
        headers: { Accept: "application/pdf", "API-Key": this.config.apiKey },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ShipStationGatewayError("The shipping label could not be downloaded", "upstream_unavailable");
    }
    if (!response.ok) {
      throw new ShipStationGatewayError(`ShipStation returned status ${response.status} for the label PDF`, "upstream_unavailable");
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 10 * 1024 * 1024) {
      throw new ShipStationGatewayError("The shipping label PDF is too large", "invalid_response");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 5 || bytes.length > 10 * 1024 * 1024 ||
        String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
      throw new ShipStationGatewayError("ShipStation did not return a valid PDF label", "invalid_response");
    }
    return bytes;
  }
}
