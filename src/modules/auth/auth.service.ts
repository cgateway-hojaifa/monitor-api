import { verify as totpVerify, generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";
import { AppDataSource } from "@/config/data-source";
import { User } from "@/entities/User";
import {
  verifyPassword,
  signToken,
  signTotpPendingToken,
  signSetupRequiredToken,
  verifyTotpPendingToken,
  verifySetupRequiredToken,
  generateRecoveryCodes,
  matchRecoveryCode,
} from "@/shared/auth";
import ApiError from "@/utils/ApiError";
import httpStatus from "@/constants/httpStatus";

/**
 * Auth data + crypto layer. Functions here own DB access (TypeORM User repo), password/TOTP
 * verification, token minting, and recovery-code handling. They stay transport-agnostic:
 * cookie set/clear and reading request cookies live in the controller. Business errors are
 * thrown as `ApiError` (mapped to the same status codes the original handlers returned); the
 * cases that returned `{ success:true, ... }` non-session shapes are returned as plain objects.
 */

const userRepo = () => AppDataSource.getRepository(User);

type PublicUser = { id: number; email: string; name: string };
const toPublic = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name });

// ── Login ──────────────────────────────────────────────────────────────────
export type LoginResult =
  | { kind: "requires_2fa"; totp_pending_token: string }
  | { kind: "requires_2fa_setup"; setup_token: string }
  | { kind: "session"; user: PublicUser; token: string };

export async function login(email?: string, password?: string): Promise<LoginResult> {
  if (!email || !password)
    throw new ApiError(httpStatus.BAD_REQUEST, "Email and password required.");

  const user = await userRepo().findOne({ where: { email } });
  if (!user) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid credentials.");

  const valid = await verifyPassword(password, user.password);
  if (!valid) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid credentials.");

  // 2FA enabled → require OTP before granting session
  if (user.totp_enabled && user.totp_secret) {
    const pendingToken = await signTotpPendingToken({ id: user.id, email: user.email });
    return { kind: "requires_2fa", totp_pending_token: pendingToken };
  }

  // 2FA not yet configured → force setup before dashboard access
  if (!user.totp_enabled) {
    const setupToken = await signSetupRequiredToken({ id: user.id, email: user.email });
    return { kind: "requires_2fa_setup", setup_token: setupToken };
  }

  // Should not reach here, but guard anyway
  const token = await signToken({ id: user.id, email: user.email });
  return { kind: "session", user: toPublic(user), token };
}

// ── 2FA verify — three paths ─────────────────────────────────────────────────
export type VerifyResult =
  { kind: "session"; user: PublicUser; token: string } | { kind: "message"; message: string };

/** Path 1: login completion via totp_pending_token. */
export async function verifyLogin(code: string, pendingToken: string): Promise<VerifyResult> {
  const pending = verifyTotpPendingToken(pendingToken);
  if (!pending)
    throw new ApiError(httpStatus.UNAUTHORIZED, "Session expired. Please log in again.");

  const user = await userRepo().findOne({ where: { id: pending.id } });
  if (!user || !user.totp_secret || !user.totp_enabled)
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid session.");

  const result = await totpVerify({ secret: user.totp_secret, token: code });
  if (!result.valid) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid authenticator code.");

  const token = await signToken({ id: user.id, email: user.email });
  return { kind: "session", user: toPublic(user), token };
}

/** Path 2: first-time setup confirmation via setup_token (no session cookie yet). */
export async function verifySetup(code: string, setupToken: string): Promise<VerifyResult> {
  const pending = verifySetupRequiredToken(setupToken);
  if (!pending)
    throw new ApiError(httpStatus.UNAUTHORIZED, "Setup session expired. Please log in again.");

  const user = await userRepo().findOne({ where: { id: pending.id } });
  if (!user || !user.totp_secret)
    throw new ApiError(httpStatus.BAD_REQUEST, "No pending 2FA setup found.");
  if (user.totp_enabled) throw new ApiError(httpStatus.BAD_REQUEST, "2FA is already enabled.");

  const result = await totpVerify({ secret: user.totp_secret, token: code });
  if (!result.valid)
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid authenticator code. Please try again.");

  user.totp_enabled = true;
  await userRepo().save(user);

  const token = await signToken({ id: user.id, email: user.email });
  return { kind: "session", user: toPublic(user), token };
}

