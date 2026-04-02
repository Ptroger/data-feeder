import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DataFeeder } from "../core.js";
import { logger } from "../utils/logger.js";

/**
 * Thin MCP layer. Maps MCP tools/resources/prompts → DataFeeder core methods.
 * Zero business logic here.
 */
export function createMcpServer(engine: DataFeeder): McpServer {
  const config = engine.feedConfig;

  const server = new McpServer({
    name: config.server.name,
    version: config.server.version,
  });

  registerFeedTools(server, engine);
  registerFeedResources(server, engine);
  registerDiscoverabilityTools(server, engine);
  registerPrompts(server, engine);

  return server;
}

// --- Feed tools ---

function registerFeedTools(server: McpServer, engine: DataFeeder): void {
  for (const feed of engine.getManager().getAllFeeds()) {
    if (feed.config.expose.type !== "tool") continue;

    const paramsShape = feed.getParamsShape();
    const feedName = feed.name;
    const hasParams = Object.keys(paramsShape).length > 0;

    logger.debug(`Registering tool: ${feed.config.expose.name}`);

    const handler = async (params: Record<string, unknown>) => {
      try {
        const result = await engine.query(feedName, params);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    };

    if (hasParams) {
      server.registerTool(
        feed.config.expose.name,
        { description: feed.config.expose.description, inputSchema: paramsShape },
        async (args, _extra) => handler(args as Record<string, unknown>),
      );
    } else {
      server.registerTool(
        feed.config.expose.name,
        { description: feed.config.expose.description },
        async (_extra) => handler({}),
      );
    }
  }
}

// --- Feed resources ---

function registerFeedResources(server: McpServer, engine: DataFeeder): void {
  for (const feed of engine.getManager().getAllFeeds()) {
    if (feed.config.expose.type !== "resource") continue;

    const feedName = feed.name;
    logger.debug(`Registering resource: ${feed.config.expose.name}`);

    server.registerResource(
      feed.config.expose.name,
      `data-feeder://${feedName}`,
      { description: feed.config.expose.description },
      async (uri) => {
        try {
          const result = await engine.query(feedName, {});
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ error: message }) }],
          };
        }
      },
    );
  }
}

// --- Discoverability tools (delegate to core) ---

function registerDiscoverabilityTools(server: McpServer, engine: DataFeeder): void {
  server.registerTool(
    "data_feeder_discover",
    {
      description:
        "Discover all available data feeds. Returns a catalog with names, descriptions, parameters, cache TTL, auth type, and usage examples. Call this first.",
    },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(engine.discover(), null, 2) }],
    }),
  );

  server.registerTool(
    "data_feeder_status",
    {
      description:
        "Get live operational status: cache hit rates, schedule status, error counts, budget usage. Use for monitoring, not discovery.",
    },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(engine.status(), null, 2) }],
    }),
  );

  server.registerTool(
    "data_feeder_templates",
    {
      description:
        "List pre-built feed templates for common APIs (weather, stocks, news). YAML snippets ready to copy into data-feeder.yaml.",
    },
    async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          templates: DataFeeder.templates(),
          hint: "Copy a template's YAML content into the 'feeds:' section of data-feeder.yaml and set the required environment variables.",
        }, null, 2),
      }],
    }),
  );
}

// --- Prompt ---

function registerPrompts(server: McpServer, engine: DataFeeder): void {
  server.registerPrompt("data_feeder_guide", {
    title: "Data Feeder Guide",
    description:
      "Comprehensive guide to this data-feeder server. Use when you first connect or need to understand what external data is available.",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: engine.guide() },
    }],
  }));
}
