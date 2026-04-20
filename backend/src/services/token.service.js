/**
 * Access/Refresh token service.
 *
 * Responsibilities:
 *   - Sign and verify JWTs using the two secrets from env.
 *   - Issue a fresh token pair on login/refresh.
 *   - Persist the current refresh token on the User document so we can
 *     revoke it server-side on logout.
 *   - Build the cookie options used by the refresh cookie.
 */

import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { REFRESH_COOKIE_NAME } from "../config/constants.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";

const ACCESS_AUDIENCE = "access";
const REFRESH_AUDIENCE = "refresh";

function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, username: user.username },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiry, audience: ACCESS_AUDIENCE }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user._id.toString() },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpiry, audience: REFRESH_AUDIENCE }
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwt.accessSecret, {
      audience: ACCESS_AUDIENCE,
    });
  } catch (error) {
    throw ApiError.unauthorized("Invalid or expired access token.", {
      code: "ACCESS_TOKEN_INVALID",
    });
  }
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, env.jwt.refreshSecret, {
      audience: REFRESH_AUDIENCE,
    });
  } catch (error) {
    throw ApiError.unauthorized("Invalid or expired refresh token.", {
      code: "REFRESH_TOKEN_INVALID",
    });
  }
}

/**
 * Issue a new (accessToken, refreshToken) pair and persist the refresh
 * token on the user document.
 */
export async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await User.updateOne({ _id: user._id }, { $set: { refreshToken } });
  return { accessToken, refreshToken };
}

export async function clearRefreshToken(userId) {
  if (!userId) return;
  await User.updateOne({ _id: userId }, { $set: { refreshToken: null } });
}

/**
 * Cookie options for the refresh cookie. Kept central so every call site
 * (set + clear) uses an identical policy — otherwise browsers refuse to
 * delete the cookie.
 */
export function refreshCookieOptions() {
  // Rough conversion of the refresh-token lifetime into milliseconds for
  // the cookie `maxAge`. Supports the common `m/h/d` suffixes.
  const lifetimeMs = parseDurationToMs(env.jwt.refreshExpiry) ?? 7 * 24 * 60 * 60 * 1000;

  return {
    httpOnly: true,
    secure: env.cookie.secure,
    sameSite: env.cookie.sameSite,
    path: "/api/auth",
    maxAge: lifetimeMs,
  };
}

export const refreshCookieName = REFRESH_COOKIE_NAME;

function parseDurationToMs(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\s*([smhd])?$/i);
  if (!match) return null;
  const qty = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? "s").toLowerCase();
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return qty * (multipliers[unit] ?? 1000);
}
