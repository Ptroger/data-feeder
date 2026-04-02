import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEnvVars, parseConfigString } from "../../src/config/loader.js";

describe("resolveEnvVars", () => {
  beforeEach(() => {
    process.env.TEST_KEY = "resolved_value";
    process.env.ANOTHER_KEY = "another_value";
  });

  afterEach(() => {
    delete process.env.TEST_KEY;
    delete process.env.ANOTHER_KEY;
  });

  it("resolves env vars in strings", () => {
    expect(resolveEnvVars("${TEST_KEY}")).toBe("resolved_value");
  });

  it("resolves multiple env vars in one string", () => {
    expect(resolveEnvVars("${TEST_KEY}-${ANOTHER_KEY}")).toBe("resolved_value-another_value");
  });

  it("resolves env vars in nested objects", () => {
    const result = resolveEnvVars({ a: { b: "${TEST_KEY}" } });
    expect(result).toEqual({ a: { b: "resolved_value" } });
  });

  it("resolves env vars in arrays", () => {
    const result = resolveEnvVars(["${TEST_KEY}", "static"]);
    expect(result).toEqual(["resolved_value", "static"]);
  });

  it("passes through non-string values", () => {
    expect(resolveEnvVars(42)).toBe(42);
    expect(resolveEnvVars(true)).toBe(true);
    expect(resolveEnvVars(null)).toBe(null);
  });

  it("throws on missing env var", () => {
    expect(() => resolveEnvVars("${MISSING_VAR}")).toThrow("MISSING_VAR is not set");
  });

  it("includes path in error for nested missing var", () => {
    expect(() => resolveEnvVars({ auth: { key: "${MISSING}" } })).toThrow("auth.key");
  });
});

describe("parseConfigString", () => {
  it("parses a valid YAML config string", () => {
    const yaml = `
feeds:
  hn:
    source:
      url: https://hacker-news.firebaseio.com/v0/topstories.json
      auth:
        type: none
    expose:
      type: tool
      name: get_hn
      description: "Get HN top stories"
`;
    const config = parseConfigString(yaml);
    expect(config.feeds.hn).toBeDefined();
    expect(config.feeds.hn.expose.name).toBe("get_hn");
  });

  it("throws on invalid config", () => {
    expect(() => parseConfigString("feeds: {}")).toThrow("Invalid config");
  });
});
