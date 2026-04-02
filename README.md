# data-feeder

Declarative data feeds for AI agents. Config file in, MCP server out.

Every agent needs external data. Every developer writes the same fetch/cache/schedule boilerplate for each API. data-feeder replaces that with a YAML config — declare your sources, get a running MCP server with caching, scheduling, and auth.

## Quickstart

```bash
npx data-feeder init          # creates data-feeder.yaml
# edit data-feeder.yaml
npx data-feeder serve          # starts MCP server on stdio
```

## Example

One feed config:

```yaml
feeds:
  hn_top_stories:
    source:
      url: https://hacker-news.firebaseio.com/v0/topstories.json
      auth:
        type: none
    cache:
      ttl: 5m
    expose:
      type: tool
      name: get_hn_top_stories
      description: "Get the top story IDs from Hacker News"
```

What the agent sees: a tool called `get_hn_top_stories` that returns cached HN data, automatically refreshed every 5 minutes.

## Features

- **YAML config** — declare data sources, no code required
- **Caching** — per-source TTL, in-memory, with hit rate stats
- **Scheduled prefetch** — cron expressions or simple intervals
- **Auth** — API key (header or query param), Bearer token, x402 payment protocol
- **MCP tools & resources** — auto-generated from config
- **Hot reload** — edit config while running, feeds update without restart
- **Budget enforcement** — daily limits and per-call caps for paid APIs
- **Retries** — exponential/linear backoff, respects Retry-After
- **Response extraction** — dot-notation path to pull nested data

## CLI

```bash
npx data-feeder init                     # scaffold config + .env.example
npx data-feeder serve                    # start MCP server (stdio)
npx data-feeder serve --http 3100        # start on HTTP port
npx data-feeder validate                 # check config for errors
npx data-feeder validate --config ./alt.yaml
npx data-feeder list                     # list all configured feeds
```

## Full Config Reference

```yaml
# data-feeder.yaml

server:
  name: my-data-feeds              # MCP server name (default: "data-feeder")
  version: 1.0.0                   # server version (default: "1.0.0")
  transport: stdio                 # "stdio" or "http" (default: "stdio")
  port: 3100                       # HTTP port (default: 3100)

defaults:
  cache: 5m                        # default cache TTL
  timeout: 10s                     # default HTTP timeout
  retries: 3                       # default retry count
  retry_backoff: exponential       # "exponential" or "linear"

budget:                            # optional
  daily_max: 10.00                 # max daily spend in USD
  alert_threshold: 0.8             # warn at 80% of budget

feeds:
  <feed_name>:
    source:
      url: https://...             # base URL (required)
      method: GET                  # GET or POST (default: GET)
      auth:
        type: api_key              # none | api_key | bearer | x402
        param: apikey              # query param name (api_key only)
        # header: X-API-Key       # OR header name (mutually exclusive with param)
        key: ${API_KEY}            # value, supports ${ENV_VAR}
      headers:                     # additional headers (optional)
        X-Custom: value
      default_params:              # always included (optional)
        units: metric
      params:                      # filled by tool invocation (optional)
        lat: "{{lat}}"
        lon: "{{lon}}"
      response:                    # response extraction (optional)
        path: data.results         # dot-notation path

    cache:
      ttl: 5m                      # 30s, 5m, 1h, 24h, 7d
      key: "{{lat}}:{{lon}}"       # custom cache key (optional)

    schedule:                      # scheduled prefetch (optional)
      - params:
          lat: 48.85
          lon: 2.35
        every: 10m                 # simple interval
      - params:
          symbol: EUR/USD
        cron: "*/1 9-17 * * 1-5"  # cron expression

    expose:
      type: tool                   # "tool" or "resource"
      name: get_weather
      description: "Get weather for a location"
      params:                      # tool input schema (tool type only)
        lat:
          type: number
          description: "Latitude"
          required: true

    timeout: 15s                   # per-feed override
    retries: 5                     # per-feed override
```

### Auth types

**API Key** — added as query parameter or header:
```yaml
auth:
  type: api_key
  param: apikey        # as query param
  key: ${MY_KEY}
```
```yaml
auth:
  type: api_key
  header: X-API-Key    # as header
  key: ${MY_KEY}
```

**Bearer** — Authorization header:
```yaml
auth:
  type: bearer
  token: ${MY_TOKEN}
```

**x402** — automatic payment on 402 responses (requires `viem` peer dependency):
```yaml
auth:
  type: x402
  wallet_key: ${WALLET_KEY}
  network: base           # base or base-sepolia
  max_per_call: 0.01      # max USD per request
```

### Environment variables

Use `${VAR_NAME}` syntax in any string value. Variables are resolved from your environment or a `.env` file in the config directory.

### Expose types

- **tool** — callable by the agent with parameters, returns fresh or cached data
- **resource** — readable endpoint, returns the most recent cached data (ideal with scheduled prefetch)

## Templates

Pre-built configs in `templates/`:

| Template | API | Auth |
|----------|-----|------|
| `openweather.yaml` | OpenWeather One Call | API key |
| `alpha-vantage.yaml` | Alpha Vantage stocks | API key |
| `exchangerate.yaml` | ExchangeRate.host | API key |
| `hackernews.yaml` | Hacker News | None |
| `generic-rest.yaml` | Any REST API | Bearer |

Copy a template into your `feeds:` section and set your env vars.

## Built-in utility tools

Every data-feeder server includes:

- `data_feeder_status` — status of all feeds (stats, schedule info, cache metrics)
- `data_feeder_cache_stats` — cache hit rates, entry counts, cost savings

## Tool response format

Every tool response includes metadata:

```json
{
  "data": { "...": "..." },
  "_meta": {
    "feed": "weather",
    "fromCache": true,
    "fetchedAt": "2024-01-15T10:30:00Z",
    "age": "2m 30s",
    "latencyMs": 0,
    "source": "https://api.openweathermap.org/...",
    "cost": 0
  }
}
```

## How it works

data-feeder reads your YAML config, creates a Feed instance per source (wiring together an auth handler, HTTP fetcher with retry logic, and an in-memory TTL cache), registers each as an MCP tool or resource, and starts the server on stdio or HTTP. Scheduled prefetch jobs run in the background via cron. Config file changes are detected and hot-reloaded without restart.

## License

MIT
