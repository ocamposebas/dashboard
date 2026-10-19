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

export interface MarketingCartItem {
  productId: number;
  variationId: number;
  name: string;
  sku: string;
  quantity: number;
  price: number;
  imageUrl: string;
}

export interface MarketingCart {
  sessionId: string;
  visitorNumber: number;
  customerName: string;
  customerEmail: string;
  items: MarketingCartItem[];
  itemCount: number;
  total: number;
  status: "active" | "abandoned" | "converted" | "cleared";
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  path: string;
}

export interface MarketingAnalytics {
  topSearches: Array<{ query: string; count: number; zeroResults: number }>;
  recentSearches: Array<{
    sessionId: string;
    visitorNumber: number;
    query: string;
    resultCount: number;
    path: string;
    searchedAt: string;
  }>;
  carts: MarketingCart[];
  activeCarts: number;
  abandonedCarts: number;
  capturedValue: number;
  abandonedValue: number;
  zeroResultSearches: number;
}

export interface PresenceSnapshot {
  type: "presence:snapshot";
  counts: PresenceCounts;
  total: number;
  serverTime: string;
  analytics: {
    timeZone: string;
    totalViews: number;
    uniqueVisitors: number;
    returningVisitors: number;
    totalSessions: number;
    returningSessions: number;
    totalClicks: number;
    totalOrders: number;
    visitorsLast30Minutes: number;
    visitorRanges: {
      today: number;
      last7Days: number;
      last30Days: number;
      all: number;
    };
    topPages: Array<{ path: string; views: number }>;
    topSources: Array<{ label: string; count: number }>;
    topDevices: Array<{ label: string; count: number }>;
    topClicks: Array<{ label: string; path: string; count: number }>;
    dailyViews: Array<{ date: string; views: number }>;
    dailyVisitors: Array<{ date: string; visitors: number }>;
    dailyActivity: Array<{
      date: string;
      views: number;
      visitors: number;
      sessions: number;
      returningSessions: number;
      clicks: number;
      orders: number;
    }>;
    recentSessions: Array<{
      id: string;
      number: number;
      visitorNumber: number;
      visitNumber: number;
      returningVisitor: boolean;
      source: string;
      device: string;
      path: string;
      startedAt: string;
      lastSeenAt: string;
      pageViews: number;
      clicks: number;
      orderCompleted: boolean;
      orderCompletedAt?: string;
      events: Array<{
        type: "pageview" | "click" | "order";
        at: string;
        path: string;
        label?: string;
        status?: "paid";
      }>;
    }>;
    /**
     * Customer-intent data is optional so older monitor relays can continue to
     * feed a newer dashboard during a rolling deployment.
     */
    marketing?: MarketingAnalytics;
  };
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
