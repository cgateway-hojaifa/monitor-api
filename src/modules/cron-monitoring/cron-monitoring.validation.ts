import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the Cron Monitoring routes.
 *
 * House style: enforce hard requirements here (name/expected present, numeric id) and let the
 * service normalize the rest. The ingest body is loose on purpose — `start_time`/`end_time` are
 * optional and `data` is opaque JSON — so its checks live in the service.
 */

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const monitorBody = Joi.object({
  name: Joi.string().trim().max(150).required(),
  expected_per_day: Joi.alternatives(Joi.number(), Joi.string()).required(),
  active: Joi.boolean().optional(),
});

const updateBody = Joi.object({
  name: Joi.string().trim().max(150).optional(),
  expected_per_day: Joi.alternatives(Joi.number(), Joi.string()).optional(),
  active: Joi.boolean().optional(),
});

const pageQuery = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  perPage: Joi.number().integer().min(1).optional(),
  q: Joi.string().allow("").optional(),
});

const limitQuery = Joi.object({ limit: Joi.number().integer().min(1).optional() });

// Ingest: key travels in the X-Cron-Key header (not validated here). One POST per completed run,
// after it finishes, carrying BOTH `start_time` and `end_time` (required) plus optional `data`.
// Times are accepted as ISO strings or epoch millis; the service parses + range-checks them.
const ingestBody = Joi.object({
  start_time: Joi.alternatives(Joi.date().iso(), Joi.number()).required(),
  end_time: Joi.alternatives(Joi.date().iso(), Joi.number()).required(),
  data: Joi.any().optional(),
}).unknown(true);

// ── Ingest ──
export const ingest: RequestSchema = { body: ingestBody };

// ── Collection ──
export const listMonitors: RequestSchema = { query: pageQuery };
export const createMonitor: RequestSchema = { body: monitorBody };

// ── Item + nested actions ──
export const getMonitor: RequestSchema = { params: idParam };
export const updateMonitor: RequestSchema = { params: idParam, body: updateBody };
export const deleteMonitor: RequestSchema = { params: idParam };
export const regenerateKey: RequestSchema = { params: idParam };
export const runs: RequestSchema = { params: idParam, query: limitQuery };
export const dailyResults: RequestSchema = { params: idParam, query: limitQuery };
