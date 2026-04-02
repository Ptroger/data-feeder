import type { AuthConfig, BudgetConfig } from "../config/schema.js";
import type { FetchResult } from "../feeds/fetcher.js";
import { NoneAuthHandler } from "./none.js";
import { ApiKeyAuthHandler } from "./api-key.js";
import { BearerAuthHandler } from "./bearer.js";
import { X402AuthHandler, createX402AuthHandler } from "./x402.js";

export interface AuthHandler {
  readonly type: string;
  applyAuth(url: URL, headers: Record<string, string>): Promise<void>;
  handle402?(
    response: FetchResult,
    url: URL,
    headers: Record<string, string>,
  ): Promise<{ headers: Record<string, string>; cost: number }>;
}

export function createAuthHandler(config: AuthConfig, budget?: BudgetConfig): AuthHandler {
  switch (config.type) {
    case "none":
      return new NoneAuthHandler();
    case "api_key":
      return new ApiKeyAuthHandler(config);
    case "bearer":
      return new BearerAuthHandler(config);
    case "x402":
      return createX402AuthHandler(config, budget);
    default:
      throw new Error(`Unknown auth type: ${(config as { type: string }).type}`);
  }
}
