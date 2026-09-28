import { createClient, type RedisClientType } from "redis";
import {
  emptyPresenceCounts,
  isPresenceSection,
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
if redis.call('SADD', KEYS[1], ARGV[1]) == 0 then return 0 end
redis.call('INCR', KEYS[2])
redis.call('HINCRBY', KEYS[3], ARGV[2], 1)
local raw = redis.call('GET', KEYS[4])
if raw then
  local decoded, session = pcall(cjson.decode, raw)
  if decoded then
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
  end
end
redis.call('PUBLISH', KEYS[6], 'changed')
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
