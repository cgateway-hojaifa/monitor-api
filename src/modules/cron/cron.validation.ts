import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/** Joi request schema for the cron-logs listing (module filter + pagination). */
export const listCronLogs: RequestSchema = {
  query: Joi.object({
    module: Joi.string().optional(),
    page: Joi.number().integer().min(1).optional(),
    perPage: Joi.number().integer().min(1).max(100).optional(),
  }),
};

export const listCronLogModules: RequestSchema = {};
