import assert from "node:assert/strict";
import test from "node:test";

import type { FulfillmentEvidenceWorkspace } from "../src/shared/fulfillmentEvidence.js";
import { FulfillmentEvidenceNotificationWorkflow } from "../src/server/fulfillmentEvidenceNotification.js";
import type { FulfillmentEvidenceService } from "../src/server/fulfillmentEvidenceService.js";

const fulfillmentId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";

function workspace(notificationState: FulfillmentEvidenceWorkspace["notificationState"]): FulfillmentEvidenceWorkspace {
  return {
    fulfillmentId,
    orderId: 108,
    orderNumber: "108",
    state: "confirmed",
    version: 4,
    confirmedBy: "operator",
    confirmedAt: "2026-10-17T18:00:00.000Z",
    notificationState,
    notificationMessage: "",
    updatedAt: "2026-10-17T18:00:00.000Z",
    files: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        fulfillmentId,
        kind: "contents",
        label: "Packed contents",
        mime: "image/jpeg",
        bytes: 4,
        width: 10,
        height: 10,
        sha256: "a".repeat(64),
        customerVisible: true,
        capturedBy: "operator",
        capturedAt: "2026-10-17T17:58:00.000Z",
        contentUrl: "/contents",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        fulfillmentId,
        kind: "sealed_label",
        label: "Sealed package & label",
        mime: "image/jpeg",
        bytes: 4,
        width: 10,
        height: 10,
        sha256: "b".repeat(64),
        customerVisible: true,
        capturedBy: "operator",
        capturedAt: "2026-10-17T17:59:00.000Z",
        contentUrl: "/sealed",
      },
    ],
  };
}

function evidenceFixture() {
  const calls: string[] = [];
  const repository = {
    async queueNotification() {
      calls.push("queued");
      return { workspace: workspace("queued"), replayed: false };
    },
    async markNotificationSent(input: { message: string }) {
      calls.push(`sent:${input.message}`);
      return { ...workspace("sent"), notificationMessage: input.message };
    },
    async markNotificationFailed(input: { message: string }) {
      calls.push(`failed:${input.message}`);
      return { ...workspace("failed"), notificationMessage: input.message };
    },
    async markNotificationUncertain(input: { message: string }) {
      calls.push(`uncertain:${input.message}`);
      return { ...workspace("uncertain"), notificationMessage: input.message };
    },
  };
  const evidence = {
    repository,
    async read(id: string) {
      const file = workspace("queued").files.find((item) => item.id === id)!;
      return { ...file, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
    },
  } as unknown as FulfillmentEvidenceService;
  return { calls, evidence };
}

test("packaging evidence notification attaches both photos and records WordPress SMTP success", async () => {
  const fixture = evidenceFixture();
  const workflow = new FulfillmentEvidenceNotificationWorkflow(fixture.evidence, {
    async emailPackagingEvidence(input) {
      assert.equal(input.orderId, 108);
      assert.equal(input.eventId, fulfillmentId);
      assert.deepEqual(input.attachments.map((item) => item.kind), ["contents", "sealed_label"]);
      return { state: "sent", sentAt: "2026-10-17T18:01:00Z", replayed: false, message: "Sent with two attachments." };
    },
  });

  const result = await workflow.send({ fulfillmentId, clientEventId: eventId, actorId: "operator" });

  assert.equal(result.notificationState, "sent");
  assert.deepEqual(fixture.calls, ["queued", "sent:Sent with two attachments."]);
});

test("an unconfirmed transport result is locked for reconciliation instead of blindly retried", async () => {
  const fixture = evidenceFixture();
  const workflow = new FulfillmentEvidenceNotificationWorkflow(fixture.evidence, {
    async emailPackagingEvidence() {
      throw new TypeError("fetch failed");
    },
  });

  const result = await workflow.send({ fulfillmentId, clientEventId: eventId, actorId: "operator" });

  assert.equal(result.notificationState, "uncertain");
  assert.match(result.notificationMessage, /mail log before retrying/i);
  assert.equal(fixture.calls.some((call) => call.startsWith("failed:")), false);
});

test("a definitive WordPress rejection is recorded as retryable failure", async () => {
  const fixture = evidenceFixture();
  const workflow = new FulfillmentEvidenceNotificationWorkflow(fixture.evidence, {
    async emailPackagingEvidence() {
      throw new Error("Commerce service returned 400: invalid recipient");
    },
  });

  const result = await workflow.send({ fulfillmentId, clientEventId: eventId, actorId: "operator" });

  assert.equal(result.notificationState, "failed");
  assert.match(result.notificationMessage, /invalid recipient/i);
});
