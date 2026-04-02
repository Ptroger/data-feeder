import type { AuthHandler } from "./index.js";

interface BearerConfig {
  type: "bearer";
  token: string;
}

export class BearerAuthHandler implements AuthHandler {
  readonly type = "bearer";

  constructor(private config: BearerConfig) {}

  async applyAuth(_url: URL, headers: Record<string, string>): Promise<void> {
    headers["Authorization"] = `Bearer ${this.config.token}`;
  }
}
