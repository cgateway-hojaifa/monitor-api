import type { Request, Response, NextFunction } from "express";
import Joi from "joi";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

/**
 * Route-layer request validation (Joi). A schema is an object with optional `params`, `query`,
 * and `body` keys; only the provided parts are validated. On failure this throws
 * `ApiError(400, message)` — the same `{ code, message }` shape the errorHandler already renders
 * and the frontend already reads via `err.response.data.message`.
 *
 * Validated + coerced values are written back onto the request (e.g. `params.id` becomes a real
 * number, unknown body keys are stripped) so controllers/services receive clean input. This runs
 * BEFORE controllers; the existing inline service checks stay as a backstop.
 */

export interface RequestSchema {
  params?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  body?: Joi.ObjectSchema;
}

const OPTIONS: Joi.ValidationOptions = {
  abortEarly: true, // first error only — matches the single-message ApiError contract
  stripUnknown: true, // drop keys not in the schema
  convert: true, // coerce "5" → 5 for numeric params/query
};

export function validate(schema: RequestSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const key of ["params", "query", "body"] as const) {
      const part = schema[key];
      if (!part) continue;
      const { value, error } = part.validate(req[key], OPTIONS);
      if (error) {
        return next(new ApiError(httpStatus.BAD_REQUEST, error.details[0].message));
      }
      // Write coerced/stripped values back (params/query are reassigned; body is mutated in place
      // to stay compatible across Express versions).
      if (key === "body") {
        req.body = value;
      } else {
        Object.assign(req[key], value);
      }
    }
    next();
  };
}

export default validate;
