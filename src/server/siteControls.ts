export interface SiteControlProductSnapshot {
  id: number;
  name: string;
  slug?: string | undefined;
  url?: string | undefined;
  sku: string;
  image: string;
  originalPrice: number;
  previousSalePrice?: number | null | undefined;
  previousSaleStartsAt?: string | null | undefined;
  previousSaleEndsAt?: string | null | undefined;
}

export interface IndependentSiteControls {
  version: string;
  source: "operations-control-plane";
  revision: number;
  updatedAt: string;
  updatedBy: string;
  promo: {
    enabled: boolean;
    type: string;
    durationMinutes: number;
    eyebrow: string;
    title: string;
    info: string;
    endsAt: string | null;
    ctaLabel: string;
    ctaUrl: string;
    product: {
      id: number;
      name: string;
      slug?: string | undefined;
      url?: string | undefined;
      sku: string;
      image: string;
      originalPrice: number;
      promoPrice: number;
      salePriceActive: boolean;
      previousSalePrice?: number | null | undefined;
      previousSaleStartsAt?: string | null | undefined;
      previousSaleEndsAt?: string | null | undefined;
    } | null;
    simpleGifts?: unknown;
  };
  maintenance: {
    enabled: boolean;
    title: string;
    message: string;
    supportEmail: string;
    updatedAt: string | null;
  };
}

export interface IndependentSiteControlsWrite {
  promo: {
    enabled: boolean;
    type: "general" | "product" | "simple_gifts";
    productId: number;
    salePrice: number;
    sitewideLabel: string;
    eyebrow: string;
    title: string;
    info: string;
    ctaLabel: string;
    ctaUrl: string;
    durationDays: number;
    durationHours: number;
    durationMinutes: number;
    restart: boolean;
  };
  maintenance: {
    enabled: boolean;
    title: string;
    message: string;
    supportEmail: string;
  };
}

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
    version: "3.0",
    source: "operations-control-plane",
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system-default",
    promo: { ...DEFAULT_PROMO },
    maintenance: { ...DEFAULT_MAINTENANCE },
  };
}

export function buildIndependentSiteControls(
  write: IndependentSiteControlsWrite,
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
          slug: currentProduct.slug,
          url: currentProduct.url,
          sku: currentProduct.sku,
          image: currentProduct.image,
          originalPrice: currentProduct.originalPrice,
          previousSalePrice: currentProduct.previousSalePrice,
          previousSaleStartsAt: currentProduct.previousSaleStartsAt,
          previousSaleEndsAt: currentProduct.previousSaleEndsAt,
        }
      : null)
    : null;

  return {
    version: "3.0",
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
      ctaUrl: write.promo.type === "product" && productSnapshot?.url
        ? productSnapshot.url
        : write.promo.ctaUrl,
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
  const publicProduct = value.promo.product
    ? {
        id: value.promo.product.id,
        name: value.promo.product.name,
        slug: value.promo.product.slug,
        url: value.promo.product.url,
        sku: value.promo.product.sku,
        image: value.promo.product.image,
        originalPrice: value.promo.product.originalPrice,
        promoPrice: value.promo.product.promoPrice,
        salePriceActive: value.promo.product.salePriceActive,
      }
    : null;
  return {
    configured: true,
    version: value.version,
    source: value.source,
    revision: value.revision,
    updatedAt: value.updatedAt,
    promo: { ...value.promo, product: publicProduct },
    maintenance: value.maintenance,
  };
}
