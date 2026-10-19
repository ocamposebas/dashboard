import { createClient, type RedisClientType } from "redis";
import { randomUUID } from "node:crypto";
import {
  emptyPresenceCounts,
  isPresenceSection,
  type MarketingAnalytics,
  type MarketingCart,
  type MarketingCartItem,
  type PresenceSection,
  type PresenceSnapshot,
} from "../shared/protocol.js";
import {
  analyticsDateKey,
  analyticsDateRange,
  DEFAULT_ANALYTICS_TIME_ZONE,
} from "./analyticsDate.js";

interface PresenceRecord {
  visitorId: string;
  section: PresenceSection;
  connectionId: string;
  touchedAt: number;
}

interface AnalyticsEvent {
  type: "pageview" | "click" | "order";
  at: string;
  path: string;
  label?: string;
  status?: "paid";
}

interface AnalyticsSession {
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
  events: AnalyticsEvent[];
}

interface StoredSearchIntent {
  sessionId: string;
  query: string;
  resultCount: number;
  path: string;
  searchedAt: string;
}

interface StoredMarketingCart {
  sessionId: string;
  customerName: string;
  customerEmail: string;
  items: MarketingCartItem[];
  itemCount: number;
  total: number;
  status: "active" | "converted" | "cleared";
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  path: string;
}

export type ManagedUserRole = "owner" | "administrator" | "operations" | "analyst";

export interface ManagedUserRecord {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: ManagedUserRole;
  status: "active" | "suspended";
  passwordHash: string;
  authVersion: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface NotificationRecord {
  id: string;
  type: "order" | "seo" | "security" | "system";
  severity: "info" | "success" | "warning" | "critical";
  title: string;
  message: string;
  createdAt: string;
  actionView: string;
  actionEntityId?: number;
  readBy: string[];
}

export interface IndependentSiteControlsRecord {
  version: string;
  source: "operations-control-plane";
  revision: number;
  updatedAt: string;
  updatedBy: string;
  promo: Record<string, unknown>;
  maintenance: Record<string, unknown>;
}

function parseStoredSession(value: string | null): AnalyticsSession | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      typeof raw.source !== "string" ||
      typeof raw.device !== "string" ||
      typeof raw.path !== "string" ||
      typeof raw.startedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.startedAt)) ||
      typeof raw.lastSeenAt !== "string" ||
      !Number.isFinite(Date.parse(raw.lastSeenAt))
    ) {
      return null;
    }
    const visitNumber =
      Number.isSafeInteger(raw.visitNumber) && Number(raw.visitNumber) > 0
        ? Number(raw.visitNumber)
        : 1;
    const events = Array.isArray(raw.events)
      ? raw.events.flatMap((item): AnalyticsEvent[] => {
          if (!item || typeof item !== "object") return [];
          const event = item as Record<string, unknown>;
          if (
            (event.type !== "pageview" &&
              event.type !== "click" &&
              event.type !== "order") ||
            typeof event.at !== "string" ||
            !Number.isFinite(Date.parse(event.at)) ||
            typeof event.path !== "string" ||
            (event.label !== undefined && typeof event.label !== "string") ||
            (event.status !== undefined && event.status !== "paid")
          ) {
            return [];
          }
          return [{
            type: event.type,
            at: event.at,
            path: event.path,
            ...(typeof event.label === "string" ? { label: event.label } : {}),
            ...(event.status === "paid" ? { status: "paid" as const } : {}),
          }];
        })
      : [];

    return {
      id: raw.id,
      number:
        Number.isSafeInteger(raw.number) && Number(raw.number) > 0
          ? Number(raw.number)
          : 0,
      visitorNumber:
        Number.isSafeInteger(raw.visitorNumber) && Number(raw.visitorNumber) > 0
          ? Number(raw.visitorNumber)
          : 0,
      visitNumber,
      returningVisitor:
        typeof raw.returningVisitor === "boolean"
          ? raw.returningVisitor
          : visitNumber > 1,
      source: raw.source,
      device: raw.device,
      path: raw.path,
      startedAt: raw.startedAt,
      lastSeenAt: raw.lastSeenAt,
      pageViews:
        Number.isSafeInteger(raw.pageViews) && Number(raw.pageViews) >= 0
          ? Number(raw.pageViews)
          : 0,
      clicks:
        Number.isSafeInteger(raw.clicks) && Number(raw.clicks) >= 0
          ? Number(raw.clicks)
          : 0,
      orderCompleted:
        typeof raw.orderCompleted === "boolean" ? raw.orderCompleted : false,
      ...(typeof raw.orderCompletedAt === "string" &&
      Number.isFinite(Date.parse(raw.orderCompletedAt))
        ? { orderCompletedAt: raw.orderCompletedAt }
        : {}),
      events,
    };
  } catch {
    return null;
  }
}

const ANALYTICS_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const RECENT_VISITOR_WINDOW_MS = 30 * 60_000;
const DAILY_ANALYTICS_TTL_SECONDS = 400 * 24 * 60 * 60;
const MARKETING_RETENTION_MS = 180 * 24 * 60 * 60_000;
const MARKETING_RETENTION_SECONDS = Math.floor(MARKETING_RETENTION_MS / 1000);
const ABANDONED_CART_WINDOW_MS = 30 * 60_000;
const TOUCH_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[3])
local changed = 0
if not current then
  changed = 1
else
  local decoded = cjson.decode(current)
  if decoded.section ~= ARGV[2] then changed = 1 end
end
redis.call('HSET', KEYS[1], ARGV[3], ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[10], ARGV[3])
redis.call('ZADD', KEYS[4], ARGV[6], ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', ARGV[7])
redis.call('PFADD', KEYS[5], ARGV[8])
redis.call('EXPIRE', KEYS[5], ARGV[9])
if changed == 1 then redis.call('PUBLISH', KEYS[3], 'changed') end
return changed
`;

const REMOVE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if not current then return 0 end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('PUBLISH', KEYS[3], 'changed')
return 1
`;

const CLEANUP_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 1000)
if #expired == 0 then return 0 end
for _, visitorId in ipairs(expired) do
  redis.call('HDEL', KEYS[1], visitorId)
  redis.call('ZREM', KEYS[2], visitorId)
