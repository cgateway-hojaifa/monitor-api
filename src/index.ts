import "reflect-metadata";
import app from "@/app";
import config from "@/config/config";
import logger from "@/config/logger";
import { initDataSource, AppDataSource } from "@/config/data-source";
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

/**
 * Graceful stop on SIGTERM (ts-node-dev restart, `pm2 restart`) and SIGINT (Ctrl+C).
 *
 * Installing a SIGTERM listener disables Node's default exit, so this must end the process itself:
 * the scheduler's interval, the DB pool and keep-alive sockets would otherwise keep it running —
 * which left ts-node-dev waiting forever for the old process and nothing listening on the port.
 */
const SHUTDOWN_TIMEOUT_MS = 5_000;
let shuttingDown = false;

const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down`);

  // Never hang: force the exit if a socket or query refuses to finish.
  setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();

  const finish = () =>
    AppDataSource.destroy()
      .catch(() => {})
      .finally(() => process.exit(0));

  if (!server) return void finish();
  server.close(() => void finish());
  // Idle keep-alive connections (e.g. a browser polling) would otherwise hold `close` open.
  server.closeIdleConnections();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
