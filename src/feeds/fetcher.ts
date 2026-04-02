import { logger } from "../utils/logger.js";

export interface FetchOptions {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  timeout: number;
  retries: number;
  retryBackoff: "exponential" | "linear";
  responsePath?: string;
}

export interface FetchResult {
  data: unknown;
  status: number;
  latencyMs: number;
  cost: number;
  fromCache: boolean;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

function extractPath(data: unknown, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = data;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function backoffMs(attempt: number, strategy: "exponential" | "linear"): number {
  if (strategy === "exponential") return Math.min(1000 * 2 ** attempt, 30_000);
  return 1000 * (attempt + 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(options: FetchOptions): Promise<FetchResult> {
  const { url, method, headers, body, timeout, retries, retryBackoff, responsePath } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = backoffMs(attempt - 1, retryBackoff);
      logger.debug(`Retry ${attempt}/${retries} for ${url} in ${delay}ms`);
      await sleep(delay);
    }

    const start = Date.now();
    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(timeout),
      };
      if (body && method === "POST") {
        fetchOptions.body = JSON.stringify(body);
      }

      logger.debug(`${method} ${url} (attempt ${attempt + 1})`);
      const response = await fetch(url, fetchOptions);
      const latencyMs = Date.now() - start;

      // 402 — return immediately for auth handler to process
      if (response.status === 402) {
        const responseData = await response.json().catch(() => null);
        return {
          data: responseData,
          status: 402,
          latencyMs,
          cost: 0,
          fromCache: false,
        };
      }

      // 429 — rate limited, retry with Retry-After if available
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : backoffMs(attempt, retryBackoff);
        logger.warn(`Rate limited on ${url}, retrying in ${delay}ms`);
        if (attempt < retries) {
          await sleep(delay);
          continue;
        }
        throw new FetchError(`Rate limited: ${url}`, 429, true);
      }

      // 4xx (except 402, 429) — fail immediately
      if (response.status >= 400 && response.status < 500) {
        const text = await response.text().catch(() => "");
        throw new FetchError(
          `HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`,
          response.status,
          false,
        );
      }

      // 5xx — retry
      if (response.status >= 500) {
        lastError = new FetchError(
          `HTTP ${response.status} from ${url}`,
          response.status,
          true,
        );
        if (attempt < retries) continue;
        throw lastError;
      }

      // Success
      let data = await response.json();
      if (responsePath) {
        data = extractPath(data, responsePath);
      }

      return {
        data,
        status: response.status,
        latencyMs,
        cost: 0,
        fromCache: false,
      };
    } catch (error) {
      if (error instanceof FetchError && !error.retryable) throw error;

      lastError = error instanceof Error ? error : new Error(String(error));

      // Timeout or network error — retry
      if (attempt < retries) continue;
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}
