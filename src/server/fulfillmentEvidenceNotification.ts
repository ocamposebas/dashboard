import type { FulfillmentEvidenceWorkspace } from "../shared/fulfillmentEvidence.js";
import type {
  PackagingEvidenceEmailAttachment,
  PackagingEvidenceEmailResult,
} from "./wooCommerceGateway.js";
import { FulfillmentEvidenceService } from "./fulfillmentEvidenceService.js";

export interface PackagingEvidenceEmailGateway {
  emailPackagingEvidence(input: {
    orderId: number;
    eventId: string;
    confirmedAt: string;
    attachments: PackagingEvidenceEmailAttachment[];
  }): Promise<PackagingEvidenceEmailResult>;
}

function safeFailure(error: unknown): boolean {
  return error instanceof Error && (
    /^Commerce service returned \d{3}:/.test(error.message) ||
    /^Packaging evidence email /.test(error.message) ||
    /^Both packaging evidence photos /.test(error.message)
  );
}

function deliveryMessage(error: unknown, uncertain: boolean): string {
  if (uncertain) {
    return "WordPress did not confirm delivery. Review the WordPress mail log before retrying to avoid a duplicate email.";
  }
  if (error instanceof Error && error.message.trim()) {
    return `WordPress email failed: ${error.message}`;
  }
  return "WordPress email failed before delivery was accepted.";
}

export class FulfillmentEvidenceNotificationWorkflow {
  constructor(
    private readonly evidence: FulfillmentEvidenceService,
    private readonly gateway: PackagingEvidenceEmailGateway,
  ) {}

  async send(input: {
    fulfillmentId: string;
    clientEventId: string;
    actorId: string;
  }): Promise<FulfillmentEvidenceWorkspace> {
    const queued = await this.evidence.repository.queueNotification(input);
    if (queued.replayed && queued.workspace.notificationState === "sent") return queued.workspace;

    const confirmedAt = queued.workspace.confirmedAt;
    if (!confirmedAt) {
      return this.evidence.repository.markNotificationFailed({
        ...input,
        message: "Packaging evidence has no confirmation timestamp.",
      });
    }

    try {
      const attachments = await Promise.all(queued.workspace.files.map(async (file) => {
        const stored = await this.evidence.read(file.id);
        return {
          kind: file.kind,
          mime: file.mime,
          bytes: stored.bytes,
        } satisfies PackagingEvidenceEmailAttachment;
      }));
      const result = await this.gateway.emailPackagingEvidence({
        orderId: queued.workspace.orderId,
        // One stable WordPress delivery key per fulfillment. Browser retry UUIDs
        // remain audit events and can never purchase a second email delivery.
        eventId: queued.workspace.fulfillmentId,
        confirmedAt,
        attachments,
      });
      if (result.state === "uncertain") {
        return this.evidence.repository.markNotificationUncertain({
          ...input,
          message: result.message || "WordPress reported an uncertain email state. Review the mail log before retrying.",
        });
      }
      return this.evidence.repository.markNotificationSent({
        ...input,
        message: result.message || "Customer email sent through WordPress SMTP with both photos attached.",
      });
    } catch (error: unknown) {
      const uncertain = !safeFailure(error);
      if (uncertain) {
        return this.evidence.repository.markNotificationUncertain({
          ...input,
          message: deliveryMessage(error, true),
        });
      }
      return this.evidence.repository.markNotificationFailed({
        ...input,
        message: deliveryMessage(error, false),
      });
    }
  }
}
