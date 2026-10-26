import assert from "node:assert/strict";
import test from "node:test";

import {
  AffiliateManagementError,
  affiliateApplicationDecisionInput,
} from "../src/server/affiliateManagement.js";

test("affiliate application decisions accept only valid ids and supported actions", () => {
  const applicationId = "918f8da0-35c7-4cc4-9ac5-c6d6fe13c11b";
  assert.deepEqual(affiliateApplicationDecisionInput({ applicationId, decision: "approved" }), {
    applicationId,
    decision: "approved",
  });
  assert.deepEqual(affiliateApplicationDecisionInput({ applicationId, decision: "rejected" }), {
    applicationId,
    decision: "rejected",
  });
});

test("affiliate application decisions reject malformed requests", () => {
  for (const value of [
    { applicationId: "", decision: "approved" },
    { applicationId: "not-a-uuid", decision: "approved" },
    { applicationId: "918f8da0-35c7-4cc4-9ac5-c6d6fe13c11b", decision: "pending" },
  ]) {
    assert.throws(
      () => affiliateApplicationDecisionInput(value),
      (error: unknown) => error instanceof AffiliateManagementError && error.code === "invalid_application_decision",
    );
  }
});
