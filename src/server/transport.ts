import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DataFeederConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

export async function startTransport(
  server: McpServer,
  config: DataFeederConfig,
  httpPortOverride?: number,
): Promise<void> {
  const transport = config.server.transport;
  const port = httpPortOverride ?? config.server.port;

  if (transport === "http" || httpPortOverride) {
    await startHttpTransport(server, port);
  } else {
    await startStdioTransport(server);
  }
}

async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server started on stdio");
}

async function startHttpTransport(server: McpServer, port: number): Promise<void> {
  // Use StreamableHTTP transport
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  // Create a basic HTTP server
  const http = await import("node:http");
  const httpServer = http.createServer(async (req, res) => {
    // Handle MCP endpoint
    if (req.url === "/mcp") {
      await transport.handleRequest(req, res);
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await server.connect(transport);

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      logger.info(`MCP server started on http://localhost:${port}/mcp`);
      resolve();
    });
  });
}
