import { createClient, type RedisClientType } from "redis";
import {
  emptyPresenceCounts,
  isPresenceSection,
  type PresenceSection,
  type PresenceSnapshot,
} from "../shared/protocol.js";

interface PresenceRecord {
  section: PresenceSection;
  connectionId: string;
}

interface AnalyticsSession {
  id: string;
  number: number;
  source: string;
  device: string;
  path: string;
  startedAt: string;
  lastSeenAt: string;
  pageViews: number;
  clicks: number;
  events: Array<{
    type: "pageview" | "click";
    at: string;
    path: string;
    label?: string;
  }>;
}

const TOUCH_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
local changed = 0
if not current then
  changed = 1
else
  local decoded = cjson.decode(current)
  if decoded.section ~= ARGV[2] then changed = 1 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
if changed == 1 then redis.call('PUBLISH', KEYS[3], 'changed') end
return changed
`;

const REMOVE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.connectionId ~= ARGV[2] then return 0 end
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

export class PresenceStore {
  private readonly client: RedisClientType;
  private readonly subscriber: RedisClientType;
  private readonly recordsKey: string;
  private readonly expiriesKey: string;
  private readonly channelKey: string;
  private readonly totalViewsKey: string;
  private readonly uniqueVisitorsKey: string;
  private readonly pageViewsKey: string;
  private readonly totalSessionsKey: string;
  private readonly totalClicksKey: string;
  private readonly sourcesKey: string;
  private readonly devicesKey: string;
  private readonly clicksKey: string;
  private readonly dailyViewsKey: string;
  private readonly dailySessionsKey: string;
  private readonly dailyClicksKey: string;
  private readonly recentSessionsKey: string;
  private readonly sessionKeyPrefix: string;
  private readonly sessionSequenceKey: string;
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    redisUrl: string,
    keyPrefix: string,
    private readonly ttlMs: number,
  ) {
    this.client = createClient({ url: redisUrl });
    this.subscriber = this.client.duplicate();
    this.recordsKey = `${keyPrefix}:records`;
    this.expiriesKey = `${keyPrefix}:expiries`;
    this.channelKey = `${keyPrefix}:events`;
    this.totalViewsKey = `${keyPrefix}:analytics:views`;
    this.uniqueVisitorsKey = `${keyPrefix}:analytics:visitors`;
    this.pageViewsKey = `${keyPrefix}:analytics:pages`;
    this.totalSessionsKey = `${keyPrefix}:analytics:sessions`;
    this.totalClicksKey = `${keyPrefix}:analytics:clicks:total`;
    this.sourcesKey = `${keyPrefix}:analytics:sources`;
    this.devicesKey = `${keyPrefix}:analytics:devices`;
    this.clicksKey = `${keyPrefix}:analytics:clicks`;
    this.dailyViewsKey = `${keyPrefix}:analytics:daily`;
    this.dailySessionsKey = `${keyPrefix}:analytics:daily:sessions`;
    this.dailyClicksKey = `${keyPrefix}:analytics:daily:clicks`;
    this.recentSessionsKey = `${keyPrefix}:analytics:recent`;
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
    connectionId: string,
    section: PresenceSection,
  ): Promise<void> {
    const record: PresenceRecord = { section, connectionId };
    const expiresAt = Date.now() + this.ttlMs;
    await this.client.eval(TOUCH_SCRIPT, {
      keys: [this.recordsKey, this.expiriesKey, this.channelKey],
      arguments: [visitorId, section, String(expiresAt), JSON.stringify(record)],
    });
  }

  async remove(visitorId: string, connectionId: string): Promise<void> {
    await this.client.eval(REMOVE_SCRIPT, {
      keys: [this.recordsKey, this.expiriesKey, this.channelKey],
      arguments: [visitorId, connectionId],
    });
  }

  async startSession(input: {
    sessionId: string;
    source: string;
    device: string;
    path: string;
  }): Promise<void> {
    const now = new Date();
    const key = `${this.sessionKeyPrefix}${input.sessionId}`;
    const existingSession = await this.client.get(key);
    const sessionNumber = existingSession
      ? 0
      : await this.client.incr(this.sessionSequenceKey);
    const session: AnalyticsSession = {
      id: input.sessionId,
      number: sessionNumber,
      source: input.source,
      device: input.device,
      path: input.path,
      startedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      pageViews: 0,
      clicks: 0,
      events: [],
    };
    const created = existingSession
      ? null
      : await this.client.set(key, JSON.stringify(session), {
          EX: 30 * 24 * 60 * 60,
          NX: true,
        });
    const transaction = this.client.multi();
    if (created) {
      transaction.incr(this.totalSessionsKey);
      transaction.hIncrBy(this.sourcesKey, input.source, 1);
      transaction.hIncrBy(this.devicesKey, input.device, 1);
      transaction.hIncrBy(this.dailySessionsKey, now.toISOString().slice(0, 10), 1);
    }
    transaction.zAdd(this.recentSessionsKey, { score: now.getTime(), value: input.sessionId });
    transaction.zRemRangeByRank(this.recentSessionsKey, 0, -101);
    await transaction.exec();
    if (!created) {
      await this.updateSession(input.sessionId, (existing) => ({
        ...existing,
        path: input.path,
        lastSeenAt: now.toISOString(),
      }));
    }
  }

  async recordPageView(visitorId: string, connectionId: string, path: string): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const transaction = this.client.multi();
    transaction.incr(this.totalViewsKey);
    transaction.pfAdd(this.uniqueVisitorsKey, visitorId);
    transaction.hIncrBy(this.pageViewsKey, path, 1);
    transaction.hIncrBy(this.dailyViewsKey, date, 1);
    transaction.publish(this.channelKey, "changed");
    await transaction.exec();
    await this.updateSession(connectionId, (session) => ({
      ...session,
      path,
      lastSeenAt: new Date().toISOString(),
      pageViews: session.pageViews + 1,
      events: [...(session.events || []), { type: "pageview" as const, at: new Date().toISOString(), path }].slice(-100),
    }));
  }

  async recordClick(connectionId: string, path: string, label: string): Promise<void> {
    const now = new Date();
    const transaction = this.client.multi();
    transaction.incr(this.totalClicksKey);
    transaction.hIncrBy(this.clicksKey, `${path}\u001f${label}`, 1);
    transaction.hIncrBy(this.dailyClicksKey, now.toISOString().slice(0, 10), 1);
    transaction.publish(this.channelKey, "changed");
    await transaction.exec();
    await this.updateSession(connectionId, (session) => ({
      ...session,
      path,
      lastSeenAt: now.toISOString(),
      clicks: session.clicks + 1,
      events: [...(session.events || []), { type: "click" as const, at: now.toISOString(), path, label }].slice(-100),
    }));
  }

  async snapshot(): Promise<PresenceSnapshot> {
    await this.cleanupExpired();
    const [values, totalViewsRaw, uniqueVisitors, pageViews, totalSessionsRaw, totalClicksRaw, sources, devices, clicks, dailyViews, dailySessions, dailyClicks, recentIds, visitorsLast30Minutes] = await Promise.all([
      this.client.hVals(this.recordsKey),
      this.client.get(this.totalViewsKey),
      this.client.pfCount(this.uniqueVisitorsKey),
      this.client.hGetAll(this.pageViewsKey),
      this.client.get(this.totalSessionsKey),
      this.client.get(this.totalClicksKey),
      this.client.hGetAll(this.sourcesKey),
      this.client.hGetAll(this.devicesKey),
      this.client.hGetAll(this.clicksKey),
      this.client.hGetAll(this.dailyViewsKey),
      this.client.hGetAll(this.dailySessionsKey),
      this.client.hGetAll(this.dailyClicksKey),
      this.client.zRange(this.recentSessionsKey, 0, 99, { REV: true }),
      this.client.zCount(this.recentSessionsKey, Date.now() - 30 * 60_000, "+inf"),
    ]);
    const recentRaw = recentIds.length
      ? await this.client.mGet(recentIds.map((id) => `${this.sessionKeyPrefix}${id}`))
      : [];
    const recentSessions = recentRaw.flatMap((value) => {
      if (!value) return [];
      try { return [JSON.parse(value) as AnalyticsSession]; } catch { return []; }
    });
    const legacySessions = recentSessions
      .filter((session) => !Number.isSafeInteger(session.number) || session.number <= 0)
      .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
    for (const session of legacySessions) {
      session.number = await this.client.incr(this.sessionSequenceKey);
      await this.client.set(
        `${this.sessionKeyPrefix}${session.id}`,
        JSON.stringify(session),
        { EX: 30 * 24 * 60 * 60 },
      );
    }
    recentSessions.sort((left, right) =>
      Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) || right.number - left.number,
    );
    const counts = emptyPresenceCounts();

    for (const value of values) {
      try {
        const record = JSON.parse(value) as Partial<PresenceRecord>;
        if (isPresenceSection(record.section)) counts[record.section] += 1;
      } catch {
        // Invalid transient records are ignored and disappear with their TTL.
      }
    }

    return {
      type: "presence:snapshot",
      counts,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      serverTime: new Date().toISOString(),
      analytics: {
        totalViews: Number(totalViewsRaw || 0),
        uniqueVisitors,
        totalSessions: Number(totalSessionsRaw || 0),
        totalClicks: Number(totalClicksRaw || 0),
        visitorsLast30Minutes,
        topPages: Object.entries(pageViews)
          .map(([path, views]) => ({ path, views: Number(views) }))
          .sort((a, b) => b.views - a.views)
          .slice(0, 8),
        topSources: this.rankHash(sources),
        topDevices: this.rankHash(devices),
        topClicks: Object.entries(clicks)
          .map(([key, count]) => {
            const [path, label] = key.split("\u001f");
            return { path: path || "/", label: label || "Interaction", count: Number(count) };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
        dailyViews: Object.entries(dailyViews)
          .map(([date, views]) => ({ date, views: Number(views) }))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-14),
        dailyActivity: Array.from(new Set([
          ...Object.keys(dailyViews),
          ...Object.keys(dailySessions),
          ...Object.keys(dailyClicks),
        ]))
          .sort((a, b) => a.localeCompare(b))
          .slice(-30)
          .map((date) => ({
            date,
            views: Number(dailyViews[date] || 0),
            sessions: Number(dailySessions[date] || 0),
            clicks: Number(dailyClicks[date] || 0),
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

  private rankHash(values: Record<string, string>): Array<{ label: string; count: number }> {
    return Object.entries(values)
      .map(([label, count]) => ({ label, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  private async updateSession(
    connectionId: string,
    update: (session: AnalyticsSession) => AnalyticsSession,
  ): Promise<void> {
    const key = `${this.sessionKeyPrefix}${connectionId}`;
    const raw = await this.client.get(key);
    if (!raw) return;
    try {
      const session = update(JSON.parse(raw) as AnalyticsSession);
      const transaction = this.client.multi();
      transaction.set(key, JSON.stringify(session), { EX: 30 * 24 * 60 * 60 });
      transaction.zAdd(this.recentSessionsKey, { score: Date.now(), value: connectionId });
      await transaction.exec();
    } catch {
      // Invalid analytics sessions expire automatically.
    }
  }
}
