/**
 * AI Bridge service.
 *
 * Responsibilities:
 *   - Translate a chat's MongoDB message history into the exact shape
 *     the Python `/chat` endpoint expects (role/content/context).
 *   - Call the Python AI service with a small retry loop for transient
 *     failures (network hiccups, cold starts).
 *   - Support TWO response modes:
 *       1. `generateAIResponse` — eager: returns the parsed JSON reply.
 *       2. `streamAIResponse`  — pipes the raw axios stream back to the
 *          caller so the HTTP layer can emit Server-Sent Events.
 *
 * The Python service currently returns JSON (not SSE), but using
 * `responseType: "stream"` keeps this module forward-compatible with
 * a future streaming backend without requiring any controller changes.
 */

import axios from "axios";

import { env } from "../config/env.js";
import { MESSAGE_ROLES } from "../config/constants.js";
import { ApiError } from "../utils/ApiError.js";

const AI_CHAT_URL = `${env.aiService.url}/chat`;

/**
 * Convert internal DB messages to the Python schema.
 * Anything with an unknown role falls back to `user`.
 */
export function mapMessagesToPython(messages = []) {
  return messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({
      role: Object.values(MESSAGE_ROLES).includes(m.role) ? m.role : MESSAGE_ROLES.USER,
      content: m.content,
    }));
}

/**
 * Build the full JSON body sent to Python.
 */
export function buildChatPayload({ messages, context = {}, activePdfId = null }) {
  const payload = {
    messages: mapMessagesToPython(messages),
    context: { ...context },
  };
  if (activePdfId && !payload.context.pdf_id) {
    payload.context.pdf_id = activePdfId;
  }
  return payload;
}

const RETRY_ABLE_NET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

function isRetryable(error) {
  if (!error) return false;
  if (error.response) {
    // 5xx from the AI service are worth retrying; 4xx are not.
    return error.response.status >= 500 && error.response.status < 600;
  }
  if (error.code && RETRY_ABLE_NET_CODES.has(error.code)) return true;
  // axios marks timeouts as ECONNABORTED.
  if (error.code === "ECONNABORTED") return true;
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callWithRetry(axiosConfig) {
  const maxAttempts = Math.max(1, env.aiService.retries);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await axios(axiosConfig);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) break;
      const delay = env.aiService.retryDelayMs * 2 ** (attempt - 1);
      // eslint-disable-next-line no-console
      console.warn(
        `[ai.service] attempt ${attempt}/${maxAttempts} failed (${
          error.code ?? error.response?.status ?? "unknown"
        }); retrying in ${delay}ms…`
      );
      await sleep(delay);
    }
  }

  throw normalizeUpstreamError(lastError);
}

function normalizeUpstreamError(error) {
  if (!error) return ApiError.badGateway("AI service unavailable.");
  if (error.response) {
    const status = error.response.status;
    const detail =
      error.response.data?.detail ??
      error.response.data?.message ??
      error.response.statusText;
    // Preserve semantic 4xx upstream so the frontend can surface it.
    const mapped = status >= 400 && status < 500 ? status : 502;
    return new ApiError(mapped, `AI service error: ${detail}`, {
      code: "AI_SERVICE_UPSTREAM_ERROR",
    });
  }
  if (error.code && RETRY_ABLE_NET_CODES.has(error.code)) {
    return ApiError.serviceUnavailable(
      `AI service unreachable (${error.code}).`,
      { code: "AI_SERVICE_UNREACHABLE" }
    );
  }
  return ApiError.badGateway(`AI service call failed: ${error.message}`, {
    code: "AI_SERVICE_UNKNOWN",
  });
}

/**
 * Eager call — returns the parsed JSON reply from Python.
 * Suitable for callers that don't need streaming.
 */
export async function generateAIResponse({
  messages,
  context = {},
  activePdfId = null,
} = {}) {
  const payload = buildChatPayload({ messages, context, activePdfId });

  const response = await callWithRetry({
    method: "POST",
    url: AI_CHAT_URL,
    data: payload,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    timeout: env.aiService.timeoutMs,
  });

  return response.data;
}

/**
 * Streaming call — returns the axios response so the controller can
 * pipe `response.data` into an SSE frame per chunk.
 * The caller is responsible for terminating the outbound response.
 */
export async function streamAIResponse({
  messages,
  context = {},
  activePdfId = null,
} = {}) {
  const payload = buildChatPayload({ messages, context, activePdfId });

  const response = await callWithRetry({
    method: "POST",
    url: AI_CHAT_URL,
    data: payload,
    responseType: "stream",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    timeout: env.aiService.timeoutMs,
  });

  return response;
}

export const aiServiceConfig = Object.freeze({
  url: env.aiService.url,
  chatUrl: AI_CHAT_URL,
});
