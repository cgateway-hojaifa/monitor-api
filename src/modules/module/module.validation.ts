import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the module-management routes. Mirrors the `ModulePayload` the service
 * accepts; the service adds slug-format / parent-cycle / dependency checks as a backstop.
 */

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const moduleBody = Joi.object({
  name: Joi.string().trim().max(100).required(),
  display_name: Joi.string().trim().max(150).required(),
  slug: Joi.string()
    .trim()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100)
    .required()
    .messages({ "string.pattern.base": "Slug must be kebab-case (lowercase, hyphens)." }),
  description: Joi.string().allow("", null).max(500).optional(),
  icon: Joi.string().allow("", null).max(64).optional(),
  route: Joi.string().allow("", null).max(255).optional(),
  menu_order: Joi.number().integer().optional(),
  parent_id: Joi.number().integer().positive().allow(null).optional(),
  status: Joi.string().valid("active", "inactive").optional(),
  visible: Joi.boolean().optional(),
  permissions: Joi.array().items(Joi.string()).optional(),
  config: Joi.object().optional(),
  feature_flags: Joi.object().pattern(Joi.string(), Joi.boolean()).optional(),
  dependencies: Joi.array().items(Joi.string()).optional(),
});

export const listModules: RequestSchema = {};
export const getNav: RequestSchema = {};
export const getModuleScopes: RequestSchema = {};
export const getModuleSchedules: RequestSchema = {};
export const getModule: RequestSchema = { params: idParam };
export const createModule: RequestSchema = { body: moduleBody };
export const updateModule: RequestSchema = { params: idParam, body: moduleBody };
export const deleteModule: RequestSchema = { params: idParam };
