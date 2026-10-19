export type FulfillmentEvidenceKind = "contents" | "sealed_label";
export type FulfillmentEvidenceState = "draft" | "confirmed";
export type FulfillmentEvidenceNotificationState =
  | "not_configured"
  | "queued"
  | "sent"
  | "uncertain"
  | "failed";

export interface FulfillmentEvidenceFile {
  id: string;
  fulfillmentId: string;
  kind: FulfillmentEvidenceKind;
  label: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  customerVisible: boolean;
  capturedBy: string;
  capturedAt: string;
  contentUrl: string;
}

export interface FulfillmentEvidenceWorkspace {
  fulfillmentId: string;
  orderId: number;
  orderNumber: string;
  state: FulfillmentEvidenceState;
  version: number;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notificationState: FulfillmentEvidenceNotificationState;
  notificationMessage: string;
  files: FulfillmentEvidenceFile[];
  updatedAt: string;
}

