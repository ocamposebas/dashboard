import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { PHASE_ONE_EMAIL_TEMPLATES, renderPhaseOneEmail, type MarketingEmailProduct } from "../shared/marketingEmail.js";
import type { MarketingEmailRepository } from "./marketingEmailRepository.js";

export interface MarketingEmailTransport {
  sendMarketingEmail(input: {
    eventId: string;
    recipient: string;
    subject: string;
    html: string;
    text: string;
    unsubscribeUrl: string;
  }): Promise<{ state: "sent" | "uncertain"; sentAt: string | null; replayed: boolean; message: string }>;
}

export class MarketingEmailService {
  private processing = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly repository: MarketingEmailRepository,
    private readonly transport: MarketingEmailTransport,
    private readonly publicOrigin: string,
    private readonly signingSecret: string,
  ) {}

  templates() {
    return PHASE_ONE_EMAIL_TEMPLATES;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.processOne(), 2_000);
    this.timer.unref();
    setTimeout(() => void this.processOne(), 500).unref();
  }

  async sendTest(input: {
    recipient: string;
    subject: string;
    preheader: string;
    heading: string;
    message: string;
    buttonLabel: string;
    buttonUrl: string;
    templateKey: string;
    products: MarketingEmailProduct[];
  }) {
    const template = PHASE_ONE_EMAIL_TEMPLATES.find((item) => item.key === input.templateKey);
    const rendered = renderPhaseOneEmail({
      ...input,
      recipientName: "Phase One team",
      unsubscribeUrl: "https://phaseonelabz.com/",
      logoUrl: `${this.publicOrigin}/assets/phase-one-email-logo-v2.png`,
      ...(template?.accent ? { accent: template.accent } : {}),
    });
    return this.transport.sendMarketingEmail({
      eventId: randomUUID(),
      recipient: input.recipient,
      subject: `[TEST] ${input.subject}`,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl: "https://phaseonelabz.com/",
    });
  }

  unsubscribeToken(contactId: string): string {
    const encoded = Buffer.from(contactId, "utf8").toString("base64url");
    const signature = createHmac("sha256", this.signingSecret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  contactIdFromToken(token: string): string | null {
    const [encoded, supplied] = token.split(".");
    if (!encoded || !supplied) return null;
    const expected = createHmac("sha256", this.signingSecret).update(encoded).digest("base64url");
    const left = Buffer.from(supplied);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
    const contactId = Buffer.from(encoded, "base64url").toString("utf8");
    return /^[a-f0-9-]{36}$/i.test(contactId) ? contactId : null;
  }

  private unsubscribeUrl(contactId: string): string {
    return `${this.publicOrigin}/api/public/marketing/unsubscribe?token=${encodeURIComponent(this.unsubscribeToken(contactId))}`;
  }

  private async processOne(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.repository.reconcileQueue();
      const delivery = await this.repository.claimDelivery();
      if (!delivery) return;
      const template = PHASE_ONE_EMAIL_TEMPLATES.find((item) => item.key === delivery.campaign.templateKey);
      const unsubscribeUrl = this.unsubscribeUrl(delivery.contactId);
      const rendered = renderPhaseOneEmail({
        preheader: delivery.campaign.preheader,
        heading: delivery.campaign.heading,
        message: delivery.campaign.message,
        buttonLabel: delivery.campaign.buttonLabel,
        buttonUrl: delivery.campaign.buttonUrl,
        recipientName: delivery.firstName || delivery.lastName || "Research partner",
        unsubscribeUrl,
        logoUrl: `${this.publicOrigin}/assets/phase-one-email-logo-v2.png`,
        products: delivery.campaign.products,
        ...(template?.accent ? { accent: template.accent } : {}),
      });
      try {
        const result = await this.transport.sendMarketingEmail({
          eventId: delivery.eventId,
          recipient: delivery.email,
          subject: delivery.campaign.subject,
          html: rendered.html,
          text: rendered.text,
          unsubscribeUrl,
        });
        await this.repository.markDelivery({
          deliveryId: delivery.deliveryId,
          contactId: delivery.contactId,
          campaignId: delivery.campaignId,
          status: result.state,
          error: result.state === "uncertain" ? result.message : "",
          sentAt: result.sentAt,
        });
      } catch (error: unknown) {
        await this.repository.markDelivery({
          deliveryId: delivery.deliveryId,
          contactId: delivery.contactId,
          campaignId: delivery.campaignId,
          status: "failed",
          error: error instanceof Error ? error.message : "WordPress SMTP delivery failed",
        });
      }
    } catch (error: unknown) {
      console.error("Marketing email queue failed", error);
    } finally {
      this.processing = false;
    }
  }
}
