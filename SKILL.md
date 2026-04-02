# data-feeder

Declarative data feeds for AI agents. YAML config → cached, scheduled access to any REST API.

## When to use this skill

TRIGGER when:
- User needs external data from a REST API (weather, stocks, news, exchange rates, any public API)
- User asks to "wire up", "connect", "fetch from", or "add a data source" for an agent
- User mentions "data feed", "API cache", "scheduled fetch", "data freshness", or "prefetch"
- User wants to set up an MCP server that serves external data
- User is building an agent that needs access to multiple external APIs
- A task requires fresh data from the internet (prices, weather, news, etc.)
- User asks about caching API responses or reducing API call costs

DO NOT TRIGGER when:
- User needs to connect to databases or internal systems
- User needs custom business logic beyond fetch-and-cache
- User is making a one-off API call with no caching needs

## Installation

### As an MCP server (for any MCP client)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "data-feeder": {
      "command": "npx",
      "args": ["data-feeder", "serve"],
      "cwd": "/path/to/project"
    }
  }
}
```

For Claude Code (`~/.claude/settings.json` or project `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "data-feeder": {
      "command": "npx",
      "args": ["data-feeder", "serve", "--config", "/path/to/data-feeder.yaml"]
    }
  }
}
```

### As a CLI tool

```bash
npm install -g data-feeder
# or use directly with npx
npx data-feeder <command>
```

### Setup workflow

```bash
# 1. Initialize config in your project
npx data-feeder init

# 2. Edit data-feeder.yaml — add your data sources
# 3. Add API keys to .env

# 4. Validate your config
npx data-feeder validate

# 5. Start serving (as MCP server or query directly)
npx data-feeder serve          # MCP server on stdio
npx data-feeder serve --http 3100  # MCP server on HTTP
npx data-feeder query weather --lat 48.85 --lon 2.35  # Direct query
```

## How it works

data-feeder reads a `data-feeder.yaml` config file that declares external data sources. For each source, it handles:

- **HTTP fetching** with retries, timeouts, and error handling
- **Authentication** — API key (header or query param), Bearer token, x402 payment protocol
- **Caching** — in-memory with per-source TTL, cache hit/miss tracking
- **Scheduled prefetch** — cron expressions or simple intervals to keep data warm
- **Budget enforcement** — daily limits and per-call caps for paid APIs

Each feed is exposed as an MCP tool (callable with parameters) or resource (readable latest data).

## CLI commands

| Command | Description |
|---------|-------------|
| `data-feeder init` | Create starter `data-feeder.yaml` and `.env.example` |
| `data-feeder serve` | Start MCP server (stdio by default, `--http <port>` for HTTP) |
| `data-feeder validate` | Validate config and check env vars |
| `data-feeder list` | List all configured feeds |
| `data-feeder discover` | Show full feed catalog as JSON |
| `data-feeder query <feed> [--param val]` | Query a feed directly from CLI |

## Config format

```yaml
feeds:
  <feed_name>:
    source:
      url: https://api.example.com/data
      method: GET                    # GET or POST
      auth:
        type: api_key               # none | api_key | bearer | x402
        param: apikey                # query param name
        key: ${API_KEY}              # supports ${ENV_VAR} syntax
      default_params:                # always included
        units: metric
      params:                        # filled by tool invocation
        lat: "{{lat}}"
      response:
        path: data.results           # dot-notation extraction
    cache:
      ttl: 5m                        # 30s, 5m, 1h, 24h, 7d
    expose:
      type: tool                     # tool (callable) or resource (readable)
      name: get_data
      description: "Description for the agent"
      params:
        lat:
          type: number
          description: "Latitude"
          required: true
```

## Available templates

Pre-built configs for common APIs — use `data-feeder discover` or the `data_feeder_templates` MCP tool to list them:

- **openweather** — OpenWeather One Call API (weather + forecast)
- **alpha-vantage** — Stock quotes, forex, crypto
- **exchangerate** — Currency exchange rates
- **hackernews** — HN top stories (free, no auth)
- **generic-rest** — Template for any REST API with Bearer auth

## Agent interaction pattern

When connected as an MCP server, agents should:

1. Call `data_feeder_discover` first to see all available feeds and their parameters
2. Call specific feed tools (e.g., `get_weather`, `get_stock_quote`) with required params
3. Check `_meta.fromCache` and `_meta.age` in responses to assess data freshness
4. Call `data_feeder_status` for operational metrics (cache hit rates, error counts)
5. Call `data_feeder_templates` to suggest new data sources to the developer

## Response format

Every feed response includes metadata:

```json
{
  "data": { "..." : "..." },
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

## Adding a new data source

To wire up a new API:

1. Check `data-feeder templates` for a pre-built config
2. If no template exists, add a new entry to `data-feeder.yaml` under `feeds:`
3. Set auth (API key, bearer, or none)
4. Define params that the agent will pass
5. Set cache TTL based on how fresh the data needs to be
6. Add env vars to `.env`
7. Run `data-feeder validate` to check
8. Restart the server (or let hot-reload pick it up)
