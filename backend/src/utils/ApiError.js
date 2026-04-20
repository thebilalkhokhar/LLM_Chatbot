/**
 * Operational error class used throughout the API layer.
 *
 * Controllers / services throw an `ApiError` whenever they want the
 * centralized error middleware to serialise a specific HTTP status and
 * message. Anything else that propagates is treated as a 500.
 */

export class ApiError extends Error {
  constructor(statusCode, message, { code = undefined, details = undefined } = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message, extras) {
    return new ApiError(400, message, extras);
  }

  static unauthorized(message = "Unauthorized", extras) {
    return new ApiError(401, message, extras);
  }

  static forbidden(message = "Forbidden", extras) {
    return new ApiError(403, message, extras);
  }

  static notFound(message = "Not Found", extras) {
    return new ApiError(404, message, extras);
  }

  static conflict(message, extras) {
    return new ApiError(409, message, extras);
  }

  static badGateway(message = "Upstream service error", extras) {
    return new ApiError(502, message, extras);
  }

  static serviceUnavailable(message = "Service unavailable", extras) {
    return new ApiError(503, message, extras);
  }
}
