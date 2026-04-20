/**
 * Centralized error handler.
 *
 * Shapes every error into a consistent JSON envelope:
 *   { status: "error", statusCode, message, code?, details? }
 *
 * - `ApiError` → serialised verbatim (operational errors).
 * - Mongoose `ValidationError` → 400 with field details.
 * - Mongoose duplicate-key (`E11000`) → 409 with the offending field.
 * - JWT errors → 401.
 * - Everything else → 500 (message is hidden in production).
 */

import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let apiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else if (err?.name === "ValidationError") {
    apiError = ApiError.badRequest("Validation failed.", {
      code: "VALIDATION_ERROR",
      details: Object.fromEntries(
        Object.entries(err.errors ?? {}).map(([field, e]) => [field, e.message])
      ),
    });
  } else if (err?.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? "field";
    apiError = ApiError.conflict(`Duplicate value for "${field}".`, {
      code: "DUPLICATE_KEY",
      details: err.keyValue,
    });
  } else if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {
    apiError = ApiError.unauthorized(err.message, { code: "JWT_ERROR" });
  } else {
    apiError = new ApiError(500, "Internal server error.", {
      code: "INTERNAL_ERROR",
    });
  }

  // Only log stack traces server-side; never expose them to the client.
  if (!apiError.isOperational || apiError.statusCode >= 500) {
    // eslint-disable-next-line no-console
    console.error("[error]", err?.stack ?? err);
  } else if (env.nodeEnv !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[error] ${apiError.statusCode} ${apiError.message}`);
  }

  const body = {
    status: "error",
    statusCode: apiError.statusCode,
    message: apiError.message,
  };
  if (apiError.code) body.code = apiError.code;
  if (apiError.details) body.details = apiError.details;

  res.status(apiError.statusCode).json(body);
}
