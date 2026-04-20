/**
 * Wraps an async Express handler so thrown errors / rejected promises
 * are forwarded to the centralized error middleware via `next(err)`.
 *
 * Usage:
 *   router.get("/x", asyncHandler(async (req, res) => { ... }));
 */

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
