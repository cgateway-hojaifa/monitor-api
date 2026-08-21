import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the Category routes.
 *
 * Matches the house style: enforce only the hard requirements here (name present, numeric id) and
 * leave normalization to the service — it trims, maps empty strings to null, and validates the
 * colour format. Service checks remain the backstop.
 */

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const categoryBody = Joi.object({
  name: Joi.string().trim().max(100).required(),
  description: Joi.string().trim().max(500).allow("", null).optional(),
  color: Joi.string().trim().allow("", null).optional(),
});

// ── Collection ──
export const listCategories: RequestSchema = {
  query: Joi.object({ q: Joi.string().allow("").optional() }),
};
export const createCategory: RequestSchema = { body: categoryBody };

// ── Item ──
export const getCategory: RequestSchema = { params: idParam };
export const updateCategory: RequestSchema = { params: idParam, body: categoryBody };
export const deleteCategory: RequestSchema = { params: idParam };
