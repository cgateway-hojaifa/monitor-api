import type { Request } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const TOTP_PENDING_EXPIRES = "5m";
const SETUP_REQUIRED_EXPIRES = "15m";

// ── Password hashing ──
export async function hashPassword(plain: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.compare(plain, hashed);
}

// ── JWT sign / verify ──
export async function signToken(payload: { id: number; email: string }): Promise<string> {
  const jwt = await import("jsonwebtoken");
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as import("jsonwebtoken").SignOptions);
}

export function verifyToken(token: string): { id: number; email: string } | null {
  try {
    const jwt = require("jsonwebtoken");
    return jwt.verify(token, JWT_SECRET) as { id: number; email: string };
  } catch {
    return null;
  }
}

// ── Token from request ──
export function getTokenFromRequest(req: Request): string | null {
  const cookie = (req.cookies as Record<string, string> | undefined)?.auth_token;
  if (cookie) return cookie;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export function getAuthUser(req: Request): { id: number; email: string } | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyToken(token);
}

// ── Recovery codes ──
export async function generateRecoveryCodes(
  count = 10,
): Promise<{ plain: string[]; hashed: string[] }> {
  const bcrypt = await import("bcryptjs");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (0/O, 1/I)
  const plain: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < 10; j++) code += chars[Math.floor(Math.random() * chars.length)];
    plain.push(code.slice(0, 5) + "-" + code.slice(5));
  }
  const hashed = await Promise.all(plain.map((c) => bcrypt.hash(c.replace("-", ""), 10)));
  return { plain, hashed };
}

export async function matchRecoveryCode(submitted: string, hashes: string[]): Promise<number> {
  const bcrypt = await import("bcryptjs");
  const normalized = submitted.replace(/[-\s]/g, "").toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) return i;
  }
  return -1;
}

// ── TOTP pending token (5-minute bridge between password OK and OTP verify) ──
export async function signTotpPendingToken(payload: {
  id: number;
  email: string;
}): Promise<string> {
  const jwt = await import("jsonwebtoken");
  return jwt.sign({ ...payload, totp_pending: true }, JWT_SECRET, {
    expiresIn: TOTP_PENDING_EXPIRES,
  } as import("jsonwebtoken").SignOptions);
}

export function verifyTotpPendingToken(token: string): { id: number; email: string } | null {
  try {
    const jwt = require("jsonwebtoken");
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: number;
      email: string;
      totp_pending?: boolean;
    };
    if (!payload.totp_pending) return null;
    return { id: payload.id, email: payload.email };
  } catch {
    return null;
  }
}

// ── Setup-required token (15-minute gate — allows /settings/2fa only) ──
export async function signSetupRequiredToken(payload: {
  id: number;
  email: string;
}): Promise<string> {
  const jwt = await import("jsonwebtoken");
  return jwt.sign({ ...payload, setup_required: true }, JWT_SECRET, {
    expiresIn: SETUP_REQUIRED_EXPIRES,
  } as import("jsonwebtoken").SignOptions);
}

export function verifySetupRequiredToken(token: string): { id: number; email: string } | null {
  try {
    const jwt = require("jsonwebtoken");
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: number;
      email: string;
      setup_required?: boolean;
    };
    if (!payload.setup_required) return null;
    return { id: payload.id, email: payload.email };
  } catch {
    return null;
  }
}
