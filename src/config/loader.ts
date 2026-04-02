import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { config as loadDotenv } from "dotenv";
import { DataFeederConfigSchema, type DataFeederConfig } from "./schema.js";
import { logger } from "../utils/logger.js";

const ENV_VAR_REGEX = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function resolveEnvVars(obj: unknown, path: string = ""): unknown {
  if (typeof obj === "string") {
    return obj.replace(ENV_VAR_REGEX, (_match, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(
          `Environment variable ${varName} is not set (referenced at ${path || "root"}). Add it to .env or your environment.`
        );
      }
      return value;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map((item, i) => resolveEnvVars(item, `${path}[${i}]`));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvVars(value, path ? `${path}.${key}` : key);
    }
    return result;
  }
  return obj;
}

export function findConfigFile(startDir?: string): string {
  const dir = startDir ?? process.cwd();
  const candidates = [
    resolve(dir, "data-feeder.yaml"),
    resolve(dir, "data-feeder.yml"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No data-feeder.yaml found in ${dir}. Run 'data-feeder init' to create one.`
  );
}

export function loadConfig(configPath?: string): DataFeederConfig {
  const resolvedPath = configPath ?? findConfigFile();

  // Load .env from the same directory as the config file
  const configDir = dirname(resolvedPath);
  loadDotenv({ path: resolve(configDir, ".env") });

  logger.debug(`Loading config from ${resolvedPath}`);

  const raw = readFileSync(resolvedPath, "utf-8");
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config file is empty or not a valid YAML object");
  }

  // Resolve environment variables before validation
  const resolved = resolveEnvVars(parsed);

  // Validate with Zod
  const result = DataFeederConfigSchema.safeParse(resolved);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid config:\n${errors}`);
  }

  logger.info(`Loaded ${Object.keys(result.data.feeds).length} feed(s) from ${resolvedPath}`);
  return result.data;
}

export function parseConfigString(yamlString: string): DataFeederConfig {
  const parsed = parseYaml(yamlString);
  const resolved = resolveEnvVars(parsed);
  const result = DataFeederConfigSchema.safeParse(resolved);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid config:\n${errors}`);
  }
  return result.data;
}
