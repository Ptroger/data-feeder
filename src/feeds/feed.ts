import { z } from "zod";
import type { FeedConfig, ExposeParamConfig } from "../config/schema.js";
import { parseTtl } from "../config/schema.js";
import type { AuthHandler } from "../auth/index.js";
import { fetchWithRetry, type FetchResult } from "./fetcher.js";
import { MemoryCache, buildCacheKey } from "../cache/memory.js";
import { logger } from "../utils/logger.js";

export interface FeedResponse {
  data: unknown;
  _meta: {
    feed: string;
    fromCache: boolean;
    fetchedAt: string;
    age: string;
    latencyMs: number;
    source: string;
    cost: number;
  };
}

export interface FeedStats {
  name: string;
  calls: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  totalCost: number;
}

const TEMPLATE_REGEX = /\{\{(\w+)\}\}/g;

function resolveTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(TEMPLATE_REGEX, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) return `{{${key}}}`;
    return String(value);
  });
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export class Feed {
  readonly name: string;
  readonly config: FeedConfig;
  private auth: AuthHandler;
  private cache: MemoryCache;
  private ttlMs: number;
  private timeoutMs: number;
  private stats_: FeedStats;

  constructor(
    name: string,
    config: FeedConfig,
    auth: AuthHandler,
    cache: MemoryCache,
    defaults: { cache: string; timeout: string; retries: number; retryBackoff: "exponential" | "linear" },
  ) {
    this.name = name;
    this.config = config;
    this.auth = auth;
    this.cache = cache;
    this.ttlMs = parseTtl(config.cache.ttl);
    this.timeoutMs = parseTtl(config.timeout ?? defaults.timeout);
    this.stats_ = { name, calls: 0, cacheHits: 0, cacheMisses: 0, errors: 0, totalCost: 0 };
  }

  async query(params: Record<string, unknown>): Promise<FeedResponse> {
    this.stats_.calls++;

    // Build cache key
    const cacheKeyTemplate = this.config.cache.key;
    const cacheKey = cacheKeyTemplate
      ? `${this.name}:${resolveTemplate(cacheKeyTemplate, params)}`
      : buildCacheKey(this.name, params);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.stats_.cacheHits++;
      const age = Date.now() - cached.fetchedAt;
      return {
        data: cached.data,
        _meta: {
          feed: this.name,
          fromCache: true,
          fetchedAt: new Date(cached.fetchedAt).toISOString(),
          age: formatAge(age),
          latencyMs: 0,
          source: this.config.source.url,
          cost: 0,
        },
      };
    }

    this.stats_.cacheMisses++;

    // Build URL with params
    const url = new URL(resolveTemplate(this.config.source.url, params));

    // Apply default_params
    if (this.config.source.default_params) {
      for (const [key, value] of Object.entries(this.config.source.default_params)) {
        url.searchParams.set(key, value);
      }
    }

    // Apply dynamic params (resolve templates)
    if (this.config.source.params) {
      for (const [key, template] of Object.entries(this.config.source.params)) {
        const resolved = resolveTemplate(template, params);
        if (resolved !== template) {
          url.searchParams.set(key, resolved);
        }
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.config.source.headers,
    };

    // Apply auth
    await this.auth.applyAuth(url, headers);

    try {
      const result = await fetchWithRetry({
        url: url.toString(),
        method: this.config.source.method,
        headers,
        timeout: this.timeoutMs,
        retries: this.config.retries ?? 3,
        retryBackoff: "exponential",
        responsePath: this.config.source.response?.path,
      });

      // Handle 402 with auth handler
      if (result.status === 402 && this.auth.handle402) {
        const payment = await this.auth.handle402(result, url, headers);
        const paidResult = await fetchWithRetry({
          url: url.toString(),
          method: this.config.source.method,
          headers: { ...headers, ...payment.headers },
          timeout: this.timeoutMs,
          retries: 0,
          retryBackoff: "exponential",
          responsePath: this.config.source.response?.path,
        });
        paidResult.cost = payment.cost;
        this.stats_.totalCost += payment.cost;
        this.cache.set(cacheKey, paidResult.data, this.ttlMs, {
          source: this.name,
          cost: payment.cost,
        });
        return this.buildResponse(paidResult);
      }

      // Cache the result
      this.cache.set(cacheKey, result.data, this.ttlMs, {
        source: this.name,
        cost: result.cost,
      });

      return this.buildResponse(result);
    } catch (error) {
      this.stats_.errors++;
      throw error;
    }
  }

  getParamsShape(): Record<string, z.ZodTypeAny> {
    if (this.config.expose.type !== "tool") return {};
    const shape: Record<string, z.ZodTypeAny> = {};
    const params = this.config.expose.params;

    for (const [name, paramConfig] of Object.entries(params)) {
      let schema: z.ZodTypeAny;
      switch (paramConfig.type) {
        case "number":
          schema = z.number();
          break;
        case "boolean":
          schema = z.boolean();
          break;
        default:
          schema = z.string();
      }
      if (paramConfig.description) {
        schema = schema.describe(paramConfig.description);
      }
      if (!paramConfig.required) {
        schema = schema.optional();
      }
      shape[name] = schema;
    }
    return shape;
  }

  getStats(): FeedStats {
    return { ...this.stats_ };
  }

  private buildResponse(result: FetchResult): FeedResponse {
    return {
      data: result.data,
      _meta: {
        feed: this.name,
        fromCache: false,
        fetchedAt: new Date().toISOString(),
        age: "0s",
        latencyMs: result.latencyMs,
        source: this.config.source.url,
        cost: result.cost,
      },
    };
  }
}
