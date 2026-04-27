/**
 * Shared frontend types.
 *
 * These mirror the backend response shapes from the Node gateway.
 * Keep them in sync with:
 *   - backend/src/controllers/auth.controller.js   (user, accessToken)
 *   - backend/src/controllers/chat.controller.js   (chats, messages)
 *   - ai-service/app/schemas/chat_schema.py        (role enum)
 */

export type MessageRole = "system" | "user" | "assistant";

/**
 * Which LLM the user has selected for this chat.
 *
 * - ``"groq"``   → default. ``llama-3.3-70b-versatile`` via Groq Cloud.
 * - ``"gemini"`` → Google Gemini (``gemini-2.5-flash-lite``).
 *
 * The Python service auto-falls-back to the other provider if the
 * preferred one is unreachable.
 */
export type EngineId = "groq" | "gemini";

export const DEFAULT_ENGINE: EngineId = "groq";

export interface User {
  id: string;
  email: string;
  username: string;
  createdAt?: string;
}

export interface Message {
  id?: string;
  role: MessageRole;
  content: string;
  provider?: string | null;
  model?: string | null;
  createdAt?: string;
  /** True while the assistant is still streaming tokens (client-side only). */
  pending?: boolean;
}

export interface ChatSummary {
  id: string;
  title: string;
  /** True once the user has manually renamed the chat. */
  titleLocked?: boolean;
  active_pdf_id?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  status: "ok";
  user: User;
  accessToken: string;
}
