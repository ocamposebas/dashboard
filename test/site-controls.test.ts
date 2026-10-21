import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIndependentSiteControls,
  defaultIndependentSiteControls,
  publicSiteControls,
  type IndependentSiteControlsWrite,
} from "../src/server/siteControls.js";
import {
  nextSiteControlRevision,
  SiteControlRepositoryError,
} from "../src/server/siteControlRepository.js";

function writeInput(): IndependentSiteControlsWrite {
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
  assert.equal(value.version, "3.0");
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

test("independent Site Controls reject stale editor revisions", () => {
  assert.equal(nextSiteControlRevision(7, 7), 8);
  assert.throws(
    () => nextSiteControlRevision(8, 7),
    (error: unknown) => error instanceof SiteControlRepositoryError && error.code === "revision_conflict",
  );
});
