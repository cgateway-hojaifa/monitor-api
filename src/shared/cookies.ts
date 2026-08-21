import type { CookieOptions } from "express";

/**
 * Shared auth-cookie options (env-driven for cross-origin deploy shapes).
 * Defaults preserve the original behavior: httpOnly, sameSite=lax, secure only in prod.
 */
const SAMESITE = (process.env.COOKIE_SAMESITE as "lax" | "strict" | "none" | undefined) || "lax";
const SECURE =
  process.env.COOKIE_SECURE != null
    ? process.env.COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
const DOMAIN = process.env.COOKIE_DOMAIN || undefined;

function base(): CookieOptions {
  return {
    httpOnly: true,
    secure: SECURE,
    sameSite: SAMESITE,
    path: "/",
    ...(DOMAIN ? { domain: DOMAIN } : {}),
  };
}

/** Session cookie (`auth_token`) — 7 days. */
export function authCookieOptions(): CookieOptions {
  return { ...base(), maxAge: 60 * 60 * 24 * 7 * 1000 };
}

/** Setup-required cookie — 15 minutes. */
export function setupCookieOptions(): CookieOptions {
  return { ...base(), maxAge: 60 * 15 * 1000 };
}

/** Options used to clear a cookie (domain/path must match the set call). */
export function clearCookieOptions(): CookieOptions {
  return { path: "/", ...(DOMAIN ? { domain: DOMAIN } : {}) };
}
