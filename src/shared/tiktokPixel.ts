export const TIKTOK_PIXEL_EVENT_KEYS = [
  "pageView",
  "viewContent",
  "search",
  "addToCart",
  "initiateCheckout",
  "purchase",
] as const;

export type TikTokPixelEventKey = typeof TIKTOK_PIXEL_EVENT_KEYS[number];

export type TikTokPixelEvents = Record<TikTokPixelEventKey, boolean>;

export interface TikTokPixelSettings {
  version: "1.0";
  source: "operations-control-plane";
  provider: "tiktok";
  enabled: boolean;
  pixelId: string;
  events: TikTokPixelEvents;
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

export type PublicTikTokPixelSettings = Omit<TikTokPixelSettings, "updatedBy">;

export const DEFAULT_TIKTOK_PIXEL_ID = "D9UBLSRC77UDKVSV1D90";

export function defaultTikTokPixelEvents(): TikTokPixelEvents {
  return {
    pageView: true,
    viewContent: true,
    search: true,
    addToCart: true,
    initiateCheckout: true,
    purchase: true,
  };
}

export function normalizeTikTokPixelId(value: unknown): string {
  const pixelId = typeof value === "string" ? value.trim() : "";
  if (!pixelId) return "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(pixelId)) {
    throw new Error("Enter a valid TikTok Pixel ID, not a script or code snippet");
  }
  return pixelId;
}

export function normalizeTikTokPixelEvents(value: unknown): TikTokPixelEvents {
  const input = value && typeof value === "object"
    ? value as Partial<Record<TikTokPixelEventKey, unknown>>
    : {};
  const defaults = defaultTikTokPixelEvents();
  return Object.fromEntries(
    TIKTOK_PIXEL_EVENT_KEYS.map((key) => [
      key,
      typeof input[key] === "boolean" ? input[key] : defaults[key],
    ]),
  ) as TikTokPixelEvents;
}

export function defaultTikTokPixelSettings(now = new Date()): TikTokPixelSettings {
  return {
    version: "1.0",
    source: "operations-control-plane",
    provider: "tiktok",
    enabled: true,
    pixelId: DEFAULT_TIKTOK_PIXEL_ID,
    events: defaultTikTokPixelEvents(),
    revision: 1,
    updatedBy: "system:migrated-hardcoded-pixel",
    updatedAt: now.toISOString(),
  };
}

export function publicTikTokPixelSettings(
  settings: TikTokPixelSettings,
): PublicTikTokPixelSettings {
  const { updatedBy: _updatedBy, ...publicSettings } = settings;
  return publicSettings;
}
