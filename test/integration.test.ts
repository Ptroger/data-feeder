import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataFeeder } from "../src/core.js";
import { createMcpServer } from "../src/server/mcp.js";
import type { DataFeederConfig } from "../src/config/schema.js";
import { setupMockServer } from "./setup.js";

setupMockServer();

// --- Test config ---

const testConfig: DataFeederConfig = {
  server: { name: "test-server", version: "1.0.0", transport: "stdio", port: 3100 },
  defaults: {
    cache: "5m",
    timeout: "10s",
    retries: 3,
    retry_backoff: "exponential",
  },
  feeds: {
    test_api: {
      source: {
        url: "https://api.test.com/success",
        method: "GET",
        auth: { type: "none" },
      },
      cache: { ttl: "5m" },
      expose: {
        type: "tool",
        name: "get_test_data",
        description: "Get test data from the test API",
        params: {},
      },
    },
    weather: {
      source: {
        url: "https://api.test.com/weather",
        method: "GET",
        auth: { type: "none" },
        params: { lat: "{{lat}}", lon: "{{lon}}" },
      },
      cache: { ttl: "5m" },
      expose: {
        type: "tool",
        name: "get_weather",
        description: "Get weather for a location",
        params: {
          lat: { type: "number", description: "Latitude", required: true },
          lon: { type: "number", description: "Longitude", required: true },
        },
      },
    },
    news_feed: {
      source: {
        url: "https://api.test.com/success",
        method: "GET",
        auth: { type: "none" },
      },
      cache: { ttl: "10m" },
      expose: {
        type: "resource",
        name: "latest_news",
        description: "Latest news headlines",
      },
    },
  },
};

// --- Helper to create a connected client + server ---

