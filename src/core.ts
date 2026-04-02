import { writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, findConfigFile, parseConfigString } from "./config/loader.js";
import type { DataFeederConfig, FeedConfig } from "./config/schema.js";
import { FeedManager, type FeedStatus } from "./feeds/manager.js";
import type { FeedResponse } from "./feeds/feed.js";
import type { CacheStats } from "./cache/memory.js";
import { logger } from "./utils/logger.js";

// --- Public types ---

export interface DiscoverResult {
  server: string;
  total_feeds: number;
  feeds: FeedCatalogEntry[];
  hint: string;
}

export interface FeedCatalogEntry {
  feed_name: string;
  tool_name: string;
  type: string;
  description: string;
  source_url: string;
  auth_type: string;
  cache_ttl: string;
  has_schedule: boolean;
  parameters?: Array<{ name: string; type: string; required: boolean; description: string }>;
  usage_example?: { tool: string; arguments: Record<string, unknown> };
  stats?: { total_calls: number; cache_hit_rate: string; errors: number };
}

export interface StatusResult {
  feeds: FeedStatus[];
  cache: CacheStats;
}

export interface Template {
  name: string;
  filename: string;
  content: string;
}

export interface FeedListEntry {
  name: string;
  type: string;
  expose_name: string;
  cache_ttl: string;
  url: string;
}

export interface ValidateResult {
  valid: boolean;
  feed_count: number;
  feeds: Array<{ name: string; type: string; expose_name: string; url: string }>;
}

// --- Core engine ---

export class DataFeeder {
  private manager: FeedManager;
  private config: DataFeederConfig;

  constructor(config: DataFeederConfig) {
    this.config = config;
    this.manager = new FeedManager(config);
    this.manager.initialize();
  }

  // --- Static helpers (no instance needed) ---

  static loadConfig(path?: string): DataFeederConfig {
    return loadConfig(path);
  }

  static findConfigFile(startDir?: string): string {
    return findConfigFile(startDir);
  }

  static parseConfigString(yaml: string): DataFeederConfig {
    return parseConfigString(yaml);
  }

  static init(dir?: string): { configPath: string; envExamplePath: string } {
    const targetDir = dir ?? process.cwd();
    const configPath = resolve(targetDir, "data-feeder.yaml");
    if (existsSync(configPath)) {
      throw new Error("data-feeder.yaml already exists in this directory");
    }

    const template = `# data-feeder configuration
# Docs: https://github.com/ptroger/data-feeder

server:
  name: my-data-feeds
  version: 1.0.0

# Global defaults
defaults:
  cache: 5m
  timeout: 10s
  retries: 3

feeds:
  # Example: Hacker News top stories (free, no auth)
  hn_top_stories:
    source:
      url: https://hacker-news.firebaseio.com/v0/topstories.json
      auth:
        type: none
    cache:
      ttl: 5m
    expose:
      type: tool
      name: get_hn_top_stories
      description: "Get the IDs of the current top stories on Hacker News"

  # Example: Weather API (requires API key)
  # Uncomment and add your API key to .env
  #
  # weather:
  #   source:
  #     url: https://api.openweathermap.org/data/3.0/onecall
  #     auth:
  #       type: api_key
  #       param: appid
  #       key: \${OPENWEATHER_KEY}
  #     default_params:
  #       units: metric
  #     params:
  #       lat: "{{lat}}"
  #       lon: "{{lon}}"
  #   cache:
  #     ttl: 5m
  #   expose:
  #     type: tool
  #     name: get_weather
  #     description: "Get current weather for a location"
  #     params:
  #       lat:
  #         type: number
  #         description: "Latitude"
  #         required: true
  #       lon:
  #         type: number
  #         description: "Longitude"
  #         required: true
`;

    writeFileSync(configPath, template, "utf-8");

    const envExamplePath = resolve(targetDir, ".env.example");
    if (!existsSync(envExamplePath)) {
      writeFileSync(
        envExamplePath,
        "# Add your API keys here\n# OPENWEATHER_KEY=your_key_here\n",
        "utf-8",
      );
    }

    return { configPath, envExamplePath };
  }

  static validate(configPath?: string): ValidateResult {
    const config = loadConfig(configPath);
    return {
      valid: true,
      feed_count: Object.keys(config.feeds).length,
      feeds: Object.entries(config.feeds).map(([name, feed]) => ({
        name,
        type: feed.expose.type,
        expose_name: feed.expose.name,
        url: feed.source.url,
      })),
    };
  }

