import type { Request, Response } from "express";
import httpStatus from "@/constants/httpStatus";
import catchAsync from "@/middleware/catchAsync";
import ApiError from "@/utils/ApiError";
import { requireAuth } from "@/middleware/requireAuth";
import * as service from "@/modules/auth/auth.service";
import { getAuthUser, verifySetupRequiredToken } from "@/shared/auth";
import { authCookieOptions, setupCookieOptions, clearCookieOptions } from "@/shared/cookies";

// ── Login ──────────────────────────────────────────────────────────────────
export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const result = await service.login(email, password);

  if (result.kind === "requires_2fa") {
    return res.status(httpStatus.OK).json({
      success: true,
      requires_2fa: true,
      totp_pending_token: result.totp_pending_token,
    });
  }
  if (result.kind === "requires_2fa_setup") {
    return res.status(httpStatus.OK).json({
      success: true,
      requires_2fa_setup: true,
      setup_token: result.setup_token,
    });
  }
  res.cookie("auth_token", result.token, authCookieOptions());
  return res.status(httpStatus.OK).json({ success: true, user: result.user });
});

// ── Logout ──────────────────────────────────────────────────────────────────
export const logout = catchAsync(async (_req: Request, res: Response) => {
  res.clearCookie("auth_token", clearCookieOptions());
  return res.status(httpStatus.OK).json({ success: true });
});

// ── 2FA verify (three paths, selected by which token/session is present) ──────
export const verify2fa = catchAsync(async (req: Request, res: Response) => {
  const { code, totp_pending_token, setup_token } = req.body as {
    code?: string;
    totp_pending_token?: string;
    setup_token?: string;
  };
  if (!code) throw new ApiError(httpStatus.BAD_REQUEST, "OTP code required.");

  // Path 1: login completion via totp_pending_token
  if (totp_pending_token) {
    const result = await service.verifyLogin(code, totp_pending_token);
    if (result.kind === "session") {
      res.cookie("auth_token", result.token, authCookieOptions());
      return res.status(httpStatus.OK).json({ success: true, user: result.user });
    }
  }

  // Path 2: first-time setup confirmation via setup_token (no session cookie yet)
  if (setup_token) {
    const result = await service.verifySetup(code, setup_token);
    if (result.kind === "session") {
      res.cookie("auth_token", result.token, authCookieOptions());
      return res.status(httpStatus.OK).json({ success: true, user: result.user });
    }
  }

  // Path 3: re-confirm setup from an authenticated session (managing 2FA in settings)
  const authUser = getAuthUser(req);
  if (!authUser) throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized.");
  const result = await service.verifyAuthenticated(code, authUser.id);
  return res
    .status(httpStatus.OK)
    .json({ success: true, message: (result as { message: string }).message });
});

// ── 2FA setup (auth session OR setup_token resolves the user) ─────────────────
export const setup2fa = catchAsync(async (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, string>;
  const authUser = getAuthUser(req);
  const resolved =
    authUser || (body.setup_token ? verifySetupRequiredToken(body.setup_token) : null);
  if (!resolved) throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized.");

  const data = await service.setup(resolved.id);
  return res.status(httpStatus.OK).json({ success: true, ...data });
});

// ── 2FA disable (authenticated) ───────────────────────────────────────────────
export const disable2fa = catchAsync(async (req: Request, res: Response) => {
  const { user, error } = await requireAuth(req);
  if (error) return error(res);
  const { code } = req.body as { code?: string };
  const result = await service.disable(user!.id, code);
  return res.status(httpStatus.OK).json({ success: true, message: result.message });
});

// ── 2FA recover (recovery-code login) ─────────────────────────────────────────
export const recover2fa = catchAsync(async (req: Request, res: Response) => {
  const { totp_pending_token, recovery_code } = req.body as {
    totp_pending_token?: string;
    recovery_code?: string;
  };
  const result = await service.recover(totp_pending_token, recovery_code);
  res.cookie("auth_token", result.token, authCookieOptions());
  return res.status(httpStatus.OK).json({
    success: true,
    user: result.user,
    remaining_codes: result.remaining_codes,
  });
});

// ── 2FA regenerate recovery codes (authenticated) ─────────────────────────────
export const regenerateCodes = catchAsync(async (req: Request, res: Response) => {
  const { user, error } = await requireAuth(req);
  if (error) return error(res);
  const { code } = req.body as { code?: string };
  const result = await service.regenerateCodes(user!.id, code);
  return res.status(httpStatus.OK).json({ success: true, recoveryCodes: result.recoveryCodes });
});

// ── Setup cookie ops (pure cookie plumbing; no DB) ────────────────────────────
export const setSetupCookie = catchAsync(async (req: Request, res: Response) => {
  const { setup_token } = req.body as { setup_token?: string };
  if (!setup_token) throw new ApiError(httpStatus.BAD_REQUEST, "Missing token.");
  const payload = verifySetupRequiredToken(setup_token);
  if (!payload) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid or expired token.");
  res.cookie("setup_required_token", setup_token, setupCookieOptions());
  return res.status(httpStatus.OK).json({ success: true });
});

export const getSetupToken = catchAsync(async (req: Request, res: Response) => {
  const token = (req.cookies as Record<string, string> | undefined)?.setup_required_token;
  if (!token) throw new ApiError(httpStatus.UNAUTHORIZED, "No setup session.");
  const payload = verifySetupRequiredToken(token);
  if (!payload) throw new ApiError(httpStatus.UNAUTHORIZED, "Setup session expired.");
  return res.status(httpStatus.OK).json({ success: true, setup_token: token });
});

export const clearSetupCookie = catchAsync(async (_req: Request, res: Response) => {
  res.clearCookie("setup_required_token", clearCookieOptions());
  return res.status(httpStatus.OK).json({ success: true });
});
