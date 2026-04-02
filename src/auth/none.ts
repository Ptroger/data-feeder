import type { AuthHandler } from "./index.js";

export class NoneAuthHandler implements AuthHandler {
  readonly type = "none";

  async applyAuth(_url: URL, _headers: Record<string, string>): Promise<void> {
    // no-op
  }
}