  static templates(): Template[] {
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      // Works from both src/ (dev) and dist/ (installed)
      let templatesDir = resolve(thisDir, "../templates");
      if (!existsSync(templatesDir)) {
        templatesDir = resolve(thisDir, "../../templates");
      }
      const files = readdirSync(templatesDir).filter((f) => f.endsWith(".yaml"));
      return files.map((filename) => ({
        name: filename.replace(".yaml", "").replace(/-/g, " "),
        filename,
        content: readFileSync(resolve(templatesDir, filename), "utf-8"),
      }));
    } catch {
      return [];
    }
  }

  // --- Instance methods (require a running engine) ---

  get feedConfig(): DataFeederConfig {
    return this.config;
  }

  getManager(): FeedManager {
    return this.manager;
  }

  async query(feedName: string, params: Record<string, unknown>): Promise<FeedResponse> {
    return this.manager.query(feedName, params);
  }

  discover(): DiscoverResult {
    const catalog: FeedCatalogEntry[] = Object.entries(this.config.feeds).map(([name, feed]) => {
      const entry: FeedCatalogEntry = {
        feed_name: name,
        tool_name: feed.expose.name,
        type: feed.expose.type,
        description: feed.expose.description,
        source_url: feed.source.url,
        auth_type: feed.source.auth.type,
        cache_ttl: feed.cache.ttl,
        has_schedule: !!feed.schedule?.length,
      };

      if (feed.expose.type === "tool" && "params" in feed.expose) {
        entry.parameters = Object.entries(feed.expose.params).map(([pName, pConfig]) => ({
          name: pName,
          type: pConfig.type,
          required: pConfig.required,
          description: pConfig.description ?? "",
        }));
        const exampleArgs: Record<string, unknown> = {};
        for (const [pName, pConfig] of Object.entries(feed.expose.params)) {
          if (pConfig.type === "number") exampleArgs[pName] = 0;
          else if (pConfig.type === "boolean") exampleArgs[pName] = true;
          else exampleArgs[pName] = `<${pName}>`;
        }
        entry.usage_example = { tool: feed.expose.name, arguments: exampleArgs };
      }

      const feedInstance = this.manager.getFeed(name);
      if (feedInstance) {
        const stats = feedInstance.getStats();
        entry.stats = {
          total_calls: stats.calls,
          cache_hit_rate:
            stats.calls > 0
              ? `${Math.round((stats.cacheHits / stats.calls) * 100)}%`
              : "n/a",
          errors: stats.errors,
        };
      }

      return entry;
    });

    return {
      server: this.config.server.name,
      total_feeds: catalog.length,
      feeds: catalog,
      hint: "Use the tool_name from each feed to call it directly. Call data_feeder_status for live cache and schedule metrics.",
    };
  }

  status(): StatusResult {
    return {
      feeds: this.manager.status(),
      cache: this.manager.cacheStats(),
    };
  }

  cacheStats(): CacheStats {
    return this.manager.cacheStats();
  }

  list(): FeedListEntry[] {
    return Object.entries(this.config.feeds).map(([name, feed]) => ({
      name,
      type: feed.expose.type,
      expose_name: feed.expose.name,
      cache_ttl: feed.cache.ttl,
      url: feed.source.url,
    }));
  }

  guide(): string {
    const feedDescriptions = Object.entries(this.config.feeds)
      .map(([name, feed]) => {
        let desc = `- **${feed.expose.name}** (feed: ${name}): ${feed.expose.description}`;
        desc += `\n  Source: ${feed.source.url} | Cache: ${feed.cache.ttl} | Auth: ${feed.source.auth.type}`;
        if (feed.expose.type === "tool" && "params" in feed.expose) {
          const params = Object.entries(feed.expose.params)
            .map(([p, c]) => `${p} (${c.type}${c.required ? ", required" : ""})`)
            .join(", ");
          desc += `\n  Parameters: ${params}`;
        }
        return desc;
      })
      .join("\n\n");

    return `# Data Feeder — Agent Guide

This is a **data-fetching hub**. It provides cached, scheduled access to external REST APIs. Every tool here returns real-time or near-real-time data from the internet.

## How to use

1. **Call \`discover\`** to see all available feeds, their parameters, and usage examples.
2. **Call feed tools directly** (e.g., \`get_weather\`, \`get_stock_quote\`) with the required parameters.
3. **Call \`status\`** to see cache hit rates and whether data is fresh.
4. **Call \`templates\`** if you need to suggest adding a new data source.

## Available feeds

${feedDescriptions}

## Important behavior

- **Caching**: Responses are cached per-feed with configurable TTL. The \`_meta.fromCache\` field tells you if data came from cache. The \`_meta.age\` field tells you how old it is.
- **Automatic retries**: Failed requests are retried with backoff. You don't need to retry yourself.
- **Rate limiting**: 429 responses are handled automatically with Retry-After.
- **Cost tracking**: For paid APIs (x402), the \`_meta.cost\` field shows what each call cost.

## Best practices

- Prefer calling feed tools over making raw HTTP requests — they handle auth, caching, retries, and rate limits for you.
- If you need data that isn't available as a feed, suggest adding it via a template from \`templates\`.
- Check \`_meta.age\` to decide if data is fresh enough for your use case.
- For frequently needed data, suggest the developer add a scheduled prefetch to reduce latency.`;
  }

  // --- Lifecycle ---

  startSchedules(): void {
    this.manager.startSchedules();
  }

  stopSchedules(): void {
    this.manager.stopSchedules();
  }

  reload(newConfig: DataFeederConfig): void {
    this.config = newConfig;
    this.manager.reload(newConfig);
  }

  destroy(): void {
    this.manager.destroy();
  }
}
