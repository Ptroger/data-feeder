import type { AuthHandler } from "./index.js";

interface ApiKeyConfig {
  type: "api_key";
  param?: string;
  header?: string;
  key: string;
}

export class ApiKeyAuthHandler implements AuthHandler {
  readonly type = "api_key";

  constructor(private config: ApiKeyConfig) {}

  async applyAuth(url: URL, headers: Record<string, string>): Promise<void> {
    if (this.config.param) {
      url.searchParams.set(this.config.param, this.config.key);
    } else if (this.config.header) {
      headers[this.config.header] = this.config.key;
    }
  }
}
