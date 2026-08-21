import type { Request, Response, NextFunction } from "express";
import { AppDataSource } from "@/config/data-source";
import { Module } from "@/entities/Module";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

/**
 * Gate a feature module's API by its DB status. When the module's `modules` row is `inactive`,
 * all of its routes 404 — so a module disabled from Settings → Module Management goes dark with
 * no code change. A short in-memory cache avoids a DB round-trip on every request; edits through
 * the admin UI take effect within the TTL.
 */

const CACHE_TTL_MS = 10_000;
let cache: { at: number; active: Set<string> } | null = null;

async function activeSlugs(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.active;
  const rows = await AppDataSource.getRepository(Module).find({ where: { status: "active" } });
  cache = { at: now, active: new Set(rows.map((m) => m.slug)) };
  return cache.active;
}

/** Drop the cache so a status change is reflected immediately (called after module mutations). */
export function invalidateModuleCache(): void {
  cache = null;
}

/** Express guard: require the given module slug to be active, else 404. */
export function moduleGuard(slug: string) {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    const active = await activeSlugs();
    if (!active.has(slug)) return next(new ApiError(httpStatus.NOT_FOUND, "Not found"));
    next();
  };
}
