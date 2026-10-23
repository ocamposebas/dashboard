export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type FulfillmentState = "open" | "paused" | "packed" | "cancelled";
export type FulfillmentSyncState = "not_needed" | "pending" | "synced" | "failed";
export type FulfillmentScanResult = "accepted" | "rejected";
export type FulfillmentEventType =
  | "started"
  | "resumed"
  | "paused"
  | "cancelled"
  | "packed"
  | "sync_succeeded"
  | "sync_failed";

export interface FulfillmentSession {
  id: string;
  orderId: number;
  orderNumber: string;
  state: FulfillmentState;
  sourceModifiedAt: string | null;
  sourceSnapshot: JsonValue;
  progress: JsonValue;
  completionSnapshot: JsonValue | null;
  startedBy: string;
  cancelledBy: string | null;
  cancelReason: string | null;
  startedAt: string;
  updatedAt: string;
  packedAt: string | null;
  version: number;
  wordpressSyncState: FulfillmentSyncState;
  wordpressSyncAttempts: number;
  wordpressNextRetryAt: string | null;
  wordpressLastError: string | null;
}

export interface FulfillmentScanEvent {
  id: string;
  fulfillmentId: string;
  clientEventId: string;
  rawBarcode: string;
  barcodeType: string | null;
  productId: number | null;
  variationId: number | null;
  orderItemId: number | null;
  coaId: string | null;
  lot: string | null;
  result: FulfillmentScanResult;
  reasonCode: string;
  quantityDelta: number;
  responseSnapshot: JsonValue;
  actorId: string;
  createdAt: string;
}

export interface StartFulfillmentInput {
  orderId: number;
  orderNumber: string;
  sourceModifiedAt: string | null;
  sourceSnapshot: JsonValue;
  progress: JsonValue;
  actorId: string;
}

export interface FulfillmentScanDecision {
  result: FulfillmentScanResult;
  reasonCode: string;
  quantityDelta: number;
  responseSnapshot: JsonValue;
  nextProgress?: JsonValue;
  barcodeType?: string;
  productId?: number;
  variationId?: number;
  orderItemId?: number;
  coaId?: string;
  lot?: string;
}

export interface RecordFulfillmentScanInput {
  fulfillmentId: string;
  clientEventId: string;
  rawBarcode: string;
  actorId: string;
  expectedVersion?: number;
}

export interface RecordedFulfillmentScan {
  replayed: boolean;
  session: FulfillmentSession;
  event: FulfillmentScanEvent;
}

export type FulfillmentQueueStatus = "waiting" | "active" | "paused" | "packed" | "blocked";

export interface FulfillmentQueueReason {
  code: string;
  message: string;
}

export interface FulfillmentQueueLine {
  orderItemId: number;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  quantity: number;
  imageUrl: string | null;
  locationCode: string | null;
  inheritedLocation: boolean;
  coa: {
    id: string;
    number: string;
    lot: string;
    batch: string;
  } | null;
  verifiedQuantity: number;
  verifiedLots: FulfillmentCoaAllocation[];
}

export interface FulfillmentQueueEntry {
  orderId: number;
  orderNumber: string;
  customer: string;
  orderStatus: string;
  paymentMethod: string;
  createdAt: string | null;
  modifiedAt: string | null;
  queueStatus: FulfillmentQueueStatus;
  itemCount: number;
  unitCount: number;
  verifiedUnits: number;
  lines: FulfillmentQueueLine[];
  reasons: FulfillmentQueueReason[];
  primaryAction: "start" | "resume" | "open" | "review" | "none";
  session: FulfillmentSession | null;
}

export interface FulfillmentQueuePayload {
  configured: boolean;
  connected: boolean;
  generatedAt: string;
  activeSessionId: string | null;
  permissions: {
    read: boolean;
    operateQueue: boolean;
  };
  orders: FulfillmentQueueEntry[];
  error?: string;
}

export type FulfillmentScanReasonCode =
  | "accepted"
  | "unknown_barcode"
  | "inactive_barcode"
  | "batch_required"
  | "wrong_product"
  | "wrong_variation"
  | "wrong_batch"
  | "invalid_coa"
  | "quantity_complete"
  | "order_ineligible"
  | "order_changed"
  | "line_changed"
  | "verification_method_changed";

export interface FulfillmentScanFeedback {
  accepted: boolean;
  reasonCode: FulfillmentScanReasonCode;
  message: string;
  productName: string | null;
  sku: string | null;
  locationCode: string | null;
  lot: string | null;
  orderItemId: number | null;
  verifiedQuantity: number;
  requiredQuantity: number;
  verifiedUnits: number;
  totalUnits: number;
  complete: boolean;
  scannedProductName: string | null;
  scannedSku: string | null;
  expectedProductName: string | null;
  expectedSku: string | null;
}

export interface FulfillmentScanPayload {
  replayed: boolean;
  session: FulfillmentSession;
  event: FulfillmentScanEvent;
  feedback: FulfillmentScanFeedback;
}

export interface FulfillmentPackingLineSnapshot {
  [key: string]: JsonValue;
  orderItemId: number;
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  requiredQuantity: number;
  verifiedQuantity: number;
  locationCode: string;
  coaId: string;
  coaNumber: string;
  lot: string;
  batch: string;
  allocations: FulfillmentCoaAllocation[];
}

export interface FulfillmentCoaAllocation {
  [key: string]: JsonValue;
  orderItemId: number;
  coaId: string;
  coaNumber: string;
  lot: string;
  batch: string;
  quantity: number;
}

export interface FulfillmentPackingSnapshot {
  [key: string]: JsonValue;
  version: 1;
  clientEventId: string;
  orderId: number;
  orderNumber: string;
  sourceModifiedAt: string | null;
  confirmedAt: string;
  packedBy: string;
  verifiedUnits: number;
  totalUnits: number;
  lines: FulfillmentPackingLineSnapshot[];
}

export interface FulfillmentPackingPayload {
  replayed: boolean;
  session: FulfillmentSession;
  snapshot: FulfillmentPackingSnapshot;
  coaSync?: {
    state: "synced" | "pending" | "failed";
    message: string;
    assignedUnits: number;
  };
}