/** Path 3: re-confirm setup from an authenticated session (managing 2FA in settings). */
export async function verifyAuthenticated(code: string, userId: number): Promise<VerifyResult> {
  const user = await userRepo().findOne({ where: { id: userId } });
  if (!user || !user.totp_secret)
    throw new ApiError(httpStatus.BAD_REQUEST, "No pending 2FA setup found.");
  if (user.totp_enabled) throw new ApiError(httpStatus.BAD_REQUEST, "2FA is already enabled.");

  const result = await totpVerify({ secret: user.totp_secret, token: code });
  if (!result.valid)
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid authenticator code. Please try again.");

  user.totp_enabled = true;
  await userRepo().save(user);
  return { kind: "message", message: "2FA enabled successfully." };
}

// ── 2FA setup (generate secret + QR + recovery codes) ─────────────────────────
export async function setup(userId: number) {
  const dbUser = await userRepo().findOne({ where: { id: userId } });
  if (!dbUser) throw new ApiError(httpStatus.NOT_FOUND, "User not found.");
  if (dbUser.totp_enabled) throw new ApiError(httpStatus.BAD_REQUEST, "2FA is already enabled.");

  const secret = generateSecret();
  const otpAuthUrl = generateURI({
    issuer: "Script Discovery & Inventory",
    label: dbUser.email,
    secret,
  });
  const qrDataUrl = await QRCode.toDataURL(otpAuthUrl);

  // Pre-generate recovery codes — stored hashed, returned plain (shown once after confirm)
  const { plain: recoveryCodes, hashed: recoveryHashes } = await generateRecoveryCodes(10);

  dbUser.totp_secret = secret;
  dbUser.totp_enabled = false;
  dbUser.recovery_codes = JSON.stringify(recoveryHashes);
  await userRepo().save(dbUser);

  return { secret, qrDataUrl, recoveryCodes };
}

// ── 2FA disable ──────────────────────────────────────────────────────────────
export async function disable(userId: number, code?: string) {
  if (!code) throw new ApiError(httpStatus.BAD_REQUEST, "OTP code required.");

  const dbUser = await userRepo().findOne({ where: { id: userId } });
  if (!dbUser) throw new ApiError(httpStatus.NOT_FOUND, "User not found.");
  if (!dbUser.totp_enabled || !dbUser.totp_secret)
    throw new ApiError(httpStatus.BAD_REQUEST, "2FA is not enabled.");

  const result = await totpVerify({ secret: dbUser.totp_secret, token: code });
  if (!result.valid) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid authenticator code.");

  dbUser.totp_secret = null;
  dbUser.totp_enabled = false;
  await userRepo().save(dbUser);
  return { message: "2FA disabled." };
}

// ── 2FA recovery-code login ──────────────────────────────────────────────────
export async function recover(pendingToken?: string, recoveryCode?: string) {
  if (!pendingToken) throw new ApiError(httpStatus.BAD_REQUEST, "Login session required.");
  if (!recoveryCode) throw new ApiError(httpStatus.BAD_REQUEST, "Recovery code required.");

  const pending = verifyTotpPendingToken(pendingToken);
  if (!pending)
    throw new ApiError(httpStatus.UNAUTHORIZED, "Session expired. Please log in again.");

  const user = await userRepo().findOne({ where: { id: pending.id } });
  if (!user || !user.totp_enabled) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid session.");

  if (!user.recovery_codes)
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "No recovery codes available. Contact your administrator.",
    );

  const hashes: string[] = JSON.parse(user.recovery_codes);
  const matchIdx = await matchRecoveryCode(recoveryCode, hashes);
  if (matchIdx === -1) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid recovery code.");

  // Consume the used code (remove from array)
  hashes.splice(matchIdx, 1);
  const remaining = hashes.length;
  user.recovery_codes = JSON.stringify(hashes);
  await userRepo().save(user);

  const token = await signToken({ id: user.id, email: user.email });
  return { user: toPublic(user), token, remaining_codes: remaining };
}

// ── 2FA regenerate recovery codes ────────────────────────────────────────────
export async function regenerateCodes(userId: number, code?: string) {
  if (!code) throw new ApiError(httpStatus.BAD_REQUEST, "Current OTP code required.");

  const dbUser = await userRepo().findOne({ where: { id: userId } });
  if (!dbUser) throw new ApiError(httpStatus.NOT_FOUND, "User not found.");
  if (!dbUser.totp_enabled || !dbUser.totp_secret)
    throw new ApiError(httpStatus.BAD_REQUEST, "2FA is not enabled.");

  const result = await totpVerify({ secret: dbUser.totp_secret, token: code });
  if (!result.valid) throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid authenticator code.");

  const { plain: recoveryCodes, hashed: recoveryHashes } = await generateRecoveryCodes(10);
  dbUser.recovery_codes = JSON.stringify(recoveryHashes);
  await userRepo().save(dbUser);

  return { recoveryCodes };
}
