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

test("a product campaign replaces an old CTA with the exact selected product URL", () => {
  const write = writeInput();
  write.promo.enabled = true;
  write.promo.type = "product";
  write.promo.productId = 22;
  write.promo.salePrice = 40;
  write.promo.ctaUrl = "/product/old-campaign/";
  const value = buildIndependentSiteControls(
    write,
    defaultIndependentSiteControls(),
    {
      id: 22,
      name: "Test compound",
      slug: "test-compound",
      url: "/product/test-compound/",
      sku: "TEST-22",
      image: "",
      originalPrice: 65,
    },
    "Operations Admin",
    new Date("2026-10-21T17:00:00.000Z"),
  );

  assert.equal(value.promo.ctaUrl, "/product/test-compound/");
  assert.equal(value.promo.product?.promoPrice, 40);
});

test("public Site Controls excludes the internal editor identity", () => {
  const value = defaultIndependentSiteControls();
  value.promo.product = {
    id: 22,
    name: "Test compound",
    slug: "test-compound",
    url: "/product/test-compound/",
    sku: "TEST-22",
    image: "",
    originalPrice: 65,
    promoPrice: 40,
    salePriceActive: true,
    previousSalePrice: 55,
    previousSaleStartsAt: "2026-10-01T00:00:00.000Z",
    previousSaleEndsAt: "2026-10-31T00:00:00.000Z",
  };
  const payload = publicSiteControls({
    ...value,
    updatedBy: "Private Administrator",
  });
  assert.equal(payload.source, "operations-control-plane");
  assert.equal("updatedBy" in payload, false);
  const publicPromo = payload.promo as Record<string, unknown>;
  const publicProduct = publicPromo.product as Record<string, unknown>;
  assert.equal(publicPromo.ctaUrl, "/research-peptides/");
  assert.equal(publicProduct.url, "/product/test-compound/");
  assert.equal(publicProduct.slug, "test-compound");
  assert.equal("previousSalePrice" in publicProduct, false);
});

test("independent Site Controls reject stale editor revisions", () => {
  assert.equal(nextSiteControlRevision(7, 7), 8);
  assert.throws(
    () => nextSiteControlRevision(8, 7),
    (error: unknown) => error instanceof SiteControlRepositoryError && error.code === "revision_conflict",
  );
});
