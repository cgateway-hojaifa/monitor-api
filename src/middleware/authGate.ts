import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "@/shared/auth";

/**
 * API auth gate — the Express port of the API-auth branch of the old Next `middleware.ts`.
 *
 * Runs before all `/api` routers. Auth routes are always allowed (they establish the session);
 * everything else requires a valid `auth_token` cookie. The page-redirect logic from the old
 * middleware stays in the frontend.
 *
 * NOTE: paths here include the `/api` prefix because the gate is mounted at the app root,
 * matching the pathnames the old Next middleware saw.
 */

const AUTH_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/2fa/verify", // allows totp_pending_token and setup_token paths (no auth cookie yet)
  "/api/auth/2fa/recover", // recovery code login (no auth cookie yet)
  "/api/auth/2fa/setup", // allows setup_token path (no auth cookie yet)
  "/api/auth/2fa/set-setup-cookie", // sets httpOnly cookie from login's setup_token
  "/api/auth/2fa/get-setup-token", // returns setup_token from cookie to setup page
  "/api/auth/2fa/clear-setup-cookie", // clears setup cookie after enrollment
];

export function authGate(req: Request, res: Response, next: NextFunction) {
  // Mounted at "/api", so req.path is stripped of that prefix — use originalUrl (which keeps
  // the full "/api/..." path) minus the query string so the constants below match.
  const pathname = req.originalUrl.split("?")[0];

  // Always allow auth routes
  if (AUTH_PATHS.some((p) => pathname.startsWith(p))) return next();

  // Everything else requires a valid session token
  const token = (req.cookies as Record<string, string> | undefined)?.auth_token;
  const isLoggedIn = !!token && !!verifyToken(token);

  if (!isLoggedIn) {
    if (token) res.clearCookie("auth_token", { path: "/" });
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }

  return next();
}
