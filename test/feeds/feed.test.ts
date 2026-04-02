import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { Feed } from "../../src/feeds/feed.js";
import { NoneAuthHandler } from "../../src/auth/none.js";
import { ApiKeyAuthHandler } from "../../src/auth/api-key.js";
import { MemoryCache } from "../../src/cache/memory.js";
import { mockServer, setupMockServer } from "../setup.js";
import type { FeedConfig } from "../../src/config/schema.js";

setupMockServer();

const defaults = {
  cache: "5m",
  timeout: "10s",
  retries: 3,
  retryBackoff: "exponential" as const,
};

function makeFeed(overrides: Partial<FeedConfig> = {}, cache?: MemoryCache): Feed {
  const config: FeedConfig = {
    source: {
      url: "https://api.test.com/success",
      method: "GET",
      auth: { type: "none" },
      ...overrides.source,
    },
    cache: { ttl: "5m", ...overrides.cache },
    expose: {
      type: "tool",
      name: "test_tool",
      description: "Test tool",
      params: {},
      ...overrides.expose,
    },
    ...overrides,
    // Re-apply nested to avoid override issues
  };
  // Fix: ensure overrides don't break nesting
  if (overrides.source) config.source = { ...config.source, ...overrides.source };
  if (overrides.cache) config.cache = { ...config.cache, ...overrides.cache };
  if (overrides.expose) config.expose = { ...config.expose, ...overrides.expose } as FeedConfig["expose"];

  return new Feed("test_feed", config, new NoneAuthHandler(), cache ?? new MemoryCache(0), defaults);
}

describe("Feed", () => {
  it("fetches data and returns with _meta", async () => {
    const feed = makeFeed();
    const result = await feed.query({});
    expect(result.data).toEqual({ result: "ok" });
    expect(result._meta.feed).toBe("test_feed");
    expect(result._meta.fromCache).toBe(false);
    expect(result._meta.cost).toBe(0);
  });

  it("returns cached data on second call", async () => {
    const cache = new MemoryCache(0);
    const feed = makeFeed({}, cache);
    const first = await feed.query({});
    expect(first._meta.fromCache).toBe(false);

    const second = await feed.query({});
    expect(second._meta.fromCache).toBe(true);
    expect(second.data).toEqual({ result: "ok" });
  });

  it("applies response path extraction", async () => {
    const feed = makeFeed({
      source: {
        url: "https://api.test.com/nested",
        method: "GET",
        auth: { type: "none" },
        response: { path: "data.results" },
      },
    });
    const result = await feed.query({});
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("applies default_params to URL", async () => {
    let capturedUrl = "";
    mockServer.use(
      http.get("https://api.test.com/with-params", ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );

    const feed = makeFeed({
      source: {
        url: "https://api.test.com/with-params",
        method: "GET",
        auth: { type: "none" },
        default_params: { units: "metric" },
        params: { q: "{{city}}" },
      },
    });
    await feed.query({ city: "Paris" });
    expect(capturedUrl).toContain("units=metric");
    expect(capturedUrl).toContain("q=Paris");
  });

  it("tracks stats", async () => {
    const cache = new MemoryCache(0);
    const feed = makeFeed({}, cache);
    await feed.query({});
    await feed.query({}); // cache hit
    const stats = feed.getStats();
    expect(stats.calls).toBe(2);
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheMisses).toBe(1);
  });

  it("generates Zod params shape from expose config", () => {
    const feed = makeFeed({
      expose: {
        type: "tool",
        name: "get_weather",
        description: "Weather",
        params: {
          lat: { type: "number", description: "Latitude", required: true },
          lon: { type: "number", description: "Longitude", required: true },
          units: { type: "string", description: "Units", required: false },
        },
      },
    });
    const shape = feed.getParamsShape();
    expect(Object.keys(shape)).toEqual(["lat", "lon", "units"]);
  });
});
