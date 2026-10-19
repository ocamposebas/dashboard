import { AffiliateRepository, type AffiliateShadowSyncResult } from "./affiliateRepository.js";
import { WooCommerceGateway } from "./wooCommerceGateway.js";

export interface AffiliateShadowSyncConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  accessMode: "read_only" | "read_write";
  syncIntervalMs: number;
  backfillDays: number;
}

interface AffiliateShadowSyncOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class AffiliateShadowSync {
  private readonly gateway: WooCommerceGateway;
  private readonly now: () => Date;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(
    config: AffiliateShadowSyncConfig,
    private readonly repository: AffiliateRepository,
    options: AffiliateShadowSyncOptions = {},
  ) {
    this.gateway = new WooCommerceGateway(config, options.fetchImpl || fetch);
    this.now = options.now || (() => new Date());
    this.logger = options.logger || console;
    this.intervalMs = Math.max(60_000, config.syncIntervalMs);
  }

  private readonly intervalMs: number;

  start(): void {
    if (this.timer) return;
    this.queueSync();
    this.timer = setInterval(() => this.queueSync(), this.intervalMs);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  async syncOnce(): Promise<AffiliateShadowSyncResult> {
    const syncedAt = this.now();
    let imported = false;
    try {
      const legacy = await this.gateway.listLegacyAffiliateCoupons();
      await this.repository.importLegacy(legacy);
      imported = true;
    } catch (error: unknown) {
      this.logger.warn("Affiliate plugin snapshot refresh failed; checking whether shadow tracking is already initialized", error);
    }

    if (imported) await this.repository.initializeShadowMode(syncedAt);
    const window = await this.repository.shadowSyncWindow(syncedAt);
    if (!window.enabled) {
      return { scanned: 0, matched: 0, upserted: 0, conflicts: 0, ignored: 0 };
    }
    const orders = await this.gateway.listOrdersModifiedSince(
      window.after.toISOString(),
      window.before.toISOString(),
    );
    return this.repository.reconcileShadowOrders(orders, syncedAt);
  }

  private queueSync(): void {
    if (this.inFlight) return;
    const operation = this.syncOnce()
      .then((result) => {
        this.logger.info(
          `Affiliate shadow sync scanned ${result.scanned}, matched ${result.matched}, ` +
          `saved ${result.upserted}, conflicts ${result.conflicts}`,
        );
      })
      .catch((error: unknown) => {
        this.logger.error("Affiliate shadow synchronization failed", error);
      });
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = undefined;
    });
  }
}
