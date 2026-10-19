import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIndependentSiteControls,
  defaultIndependentSiteControls,
  publicSiteControls,
} from "../src/server/siteControls.js";
import type { CommerceSiteControlsWrite } from "../src/server/wooCommerceGateway.js";

function writeInput(): CommerceSiteControlsWrite {
  return {
    promo: {
      enabled: false,
      type: "general",
      productId: 0,
      salePrice: 0,
      sitewideLabel: "",
      eyebrow: "Notice",
      title: "Laboratory update",
      info: "Storefront operations continue normally.",
      ctaLabel: "View catalog",
      ctaUrl: "/research-peptides/",
      durationDays: 1,
      durationHours: 0,
      durationMinutes: 0,
      restart: false,
    },
    maintenance: {
      enabled: true,
      title: "Planned maintenance",
      message: "We will return shortly.",
      supportEmail: "support@phaseonelabz.com",
    },
  };
}

test("independent Site Controls default to an open storefront", () => {
  const value = defaultIndependentSiteControls();
  assert.equal(value.source, "operations-control-plane");
  assert.equal(value.maintenance.enabled, false);
  assert.equal(value.revision, 0);
});

test("a control-plane write does not require a WordPress response", () => {
  const now = new Date("2026-10-15T17:00:00.000Z");
  const value = buildIndependentSiteControls(
    writeInput(),
    defaultIndependentSiteControls(),
    null,
    "Operations Admin",
    now,
  );
  assert.equal(value.maintenance.enabled, true);
  assert.equal(value.maintenance.updatedAt, now.toISOString());
  assert.equal(value.updatedBy, "Operations Admin");
  assert.equal(value.source, "operations-control-plane");
});

test("public Site Controls excludes the internal editor identity", () => {
  const payload = publicSiteControls({
    ...defaultIndependentSiteControls(),
    updatedBy: "Private Administrator",
  });
  assert.equal(payload.source, "operations-control-plane");
  assert.equal("updatedBy" in payload, false);
});
