/**
 * Chat routes mounted at `/api/chat`.
 *
 * Every route is protected by the `verifyJWT` guard.
 */

import { Router } from "express";

import {
  deleteChat,
  getChat,
  listChats,
  sendMessage,
  updateChat,
} from "../controllers/chat.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.use(verifyJWT);

router.get("/", asyncHandler(listChats));
router.post("/", asyncHandler(sendMessage));

router.get("/:id", asyncHandler(getChat));
router.patch("/:id", asyncHandler(updateChat));
router.delete("/:id", asyncHandler(deleteChat));

export default router;
