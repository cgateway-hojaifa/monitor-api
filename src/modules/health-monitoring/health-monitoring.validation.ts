import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the Health Monitoring routes.
 *
 * Kept deliberately permissive to match the service, which normalizes rather than rejects:
 * `method` defaults to GET when not one of the allowed verbs, `fail_threshold` defaults to 2
 * when not > 0, and request_headers/request_body are JSON-validated inside the service. So here
 * we only enforce the hard requirements (name + url present) and the numeric `id` param; the
 * service handles the rest. Service checks remain the backstop.
 */

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

// name + url required; everything else optional and left for the service to normalize.
const monitorBody = Joi.object({
  name: Joi.string().trim().required(),
  url: Joi.string().trim().required(),
  method: Joi.string().optional(),
  request_headers: Joi.string().allow("", null).optional(),
  request_body: Joi.string().allow("", null).optional(),
  fail_threshold: Joi.alternatives(Joi.number(), Joi.string()).optional(),
  active: Joi.boolean().optional(),
  // Optional category assignment; null/"" clears it. Existence is checked in the service.
  category_id: Joi.alternatives(Joi.number().integer().positive(), Joi.valid(null, "")).optional(),
});

const pageQuery = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  perPage: Joi.number().integer().min(1).optional(),
  q: Joi.string().allow("").optional(),
  // Filter: a category id, or the literal "none" for uncategorized monitors.
  category_id: Joi.alternatives(
    Joi.number().integer().positive(),
    Joi.string().valid("none", ""),
  ).optional(),
});

// ── Fixed sub-paths ──
export const status: RequestSchema = {};
export const checkAll: RequestSchema = {};

// ── Collection ──
export const listMonitors: RequestSchema = { query: pageQuery };
export const createMonitor: RequestSchema = { body: monitorBody };

// ── Item + nested actions ──
export const getMonitor: RequestSchema = { params: idParam };
export const updateMonitor: RequestSchema = { params: idParam, body: monitorBody };
export const deleteMonitor: RequestSchema = { params: idParam };
export const checkOne: RequestSchema = { params: idParam };
export const heartbeats: RequestSchema = {
  params: idParam,
  query: Joi.object({ limit: Joi.number().integer().min(1).optional() }),
};
export const clearHeartbeats: RequestSchema = { params: idParam };
export const events: RequestSchema = {
  params: idParam,
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    perPage: Joi.number().integer().min(1).optional(),
  }),
};
