/**
 * Shared constants.
 *
 * The `MESSAGE_ROLES` enum is kept 1:1 with
 * `ai-service/app/schemas/chat_schema.py`:
 *   Literal["system", "user", "assistant"]
 * Any change on one side MUST be mirrored on the other.
 */

export const MESSAGE_ROLES = Object.freeze({
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
});

export const MESSAGE_ROLE_VALUES = Object.freeze(Object.values(MESSAGE_ROLES));

export const REFRESH_COOKIE_NAME = "refreshToken";

export const SSE_EVENTS = Object.freeze({
  START: "start",
  REPLY: "reply",
  TOKEN: "token",
  ERROR: "error",
  DONE: "done",
});

export const PASSWORD_MIN_LENGTH = 8;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
