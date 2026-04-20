/**
 * Auth controller — signup / login / refresh / logout.
 *
 * All handlers are wrapped with `asyncHandler` at the route layer so
 * thrown errors land in the centralised error middleware.
 */

import { User } from "../models/user.model.js";
import {
  clearRefreshToken,
  issueTokenPair,
  refreshCookieName,
  refreshCookieOptions,
  verifyRefreshToken,
} from "../services/token.service.js";
import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "../config/constants.js";
import { ApiError } from "../utils/ApiError.js";

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
  };
}

function assertCredentialsPayload(body, { requireUsername }) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const username =
    typeof body.username === "string" ? body.username.trim() : undefined;

  if (!email) throw ApiError.badRequest("Email is required.");
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw ApiError.badRequest(
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`
    );
  }

  if (requireUsername) {
    if (
      !username ||
      username.length < USERNAME_MIN_LENGTH ||
      username.length > USERNAME_MAX_LENGTH
    ) {
      throw ApiError.badRequest(
        `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters.`
      );
    }
  }

  return { email, password, username };
}

/**
 * POST /api/auth/signup
 */
export async function signup(req, res) {
  const { email, password, username } = assertCredentialsPayload(req.body ?? {}, {
    requireUsername: true,
  });

  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) {
    const field = existing.email === email ? "email" : "username";
    throw ApiError.conflict(`An account with that ${field} already exists.`, {
      code: "ACCOUNT_EXISTS",
    });
  }

  const user = await User.create({ email, password, username });
  const { accessToken, refreshToken } = await issueTokenPair(user);

  res.cookie(refreshCookieName, refreshToken, refreshCookieOptions());
  res.status(201).json({
    status: "ok",
    user: sanitizeUser(user),
    accessToken,
  });
}

/**
 * POST /api/auth/login
 */
export async function login(req, res) {
  const { email, password } = assertCredentialsPayload(req.body ?? {}, {
    requireUsername: false,
  });

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.isPasswordValid(password))) {
    throw ApiError.unauthorized("Invalid email or password.", {
      code: "INVALID_CREDENTIALS",
    });
  }

  const { accessToken, refreshToken } = await issueTokenPair(user);

  res.cookie(refreshCookieName, refreshToken, refreshCookieOptions());
  res.status(200).json({
    status: "ok",
    user: sanitizeUser(user),
    accessToken,
  });
}

/**
 * POST /api/auth/refresh
 *
 * Rotates the access token. Also rotates the refresh token (best
 * practice: single-use refresh tokens) and updates the DB record.
 */
export async function refresh(req, res) {
  const cookieToken = req.cookies?.[refreshCookieName];
  if (!cookieToken) {
    throw ApiError.unauthorized("Missing refresh token cookie.", {
      code: "REFRESH_TOKEN_MISSING",
    });
  }

  const payload = verifyRefreshToken(cookieToken);
  const user = await User.findById(payload.sub).select("+refreshToken");
  if (!user) {
    throw ApiError.unauthorized("Refresh subject no longer exists.", {
      code: "USER_NOT_FOUND",
    });
  }

  // Token-reuse check: the cookie MUST match what we last issued. If it
  // doesn't, treat it as a replay attempt and invalidate everything.
  if (user.refreshToken !== cookieToken) {
    await clearRefreshToken(user._id);
    res.clearCookie(refreshCookieName, refreshCookieOptions());
    throw ApiError.unauthorized("Refresh token reuse detected.", {
      code: "REFRESH_TOKEN_REUSED",
    });
  }

  const { accessToken, refreshToken } = await issueTokenPair(user);
  res.cookie(refreshCookieName, refreshToken, refreshCookieOptions());
  res.status(200).json({
    status: "ok",
    user: sanitizeUser(user),
    accessToken,
  });
}

/**
 * POST /api/auth/logout
 *
 * Clears the cookie and the stored refresh token. Idempotent — a
 * logout without cookie still succeeds.
 */
export async function logout(req, res) {
  const cookieToken = req.cookies?.[refreshCookieName];
  if (cookieToken) {
    try {
      const payload = verifyRefreshToken(cookieToken);
      await clearRefreshToken(payload.sub);
    } catch {
      // Token was already invalid — nothing to revoke.
    }
  }

  res.clearCookie(refreshCookieName, refreshCookieOptions());
  res.status(200).json({ status: "ok" });
}

/**
 * GET /api/auth/me  — quick echo endpoint for the frontend.
 */
export async function me(req, res) {
  res.status(200).json({ status: "ok", user: sanitizeUser(req.user) });
}
