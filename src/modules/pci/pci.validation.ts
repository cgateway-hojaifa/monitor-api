import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the PCI routes. Schemas mirror exactly what each handler/service reads
 * today, so nothing currently accepted gets rejected. `id` params are coerced to positive
 * integers (guards the old unguarded `Number(req.params.id)` → NaN path). Service-layer checks
 * remain as a backstop.
 */

const idParam = Joi.object({
  id: Joi.number().integer().positive().required(),
});

// ── Projects ──
export const listProjects: RequestSchema = {
  // A category id, or "none" for uncategorized projects.
  query: Joi.object({
    category_id: Joi.alternatives(
      Joi.number().integer().positive(),
      Joi.string().valid("none", ""),
    ).optional(),
  }),
};
// Payment-page settings (PCI DSS 11.6.1). Shape only — URL scheme, header-name syntax, duplicates
// and lengths are checked by the service (pageConfig.ts) so messages stay in one place.
// Optional category assignment; null/"" clears it. Existence is checked in the service.
const categoryField = {
  category_id: Joi.alternatives(Joi.number().integer().positive(), Joi.valid(null, "")).optional(),
};

/** A history filter day: `YYYY-MM-DD` (server time zone), "" = not set. */
const dateParam = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .allow("")
  .optional()
  .messages({ "string.pattern.base": "Dates must be in YYYY-MM-DD format." });

const pageFields = {
  page_url: Joi.string().allow("", null).max(2048).optional(),
  expected_headers: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().allow("").required(),
        value: Joi.string().allow("").required(),
      }),
    )
    .allow(null)
    .optional(),
};

export const createProject: RequestSchema = {
  body: Joi.object({
    name: Joi.string().trim().max(100).required(),
    description: Joi.string().allow("", null).max(500).optional(),
    ...pageFields,
    ...categoryField,
  }),
};
export const getProject: RequestSchema = { params: idParam };
export const updateProject: RequestSchema = {
  params: idParam,
  body: Joi.object({
    name: Joi.string().trim().max(100).required(),
    description: Joi.string().allow("", null).max(500).optional(),
    ...pageFields,
    ...categoryField,
  }),
};
export const scanProject: RequestSchema = { params: idParam };
export const listProjectScans: RequestSchema = {
  params: idParam,
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    perPage: Joi.number().integer().min(1).max(100).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(), // alias of perPage
  }),
};
export const listPageScans: RequestSchema = {
  query: Joi.object({
    project_id: Joi.number().integer().positive().optional(),
    page: Joi.number().integer().min(1).optional(),
    perPage: Joi.number().integer().min(1).max(100).optional(),
    from: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow("")
      .optional(),
    to: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow("")
      .optional(),
  }),
};
export const deleteProject: RequestSchema = { params: idParam };
export const reportProject: RequestSchema = {
  params: idParam,
  query: Joi.object({ format: Joi.string().optional() }),
};
export const reportProjects: RequestSchema = {
  query: Joi.object({ format: Joi.string().optional() }),
};

// ── Files ──
export const listFiles: RequestSchema = {
  query: Joi.object({ project_id: Joi.number().integer().positive().optional() }),
};
export const createFile: RequestSchema = {
  body: Joi.object({
    project_id: Joi.number().integer().positive().required(),
    file_name: Joi.string().trim().max(255).required(),
    file_url: Joi.string().trim().max(2048).required(),
    file_content: Joi.string().required(),
  }),
};
export const getFile: RequestSchema = { params: idParam };
export const updateFile: RequestSchema = {
  params: idParam,
  body: Joi.object({
    project_id: Joi.number().integer().positive().required(),
    file_name: Joi.string().trim().max(255).required(),
    file_url: Joi.string().trim().max(2048).required(),
    file_content: Joi.string().required(),
  }),
};
export const deleteFile: RequestSchema = { params: idParam };
export const checkFile: RequestSchema = {
  body: Joi.object({ id: Joi.number().integer().positive().required() }),
};

// ── Emails ──
export const listEmails: RequestSchema = {};
export const createEmail: RequestSchema = {
  body: Joi.object({
    name: Joi.string().trim().max(150).required(),
    email: Joi.string().trim().max(255).required(),
  }),
};
export const getEmail: RequestSchema = { params: idParam };
export const updateEmail: RequestSchema = {
  params: idParam,
  body: Joi.object({
    name: Joi.string().trim().max(150).required(),
    email: Joi.string().trim().max(255).required(),
  }),
};
export const deleteEmail: RequestSchema = { params: idParam };

// ── Check history ──
export const listCheckHistory: RequestSchema = {
  query: Joi.object({
    project_id: Joi.number().integer().positive().optional(),
    file_id: Joi.number().integer().positive().optional(),
    page: Joi.number().integer().min(1).optional(),
    perPage: Joi.number().integer().min(1).max(100).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(), // alias of perPage
    from: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow("")
      .optional(),
    to: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow("")
      .optional(),
  }),
};
export const listFileOptions: RequestSchema = {
  query: Joi.object({ project_id: Joi.number().integer().positive().optional() }),
};
