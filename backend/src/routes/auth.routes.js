/**
 * Auth routes mounted at `/api/auth`.
 */

import { Router } from "express";

import {
  login,
  logout,
  me,
  refresh,
  signup,
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/signup", asyncHandler(signup));
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));
router.post("/logout", asyncHandler(logout));

// Convenience endpoint for the frontend to check an access token.
router.get("/me", verifyJWT, asyncHandler(me));

export default router;
