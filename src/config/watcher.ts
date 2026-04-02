import { watch } from "chokidar";
import { loadConfig } from "./loader.js";
import type { DataFeederConfig } from "./schema.js";
import { logger } from "../utils/logger.js";

export function watchConfig(
  configPath: string,
  onChange: (newConfig: DataFeederConfig) => void,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(configPath, {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on("change", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      logger.info("Config file changed, reloading...");
      try {
        const newConfig = loadConfig(configPath);
        onChange(newConfig);
        logger.info("Config reloaded successfully");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Config reload failed, keeping current config: ${msg}`);
      }
    }, 300);
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}
