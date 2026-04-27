/**
 * Chat model (a conversation thread owned by a single user).
 *
 * `messages` is an ordered array of `messageSchema` subdocuments.
 * `active_pdf_id` tracks which FAISS index the Python retriever should
 * use for the next /chat turn; it maps 1:1 to the `pdf_id` the Python
 * schema reads from `context`.
 */

import mongoose from "mongoose";
import { messageSchema } from "./message.model.js";

const { Schema } = mongoose;

const chatSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: "New Chat",
      maxlength: 200,
    },
    // Set to `true` once the user manually renames the chat. Locked
    // titles are protected from the LLM-driven auto-titler that fires
    // after the first message of a new thread.
    titleLocked: {
      type: Boolean,
      default: false,
    },
    messages: {
      type: [messageSchema],
      default: () => [],
    },
    // Matches the Python side's `context.pdf_id`. Stored at the thread
    // level so the client doesn't have to resend it on every turn.
    active_pdf_id: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

chatSchema.index({ userId: 1, updatedAt: -1 });

export const Chat = mongoose.model("Chat", chatSchema);