end
redis.call('PUBLISH', KEYS[3], 'changed')
return #expired
`;

const START_SESSION_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing then
  local previousPath = ''
  local decoded, previous = pcall(cjson.decode, existing)
  if decoded and type(previous) == 'table' then
    if previous.path then previousPath = previous.path end
    local legacyVisitNumber = redis.call('HGET', KEYS[3], ARGV[2])
    if not legacyVisitNumber then
      legacyVisitNumber = tonumber(previous.visitNumber) or 1
      redis.call('HSET', KEYS[3], ARGV[2], legacyVisitNumber)
    end
    local legacyVisitorNumber = redis.call('HGET', KEYS[4], ARGV[2])
    if not legacyVisitorNumber then
      legacyVisitorNumber = redis.call('INCR', KEYS[5])
      redis.call('HSET', KEYS[4], ARGV[2], legacyVisitorNumber)
    end
    previous.visitorNumber = tonumber(legacyVisitorNumber)
    previous.visitNumber = tonumber(legacyVisitNumber)
    previous.returningVisitor = tonumber(legacyVisitNumber) > 1
    if previous.orderCompleted == nil then previous.orderCompleted = false end
    redis.call('SET', KEYS[1], cjson.encode(previous), 'EX', ARGV[7])
    redis.call('ZADD', KEYS[15], ARGV[6], ARGV[1])
    redis.call('ZREMRANGEBYRANK', KEYS[15], 0, -101)
    return {0, previousPath}
  end
  redis.call('DEL', KEYS[1])
end

local sessionNumber = redis.call('INCR', KEYS[2])
local visitNumber = redis.call('HINCRBY', KEYS[3], ARGV[2], 1)
local visitorNumber = redis.call('HGET', KEYS[4], ARGV[2])
if not visitorNumber then
  visitorNumber = redis.call('INCR', KEYS[5])
  redis.call('HSET', KEYS[4], ARGV[2], visitorNumber)
end

local session = cjson.decode(ARGV[8])
session.number = sessionNumber
session.visitorNumber = tonumber(visitorNumber)
session.visitNumber = visitNumber
session.returningVisitor = visitNumber > 1
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[7])
redis.call('INCR', KEYS[6])
if visitNumber > 1 then
  redis.call('INCR', KEYS[8])
  redis.call('HINCRBY', KEYS[12], ARGV[5], 1)
end
if visitNumber == 2 then redis.call('INCR', KEYS[7]) end
redis.call('HINCRBY', KEYS[9], ARGV[3], 1)
redis.call('HINCRBY', KEYS[10], ARGV[4], 1)
redis.call('HINCRBY', KEYS[11], ARGV[5], 1)
redis.call('PFADD', KEYS[13], ARGV[9])
redis.call('PFADD', KEYS[14], ARGV[9])
redis.call('EXPIRE', KEYS[14], ARGV[10])
redis.call('ZADD', KEYS[15], ARGV[6], ARGV[1])
redis.call('ZREMRANGEBYRANK', KEYS[15], 0, -101)
redis.call('PUBLISH', KEYS[16], 'changed')
return {1, ''}
`;

const UPDATE_SESSION_METADATA_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local decoded, session = pcall(cjson.decode, raw)
if not decoded then return 0 end
session.source = ARGV[1]
session.device = ARGV[2]
session.path = ARGV[3]
session.lastSeenAt = ARGV[4]
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[5])
redis.call('ZADD', KEYS[2], ARGV[6], ARGV[7])
return 1
`;

const RECORD_SESSION_EVENT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local decoded, session = pcall(cjson.decode, raw)
if not decoded then return 0 end
session.path = ARGV[5]
session.lastSeenAt = ARGV[4]
if ARGV[3] == 'pageview' then
  session.pageViews = (session.pageViews or 0) + 1
else
  session.clicks = (session.clicks or 0) + 1
end
local events = session.events or {}
local event = { type = ARGV[3], at = ARGV[4], path = ARGV[5] }
if ARGV[6] ~= '' then event.label = ARGV[6] end
table.insert(events, event)
while #events > 100 do table.remove(events, 1) end
session.events = events
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[7])
return 1
`;

const RECORD_PAGE_VIEW_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local decoded, session = pcall(cjson.decode, raw)
if not decoded then return 0 end
session.path = ARGV[4]
session.lastSeenAt = ARGV[3]
session.pageViews = (session.pageViews or 0) + 1
local events = session.events or {}
table.insert(events, { type = 'pageview', at = ARGV[3], path = ARGV[4] })
while #events > 100 do table.remove(events, 1) end
session.events = events
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[5])
redis.call('INCR', KEYS[3])
redis.call('PFADD', KEYS[4], ARGV[6])
redis.call('PFADD', KEYS[5], ARGV[6])
redis.call('EXPIRE', KEYS[5], ARGV[8])
redis.call('HINCRBY', KEYS[6], ARGV[4], 1)
redis.call('HINCRBY', KEYS[7], ARGV[7], 1)
redis.call('PUBLISH', KEYS[8], 'changed')
return 1
`;

const RECORD_ORDER_SCRIPT = `
local recorded = redis.call('SADD', KEYS[1], ARGV[1])
if recorded == 1 then
  redis.call('INCR', KEYS[2])
  redis.call('HINCRBY', KEYS[3], ARGV[2], 1)
end
local sessionChanged = 0
local raw = redis.call('GET', KEYS[4])
if raw then
  local decoded, session = pcall(cjson.decode, raw)
  if decoded and session.orderCompleted ~= true then
    session.path = ARGV[6]
    session.lastSeenAt = ARGV[5]
    session.orderCompleted = true
    session.orderCompletedAt = ARGV[5]
    local events = session.events or {}
    table.insert(events, { type = 'order', at = ARGV[5], path = ARGV[6], status = 'paid' })
    while #events > 100 do table.remove(events, 1) end
    session.events = events
    redis.call('SET', KEYS[4], cjson.encode(session), 'EX', ARGV[4])
    redis.call('ZADD', KEYS[5], ARGV[3], ARGV[7])
    sessionChanged = 1
  end
end
if recorded == 1 or sessionChanged == 1 then
  redis.call('PUBLISH', KEYS[6], 'changed')
