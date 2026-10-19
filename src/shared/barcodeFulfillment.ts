export type BarcodeEntityType = "product" | "variation" | "batch";
export type ThermalLabelSize = "2x1" | "3x1";

export interface ProductLocation {
  productId: number;
  variationId: number;
  locationCode: string;
  updatedBy: string;
  updatedAt: string;
}

export interface FulfillmentBarcodePayload {
  version: 1;
  type: BarcodeEntityType;
  productId: number;
  variationId: number;
  coaId?: string;
  lot?: string;
}

export interface BarcodeRegistryRecord extends FulfillmentBarcodePayload {
  barcodeValue: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export interface ThermalLabelLayout {
  size: ThermalLabelSize;
  widthInches: number;
  heightInches: number;
  barcodeHeightMillimeters: number;
  copies: number;
}

export interface BarcodeLabel {
  token: string;
  svg: string;
  payload: FulfillmentBarcodePayload;
  productName: string;
  variantName: string;
  sku: string;
  locationCode: string;
  coaNumber: string;
  lot: string;
  layout: ThermalLabelLayout;
}
