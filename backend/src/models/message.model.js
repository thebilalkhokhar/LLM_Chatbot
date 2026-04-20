/**
 * Message subdocument schema.
 *
 * Mirrors the Python Pydantic `ChatMessage` model in
 * `ai-service/app/schemas/chat_schema.py`. Fields here MUST keep the
 * same names so the AI bridge service doesn't have to transform payloads.
 */

import mongoose from "mongoose";
import { MESSAGE_ROLE_VALUES } from "../config/constants.js";

const { Schema } = mongoose;

export const messageSchema = new Schema(
  {
    role: {
      type: String,
      enum: MESSAGE_ROLE_VALUES,
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    // Free-form dict matching the Python `context` bag (e.g. { pdf_id: "..." }).
    // `Schema.Types.Mixed` lets the caller attach anything without migrations.
    context: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    // Which LLM answered, when known. Useful for analytics / UI labels.
    provider: { type: String, default: null },
    model: { type: String, default: null },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);
