import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryCache, buildCacheKey } from "../../src/cache/memory.js";

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache(0); // disable auto-cleanup for tests
  });

  it("returns null for missing key", () => {
    expect(cache.get("missing")).toBeNull();
  });

  it("stores and retrieves data", () => {
    cache.set("key1", { temp: 20 }, 60_000, { source: "weather", cost: 0 });
    const entry = cache.get<{ temp: number }>("key1");
    expect(entry).not.toBeNull();
    expect(entry!.data.temp).toBe(20);
    expect(entry!.source).toBe("weather");
  });

  it("returns null for expired entry", () => {
    vi.useFakeTimers();
    cache.set("key1", "data", 1_000, { source: "test", cost: 0 });
    vi.advanceTimersByTime(1_001);
    expect(cache.get("key1")).toBeNull();
    vi.useRealTimers();
  });

  it("has() returns false for expired entry", () => {
    vi.useFakeTimers();
    cache.set("key1", "data", 1_000, { source: "test", cost: 0 });
    vi.advanceTimersByTime(1_001);
    expect(cache.has("key1")).toBe(false);
    vi.useRealTimers();
  });

  it("tracks hits and misses", () => {
    cache.set("key1", "data", 60_000, { source: "test", cost: 0 });
    cache.get("key1"); // hit
    cache.get("key1"); // hit
    cache.get("missing"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  it("tracks cost savings on cache hits", () => {
    cache.set("key1", "data", 60_000, { source: "test", cost: 0.01 });
    cache.get("key1"); // hit, saves 0.01
    cache.get("key1"); // hit, saves 0.01
    expect(cache.stats().totalCostSaved).toBeCloseTo(0.02);
  });

  it("prune removes expired entries", () => {
    vi.useFakeTimers();
    cache.set("short", "data", 1_000, { source: "test", cost: 0 });
    cache.set("long", "data", 60_000, { source: "test", cost: 0 });
    vi.advanceTimersByTime(1_001);
    cache.prune();
    expect(cache.stats().entries).toBe(1);
    vi.useRealTimers();
  });

  it("delete removes a specific entry", () => {
    cache.set("key1", "data", 60_000, { source: "test", cost: 0 });
    cache.delete("key1");
    expect(cache.has("key1")).toBe(false);
  });

  it("clear removes all entries", () => {
    cache.set("key1", "a", 60_000, { source: "test", cost: 0 });
    cache.set("key2", "b", 60_000, { source: "test", cost: 0 });
    cache.clear();
    expect(cache.stats().entries).toBe(0);
  });
});

describe("buildCacheKey", () => {
  it("builds key from feed name and sorted params", () => {
    expect(buildCacheKey("weather", { lon: 2.35, lat: 48.85 })).toBe("weather:lat=48.85:lon=2.35");
  });

  it("returns just feed name when no params", () => {
    expect(buildCacheKey("hn", {})).toBe("hn");
  });

  it("handles single param", () => {
    expect(buildCacheKey("stock", { symbol: "AAPL" })).toBe("stock:symbol=AAPL");
  });
});
