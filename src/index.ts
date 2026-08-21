import "reflect-metadata";
import app from "@/app";
import config from "@/config/config";
import logger from "@/config/logger";
import { initDataSource } from "@/config/data-source";
import { backfillNotificationModules } from "@/notifications/store";
// Seeding disabled — the DB is the source of truth for modules; boot must never write to the table.
// import { seedModules } from "@/modules/module/module.seed";
import { initAll } from "@/shared/registry";
import { startScheduler } from "@/jobs/scheduler";

let server: ReturnType<typeof app.listen> | undefined;

/**
 * Boot sequence (template's index.js shape, extended for this app):
 *   initDataSource()            — TypeORM connect + synchronize (schema owned by entities)
 *   backfillNotificationModules — one-time legacy `module` → `modules[]` migration
 *   seedModules()               — DISABLED: existing module rows are preserved as-is across boots
 *   initAll()                   — module IoC wiring, gated by DB module status
 *   startScheduler()            — in-process scheduler (tasks gated by DB module status)
 *   app.listen()
 */
(async () => {
  try {
    await initDataSource();
    await backfillNotificationModules();
    // await seedModules();
    await initAll();
    await startScheduler();

    server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });
  } catch (err) {
    logger.error("Server startup failed:", (err as Error)?.message);
    process.exit(1);
  }
})();

const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info("Server closed");
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

process.on("uncaughtException", exitHandler);
process.on("unhandledRejection", exitHandler);

process.on("SIGTERM", () => {
  logger.info("SIGTERM received");
  if (server) server.close();
});
