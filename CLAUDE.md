# data-feeder

Declarative data feeds for AI agents. YAML config → MCP server with caching, scheduling, and auth.

## Architecture

```
src/core.ts           ← ALL logic lives here (DataFeeder class)
src/cli.ts            ← Thin: argv → core → formatted output
src/server/mcp.ts     ← Thin: MCP tools/resources/prompts → core
src/server/transport.ts ← stdio + HTTP transport
```

The core owns: config loading, feed management, query, discover, status, templates, guide text, init scaffolding, validate. MCP and CLI are thin wrappers.

### Key modules

- `config/schema.ts` — Zod schema for data-feeder.yaml. Everything depends on this.
- `config/loader.ts` — YAML parsing + `${ENV_VAR}` resolution + Zod validation
- `feeds/feed.ts` — Single feed orchestrator (auth + fetch + cache)
- `feeds/fetcher.ts` — HTTP fetch with retries, backoff, timeout (native fetch)
- `feeds/manager.ts` — Holds all Feed instances + shared cache + scheduler
- `cache/memory.ts` — In-memory TTL cache with hit/miss stats
- `auth/` — Strategy pattern: none, api-key, bearer, x402
- `scheduler/cron.ts` — node-cron wrapper for prefetch jobs

## Conventions

- **ESM only** — `"type": "module"`, all imports use `.js` extensions
- **All logging to stderr** — stdout is reserved for MCP stdio transport. Use `logger.info/warn/error/debug`.
- **Zero `console.log()`** — will corrupt MCP protocol
- **Tests**: vitest + msw. Mock HTTP in `test/setup.ts`. Integration tests use `InMemoryTransport.createLinkedPair()`.
- **MCP SDK**: Use `registerTool`/`registerResource`/`registerPrompt` (not deprecated `tool()`/`resource()`/`prompt()`)
- **Zero-arg tools**: callback signature is `(extra) => ...`, NOT `(args, extra) => ...`. Don't pass extra as params.

## Build & test

```bash
npm run build          # tsc
npm test               # vitest run (69 tests)
npm run dev            # tsc --watch
```

## CLI commands

```bash
npx data-feeder init
npx data-feeder serve [--config path] [--http port]
npx data-feeder validate [--config path]
npx data-feeder list [--config path]
npx data-feeder discover [--config path]
npx data-feeder query <feed> [--param val ...]
```

## x402 auth

viem is an optional peer dep. The x402 handler lazy-imports it at runtime — importing `auth/x402.ts` doesn't trigger viem loading. Only `handle402()` does. If viem isn't installed, it throws a clear error.

## Templates

In `templates/`. Path resolution in `core.ts` handles both `src/` (dev) and `dist/` (installed) by trying `../templates` then `../../templates`.
