import Joi from "joi";
import type { RequestSchema } from "@/middleware/validate";

/**
 * Joi request schemas for the auth routes.
 *
 * Deliberately permissive on the multi-path 2FA endpoints: `verify2fa` selects its path by which
 * of `totp_pending_token` / `setup_token` / an existing session is present, and the controller
 * already returns precise 400/401s for the missing-piece cases. So schemas here only assert the
 * always-required field (`code` for verify, credentials for login) and the correct types for the
 * optional tokens — the controller/service keep their existing checks as the backstop.
 */

export const login: RequestSchema = {
  body: Joi.object({
    email: Joi.string().required(),
    password: Joi.string().required(),
  }),
};

export const logout: RequestSchema = {};

export const verify2fa: RequestSchema = {
  body: Joi.object({
    code: Joi.string().required(),
    totp_pending_token: Joi.string().optional(),
    setup_token: Joi.string().optional(),
  }),
};

export const setup2fa: RequestSchema = {
  body: Joi.object({
    setup_token: Joi.string().optional(),
  }),
};

export const disable2fa: RequestSchema = {
  body: Joi.object({
    code: Joi.string().optional(), // service returns the exact "OTP code required." message
  }),
};

export const recover2fa: RequestSchema = {
  body: Joi.object({
    totp_pending_token: Joi.string().optional(),
    recovery_code: Joi.string().optional(),
  }),
};

export const regenerateCodes: RequestSchema = {
  body: Joi.object({
    code: Joi.string().optional(), // service returns "Current OTP code required."
  }),
};

export const setSetupCookie: RequestSchema = {
  body: Joi.object({
    setup_token: Joi.string().optional(), // controller returns "Missing token." when absent
  }),
};

export const getSetupToken: RequestSchema = {};
export const clearSetupCookie: RequestSchema = {};
