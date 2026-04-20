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
  active_pdf_id?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  status: "ok";
  user: User;
  accessToken: string;
}
