import { describe, it, expect } from "vitest";
import { DataFeederConfigSchema, parseTtl } from "../../src/config/schema.js";

describe("parseTtl", () => {
  it("parses seconds", () => expect(parseTtl("30s")).toBe(30_000));
  it("parses minutes", () => expect(parseTtl("5m")).toBe(300_000));
  it("parses hours", () => expect(parseTtl("1h")).toBe(3_600_000));
  it("parses days", () => expect(parseTtl("7d")).toBe(604_800_000));
  it("rejects invalid format", () => expect(() => parseTtl("5x")).toThrow());
  it("rejects empty string", () => expect(() => parseTtl("")).toThrow());
});

describe("DataFeederConfigSchema", () => {
  const minimalFeed = {
    source: { url: "https://api.example.com/data" },
    expose: { type: "tool", name: "get_data", description: "Get data" },
  };

  it("accepts minimal valid config", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: { my_feed: minimalFeed },
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults", () => {
    const result = DataFeederConfigSchema.parse({
      feeds: { my_feed: minimalFeed },
    });
    expect(result.server.name).toBe("data-feeder");
    expect(result.server.transport).toBe("stdio");
    expect(result.defaults.cache).toBe("5m");
    expect(result.defaults.retries).toBe(3);
    expect(result.defaults.retry_backoff).toBe("exponential");
  });

  it("rejects empty feeds", () => {
    const result = DataFeederConfigSchema.safeParse({ feeds: {} });
    expect(result.success).toBe(false);
  });

  it("rejects invalid feed name (starts with number)", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: { "123bad": minimalFeed },
    });
    expect(result.success).toBe(false);
  });

  it("accepts feed with api_key auth (param)", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: {
        my_feed: {
          ...minimalFeed,
          source: {
            url: "https://api.example.com",
            auth: { type: "api_key", param: "apikey", key: "test123" },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts feed with api_key auth (header)", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: {
        my_feed: {
          ...minimalFeed,
          source: {
            url: "https://api.example.com",
            auth: { type: "api_key", header: "X-API-Key", key: "test123" },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts feed with bearer auth", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: {
        my_feed: {
          ...minimalFeed,
          source: {
            url: "https://api.example.com",
            auth: { type: "bearer", token: "mytoken" },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts resource expose type", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: {
        my_feed: {
          source: { url: "https://api.example.com/data" },
          expose: { type: "resource", name: "my_resource", description: "A resource" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts schedule with cron", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: {
        my_feed: {
          ...minimalFeed,
          schedule: [{ params: { lat: 48.85 }, cron: "*/5 * * * *" }],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts schedule with every", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: {
        my_feed: {
          ...minimalFeed,
          schedule: [{ params: { lat: 48.85 }, every: "10m" }],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects schedule with both every and cron", () => {
    const result = DataFeederConfigSchema.safeParse({
      feeds: {
        my_feed: {
          ...minimalFeed,
          schedule: [{ params: {}, every: "10m", cron: "*/5 * * * *" }],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts full config with all options", () => {
    const result = DataFeederConfigSchema.safeParse({
      server: { name: "my-feeds", version: "2.0.0", transport: "http", port: 8080 },
      defaults: { cache: "10m", timeout: "30s", retries: 5, retry_backoff: "linear" },
      budget: { daily_max: 10.0, alert_threshold: 0.9 },
      feeds: {
        weather: {
          source: {
            url: "https://api.openweathermap.org/data/3.0/onecall",
            auth: { type: "api_key", param: "appid", key: "abc123" },
            default_params: { units: "metric" },
            params: { lat: "{{lat}}", lon: "{{lon}}" },
            response: { path: "data.results" },
          },
          cache: { ttl: "5m", key: "{{lat}}:{{lon}}" },
          schedule: [{ params: { lat: 48.85, lon: 2.35 }, every: "10m" }],
          expose: {
            type: "tool",
            name: "get_weather",
            description: "Get weather",
            params: {
              lat: { type: "number", description: "Latitude", required: true },
              lon: { type: "number", description: "Longitude", required: true },
            },
          },
          timeout: "15s",
          retries: 5,
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
