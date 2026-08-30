export const PRESENCE_SECTIONS = [
  "HOME",
  "SHOP",
  "PRODUCT",
  "CART",
  "CHECKOUT",
  "OTHER",
] as const;

export type PresenceSection = (typeof PRESENCE_SECTIONS)[number];

export type PresenceCounts = Record<PresenceSection, number>;

export interface PresenceSnapshot {
  type: "presence:snapshot";
  counts: PresenceCounts;
  total: number;
  serverTime: string;
}

export function isPresenceSection(value: unknown): value is PresenceSection {
  return (
    typeof value === "string" &&
    (PRESENCE_SECTIONS as readonly string[]).includes(value)
  );
}

export function emptyPresenceCounts(): PresenceCounts {
  return {
    HOME: 0,
    SHOP: 0,
    PRODUCT: 0,
    CART: 0,
    CHECKOUT: 0,
    OTHER: 0,
  };
}
