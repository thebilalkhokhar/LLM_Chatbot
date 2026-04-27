"use client";

/**
 * useChat — streaming chat controller.
 *
 * Responsibilities:
 *   - Holds the message list for the current chat.
 *   - `sendMessage(content)` opens `POST /api/chat`, reads the SSE
 *     stream with the Fetch API, and updates the last assistant
 *     message token-by-token for a "typing" feel.
 *   - Handles 401 transparently: if the gateway rejects the call,
 *     we run the shared single-flight refresh and retry once.
 *   - Exposes lifecycle flags (`isStreaming`, `error`) so the UI can
 *     render spinners / error banners.
 *   - `cancel()` aborts the in-flight stream; `clear()` resets state
 *     (used when switching to a different chat).
 *
 * Wire protocol (matches backend/src/controllers/chat.controller.js):
 *
 *   event: start   data: { provider, model }
 *   event: token   data: { delta: "..." }      // 0+ times
 *   event: done    data: { chatId, messageId, reply, provider, model, next_step }
 *   event: error   data: { message, code, statusCode }
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  apiUrl,
  getAccessToken,
  refreshAccessToken,
} from "@/lib/api-client";
import { parseSse } from "@/lib/sse";
import type { EngineId, Message } from "@/types";
import { DEFAULT_ENGINE } from "@/types";

export interface ChatError {
  message: string;
  code?: string;
  statusCode?: number;
}

export interface UseChatOptions {
  /** Initial history, e.g. when opening an existing chat. */
  initialMessages?: Message[];
  /** Current chat id (continues a thread) — optional for new chats. */
  chatId?: string | null;
  /** Active RAG PDF id (mirrors the backend `active_pdf_id`). */
  activePdfId?: string | null;
  /** LLM toggle. Defaults to Groq. */
  engine?: EngineId;
  /** Called once the stream finishes successfully. */
  onDone?: (meta: {
    chatId: string | null;
    messageId: string | null;
    reply: string;
    provider: string | null;
    model: string | null;
  }) => void;
}

