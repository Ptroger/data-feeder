import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("Stdio MCP Server E2E", () => {
  let tmpDir: string;
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    // Create a temp directory with a minimal config (no env vars needed)
    tmpDir = mkdtempSync(join(tmpdir(), "data-feeder-test-"));
    const configPath = join(tmpDir, "data-feeder.yaml");
    writeFileSync(
      configPath,
      `
server:
  name: stdio-test
feeds:
  hn:
    source:
      url: https://hacker-news.firebaseio.com/v0/topstories.json
      auth:
        type: none
    cache:
      ttl: 5m
    expose:
      type: tool
      name: get_hn_stories
      description: "Get HN top stories"
`,
    );

    // Spawn the server as a child process on stdio
    const serverPath = resolve(import.meta.dirname, "../dist/index.js");
    transport = new StdioClientTransport({
      command: "node",
      args: [serverPath, "serve", "--config", configPath],
    });

    client = new Client({ name: "stdio-test-client", version: "1.0.0" });
    await client.connect(transport);
  }, 15_000);

  afterAll(async () => {
    await client.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists tools including feed tools and utility tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("get_hn_stories");
    expect(names).toContain("data_feeder_discover");
    expect(names).toContain("data_feeder_status");
    expect(names).toContain("data_feeder_templates");
    expect(names).toContain("data_feeder_add_feed");
  });

  it("calls get_hn_stories and gets live data", async () => {
    const result = await client.callTool({ name: "get_hn_stories", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.data).toBeDefined();
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeGreaterThan(0);
    expect(parsed._meta.feed).toBe("hn");
    expect(parsed._meta.fromCache).toBe(false);
  }, 10_000);

  it("second call returns cached data", async () => {
    const result = await client.callTool({ name: "get_hn_stories", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed._meta.fromCache).toBe(true);
  });

  it("discover returns feed catalog", async () => {
    const result = await client.callTool({ name: "data_feeder_discover", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.server).toBe("stdio-test");
    expect(parsed.total_feeds).toBe(1);
    expect(parsed.feeds[0].tool_name).toBe("get_hn_stories");
  });

  it("status shows cache hits after previous calls", async () => {
    const result = await client.callTool({ name: "data_feeder_status", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.cache.hits).toBeGreaterThanOrEqual(1);
    expect(parsed.cache.misses).toBeGreaterThanOrEqual(1);
  });

  it("lists prompts including guide", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("data_feeder_guide");
  });
});
