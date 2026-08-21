import type { Request, Response } from "express";
import { getAuthUser } from "@/shared/auth";
import { AppDataSource } from "@/config/data-source";
import { User } from "@/entities/User";

/**
 * Inline auth guard, called at the top of a handler/service body (mirrors the original Next
 * version's `const { user, error } = await requireAuth(req)` shape so handler logic ports
 * verbatim).
 *
 * On failure returns `{ user: null, error }` where `error` is a sender: call `error(res)` and
 * return — it writes the 401 (clearing a stale cookie when a bad token was presented). On
 * success returns the loaded `User` row and `error: null`.
 */
export type AuthError = (res: Response) => Response;

export async function requireAuth(
  req: Request,
): Promise<{ user: User | null; error: AuthError | null }> {
  const authUser = getAuthUser(req);
  if (!authUser) {
    return {
      user: null,
      error: (res) => res.status(401).json({ success: false, message: "Unauthorized." }),
    };
  }

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: authUser.id } });

  if (!user) {
    return {
      user: null,
      error: (res) =>
        res
          .clearCookie("auth_token", { path: "/" })
          .status(401)
          .json({ success: false, message: "Unauthorized." }),
    };
  }

  return { user, error: null };
}