async function createTestPair(config: DataFeederConfig = testConfig) {
  const engine = new DataFeeder(config);
  const server = createMcpServer(engine);
  const client = new Client({ name: "test-client", version: "1.0.0" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, server, engine };
}

// --- Evals ---

describe("Integration: MCP Server E2E", () => {
  describe("Tool discovery", () => {
    it("lists all feed tools + utility tools", async () => {
      const { client, server } = await createTestPair();

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();

      // Feed tools
      expect(names).toContain("get_test_data");
      expect(names).toContain("get_weather");

      // Discoverability tools
      expect(names).toContain("data_feeder_discover");
      expect(names).toContain("data_feeder_status");
      expect(names).toContain("data_feeder_templates");

      // Resource feeds should NOT appear as tools
      expect(names).not.toContain("latest_news");

      await client.close();
      await server.close();
    });

    it("tool descriptions are non-empty and useful", async () => {
      const { client, server } = await createTestPair();

      const { tools } = await client.listTools();
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.description!.length).toBeGreaterThan(10);
      }

      await client.close();
      await server.close();
    });

    it("tool input schemas match config params", async () => {
      const { client, server } = await createTestPair();

      const { tools } = await client.listTools();
      const weatherTool = tools.find((t) => t.name === "get_weather");

      expect(weatherTool).toBeDefined();
      expect(weatherTool!.inputSchema).toBeDefined();
      const props = (weatherTool!.inputSchema as { properties?: Record<string, unknown> }).properties;
      expect(props).toHaveProperty("lat");
      expect(props).toHaveProperty("lon");

      await client.close();
      await server.close();
    });
  });

  describe("Resource discovery", () => {
    it("lists feed resources", async () => {
      const { client, server } = await createTestPair();

      const { resources } = await client.listResources();
      const names = resources.map((r) => r.name);

      expect(names).toContain("latest_news");

      await client.close();
      await server.close();
    });
  });

  describe("Prompt discovery", () => {
    it("lists the data_feeder_guide prompt", async () => {
      const { client, server } = await createTestPair();

      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name);

      expect(names).toContain("data_feeder_guide");

      await client.close();
      await server.close();
    });

    it("guide prompt contains feed descriptions", async () => {
      const { client, server } = await createTestPair();

      const result = await client.getPrompt({ name: "data_feeder_guide" });
      const text = result.messages[0].content as { type: string; text: string };

      expect(text.text).toContain("get_weather");
      expect(text.text).toContain("get_test_data");
      expect(text.text).toContain("data-fetching hub");
      expect(text.text).toContain("_meta.fromCache");

      await client.close();
      await server.close();
    });
  });

  describe("Tool execution", () => {
    it("calls a zero-param tool and returns data with _meta", async () => {
      const { client, server } = await createTestPair();

      const result = await client.callTool({ name: "get_test_data", arguments: {} });
      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.data).toEqual({ result: "ok" });
      expect(parsed._meta).toBeDefined();
      expect(parsed._meta.feed).toBe("test_api");
      expect(parsed._meta.fromCache).toBe(false);

      await client.close();
      await server.close();
    });

    it("calls a parameterized tool with correct params", async () => {
      const { client, server } = await createTestPair();

      const result = await client.callTool({
        name: "get_weather",
        arguments: { lat: 48.85, lon: 2.35 },
      });
      expect(result.isError).toBeFalsy();

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.data.temp).toBe(22);
      expect(parsed.data.conditions).toBe("clear");
      expect(parsed._meta.feed).toBe("weather");

      await client.close();
      await server.close();
    });

    it("second call returns cached data", async () => {
      const { client, server } = await createTestPair();

      // First call — cache miss
      const first = await client.callTool({ name: "get_test_data", arguments: {} });
      const firstParsed = JSON.parse(
        (first.content as Array<{ type: string; text: string }>)[0].text,
      );
      expect(firstParsed._meta.fromCache).toBe(false);

      // Second call — cache hit
      const second = await client.callTool({ name: "get_test_data", arguments: {} });
      const secondParsed = JSON.parse(
        (second.content as Array<{ type: string; text: string }>)[0].text,
      );
      expect(secondParsed._meta.fromCache).toBe(true);
      expect(secondParsed.data).toEqual(firstParsed.data);

      await client.close();
      await server.close();
    });

    it("handles fetch errors gracefully", async () => {
      const errorConfig: DataFeederConfig = {
        ...testConfig,
        feeds: {
          broken: {
            source: {
              url: "https://api.test.com/not-found",
              method: "GET",
              auth: { type: "none" },
            },
            cache: { ttl: "5m" },
            expose: {
              type: "tool",
              name: "get_broken",
              description: "A broken feed",
              params: {},
            },
            retries: 0,
          },
        },
      };

      const { client, server } = await createTestPair(errorConfig);

      const result = await client.callTool({ name: "get_broken", arguments: {} });
      expect(result.isError).toBe(true);

      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);
      expect(parsed.error).toContain("404");

      await client.close();
      await server.close();
    });
  });

  describe("Discoverability tools", () => {
    it("data_feeder_discover returns full catalog", async () => {
      const { client, server } = await createTestPair();

      const result = await client.callTool({ name: "data_feeder_discover", arguments: {} });
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.total_feeds).toBe(3);
      expect(parsed.feeds).toHaveLength(3);

      // Check a feed entry has all expected fields
      const weatherFeed = parsed.feeds.find(
        (f: Record<string, unknown>) => f.feed_name === "weather",
      );
      expect(weatherFeed).toBeDefined();
      expect(weatherFeed.tool_name).toBe("get_weather");
      expect(weatherFeed.description).toBe("Get weather for a location");
      expect(weatherFeed.parameters).toHaveLength(2);
      expect(weatherFeed.usage_example).toBeDefined();
      expect(weatherFeed.usage_example.tool).toBe("get_weather");
      expect(weatherFeed.stats).toBeDefined();

      await client.close();
      await server.close();
    });

    it("data_feeder_status returns live metrics", async () => {
      const { client, server } = await createTestPair();

      // Make some calls first to generate stats
      await client.callTool({ name: "get_test_data", arguments: {} });
      await client.callTool({ name: "get_test_data", arguments: {} }); // cache hit

      const result = await client.callTool({ name: "data_feeder_status", arguments: {} });
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      expect(parsed.feeds).toBeDefined();
      expect(parsed.cache).toBeDefined();
      expect(parsed.cache.hits).toBeGreaterThanOrEqual(1);

      await client.close();
      await server.close();
    });

    it("data_feeder_templates returns available templates", async () => {
      const { client, server } = await createTestPair();

      const result = await client.callTool({ name: "data_feeder_templates", arguments: {} });
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0].text);

      // Templates may or may not load depending on dist vs src path resolution
      // At minimum, the tool should return without error
      expect(parsed.templates).toBeDefined();
      expect(Array.isArray(parsed.templates)).toBe(true);
      expect(parsed.hint).toContain("data-feeder.yaml");

      await client.close();
      await server.close();
    });
  });

  describe("Agent workflow simulation", () => {
    it("full agent flow: discover → call tool → check status", async () => {
      const { client, server } = await createTestPair();

      // Step 1: Agent discovers what's available
      const discover = await client.callTool({ name: "data_feeder_discover", arguments: {} });
      const catalog = JSON.parse(
        (discover.content as Array<{ type: string; text: string }>)[0].text,
      );
      expect(catalog.total_feeds).toBeGreaterThan(0);

      // Step 2: Agent picks a tool from the catalog and calls it
      const weatherFeed = catalog.feeds.find(
        (f: Record<string, unknown>) => f.tool_name === "get_weather",
      );
      expect(weatherFeed).toBeDefined();

      const weatherResult = await client.callTool({
        name: weatherFeed.tool_name,
        arguments: { lat: 48.85, lon: 2.35 },
      });
      const weatherData = JSON.parse(
        (weatherResult.content as Array<{ type: string; text: string }>)[0].text,
      );
      expect(weatherData.data.temp).toBe(22);
      expect(weatherData._meta.fromCache).toBe(false);

      // Step 3: Agent calls again — gets cached
      const cachedResult = await client.callTool({
        name: "get_weather",
        arguments: { lat: 48.85, lon: 2.35 },
      });
      const cachedData = JSON.parse(
        (cachedResult.content as Array<{ type: string; text: string }>)[0].text,
      );
      expect(cachedData._meta.fromCache).toBe(true);

      // Step 4: Agent checks system status
      const statusResult = await client.callTool({ name: "data_feeder_status", arguments: {} });
      const status = JSON.parse(
        (statusResult.content as Array<{ type: string; text: string }>)[0].text,
      );
      expect(status.cache.hits).toBeGreaterThanOrEqual(1);
      expect(status.cache.misses).toBeGreaterThanOrEqual(1);

      await client.close();
      await server.close();
    });
  });
});
