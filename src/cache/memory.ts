export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
  source: string;
  cost: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalCostSaved: number;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private hits = 0;
  private misses = 0;
  private costSaved = 0;

  constructor(cleanupIntervalMs: number = 60_000) {
    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => this.prune(), cleanupIntervalMs);
      this.cleanupInterval.unref();
    }
  }

  get<T>(key: string): CacheEntry<T> | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    this.costSaved += entry.cost;
    return entry;
  }

  set<T>(key: string, data: T, ttlMs: number, meta: { source: string; cost: number }): void {
    const now = Date.now();
    this.store.set(key, {
      data,
      fetchedAt: now,
      expiresAt: now + ttlMs,
      source: meta.source,
      cost: meta.cost,
    });
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalCostSaved: this.costSaved,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

export function buildCacheKey(feedName: string, params: Record<string, unknown>): string {
  const sortedPairs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join(":");
  return sortedPairs ? `${feedName}:${sortedPairs}` : feedName;
}
