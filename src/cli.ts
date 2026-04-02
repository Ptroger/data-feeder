import { DataFeeder } from "./core.js";
import { watchConfig } from "./config/watcher.js";
import { createMcpServer } from "./server/mcp.js";
import { startTransport } from "./server/transport.js";
import { logger } from "./utils/logger.js";

interface ParsedArgs {
  command: string;
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "serve";
  const flags: Record<string, string> = {};
  const startIdx = command === argv[0] ? 1 : 0;
  for (let i = startIdx; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

export async function run(argv: string[]): Promise<void> {
  const { command, flags } = parseArgs(argv);

  try {
    switch (command) {
      case "init":
        return cmdInit();
      case "serve":
        return cmdServe(flags);
      case "validate":
        return cmdValidate(flags);
      case "list":
        return cmdList(flags);
      case "discover":
        return cmdDiscover(flags);
      case "query":
        return cmdQuery(flags, argv);
      case "add":
        return cmdAdd(flags, argv);
      case "help":
      case "--help":
      case "-h":
        return cmdHelp();
      default:
        logger.error(`Unknown command: ${command}`);
        cmdHelp();
        process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exit(1);
  }
}

function cmdInit(): void {
  const { configPath, envExamplePath } = DataFeeder.init();
  logger.info(`Created ${configPath}`);
  logger.info(`Created ${envExamplePath}`);
  logger.info("Next steps:");
  logger.info("  1. Edit data-feeder.yaml to configure your feeds");
  logger.info("  2. Copy .env.example to .env and add your API keys");
  logger.info("  3. Run: npx data-feeder serve");
}

async function cmdServe(flags: Record<string, string>): Promise<void> {
  const configPath = flags.config ?? DataFeeder.findConfigFile();
  const httpPort = flags.http ? parseInt(flags.http, 10) : undefined;

  const config = DataFeeder.loadConfig(configPath);
  const engine = new DataFeeder(config, configPath);
  engine.startSchedules();

  const server = createMcpServer(engine);
  await startTransport(server, config, httpPort);

  const stopWatching = watchConfig(configPath, (newConfig) => {
    engine.reload(newConfig);
    server.sendToolListChanged();
    server.sendResourceListChanged();
  });

  const shutdown = async () => {
    logger.info("Shutting down...");
    stopWatching();
    engine.destroy();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function cmdValidate(flags: Record<string, string>): void {
  const result = DataFeeder.validate(flags.config);
  logger.info(`Config is valid. ${result.feed_count} feed(s) configured.`);
  for (const feed of result.feeds) {
    logger.info(`  ${feed.name}: ${feed.type} "${feed.expose_name}" → ${feed.url}`);
  }
}

function cmdList(flags: Record<string, string>): void {
  const config = DataFeeder.loadConfig(flags.config);
  const engine = new DataFeeder(config);
  const feeds = engine.list();

  const header = `${"NAME".padEnd(20)} ${"TYPE".padEnd(10)} ${"EXPOSE".padEnd(25)} ${"CACHE".padEnd(8)} ${"URL"}`;
  console.error(header);
  console.error("-".repeat(header.length + 20));
  for (const feed of feeds) {
    console.error(
      `${feed.name.padEnd(20)} ${feed.type.padEnd(10)} ${feed.expose_name.padEnd(25)} ${feed.cache_ttl.padEnd(8)} ${feed.url}`,
    );
  }

  engine.destroy();
}

function cmdDiscover(flags: Record<string, string>): void {
  const config = DataFeeder.loadConfig(flags.config);
  const engine = new DataFeeder(config);
  const result = engine.discover();
  console.error(JSON.stringify(result, null, 2));
  engine.destroy();
}

async function cmdQuery(flags: Record<string, string>, argv: string[]): Promise<void> {
  // data-feeder query <feed_name> [--param value ...]
  const feedName = argv[1];
  if (!feedName || feedName.startsWith("--")) {
    logger.error("Usage: data-feeder query <feed_name> [--param value ...]");
    process.exit(1);
  }

  const config = DataFeeder.loadConfig(flags.config);
  const engine = new DataFeeder(config);

  // Collect params from remaining flags (skip 'config')
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (key === "config") continue;
    // Try to parse numbers
    const num = Number(value);
    params[key] = isNaN(num) ? value : num;
  }

  try {
    const result = await engine.query(feedName, params);
    // Output to stdout (not stderr) so it can be piped
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    engine.destroy();
  }
}

function cmdAdd(flags: Record<string, string>, argv: string[]): void {
  const templateName = argv[1];
  if (!templateName || templateName.startsWith("--")) {
    // List available templates
    const templates = DataFeeder.templates();
    if (templates.length === 0) {
      logger.error("No templates available");
      process.exit(1);
    }
    logger.info("Available templates:");
    for (const t of templates) {
      logger.info(`  ${t.name}`);
    }
    logger.info("\nUsage: data-feeder add <template_name>");
    return;
  }

  const { feedName, configPath } = DataFeeder.addFeed(templateName, flags.config);
  logger.info(`Added feed "${feedName}" from template "${templateName}" to ${configPath}`);
  logger.info("Don't forget to set the required environment variables in .env");
}

function cmdHelp(): void {
  console.error(`
data-feeder — Declarative data feeds for AI agents

Usage:
  data-feeder init                             Create starter config
  data-feeder serve [options]                  Start MCP server
  data-feeder validate [options]               Validate config
  data-feeder list [options]                   List configured feeds
  data-feeder discover [options]               Show feed catalog (JSON)
  data-feeder query <feed> [--param val ...]   Query a feed directly
  data-feeder add <template>                   Add a feed from a template

Options:
  --config <path>    Path to config file (default: ./data-feeder.yaml)
  --http <port>      Start HTTP transport on given port

Templates:
  openweather, alpha-vantage, exchangerate, hackernews, generic-rest

Examples:
  npx data-feeder init
  npx data-feeder serve
  npx data-feeder add openweather
  npx data-feeder query weather --lat 48.85 --lon 2.35
`);
}
