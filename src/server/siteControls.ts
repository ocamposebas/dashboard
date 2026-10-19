import type {
  CommerceSiteControls,
  CommerceSiteControlsWrite,
} from "./wooCommerceGateway.js";
import type { IndependentSiteControlsRecord } from "./presenceStore.js";

export interface SiteControlProductSnapshot {
  id: number;
  name: string;
  sku: string;
  image: string;
  originalPrice: number;
}

export type IndependentSiteControls = IndependentSiteControlsRecord & CommerceSiteControls;

const DEFAULT_PROMO = {
  enabled: false,
  type: "general",
  durationMinutes: 1_440,
  eyebrow: "Limited time special",
  title: "Research essentials",
  info: "Research essentials, available for a limited time.",
  endsAt: null,
  ctaLabel: "Shop products",
  ctaUrl: "/research-peptides/",
  product: null,
};

const DEFAULT_MAINTENANCE = {
  enabled: false,
  title: "Precision work in progress.",
  message: "We are completing a carefully planned maintenance window and will be back shortly.",
  supportEmail: "support@phaseonelabz.com",
  updatedAt: null,
};

export function defaultIndependentSiteControls(): IndependentSiteControls {
  return {
    version: "2.0",
    source: "operations-control-plane",
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system-default",
    promo: { ...DEFAULT_PROMO },
    maintenance: { ...DEFAULT_MAINTENANCE },
  };
}

export function importCommerceSiteControls(
  value: CommerceSiteControls,
  updatedBy = "wordpress-bootstrap",
): Omit<IndependentSiteControls, "revision" | "updatedAt"> {
  return {
    version: value.version || "2.0",
    source: "operations-control-plane",
    updatedBy,
    promo: { ...value.promo },
    maintenance: { ...value.maintenance },
  };
}

export function buildIndependentSiteControls(
  write: CommerceSiteControlsWrite,
  current: IndependentSiteControls,
  product: SiteControlProductSnapshot | null,
  updatedBy: string,
  now = new Date(),
): Omit<IndependentSiteControls, "revision" | "updatedAt"> {
  const totalDurationMinutes = Math.max(
    1,
    write.promo.durationDays * 1_440 +
      write.promo.durationHours * 60 +
      write.promo.durationMinutes,
  );
  const keepExistingEnd =
    write.promo.enabled &&
    !write.promo.restart &&
    current.promo.enabled &&
    current.promo.endsAt &&
    Date.parse(current.promo.endsAt) > now.getTime();
  const endsAt = write.promo.enabled
    ? keepExistingEnd
      ? current.promo.endsAt
      : new Date(now.getTime() + totalDurationMinutes * 60_000).toISOString()
    : null;
  const currentProduct = current.promo.product;
  const productSnapshot = write.promo.type === "product"
    ? product || (currentProduct?.id === write.promo.productId
      ? {
          id: currentProduct.id,
          name: currentProduct.name,
          sku: currentProduct.sku,
          image: currentProduct.image,
          originalPrice: currentProduct.originalPrice,
        }
      : null)
    : null;

  return {
    version: "2.0",
    source: "operations-control-plane",
    updatedBy,
    promo: {
      enabled: write.promo.enabled,
      type: write.promo.type,
      durationMinutes: totalDurationMinutes,
      eyebrow: write.promo.eyebrow,
      title: write.promo.type === "simple_gifts" && write.promo.sitewideLabel
        ? write.promo.sitewideLabel
        : write.promo.title,
      info: write.promo.info,
      endsAt,
      ctaLabel: write.promo.ctaLabel,
      ctaUrl: write.promo.ctaUrl,
      product: productSnapshot
        ? {
            ...productSnapshot,
            promoPrice: write.promo.salePrice,
            salePriceActive: write.promo.enabled,
          }
        : null,
      ...("simpleGifts" in current.promo
        ? { simpleGifts: (current.promo as Record<string, unknown>).simpleGifts }
        : {}),
    },
    maintenance: {
      enabled: write.maintenance.enabled,
      title: write.maintenance.title,
      message: write.maintenance.message,
      supportEmail: write.maintenance.supportEmail,
      updatedAt: now.toISOString(),
    },
  };
}

export function publicSiteControls(value: IndependentSiteControls): Record<string, unknown> {
  return {
    configured: true,
    version: value.version,
    source: value.source,
    revision: value.revision,
    updatedAt: value.updatedAt,
    promo: value.promo,
    maintenance: value.maintenance,
  };
}
