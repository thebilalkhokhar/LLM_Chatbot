/**
 * JWT guard middleware.
 *
 * - Reads the bearer access token from the `Authorization` header.
 * - Verifies it with `token.service.verifyAccessToken`.
 * - Loads the user and attaches it to `req.user`.
 *
 * Any failure results in an `ApiError(401)` forwarded to the error
 * middleware.
 */

import { User } from "../models/user.model.js";
import { verifyAccessToken } from "../services/token.service.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

function extractBearerToken(req) {
  const header = req.headers?.authorization ?? "";
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export const verifyJWT = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw ApiError.unauthorized("Missing Bearer access token.", {
      code: "ACCESS_TOKEN_MISSING",
    });
  }

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (!user) {
    throw ApiError.unauthorized("Token subject no longer exists.", {
      code: "USER_NOT_FOUND",
    });
  }

  req.user = user;
  req.auth = { userId: user.id, token };
  return next();
});
