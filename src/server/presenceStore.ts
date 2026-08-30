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

  async snapshot(): Promise<PresenceSnapshot> {
    await this.cleanupExpired();
    const values = await this.client.hVals(this.recordsKey);
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
}
