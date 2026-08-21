import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the IP Monitoring routes.
 *
 * House style: enforce only the hard requirements here (name/ip/port present, numeric id) and let
 * the service normalize — it owns the IP/hostname format check, the port range, and the timeout
 * bounds, so the error messages stay in one place. Service checks remain the backstop.
 */

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const monitorBody = Joi.object({
  name: Joi.string().trim().max(150).required(),
  ip_address: Joi.string().trim().required(),
  port: Joi.alternatives(Joi.number(), Joi.string()).required(),
  timeout_ms: Joi.alternatives(Joi.number(), Joi.string().allow("")).optional(),
  fail_threshold: Joi.alternatives(Joi.number(), Joi.string()).optional(),
  active: Joi.boolean().optional(),
  category_id: Joi.alternatives(Joi.number().integer().positive(), Joi.valid(null, "")).optional(),
});

const pageQuery = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  perPage: Joi.number().integer().min(1).optional(),
  q: Joi.string().allow("").optional(),
  category_id: Joi.alternatives(
    Joi.number().integer().positive(),
    Joi.string().valid("none", ""),
  ).optional(),
});

// ── Fixed sub-paths ──
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
