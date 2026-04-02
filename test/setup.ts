import { afterAll, afterEach, beforeAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("https://api.test.com/success", () => {
    return HttpResponse.json({ result: "ok" });
  }),

  http.get("https://api.test.com/nested", () => {
    return HttpResponse.json({ data: { results: [{ id: 1 }, { id: 2 }] } });
  }),

  http.get("https://api.test.com/server-error", () => {
    return new HttpResponse(null, { status: 500 });
  }),

  http.get("https://api.test.com/not-found", () => {
    return new HttpResponse("Not Found", { status: 404 });
  }),

  http.get("https://api.test.com/rate-limited", () => {
    return new HttpResponse(null, {
      status: 429,
      headers: { "Retry-After": "1" },
    });
  }),

  http.get("https://api.test.com/payment-required", () => {
    return HttpResponse.json(
      { accepts: [{ maxAmountRequired: "100000", payTo: "0x123", network: "base" }] },
      { status: 402 },
    );
  }),

  http.get("https://api.test.com/weather", ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json({
      lat: url.searchParams.get("lat"),
      lon: url.searchParams.get("lon"),
      temp: 22,
      conditions: "clear",
    });
  }),

  http.get("https://api.test.com/with-params", () => {
    return HttpResponse.json({ ok: true });
  }),
];

export const mockServer = setupServer(...handlers);

export function setupMockServer() {
  beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
  afterEach(() => mockServer.resetHandlers());
  afterAll(() => mockServer.close());
}
