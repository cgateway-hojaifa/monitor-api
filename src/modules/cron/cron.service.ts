import { AppDataSource } from "@/config/data-source";
import { CronLog } from "@/entities/CronLog";

/**
 * Cron-log read model. The cron *execution* logic (scheduler + run logger) lives in the
 * top-level `@/jobs/` folder; this module owns the read-only log listing the UI shows.
 */

const cronRepo = () => AppDataSource.getRepository(CronLog);

export interface CronLogQuery {
  module?: string;
  page?: unknown;
  perPage?: unknown;
}

/**
 * One page of cron logs, newest first, plus counts for the whole filtered set.
 *
 * The counts are deliberately not derived from the returned page: a "47 errors" card that really
 * meant "47 on this page" would contradict the table as soon as you paged. They're scoped to the
 * same filter as the rows, so cards and list always agree.
 */
export async function listCronLogs(query: CronLogQuery) {
  const page = Math.max(Number(query.page ?? "1"), 1);
  const perPage = Math.min(Math.max(Number(query.perPage ?? "20"), 1), 100);
  const where = query.module ? { module: query.module } : {};

  const [data, total] = await cronRepo().findAndCount({
    where,
    order: { started_at: "DESC" },
    take: perPage,
    skip: (page - 1) * perPage,
  });

  const [successCount, errorCount] = await Promise.all([
    cronRepo().count({ where: { ...where, status: "success" } }),
    cronRepo().count({ where: { ...where, status: "error" } }),
  ]);

  return { data, total, page, perPage, successCount, errorCount };
}

/**
 * Every module that has ever logged a run. Powers the filter buttons — sourced from the logs
 * themselves rather than the module registry, since a registered module that never runs on the
 * cron (ip-monitoring is manual-only) has no logs to filter to.
 */
export async function listCronLogModules(): Promise<string[]> {
  const rows = await cronRepo()
    .createQueryBuilder("log")
    .select("DISTINCT log.module", "module")
    .orderBy("log.module", "ASC")
    .getRawMany<{ module: string }>();
  return rows.map((r) => r.module);
}
