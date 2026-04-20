/**
 * Chat routes mounted at `/api/chat`.
 *
 * Every route is protected by the `verifyJWT` guard.
 */

import { Router } from "express";

import {
  deleteChat,
  generateChatTitle,
  getChat,
  listChats,
  sendMessage,
  updateChat,
  uploadPdf,
} from "../controllers/chat.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.use(verifyJWT);

router.get("/", asyncHandler(listChats));
router.post("/", asyncHandler(sendMessage));

// NOTE: keep these literal paths ABOVE the `/:id` routes so Express
// doesn't treat "threads" / "upload" / "title" as chat ids.
router.get("/threads", asyncHandler(listChats));
router.post("/upload", asyncHandler(uploadPdf));
router.post("/title", asyncHandler(generateChatTitle));

router.get("/:id", asyncHandler(getChat));
router.patch("/:id", asyncHandler(updateChat));
router.delete("/:id", asyncHandler(deleteChat));

export default router;
