import "reflect-metadata";
import { initDataSource, AppDataSource } from "@/config/data-source";
import { seedModules } from "@/modules/module/module.seed";
import logger from "@/config/logger";

/**
 * Standalone module-seed runner. Run manually via `npm run seed` — NOT part of the boot sequence
 * (index.ts never seeds). Idempotent: `seedModules()` skips when the `modules` table is non-empty,
 * so re-running is safe and never overwrites admin edits.
 */
(async () => {
  try {
    await initDataSource();
    await seedModules();
    await AppDataSource.destroy();
    logger.info("[Seed] Done.");
    process.exit(0);
  } catch (err) {
    logger.error("[Seed] Failed:", (err as Error)?.message);
    process.exit(1);
  }
})();