end
return recorded
`;

const RECORD_RECONCILED_ORDER_SCRIPT = `
if redis.call('SADD', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('INCR', KEYS[2])
redis.call('HINCRBY', KEYS[3], ARGV[2], 1)
redis.call('PUBLISH', KEYS[4], 'changed')
return 1
`;

export class PresenceStore {
  private readonly client: RedisClientType;
  private readonly subscriber: RedisClientType;
  private readonly recordsKey: string;
  private readonly expiriesKey: string;
  private readonly channelKey: string;
  private readonly totalViewsKey: string;
  private readonly uniqueVisitorsKey: string;
  private readonly returningVisitorsKey: string;
  private readonly visitorVisitCountsKey: string;
  private readonly visitorNumbersKey: string;
  private readonly visitorSequenceKey: string;
  private readonly pageViewsKey: string;
  private readonly totalSessionsKey: string;
  private readonly returningSessionsKey: string;
  private readonly totalClicksKey: string;
  private readonly totalOrdersKey: string;
  private readonly ordersSeenKey: string;
  private readonly sourcesKey: string;
  private readonly devicesKey: string;
  private readonly clicksKey: string;
  private readonly dailyViewsKey: string;
  private readonly dailySessionsKey: string;
  private readonly dailyReturningSessionsKey: string;
  private readonly dailyClicksKey: string;
  private readonly dailyOrdersKey: string;
  private readonly dailyVisitorsPrefix: string;
  private readonly recentSessionsKey: string;
  private readonly recentVisitorsKey: string;
  private readonly sessionKeyPrefix: string;
  private readonly sessionSequenceKey: string;
  private readonly orderSyncCursorKey: string;
  private readonly searchTermsKey: string;
  private readonly zeroResultSearchesKey: string;
  private readonly recentSearchesKey: string;
  private readonly marketingCartsKey: string;
  private readonly marketingCartTimelineKey: string;
  private readonly productCostsKey: string;
  private readonly commerceCacheKey: string;
  private readonly customerCacheKey: string;
  private readonly upstreamSnapshotKey: string;
  private readonly usersKey: string;
  private readonly notificationsKey: string;
  private readonly notificationTimelineKey: string;
  private readonly notificationDedupePrefix: string;
  private readonly seoConnectionKey: string;
  private readonly seoReportKey: string;
  private readonly seoOauthStatePrefix: string;
  private readonly independentSiteControlsKey: string;
  private readonly independentSiteControlsRevisionKey: string;
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    redisUrl: string,
    keyPrefix: string,
    private readonly ttlMs: number,
    private readonly analyticsTimeZone = DEFAULT_ANALYTICS_TIME_ZONE,
  ) {
    this.client = createClient({ url: redisUrl });
    this.subscriber = this.client.duplicate();
    this.recordsKey = `${keyPrefix}:records`;
    this.expiriesKey = `${keyPrefix}:expiries`;
    this.channelKey = `${keyPrefix}:events`;
    this.totalViewsKey = `${keyPrefix}:analytics:views`;
    this.uniqueVisitorsKey = `${keyPrefix}:analytics:visitors`;
    this.returningVisitorsKey = `${keyPrefix}:analytics:visitors:returning`;
    this.visitorVisitCountsKey = `${keyPrefix}:analytics:visitor:visits`;
    this.visitorNumbersKey = `${keyPrefix}:analytics:visitor:numbers`;
    this.visitorSequenceKey = `${keyPrefix}:analytics:visitor-sequence`;
    this.pageViewsKey = `${keyPrefix}:analytics:pages`;
    this.totalSessionsKey = `${keyPrefix}:analytics:sessions`;
    this.returningSessionsKey = `${keyPrefix}:analytics:sessions:returning`;
    this.totalClicksKey = `${keyPrefix}:analytics:clicks:total`;
    this.totalOrdersKey = `${keyPrefix}:analytics:orders:total`;
    this.ordersSeenKey = `${keyPrefix}:analytics:orders:seen:v2`;
    this.sourcesKey = `${keyPrefix}:analytics:sources`;
    this.devicesKey = `${keyPrefix}:analytics:devices`;
    this.clicksKey = `${keyPrefix}:analytics:clicks`;
    this.dailyViewsKey = `${keyPrefix}:analytics:daily`;
    this.dailySessionsKey = `${keyPrefix}:analytics:daily:sessions`;
    this.dailyReturningSessionsKey = `${keyPrefix}:analytics:daily:returning-sessions`;
    this.dailyClicksKey = `${keyPrefix}:analytics:daily:clicks`;
    this.dailyOrdersKey = `${keyPrefix}:analytics:daily:orders`;
    this.dailyVisitorsPrefix = `${keyPrefix}:analytics:daily:visitors:`;
    this.recentSessionsKey = `${keyPrefix}:analytics:recent`;
    this.recentVisitorsKey = `${keyPrefix}:analytics:recent-visitors`;
    this.sessionKeyPrefix = `${keyPrefix}:analytics:session:`;
    this.sessionSequenceKey = `${keyPrefix}:analytics:session-sequence`;
    this.orderSyncCursorKey = `${keyPrefix}:analytics:orders:woo-sync-cursor`;
    this.searchTermsKey = `${keyPrefix}:marketing:searches:v1`;
    this.zeroResultSearchesKey = `${keyPrefix}:marketing:searches:zero:v1`;
    this.recentSearchesKey = `${keyPrefix}:marketing:searches:recent:v1`;
    this.marketingCartsKey = `${keyPrefix}:marketing:carts:v1`;
    this.marketingCartTimelineKey = `${keyPrefix}:marketing:carts:timeline:v1`;
    this.productCostsKey = `${keyPrefix}:commerce:product-costs`;
    this.commerceCacheKey = `${keyPrefix}:commerce:dashboard-cache:v1`;
    this.customerCacheKey = `${keyPrefix}:commerce:customer-directory-cache:v1`;
    this.upstreamSnapshotKey = `${keyPrefix}:analytics:upstream-snapshot:v1`;
    this.usersKey = `${keyPrefix}:access:users:v1`;
    this.notificationsKey = `${keyPrefix}:notifications:records:v1`;
    this.notificationTimelineKey = `${keyPrefix}:notifications:timeline:v1`;
    this.notificationDedupePrefix = `${keyPrefix}:notifications:dedupe:v1:`;
    this.seoConnectionKey = `${keyPrefix}:seo:connection:v1`;
    this.seoReportKey = `${keyPrefix}:seo:report:v1`;
    this.seoOauthStatePrefix = `${keyPrefix}:seo:oauth-state:`;
    this.independentSiteControlsKey = `${keyPrefix}:site-controls:independent:v1`;
    this.independentSiteControlsRevisionKey = `${keyPrefix}:site-controls:revision:v1`;

    this.client.on("error", (error) => console.error("Redis error", error));
    this.subscriber.on("error", (error) =>
      console.error("Redis subscriber error", error),
    );
  }

  async connect(onChanged: () => void): Promise<void> {
    await Promise.all([this.client.connect(), this.subscriber.connect()]);
    await this.subscriber.subscribe(this.channelKey, onChanged);
    await this.cleanupExpired();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch((error: unknown) =>
        console.error("Presence cleanup failed", error),
      );
    }, 1_000);
    this.cleanupTimer.unref();
  }

  async disconnect(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled([this.subscriber.quit(), this.client.quit()]);
  }

  async touch(
    visitorId: string,
    analyticsVisitorId: string,
    connectionId: string,
    section: PresenceSection,
  ): Promise<void> {
    const current = new Date();
    const now = current.getTime();
    const date = analyticsDateKey(current, this.analyticsTimeZone);
    const expiresAt = now + this.ttlMs;
    const record: PresenceRecord = {
      visitorId,
      section,
      connectionId,
      touchedAt: now,
    };
    await this.client.eval(TOUCH_SCRIPT, {
      keys: [
        this.recordsKey,
        this.expiriesKey,
        this.channelKey,
        this.recentVisitorsKey,
        `${this.dailyVisitorsPrefix}${date}`,
      ],
      arguments: [
        visitorId,
        section,
        connectionId,
        JSON.stringify(record),
        analyticsVisitorId,
        String(now),
        String(now - RECENT_VISITOR_WINDOW_MS),
        visitorId,
        String(DAILY_ANALYTICS_TTL_SECONDS),
        String(expiresAt),
      ],
    });
  }

  async remove(connectionId: string): Promise<void> {
    await this.client.eval(REMOVE_SCRIPT, {
      keys: [this.recordsKey, this.expiriesKey, this.channelKey],
      arguments: [connectionId],
    });
  }

  async startSession(input: {
    sessionId: string;
    visitorId: string;
    uniqueVisitorId: string;
    source: string;
    device: string;
    path: string;
  }): Promise<{ created: boolean; previousPath: string }> {
    const now = new Date();
    const date = analyticsDateKey(now, this.analyticsTimeZone);
    const session: AnalyticsSession = {
      id: input.sessionId,
      number: 0,
      visitorNumber: 0,
      visitNumber: 0,
      returningVisitor: false,
      source: input.source,
      device: input.device,
      // The first page view atomically fills this path together with its
      // aggregate counters. An empty value makes a failed first write retryable
      // on the next hello instead of silently losing or duplicating the view.
      path: "",
      startedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      pageViews: 0,
      clicks: 0,
      orderCompleted: false,
      events: [],
    };
    const created = await this.client.eval(START_SESSION_SCRIPT, {
      keys: [
        `${this.sessionKeyPrefix}${input.sessionId}`,
        this.sessionSequenceKey,
        this.visitorVisitCountsKey,
        this.visitorNumbersKey,
        this.visitorSequenceKey,
        this.totalSessionsKey,
        this.returningVisitorsKey,
        this.returningSessionsKey,
        this.sourcesKey,
        this.devicesKey,
        this.dailySessionsKey,
        this.dailyReturningSessionsKey,
        this.uniqueVisitorsKey,
        `${this.dailyVisitorsPrefix}${date}`,
        this.recentSessionsKey,
        this.channelKey,
      ],
      arguments: [
        input.sessionId,
        input.visitorId,
        input.source,
        input.device,
        date,
        String(now.getTime()),
        String(ANALYTICS_SESSION_TTL_SECONDS),
        JSON.stringify(session),
        input.uniqueVisitorId,
        String(DAILY_ANALYTICS_TTL_SECONDS),
      ],
    });
    const result = Array.isArray(created) ? created : [created];
    const wasCreated = Number(result[0]) === 1;
    const previousPath = typeof result[1] === "string" ? result[1] : "";
    if (!wasCreated) {
      await this.updateSessionMetadata(input.sessionId, {
        source: input.source,
        device: input.device,
        path:
          previousPath !== input.path ? previousPath : input.path,
        at: now,
      });
    }
    return { created: wasCreated, previousPath };
  }

  async recordPageView(
    visitorId: string,
    sessionId: string,
    path: string,
  ): Promise<void> {
    const now = new Date();
    const date = analyticsDateKey(now, this.analyticsTimeZone);
    await this.client.eval(RECORD_PAGE_VIEW_SCRIPT, {
      keys: [
        `${this.sessionKeyPrefix}${sessionId}`,
        this.recentSessionsKey,
        this.totalViewsKey,
        this.uniqueVisitorsKey,
        `${this.dailyVisitorsPrefix}${date}`,
        this.pageViewsKey,
        this.dailyViewsKey,
        this.channelKey,
      ],
      arguments: [
        String(now.getTime()),
        String(ANALYTICS_SESSION_TTL_SECONDS),
        now.toISOString(),
        path,
        sessionId,
        visitorId,
        date,
        String(DAILY_ANALYTICS_TTL_SECONDS),
      ],
    });
  }

  async recordClick(sessionId: string, path: string, label: string): Promise<void> {
    const now = new Date();
    const date = analyticsDateKey(now, this.analyticsTimeZone);
    const transaction = this.client.multi();
    transaction.incr(this.totalClicksKey);
    transaction.hIncrBy(this.clicksKey, `${path}\u001f${label}`, 1);
    transaction.hIncrBy(this.dailyClicksKey, date, 1);
    await transaction.exec();
    await this.recordSessionEvent(sessionId, {
      type: "click",
      at: now,
      path,
      label,
    });
    await this.client.publish(this.channelKey, "changed");
  }

  async recordSearch(
    sessionId: string,
    path: string,
    input: { query: string; resultCount: number },
  ): Promise<void> {
    const searchedAt = new Date().toISOString();
    const record: StoredSearchIntent = {
      sessionId,
      query: input.query,
      resultCount: input.resultCount,
      path,
      searchedAt,
    };
    const transaction = this.client.multi();
    transaction.hIncrBy(this.searchTermsKey, input.query, 1);
    if (input.resultCount === 0) {
      transaction.hIncrBy(this.zeroResultSearchesKey, input.query, 1);
    }
    transaction.lPush(this.recentSearchesKey, JSON.stringify(record));
    transaction.lTrim(this.recentSearchesKey, 0, 99);
    transaction.expire(this.searchTermsKey, MARKETING_RETENTION_SECONDS);
    transaction.expire(this.zeroResultSearchesKey, MARKETING_RETENTION_SECONDS);
    transaction.expire(this.recentSearchesKey, MARKETING_RETENTION_SECONDS);
    transaction.publish(this.channelKey, "changed");
    await transaction.exec();
  }

  async recordCart(
    sessionId: string,
    path: string,
    input: {
      customerName: string;
      customerEmail: string;
      items: MarketingCartItem[];
      expiresAt: number | null;
    },
  ): Promise<void> {
    const now = new Date();
    const nowMs = now.getTime();
    const existingRaw = await this.client.hGet(this.marketingCartsKey, sessionId);
    let existing: StoredMarketingCart | null = null;
    if (existingRaw) {
      try {
        existing = JSON.parse(existingRaw) as StoredMarketingCart;
      } catch {
        existing = null;
      }
    }

    // An empty cart on a visitor's first page view is not a useful marketing
    // event. Empty updates do, however, close a cart that was previously seen.
    if (input.items.length === 0 && !existing) return;

    const hasItems = input.items.length > 0;
    const retainedItems = hasItems ? input.items : existing?.items || [];
    const itemCount = retainedItems.reduce(
      (sum, item) => sum + Math.max(0, item.quantity),
      0,
    );
    const total = Number(retainedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    ).toFixed(2));
    const cart: StoredMarketingCart = {
      sessionId,
      customerName: input.customerName || existing?.customerName || "",
      customerEmail: input.customerEmail || existing?.customerEmail || "",
      items: retainedItems,
      itemCount,
      total,
      status: hasItems ? "active" : "cleared",
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: input.expiresAt
        ? new Date(input.expiresAt).toISOString()
        : existing?.expiresAt || null,
      path,
    };

    const staleIds = await this.client.zRangeByScore(
      this.marketingCartTimelineKey,
      0,
      nowMs - MARKETING_RETENTION_MS,
    );
    const transaction = this.client.multi();
    if (staleIds.length) transaction.hDel(this.marketingCartsKey, staleIds);
    transaction.zRemRangeByScore(
      this.marketingCartTimelineKey,
      0,
      nowMs - MARKETING_RETENTION_MS,
    );
    transaction.hSet(this.marketingCartsKey, sessionId, JSON.stringify(cart));
    transaction.zAdd(this.marketingCartTimelineKey, {
      score: nowMs,
      value: sessionId,
    });
    transaction.expire(this.marketingCartsKey, MARKETING_RETENTION_SECONDS);
    transaction.expire(this.marketingCartTimelineKey, MARKETING_RETENTION_SECONDS);
    transaction.publish(this.channelKey, "changed");
    await transaction.exec();
  }

  async markCartConverted(sessionId: string, path: string): Promise<void> {
    const raw = await this.client.hGet(this.marketingCartsKey, sessionId);
    if (!raw) return;
    try {
      const cart = JSON.parse(raw) as StoredMarketingCart;
      const now = new Date();
      const updated: StoredMarketingCart = {
        ...cart,
        path,
        status: "converted",
        updatedAt: now.toISOString(),
      };
      const transaction = this.client.multi();
      transaction.hSet(this.marketingCartsKey, sessionId, JSON.stringify(updated));
      transaction.zAdd(this.marketingCartTimelineKey, {
        score: now.getTime(),
        value: sessionId,
      });
      transaction.publish(this.channelKey, "changed");
      await transaction.exec();
    } catch {
      // A malformed marketing record must never interfere with order tracking.
    }
  }

  async recordOrder(
    sessionId: string,
    orderFingerprint: string,
    path: string,
  ): Promise<boolean> {
    const now = new Date();
    const date = analyticsDateKey(now, this.analyticsTimeZone);
    const recorded = await this.client.eval(RECORD_ORDER_SCRIPT, {
      keys: [
        this.ordersSeenKey,
        this.totalOrdersKey,
        this.dailyOrdersKey,
        `${this.sessionKeyPrefix}${sessionId}`,
        this.recentSessionsKey,
        this.channelKey,
      ],
      arguments: [
        orderFingerprint,
        date,
        String(now.getTime()),
        String(ANALYTICS_SESSION_TTL_SECONDS),
        now.toISOString(),
        path,
        sessionId,
      ],
    });
    return Number(recorded) === 1;
  }

  async recordReconciledOrder(
    orderFingerprint: string,
    paidAt: Date,
  ): Promise<boolean> {
    const date = analyticsDateKey(paidAt, this.analyticsTimeZone);
    const recorded = await this.client.eval(RECORD_RECONCILED_ORDER_SCRIPT, {
      keys: [
        this.ordersSeenKey,
        this.totalOrdersKey,
        this.dailyOrdersKey,
        this.channelKey,
      ],
      arguments: [orderFingerprint, date],
    });
    return Number(recorded) === 1;
  }

  async getOrderSyncCursor(): Promise<Date | null> {
    const raw = await this.client.get(this.orderSyncCursorKey);
    if (!raw) return null;
    const value = new Date(raw);
    return Number.isFinite(value.getTime()) ? value : null;
  }

  async setOrderSyncCursor(value: Date): Promise<void> {
    await this.client.set(this.orderSyncCursorKey, value.toISOString());
  }

  async getProductCosts(
    productIds: number[],
  ): Promise<Record<string, { unitCost: number; packagingCost: number; feeRate: number }>> {
    if (!productIds.length) return {};
    const fields = [...new Set(productIds.map(String))];
    const values = await this.client.hmGet(this.productCostsKey, fields);
    const result: Record<
      string,
      { unitCost: number; packagingCost: number; feeRate: number }
    > = {};

    fields.forEach((field, index) => {
      const raw = values[index];
      if (!raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;
        const record = parsed as Record<string, unknown>;
        if (
          typeof record.unitCost !== "number" ||
          typeof record.packagingCost !== "number" ||
          typeof record.feeRate !== "number"
        ) {
          return;
        }
        result[field] = {
          unitCost: record.unitCost,
          packagingCost: record.packagingCost,
          feeRate: record.feeRate,
        };
      } catch {
        // Ignore malformed legacy values so one record never breaks the catalog.
      }
    });
    return result;
  }

  async setProductCost(
    productId: number,
    value: { unitCost: number; packagingCost: number; feeRate: number },
  ): Promise<void> {
    await this.client.hSet(
      this.productCostsKey,
      String(productId),
      JSON.stringify(value),
    );
  }

  async getCommerceCache(): Promise<{ payload: Record<string, unknown>; updatedAt: number } | null> {
    const raw = await this.client.get(this.commerceCacheKey);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const value = parsed as Record<string, unknown>;
      if (!value.payload || typeof value.payload !== "object" || typeof value.updatedAt !== "number") return null;
      return { payload: value.payload as Record<string, unknown>, updatedAt: value.updatedAt };
    } catch {
      return null;
    }
  }

  async setCommerceCache(payload: Record<string, unknown>, updatedAt: number): Promise<void> {
    await this.client.set(this.commerceCacheKey, JSON.stringify({ payload, updatedAt }), { EX: 86_400 });
  }

  async clearCommerceCache(): Promise<void> {
    await this.client.del(this.commerceCacheKey);
  }

  async getUpstreamSnapshot(): Promise<PresenceSnapshot | null> {
    const raw = await this.client.get(this.upstreamSnapshotKey);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        !parsed || typeof parsed !== "object" ||
        (parsed as Record<string, unknown>).type !== "presence:snapshot" ||
        typeof (parsed as Record<string, unknown>).serverTime !== "string" ||
        !(parsed as Record<string, unknown>).counts ||
        !(parsed as Record<string, unknown>).analytics
      ) return null;
      return parsed as PresenceSnapshot;
    } catch {
      return null;
    }
  }

  async setUpstreamSnapshot(snapshot: PresenceSnapshot): Promise<void> {
    await this.client.set(this.upstreamSnapshotKey, JSON.stringify(snapshot), { EX: 86_400 });
  }

  async getCustomerCache(): Promise<{ payload: Record<string, unknown>; updatedAt: number } | null> {
    const raw = await this.client.get(this.customerCacheKey);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const value = parsed as Record<string, unknown>;
      if (!value.payload || typeof value.payload !== "object" || typeof value.updatedAt !== "number") return null;
      return { payload: value.payload as Record<string, unknown>, updatedAt: value.updatedAt };
    } catch {
      return null;
    }
  }

  async setCustomerCache(payload: Record<string, unknown>, updatedAt: number): Promise<void> {
    await this.client.set(this.customerCacheKey, JSON.stringify({ payload, updatedAt }), { EX: 86_400 });
  }

  async getIndependentSiteControls(): Promise<IndependentSiteControlsRecord | null> {
    const raw = await this.client.get(this.independentSiteControlsKey);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<IndependentSiteControlsRecord>;
      if (
        value.source !== "operations-control-plane" ||
        typeof value.version !== "string" ||
        !Number.isSafeInteger(value.revision) ||
        typeof value.updatedAt !== "string" ||
        typeof value.updatedBy !== "string" ||
        !value.promo || typeof value.promo !== "object" ||
        !value.maintenance || typeof value.maintenance !== "object"
      ) {
        return null;
      }
      return value as IndependentSiteControlsRecord;
    } catch {
      return null;
    }
  }

  async saveIndependentSiteControls(
    input: Omit<IndependentSiteControlsRecord, "revision" | "updatedAt">,
  ): Promise<IndependentSiteControlsRecord> {
    const revision = await this.client.incr(this.independentSiteControlsRevisionKey);
    const value: IndependentSiteControlsRecord = {
      ...input,
      revision,
      updatedAt: new Date().toISOString(),
    };
    await this.client.set(this.independentSiteControlsKey, JSON.stringify(value));
    return value;
  }

  async seedIndependentSiteControls(
    input: Omit<IndependentSiteControlsRecord, "revision" | "updatedAt">,
  ): Promise<IndependentSiteControlsRecord> {
    const existing = await this.getIndependentSiteControls();
    if (existing) return existing;
    return this.saveIndependentSiteControls(input);
  }

  async ensureBootstrapAdmin(username: string, passwordHash: string): Promise<void> {
    const users = await this.listUsers();
    if (users.length) return;
    const now = new Date().toISOString();
    const user: ManagedUserRecord = {
      id: randomUUID(), username, displayName: "Primary administrator", email: "",
      role: "owner", status: "active", passwordHash, authVersion: 1,
      createdAt: now, updatedAt: now, lastLoginAt: null,
    };
    await this.client.hSet(this.usersKey, user.id, JSON.stringify(user));
    await this.addNotification({
      type: "security", severity: "success", title: "Team access is ready",
      message: "The primary administrator account is protected and role management is available.",
      actionView: "team",
    });
  }

  async listUsers(): Promise<ManagedUserRecord[]> {
    const values = await this.client.hVals(this.usersKey);
    return values.flatMap((value) => {
      try {
        const user = JSON.parse(value) as ManagedUserRecord;
        return user && typeof user.id === "string" && typeof user.username === "string" ? [user] : [];
      } catch { return []; }
    }).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getUserById(id: string): Promise<ManagedUserRecord | null> {
    const value = await this.client.hGet(this.usersKey, id);
    if (!value) return null;
    try { return JSON.parse(value) as ManagedUserRecord; } catch { return null; }
  }

  async getUserByUsername(username: string): Promise<ManagedUserRecord | null> {
    const normalized = username.trim().toLocaleLowerCase("en");
    return (await this.listUsers()).find((user) => user.username.toLocaleLowerCase("en") === normalized) || null;
  }

  async createUser(input: {
    username: string; displayName: string; email: string; role: ManagedUserRole; passwordHash: string;
  }): Promise<ManagedUserRecord> {
    if (await this.getUserByUsername(input.username)) throw new Error("USERNAME_EXISTS");
    const now = new Date().toISOString();
    const user: ManagedUserRecord = {
      id: randomUUID(), username: input.username, displayName: input.displayName,
      email: input.email, role: input.role, status: "active", passwordHash: input.passwordHash,
      authVersion: 1, createdAt: now, updatedAt: now, lastLoginAt: null,
    };
    await this.client.hSet(this.usersKey, user.id, JSON.stringify(user));
    return user;
  }

  async updateUser(id: string, input: Partial<Pick<ManagedUserRecord, "displayName" | "email" | "role" | "status">>): Promise<ManagedUserRecord | null> {
    const user = await this.getUserById(id);
    if (!user) return null;
    const updated: ManagedUserRecord = { ...user, ...input, updatedAt: new Date().toISOString() };
    if (input.status === "suspended") updated.authVersion += 1;
    await this.client.hSet(this.usersKey, id, JSON.stringify(updated));
    return updated;
  }

  async setUserPassword(id: string, passwordHash: string): Promise<ManagedUserRecord | null> {
    const user = await this.getUserById(id);
    if (!user) return null;
    const updated = { ...user, passwordHash, authVersion: user.authVersion + 1, updatedAt: new Date().toISOString() };
    await this.client.hSet(this.usersKey, id, JSON.stringify(updated));
    return updated;
  }

  async recordUserLogin(id: string): Promise<void> {
    const user = await this.getUserById(id);
    if (!user) return;
    await this.client.hSet(this.usersKey, id, JSON.stringify({ ...user, lastLoginAt: new Date().toISOString() }));
  }

  async addNotification(input: Omit<NotificationRecord, "id" | "createdAt" | "readBy">): Promise<NotificationRecord> {
    const record: NotificationRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), readBy: [] };
    await this.client.hSet(this.notificationsKey, record.id, JSON.stringify(record));
    await this.client.zAdd(this.notificationTimelineKey, { score: Date.parse(record.createdAt), value: record.id });
    await this.client.zRemRangeByRank(this.notificationTimelineKey, 0, -201);
    return record;
  }

  async addNotificationOnce(
    dedupeKey: string,
    input: Omit<NotificationRecord, "id" | "createdAt" | "readBy">,
  ): Promise<NotificationRecord | null> {
    const normalizedKey = dedupeKey.trim();
    if (!normalizedKey) throw new Error("A notification deduplication key is required");
    const record: NotificationRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      readBy: [],
    };
    const claimKey = `${this.notificationDedupePrefix}${normalizedKey}`;
    const claimed = await this.client.set(claimKey, record.id, {
      NX: true,
      EX: 63_072_000,
    });
    if (!claimed) return null;
    try {
      const transaction = this.client.multi();
      transaction.hSet(this.notificationsKey, record.id, JSON.stringify(record));
      transaction.zAdd(this.notificationTimelineKey, {
        score: Date.parse(record.createdAt),
        value: record.id,
      });
      transaction.zRemRangeByRank(this.notificationTimelineKey, 0, -201);
      await transaction.exec();
      return record;
    } catch (error) {
      await this.client.del(claimKey).catch(() => 0);
      throw error;
    }
  }

  async listNotifications(_userId: string, limit = 50): Promise<NotificationRecord[]> {
    const ids = await this.client.zRange(this.notificationTimelineKey, 0, Math.max(0, limit - 1), { REV: true });
    const values = ids.length ? await this.client.hmGet(this.notificationsKey, ids) : [];
    return values.flatMap((value) => {
      if (!value) return [];
      try { return [JSON.parse(value) as NotificationRecord]; } catch { return []; }
    }).map((item) => ({ ...item, readBy: Array.isArray(item.readBy) ? item.readBy : [] }));
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<boolean> {
    const raw = await this.client.hGet(this.notificationsKey, notificationId);
    if (!raw) return false;
    try {
      const record = JSON.parse(raw) as NotificationRecord;
      record.readBy = [...new Set([...(record.readBy || []), userId])];
      await this.client.hSet(this.notificationsKey, notificationId, JSON.stringify(record));
      return true;
    } catch { return false; }
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    const records = await this.listNotifications(userId, 200);
    const transaction = this.client.multi();
    for (const record of records) {
      record.readBy = [...new Set([...(record.readBy || []), userId])];
      transaction.hSet(this.notificationsKey, record.id, JSON.stringify(record));
    }
    await transaction.exec();
  }

  async saveSeoConnection(encryptedValue: string): Promise<void> {
    await this.client.set(this.seoConnectionKey, encryptedValue);
  }

  async getSeoConnection(): Promise<string | null> { return this.client.get(this.seoConnectionKey); }
  async clearSeoConnection(): Promise<void> { await this.client.del([this.seoConnectionKey, this.seoReportKey]); }

  async saveSeoReport(payload: Record<string, unknown>): Promise<void> {
    await this.client.set(this.seoReportKey, JSON.stringify(payload));
  }

  async getSeoReport(): Promise<Record<string, unknown> | null> {
    const value = await this.client.get(this.seoReportKey);
    if (!value) return null;
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }

  async saveSeoOauthState(state: string, userId: string): Promise<void> {
    await this.client.set(`${this.seoOauthStatePrefix}${state}`, userId, { EX: 600 });
  }

  async consumeSeoOauthState(state: string): Promise<string | null> {
    return this.client.getDel(`${this.seoOauthStatePrefix}${state}`);
  }

  async snapshot(): Promise<PresenceSnapshot> {
    await this.cleanupExpired();
    const now = new Date();
    const nowMs = now.getTime();
    await this.client.zRemRangeByScore(
      this.recentVisitorsKey,
      0,
      nowMs - RECENT_VISITOR_WINDOW_MS,
    );
    const dates = analyticsDateRange(now, 30, this.analyticsTimeZone);
    const visitorKeys = dates.map((date) => `${this.dailyVisitorsPrefix}${date}`);
    const last7VisitorKeys = visitorKeys.slice(-7);

    const [
      values,
      totalViewsRaw,
      uniqueVisitors,
      returningVisitorsRaw,
      pageViews,
      totalSessionsRaw,
      returningSessionsRaw,
      totalClicksRaw,
      totalOrdersRaw,
      sources,
      devices,
      clicks,
      dailyViews,
      dailySessions,
      dailyReturningSessions,
      dailyClicks,
      dailyOrders,
      recentIds,
      visitorsLast30Minutes,
      dailyVisitorCounts,
      visitorsLast7Days,
      visitorsLast30Days,
      searchTerms,
      zeroResultSearches,
      recentSearchValues,
      marketingCartIds,
    ] = await Promise.all([
      this.client.hVals(this.recordsKey),
      this.client.get(this.totalViewsKey),
      this.client.pfCount(this.uniqueVisitorsKey),
      this.client.get(this.returningVisitorsKey),
      this.client.hGetAll(this.pageViewsKey),
      this.client.get(this.totalSessionsKey),
      this.client.get(this.returningSessionsKey),
      this.client.get(this.totalClicksKey),
      this.client.get(this.totalOrdersKey),
      this.client.hGetAll(this.sourcesKey),
      this.client.hGetAll(this.devicesKey),
      this.client.hGetAll(this.clicksKey),
      this.client.hGetAll(this.dailyViewsKey),
      this.client.hGetAll(this.dailySessionsKey),
      this.client.hGetAll(this.dailyReturningSessionsKey),
      this.client.hGetAll(this.dailyClicksKey),
      this.client.hGetAll(this.dailyOrdersKey),
      this.client.zRange(this.recentSessionsKey, 0, 99, { REV: true }),
      this.client.zCount(
        this.recentVisitorsKey,
        nowMs - RECENT_VISITOR_WINDOW_MS,
        "+inf",
      ),
      Promise.all(visitorKeys.map((key) => this.client.pfCount(key))),
      this.client.pfCount(last7VisitorKeys),
      this.client.pfCount(visitorKeys),
      this.client.hGetAll(this.searchTermsKey),
      this.client.hGetAll(this.zeroResultSearchesKey),
      this.client.lRange(this.recentSearchesKey, 0, 99),
      this.client.zRange(this.marketingCartTimelineKey, 0, 99, { REV: true }),
    ]);

    const recentRaw = recentIds.length
      ? await this.client.mGet(recentIds.map((id) => `${this.sessionKeyPrefix}${id}`))
      : [];
    // Normalize legacy JSON only in the response. START_SESSION performs the
    // authoritative atomic migration when that browser reconnects.
    const recentSessions = recentRaw.flatMap((value) => {
      const session = parseStoredSession(value);
      return session ? [session] : [];
    });
    recentSessions.sort(
      (left, right) =>
        Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
        right.number - left.number,
    );

    const marketingCartValues = marketingCartIds.length
      ? await this.client.hmGet(this.marketingCartsKey, marketingCartIds)
      : [];
    const visitorNumbers = new Map(
      recentSessions.map((session) => [session.id, session.visitorNumber]),
    );
    const marketing = this.buildMarketingAnalytics({
      nowMs,
      searchTerms,
      zeroResultSearches,
      recentSearchValues,
      marketingCartValues,
      visitorNumbers,
    });

    const counts = emptyPresenceCounts();
    const latestPresenceByVisitor = new Map<string, PresenceRecord>();
    for (const value of values) {
      try {
        const record = JSON.parse(value) as Partial<PresenceRecord>;
        if (!isPresenceSection(record.section)) continue;
        const connectionId =
          typeof record.connectionId === "string" ? record.connectionId : "";
        const visitorId =
          typeof record.visitorId === "string" && record.visitorId
            ? record.visitorId
            : connectionId;
        if (!visitorId) continue;
        const normalized: PresenceRecord = {
          visitorId,
          connectionId,
          section: record.section,
          touchedAt:
            typeof record.touchedAt === "number" ? record.touchedAt : 0,
        };
        const existing = latestPresenceByVisitor.get(visitorId);
        if (!existing || normalized.touchedAt >= existing.touchedAt) {
          latestPresenceByVisitor.set(visitorId, normalized);
        }
      } catch {
        // Invalid transient records are ignored and disappear with their TTL.
      }
    }
    for (const record of latestPresenceByVisitor.values()) {
      counts[record.section] += 1;
    }

    const visitorsToday = dailyVisitorCounts.at(-1) || 0;
    const dailyVisitorItems = dates.map((date, index) => ({
      date,
      visitors: dailyVisitorCounts[index] || 0,
    }));

    return {
      type: "presence:snapshot",
      counts,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      serverTime: now.toISOString(),
      analytics: {
        timeZone: this.analyticsTimeZone,
        totalViews: Number(totalViewsRaw || 0),
        uniqueVisitors,
        returningVisitors: Number(returningVisitorsRaw || 0),
        totalSessions: Number(totalSessionsRaw || 0),
        returningSessions: Number(returningSessionsRaw || 0),
        totalClicks: Number(totalClicksRaw || 0),
        totalOrders: Number(totalOrdersRaw || 0),
        visitorsLast30Minutes,
        visitorRanges: {
          today: visitorsToday,
          last7Days: visitorsLast7Days,
          last30Days: visitorsLast30Days,
          all: uniqueVisitors,
        },
        topPages: Object.entries(pageViews)
          .map(([path, views]) => ({ path, views: Number(views) }))
          .sort((a, b) => b.views - a.views)
          .slice(0, 8),
        topSources: this.rankHash(sources),
        topDevices: this.rankHash(devices),
        topClicks: Object.entries(clicks)
          .map(([key, count]) => {
            const [path, label] = key.split("\u001f");
            return {
              path: path || "/",
              label: label || "Interaction",
              count: Number(count),
            };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
        dailyViews: dates.slice(-14).map((date) => ({
          date,
          views: Number(dailyViews[date] || 0),
        })),
        dailyVisitors: dailyVisitorItems,
        dailyActivity: dates.map((date, index) => ({
          date,
          views: Number(dailyViews[date] || 0),
          visitors: dailyVisitorCounts[index] || 0,
          sessions: Number(dailySessions[date] || 0),
          returningSessions: Number(dailyReturningSessions[date] || 0),
          clicks: Number(dailyClicks[date] || 0),
          orders: Number(dailyOrders[date] || 0),
        })),
        recentSessions,
        marketing,
      },
    };
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === "PONG";
  }

  private async cleanupExpired(): Promise<void> {
    await this.client.eval(CLEANUP_SCRIPT, {
      keys: [this.recordsKey, this.expiriesKey, this.channelKey],
      arguments: [String(Date.now())],
    });
  }

  private rankHash(
    values: Record<string, string>,
  ): Array<{ label: string; count: number }> {
    return Object.entries(values)
      .map(([label, count]) => ({ label, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  private buildMarketingAnalytics(input: {
    nowMs: number;
    searchTerms: Record<string, string>;
    zeroResultSearches: Record<string, string>;
    recentSearchValues: string[];
    marketingCartValues: Array<string | null>;
    visitorNumbers: Map<string, number>;
  }): MarketingAnalytics {
    const topSearches = Object.entries(input.searchTerms)
      .map(([query, count]) => ({
        query,
        count: Math.max(0, Number(count) || 0),
        zeroResults: Math.max(0, Number(input.zeroResultSearches[query]) || 0),
      }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.zeroResults - left.zeroResults ||
          left.query.localeCompare(right.query),
      )
      .slice(0, 20);

    const recentSearches = input.recentSearchValues.flatMap((value) => {
      try {
        const item = JSON.parse(value) as Partial<StoredSearchIntent>;
        if (
          typeof item.sessionId !== "string" ||
          typeof item.query !== "string" ||
          typeof item.path !== "string" ||
          typeof item.searchedAt !== "string" ||
          !Number.isFinite(Date.parse(item.searchedAt)) ||
          !Number.isFinite(item.resultCount)
        ) {
          return [];
        }
        return [{
          sessionId: item.sessionId,
          visitorNumber: input.visitorNumbers.get(item.sessionId) || 0,
          query: item.query,
          resultCount: Math.max(0, Number(item.resultCount)),
          path: item.path,
          searchedAt: item.searchedAt,
        }];
      } catch {
        return [];
      }
    });

    const carts = input.marketingCartValues.flatMap((value): MarketingCart[] => {
      if (!value) return [];
      try {
        const item = JSON.parse(value) as Partial<StoredMarketingCart>;
        if (
          typeof item.sessionId !== "string" ||
          typeof item.path !== "string" ||
          typeof item.createdAt !== "string" ||
          typeof item.updatedAt !== "string" ||
          !Number.isFinite(Date.parse(item.createdAt)) ||
          !Number.isFinite(Date.parse(item.updatedAt)) ||
          !Array.isArray(item.items)
        ) {
          return [];
        }
        const items = item.items.flatMap((cartItem): MarketingCartItem[] => {
          if (
            !cartItem ||
            typeof cartItem !== "object" ||
            typeof cartItem.name !== "string" ||
            typeof cartItem.sku !== "string" ||
            typeof cartItem.imageUrl !== "string" ||
            !Number.isFinite(cartItem.productId) ||
            !Number.isFinite(cartItem.variationId) ||
            !Number.isFinite(cartItem.quantity) ||
            !Number.isFinite(cartItem.price)
          ) {
            return [];
          }
          return [{
            productId: cartItem.productId,
            variationId: cartItem.variationId,
            name: cartItem.name,
            sku: cartItem.sku,
            quantity: cartItem.quantity,
            price: cartItem.price,
            imageUrl: cartItem.imageUrl,
          }];
        });
        if (!items.length) return [];
        const storedStatus = item.status === "converted" || item.status === "cleared"
          ? item.status
          : "active";
        const status: MarketingCart["status"] = storedStatus === "active" &&
          input.nowMs - Date.parse(item.updatedAt) >= ABANDONED_CART_WINDOW_MS
          ? "abandoned"
          : storedStatus;
        const total = Number(items.reduce(
          (sum, cartItem) => sum + cartItem.price * cartItem.quantity,
          0,
        ).toFixed(2));
        return [{
          sessionId: item.sessionId,
          visitorNumber: input.visitorNumbers.get(item.sessionId) || 0,
          customerName: typeof item.customerName === "string" ? item.customerName : "",
          customerEmail: typeof item.customerEmail === "string" ? item.customerEmail : "",
          items,
          itemCount: items.reduce((sum, cartItem) => sum + cartItem.quantity, 0),
          total,
          status,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          expiresAt:
            typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt))
              ? item.expiresAt
              : null,
          path: item.path,
        }];
      } catch {
        return [];
      }
    });
    carts.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

    const activeCarts = carts.filter((cart) => cart.status === "active");
    const abandonedCarts = carts.filter((cart) => cart.status === "abandoned");
    return {
      topSearches,
      recentSearches,
      carts,
      activeCarts: activeCarts.length,
      abandonedCarts: abandonedCarts.length,
      capturedValue: Number([...activeCarts, ...abandonedCarts].reduce(
        (sum, cart) => sum + cart.total,
        0,
      ).toFixed(2)),
      abandonedValue: Number(abandonedCarts.reduce(
        (sum, cart) => sum + cart.total,
        0,
      ).toFixed(2)),
      zeroResultSearches: Object.values(input.zeroResultSearches).reduce(
        (sum, count) => sum + Math.max(0, Number(count) || 0),
        0,
      ),
    };
  }

  private async updateSessionMetadata(
    sessionId: string,
    input: { source: string; device: string; path: string; at: Date },
  ): Promise<void> {
    await this.client.eval(UPDATE_SESSION_METADATA_SCRIPT, {
      keys: [
        `${this.sessionKeyPrefix}${sessionId}`,
        this.recentSessionsKey,
      ],
      arguments: [
        input.source,
        input.device,
        input.path,
        input.at.toISOString(),
        String(ANALYTICS_SESSION_TTL_SECONDS),
        String(input.at.getTime()),
        sessionId,
      ],
    });
  }

  private async recordSessionEvent(
    sessionId: string,
    event: {
      type: "pageview" | "click";
      at: Date;
      path: string;
      label?: string;
    },
  ): Promise<void> {
    await this.client.eval(RECORD_SESSION_EVENT_SCRIPT, {
      keys: [
        `${this.sessionKeyPrefix}${sessionId}`,
        this.recentSessionsKey,
      ],
      arguments: [
        String(event.at.getTime()),
        String(ANALYTICS_SESSION_TTL_SECONDS),
        event.type,
        event.at.toISOString(),
        event.path,
        event.label || "",
        sessionId,
      ],
    });
  }
}
