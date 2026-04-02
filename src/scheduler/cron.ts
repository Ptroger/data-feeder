import cron from "node-cron";
import { parseTtl } from "../config/schema.js";
import { logger } from "../utils/logger.js";

interface ScheduledJob {
  task: cron.ScheduledTask | ReturnType<typeof setInterval>;
  type: "cron" | "interval";
}

export class Scheduler {
  private jobs = new Map<string, ScheduledJob>();

  scheduleCron(id: string, cronExpr: string, callback: () => Promise<void>): void {
    if (!cron.validate(cronExpr)) {
      throw new Error(`Invalid cron expression for ${id}: "${cronExpr}"`);
    }

    const task = cron.schedule(cronExpr, async () => {
      try {
        await callback();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Scheduled job ${id} failed: ${msg}`);
      }
    });

    this.jobs.set(id, { task, type: "cron" });
    logger.info(`Scheduled cron job: ${id} (${cronExpr})`);
  }

  scheduleInterval(id: string, every: string, callback: () => Promise<void>): void {
    const intervalMs = parseTtl(every);

    const timer = setInterval(async () => {
      try {
        await callback();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Scheduled job ${id} failed: ${msg}`);
      }
    }, intervalMs);

    timer.unref();
    this.jobs.set(id, { task: timer, type: "interval" });
    logger.info(`Scheduled interval job: ${id} (every ${every})`);
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.type === "cron") {
      (job.task as cron.ScheduledTask).stop();
    } else {
      clearInterval(job.task as ReturnType<typeof setInterval>);
    }
    this.jobs.delete(id);
  }

  cancelAll(): void {
    for (const id of this.jobs.keys()) {
      this.cancel(id);
    }
  }

  getJobIds(): string[] {
    return Array.from(this.jobs.keys());
  }
}
