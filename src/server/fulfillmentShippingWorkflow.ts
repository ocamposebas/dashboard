import type { ShippingDataMode, ShippingLabel } from "../shared/shipping.js";
import {
  FulfillmentShippingRepository,
  type BeginShippingLabelInput,
} from "./fulfillmentShippingRepository.js";
import {
  ShipStationGateway,
  ShipStationGatewayError,
  type ShipStationLabelResult,
  type ShipStationVoidResult,
} from "./shipStationGateway.js";

export class FulfillmentShippingWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: "label_purchase_disabled" | "not_found" | "invalid_state",
  ) {
    super(message);
    this.name = "FulfillmentShippingWorkflowError";
  }
}

export interface ShippingLabelProvider {
  purchaseLabelFromRate(rateId: string): Promise<ShipStationLabelResult>;
  findLabelsByRateId(rateId: string): Promise<ShipStationLabelResult[]>;
  getLabelById(labelId: string): Promise<ShipStationLabelResult>;
  voidLabel(labelId: string): Promise<ShipStationVoidResult>;
}

export class FulfillmentShippingWorkflow {
  constructor(
    private readonly repository: FulfillmentShippingRepository,
    private readonly provider: ShippingLabelProvider,
    private readonly livePurchaseEnabled: boolean,
  ) {}

  static withShipStation(
    repository: FulfillmentShippingRepository,
    gateway: ShipStationGateway,
    livePurchaseEnabled: boolean,
  ): FulfillmentShippingWorkflow {
    return new FulfillmentShippingWorkflow(repository, gateway, livePurchaseEnabled);
  }

  async create(input: BeginShippingLabelInput): Promise<{
    replayed: boolean;
    label: ShippingLabel;
  }> {
    if (input.providerMode === "mock") {
      return this.repository.createMockLabel(input);
    }
    if (!this.livePurchaseEnabled) {
      throw new FulfillmentShippingWorkflowError(
        "Real label purchase is disabled by the server safety flag",
        "label_purchase_disabled",
      );
    }
    const begun = await this.repository.beginPurchase(input);
    if (!begun.execute) return { replayed: true, label: begun.label };
    try {
      const result = await this.provider.purchaseLabelFromRate(input.rate.rateId);
      if (result.status !== "completed" || !result.trackingNumber) {
        return {
          replayed: false,
          label: await this.repository.markUnknown({
            fulfillmentId: input.fulfillmentId,
            clientEventId: input.clientEventId,
            actorId: input.actorId,
            message: "ShipStation accepted the request but the label is still processing. Reconcile before retrying.",
          }),
        };
      }
      return {
        replayed: false,
        label: await this.repository.markReady({
          fulfillmentId: input.fulfillmentId,
          clientEventId: input.clientEventId,
          actorId: input.actorId,
          result,
        }),
      };
    } catch (error) {
      if (error instanceof ShipStationGatewayError && error.code === "purchase_unknown") {
        return {
          replayed: false,
          label: await this.repository.markUnknown({
            fulfillmentId: input.fulfillmentId,
            clientEventId: input.clientEventId,
            actorId: input.actorId,
            message: error.message,
          }),
        };
      }
      const message = error instanceof Error ? error.message : "The label request failed before completion";
      const code = error instanceof ShipStationGatewayError ? error.code : "provider_error";
      return {
        replayed: false,
        label: await this.repository.markFailed({
          fulfillmentId: input.fulfillmentId,
          clientEventId: input.clientEventId,
          actorId: input.actorId,
          code,
          message,
        }),
      };
    }
  }

  async reconcile(input: {
    fulfillmentId: string;
    actorId: string;
  }): Promise<ShippingLabel> {
    const context = await this.repository.getAttemptContext(input.fulfillmentId);
    if (!context) {
      throw new FulfillmentShippingWorkflowError("The shipping attempt does not exist", "not_found");
    }
    if (context.label.state === "label_ready" || context.label.state === "failed" ||
        context.label.state === "voided") {
      return context.label;
    }
    if (context.label.providerMode !== "live") {
      return this.repository.markReconciliationWaiting(input);
    }
    const matches = await this.provider.findLabelsByRateId(context.rateId);
    const completed = matches.filter((label) => label.status === "completed" && label.trackingNumber);
    if (completed.length === 1) {
      return this.repository.markReady({
        fulfillmentId: input.fulfillmentId,
        clientEventId: context.clientEventId,
        actorId: input.actorId,
        result: completed[0]!,
      });
    }
    return this.repository.markReconciliationWaiting(input);
  }

  async void(input: { fulfillmentId: string; actorId: string }): Promise<ShippingLabel> {
    if (!this.livePurchaseEnabled) {
      throw new FulfillmentShippingWorkflowError(
        "Live label changes are disabled by the server safety flag",
        "label_purchase_disabled",
      );
    }
    const context = await this.repository.getAttemptContext(input.fulfillmentId);
    if (!context) {
      throw new FulfillmentShippingWorkflowError("The shipping label does not exist", "not_found");
    }
    if (context.label.state === "voided") return context.label;
    if (context.label.providerMode !== "live" || context.label.state !== "label_ready" || !context.label.labelId) {
      throw new FulfillmentShippingWorkflowError("Only a purchased live label can be voided", "invalid_state");
    }
    const current = await this.provider.getLabelById(context.label.labelId);
    if (current.status === "voided") {
      return this.repository.markVoided({
        fulfillmentId: input.fulfillmentId,
        actorId: input.actorId,
        message: "ShipStation already reported this label as voided.",
      });
    }
    const result = await this.provider.voidLabel(context.label.labelId);
    if (!result.approved) {
      throw new FulfillmentShippingWorkflowError(result.message, "invalid_state");
    }
    return this.repository.markVoided({
      fulfillmentId: input.fulfillmentId,
      actorId: input.actorId,
      message: result.message,
    });
  }
}

export function sourceShippingBlocksPurchase(source: BeginShippingLabelInput["sourceShipping"]): string | null {
  if (source.trackingNumber) return "This order already has a tracking number.";
  if (source.shipmentIds.length) return "This order already references a ShipStation shipment.";
  if (source.shippedItemCount > 0) return "This order already contains shipped items.";
  if (source.exported) {
    return "This order is already synchronized to ShipStation. Link or reconcile that record before native label purchase.";
  }
  return null;
}

export function purchaseModeFor(
  dataMode: ShippingDataMode,
  livePurchaseEnabled: boolean,
): "mock_only" | "live_disabled" | "live_enabled" {
  return dataMode === "mock" ? "mock_only" : livePurchaseEnabled ? "live_enabled" : "live_disabled";
}
