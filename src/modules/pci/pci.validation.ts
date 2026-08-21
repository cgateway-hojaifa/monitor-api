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
export const listProjects: RequestSchema = {};
export const createProject: RequestSchema = {
  body: Joi.object({
    name: Joi.string().trim().max(100).required(),
    description: Joi.string().allow("", null).max(500).optional(),
  }),
};
export const getProject: RequestSchema = { params: idParam };
export const updateProject: RequestSchema = {
  params: idParam,
  body: Joi.object({
    name: Joi.string().trim().max(100).required(),
    description: Joi.string().allow("", null).max(500).optional(),
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
    file_id: Joi.number().integer().positive().optional(),
    limit: Joi.number().integer().min(1).optional(),
  }),
};
