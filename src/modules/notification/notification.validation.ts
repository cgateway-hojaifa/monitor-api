import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the notification routes. Mirrors the service's `validateBody`
 * (type/name/target required; type ∈ email|slack; status ∈ active|inactive; modules = array of
 * module keys). Service checks remain as a backstop.
 *
 * Module scopes are checked for *shape* here (slug-like or "global") but not against a fixed list:
 * modules are DB rows added without code changes, and a list here would go stale — it did, which
 * is why `ip-monitoring` was rejected before the service ever saw it. The service validates the
 * values against the live `modules` table.
 */

/** `global` or a kebab-case module slug — matches the slug rule in module.validation.ts. */
const moduleScope = Joi.string()
  .trim()
  .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100)
  .messages({ "string.pattern.base": "Module scope must be a module slug or \"global\"." });

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const notificationBody = Joi.object({
  type: Joi.string().valid("email", "slack").required(),
  name: Joi.string().trim().required(),
  target: Joi.string().trim().required(),
  status: Joi.string().valid("active", "inactive").optional(),
  modules: Joi.array().items(moduleScope).optional(),
  // legacy single-module field still tolerated by the store
  module: moduleScope.allow(null).optional(),
});

export const listNotifications: RequestSchema = {
  query: Joi.object({ module: Joi.string().optional() }),
};
export const createNotification: RequestSchema = { body: notificationBody };
export const getNotification: RequestSchema = { params: idParam };
export const updateNotification: RequestSchema = { params: idParam, body: notificationBody };
export const deleteNotification: RequestSchema = { params: idParam };
