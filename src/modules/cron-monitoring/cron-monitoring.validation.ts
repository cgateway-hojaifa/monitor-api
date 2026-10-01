import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the Cron Monitoring routes.
 *
 * Monitor `name` / `expected_per_day` are checked and normalized here only — the normalizers run as
 * Joi rules and their output replaces the body value, so the service receives a trimmed name and an
 * integer count and does not re-check them. The ingest body is loose on purpose — `data` is opaque
 * JSON — so its range checks live in the service.
 */

// ── Normalizers ────────────────────────────────────────────────────────────────

function normalizeName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error("Name is required.");
  if (value.length > 150) throw new Error("Name must be 150 characters or fewer.");
  return value;
}

function normalizeExpected(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error("Expected runs per day must be a positive integer.");
  return n;
}

/**
 * Run a normalizer as a Joi rule: its return value replaces the input, a thrown message becomes the
 * validation error. Joi skips custom rules for `undefined`, so absence is handled by `.required()`.
 */
const normalized = (fn: (raw: unknown) => unknown) =>
  Joi.any().custom((value, helpers) => {
    try {
      return fn(value);
    } catch (err) {
      return helpers.message({ custom: (err as Error).message });
    }
  });

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const monitorBody = Joi.object({
  name: normalized(normalizeName).required().messages({ "any.required": "Name is required." }),
  expected_per_day: normalized(normalizeExpected)
    .required()
    .messages({ "any.required": "Expected runs per day is required." }),
  active: Joi.boolean().optional(),
});

const updateBody = Joi.object({
  name: normalized(normalizeName).optional(),
  expected_per_day: normalized(normalizeExpected).optional(),
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