export interface UseChatReturn {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isStreaming: boolean;
  error: ChatError | null;
  sendMessage: (content: string) => Promise<void>;
  cancel: () => void;
  clear: () => void;
  clearError: () => void;
  /**
   * Replace the current messages with the given history. Cancels any
   * in-flight stream first — use when the user selects a different
   * thread from the sidebar.
   */
  loadMessages: (history: Message[]) => void;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    initialMessages = [],
    chatId = null,
    activePdfId = null,
    engine = DEFAULT_ENGINE,
    onDone,
  } = options;

  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);

  // Keep the latest values available inside the closure without
  // re-creating `sendMessage` on every render.
  const chatIdRef = useRef(chatId);
  const pdfRef = useRef(activePdfId);
  const engineRef = useRef<EngineId>(engine);
  const onDoneRef = useRef(onDone);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);
  useEffect(() => {
    pdfRef.current = activePdfId;
  }, [activePdfId]);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // Cancel any in-flight stream when the component unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const clear = useCallback(() => {
    cancel();
    setMessages([]);
    setError(null);
  }, [cancel]);

  const loadMessages = useCallback(
    (history: Message[]) => {
      cancel();
      setError(null);
      setMessages(history);
    },
    [cancel]
  );

  const clearError = useCallback(() => setError(null), []);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isStreaming) return;

      setError(null);

      const userMessage: Message = {
        id: `local-${Date.now()}`,
        role: "user",
        content: trimmed,
      };
      const placeholder: Message = {
        id: `pending-${Date.now()}`,
        role: "assistant",
        content: "",
        pending: true,
      };

      setMessages((prev) => [...prev, userMessage, placeholder]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const body = JSON.stringify({
        content: trimmed,
        chatId: chatIdRef.current ?? undefined,
        pdf_id: pdfRef.current ?? undefined,
        use_gemini: engineRef.current === "gemini",
      });

      const buildInit = (token: string | null): RequestInit => ({
        method: "POST",
        credentials: "include",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });

      const endpoint = apiUrl("/chat");

      try {
        let response = await fetch(endpoint, buildInit(getAccessToken()));

        if (response.status === 401) {
          const fresh = await refreshAccessToken();
          if (!fresh) {
            throw Object.assign(new Error("Session expired. Please sign in again."), {
              code: "UNAUTHORIZED",
              statusCode: 401,
            });
          }
          response = await fetch(endpoint, buildInit(fresh));
        }

        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => "");
          throw Object.assign(
            new Error(
              text || `Request failed with status ${response.status}.`
            ),
            { statusCode: response.status }
          );
        }

        await consumeStream({
          stream: response.body,
          signal: controller.signal,
          onToken: (delta) => {
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role !== "assistant") return prev;
              next[next.length - 1] = {
                ...last,
                content: last.content + delta,
                pending: true,
              };
              return next;
            });
          },
          onStart: (provider, model) => {
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role !== "assistant") return prev;
              next[next.length - 1] = { ...last, provider, model };
              return next;
            });
          },
          onDone: (meta) => {
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role !== "assistant") return prev;
              next[next.length - 1] = {
                ...last,
                id: meta.messageId ?? last.id,
                content: meta.reply || last.content,
                provider: meta.provider ?? last.provider,
                model: meta.model ?? last.model,
                pending: false,
              };
              return next;
            });
            onDoneRef.current?.(meta);
          },
          onError: (err) => {
            setError(err);
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant" && last.pending) {
                // Drop the empty placeholder; surface error via banner.
                next.pop();
              }
              return next;
            });
          },
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const last = next[next.length - 1];
            if (last.role === "assistant" && last.pending) {
              next[next.length - 1] = {
                ...last,
                content: last.content || "(cancelled)",
                pending: false,
              };
            }
            return next;
          });
        } else {
          const e = err as ChatError & Error;
          setError({
            message: e.message || "Network error. Please try again.",
            code: e.code,
            statusCode: e.statusCode,
          });
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const last = next[next.length - 1];
            if (last.role === "assistant" && last.pending) next.pop();
            return next;
          });
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [isStreaming]
  );

  return {
    messages,
    setMessages,
    isStreaming,
    error,
    sendMessage,
    cancel,
    clear,
    clearError,
    loadMessages,
  };
}

// ----------------------------------------------------------------- //
// Internal: drain the SSE stream and fan events out to callbacks.
// ----------------------------------------------------------------- //

interface ConsumeStreamArgs {
  stream: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
  onStart: (provider: string | null, model: string | null) => void;
  onToken: (delta: string) => void;
  onDone: (meta: {
    chatId: string | null;
    messageId: string | null;
    reply: string;
    provider: string | null;
    model: string | null;
  }) => void;
  onError: (err: ChatError) => void;
}

async function consumeStream({
  stream,
  signal,
  onStart,
  onToken,
  onDone,
  onError,
}: ConsumeStreamArgs): Promise<void> {
  for await (const frame of parseSse(stream, signal)) {
    let payload: Record<string, unknown> = {};
    try {
      payload = frame.data ? JSON.parse(frame.data) : {};
    } catch {
      // Ignore malformed frames.
    }

    switch (frame.event) {
      case "start": {
        const provider = (payload.provider as string | undefined) ?? null;
        const model = (payload.model as string | undefined) ?? null;
        onStart(provider, model);
        break;
      }
      case "token": {
        const delta = typeof payload.delta === "string" ? payload.delta : "";
        if (delta) onToken(delta);
        break;
      }
      case "done": {
        onDone({
          chatId: (payload.chatId as string | undefined) ?? null,
          messageId: (payload.messageId as string | undefined) ?? null,
          reply: (payload.reply as string | undefined) ?? "",
          provider: (payload.provider as string | undefined) ?? null,
          model: (payload.model as string | undefined) ?? null,
        });
        return;
      }
      case "error": {
        onError({
          message:
            (payload.message as string | undefined) ??
            "Upstream service error.",
          code: payload.code as string | undefined,
          statusCode: payload.statusCode as number | undefined,
        });
        return;
      }
      default:
        break;
    }
  }
}
