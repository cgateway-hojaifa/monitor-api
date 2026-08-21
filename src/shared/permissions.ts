import type { Request } from "express";

/**
 * Permission seam (single-role for now).
 *
 * The app currently has one admin user and no roles table, so every authenticated request has
 * every permission. This is the single place to swap in real RBAC later (load the user's roles →
 * permission set) without touching call sites: nav filtering and any future permission gate call
 * `userHasPermission(req, required)`.
 */
export function userHasPermission(_req: Request, _required: string[]): boolean {
  // TODO(RBAC): resolve the request's user → role → permission set and check membership.
  // Until roles exist, the sole admin user is treated as fully permitted.
  return true;
}
