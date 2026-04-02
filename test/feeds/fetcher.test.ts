import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { fetchWithRetry, FetchError } from "../../src/feeds/fetcher.js";
import { mockServer, setupMockServer } from "../setup.js";

setupMockServer();

const baseOptions = {
  method: "GET" as const,
  headers: {},
  timeout: 5_000,
  retries: 0,
  retryBackoff: "exponential" as const,
};

describe("fetchWithRetry", () => {
  it("fetches successfully", async () => {
    const result = await fetchWithRetry({ ...baseOptions, url: "https://api.test.com/success" });
    expect(result.data).toEqual({ result: "ok" });
    expect(result.status).toBe(200);
    expect(result.fromCache).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("applies response path extraction", async () => {
    const result = await fetchWithRetry({
      ...baseOptions,
      url: "https://api.test.com/nested",
      responsePath: "data.results",
    });
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("throws on 404 without retrying", async () => {
    await expect(
      fetchWithRetry({ ...baseOptions, url: "https://api.test.com/not-found" }),
    ).rejects.toThrow(FetchError);

    await expect(
      fetchWithRetry({ ...baseOptions, url: "https://api.test.com/not-found" }),
    ).rejects.toMatchObject({ status: 404, retryable: false });
  });

  it("retries on 500 and eventually throws", async () => {
    let attempts = 0;
    mockServer.use(
      http.get("https://api.test.com/flaky", () => {
        attempts++;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    await expect(
      fetchWithRetry({ ...baseOptions, url: "https://api.test.com/flaky", retries: 2 }),
    ).rejects.toThrow(FetchError);
    expect(attempts).toBe(3); // initial + 2 retries
  });

  it("retries on 500 then succeeds", async () => {
    let attempts = 0;
    mockServer.use(
      http.get("https://api.test.com/flaky-ok", () => {
        attempts++;
        if (attempts < 3) return new HttpResponse(null, { status: 500 });
        return HttpResponse.json({ recovered: true });
      }),
    );

    const result = await fetchWithRetry({
      ...baseOptions,
      url: "https://api.test.com/flaky-ok",
      retries: 3,
    });
    expect(result.data).toEqual({ recovered: true });
    expect(attempts).toBe(3);
  });

  it("returns 402 response without retrying", async () => {
    const result = await fetchWithRetry({
      ...baseOptions,
      url: "https://api.test.com/payment-required",
    });
    expect(result.status).toBe(402);
    expect(result.data).toHaveProperty("accepts");
  });
});
