import type { DataFeederConfig } from "../config/schema.js";
import { createAuthHandler } from "../auth/index.js";
import { MemoryCache } from "../cache/memory.js";
import { Feed, type FeedResponse, type FeedStats } from "./feed.js";
import { Scheduler } from "../scheduler/cron.js";
import { logger } from "../utils/logger.js";

export interface FeedStatus {
  name: string;
  url: string;
  exposeType: string;
  exposeName: string;
  cacheTtl: string;
  hasSchedule: boolean;
  stats: FeedStats;
}

export class FeedManager {
  private feeds = new Map<string, Feed>();
  private cache: MemoryCache;
  private scheduler: Scheduler;
  private config: DataFeederConfig;

  constructor(config: DataFeederConfig) {
    this.config = config;
    this.cache = new MemoryCache();
    this.scheduler = new Scheduler();
  }

  initialize(): void {
    for (const [name, feedConfig] of Object.entries(this.config.feeds)) {
      const auth = createAuthHandler(feedConfig.source.auth, this.config.budget);
      const defaults = {
        ...this.config.defaults,
        retryBackoff: this.config.defaults.retry_backoff,
      };
      const feed = new Feed(name, feedConfig, auth, this.cache, defaults);
      this.feeds.set(name, feed);
      logger.info(`Registered feed: ${name} → ${feedConfig.expose.name}`);
    }
  }

  async query(feedName: string, params: Record<string, unknown>): Promise<FeedResponse> {
    const feed = this.feeds.get(feedName);
    if (!feed) throw new Error(`Unknown feed: ${feedName}`);
    return feed.query(params);
  }

  getFeed(name: string): Feed | undefined {
    return this.feeds.get(name);
  }

  getAllFeeds(): Feed[] {
    return Array.from(this.feeds.values());
  }

  startSchedules(): void {
    for (const feed of this.feeds.values()) {
      if (!feed.config.schedule) continue;
      for (let i = 0; i < feed.config.schedule.length; i++) {
        const entry = feed.config.schedule[i];
        const jobId = `${feed.name}_schedule_${i}`;
        const callback = async () => {
          logger.debug(`Prefetching ${feed.name} (scheduled)`);
          await feed.query(entry.params as Record<string, unknown>);
        };
        if (entry.cron) {
          this.scheduler.scheduleCron(jobId, entry.cron, callback);
        } else if (entry.every) {
          this.scheduler.scheduleInterval(jobId, entry.every, callback);
        }
      }
    }
  }

  stopSchedules(): void {
    this.scheduler.cancelAll();
  }

  reload(newConfig: DataFeederConfig): void {
    logger.info("Reloading feeds...");
    this.scheduler.cancelAll();
    this.feeds.clear();
    this.cache.clear();
    this.config = newConfig;
    this.initialize();
    this.startSchedules();
  }

  status(): FeedStatus[] {
    return this.getAllFeeds().map((feed) => ({
      name: feed.name,
      url: feed.config.source.url,
      exposeType: feed.config.expose.type,
      exposeName: feed.config.expose.name,
      cacheTtl: feed.config.cache.ttl,
      hasSchedule: !!feed.config.schedule?.length,
      stats: feed.getStats(),
    }));
  }

  cacheStats() {
    return this.cache.stats();
  }

  destroy(): void {
    this.scheduler.cancelAll();
    this.cache.destroy();
    this.feeds.clear();
  }
}
