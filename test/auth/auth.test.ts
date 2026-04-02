import { describe, it, expect } from "vitest";
import { createAuthHandler } from "../../src/auth/index.js";

describe("NoneAuthHandler", () => {
  it("does nothing", async () => {
    const handler = createAuthHandler({ type: "none" });
    const url = new URL("https://api.test.com/data");
    const headers: Record<string, string> = {};
    await handler.applyAuth(url, headers);
    expect(url.toString()).toBe("https://api.test.com/data");
    expect(Object.keys(headers)).toHaveLength(0);
  });
});

describe("ApiKeyAuthHandler", () => {
  it("adds key as query param", async () => {
    const handler = createAuthHandler({ type: "api_key", param: "apikey", key: "abc123" });
    const url = new URL("https://api.test.com/data");
    const headers: Record<string, string> = {};
    await handler.applyAuth(url, headers);
    expect(url.searchParams.get("apikey")).toBe("abc123");
  });

  it("adds key as header", async () => {
    const handler = createAuthHandler({ type: "api_key", header: "X-API-Key", key: "abc123" });
    const url = new URL("https://api.test.com/data");
    const headers: Record<string, string> = {};
    await handler.applyAuth(url, headers);
    expect(headers["X-API-Key"]).toBe("abc123");
  });
});

describe("BearerAuthHandler", () => {
  it("adds Authorization header", async () => {
    const handler = createAuthHandler({ type: "bearer", token: "mytoken" });
    const url = new URL("https://api.test.com/data");
    const headers: Record<string, string> = {};
    await handler.applyAuth(url, headers);
    expect(headers["Authorization"]).toBe("Bearer mytoken");
  });
});
