"use client";

/**
 * Chat page — thread management + streaming + RAG.
 *
 * Phase 6 wires this to real backend data:
 *   - `GET /api/chat/threads`  → sidebar history (with loading skeleton).
 *   - `GET /api/chat/:id`      → hydrate messages when selecting a thread.
 *   - `POST /api/chat`         → streamed turn (via `useChat`).
 *   - `POST /api/chat/title`   → auto-title the thread on the first turn.
 *   - `DELETE /api/chat/:id`   → remove threads from the sidebar.
 *
 * UX affordances:
 *   - Mobile hamburger + overlay for the sidebar.
 *   - User profile dropdown in the sidebar with a real logout.
 *   - Dismissable error banner at the top of the chat pane.
 */

import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatWindow } from "@/components/ChatWindow";
import { Sidebar } from "@/components/Sidebar";
import type { UploadResult } from "@/components/FileUpload";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  deleteChat as deleteChatApi,
  generateChatTitle,
  getChatById,
  listChats,
} from "@/services/chat.service";
import type { ChatSummary, Message } from "@/types";

interface ActivePdf {
  vectorId: string;
  filename: string;
}

export default function ChatPage() {
  const { refresh, status } = useAuth();

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activePdf, setActivePdf] = useState<ActivePdf | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // True when the next completed stream should trigger auto-titling.
  // Set to true when the user sends the first message on a new thread
  // and cleared once the title call returns.
  const needsTitleRef = useRef<boolean>(false);

  // Seed prompt for the auto-titler — the user's first message on the
  // current thread.
  const latestUserContentRef = useRef<string>("");

  // ----------------------------------------------------------- //
  // Initial thread list
  // ----------------------------------------------------------- //
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listChats();
        if (!cancelled) setChats(list);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[chat] failed to load threads:", err);
      } finally {
        if (!cancelled) setIsLoadingChats(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  // ----------------------------------------------------------- //
  // Streaming hook
  // ----------------------------------------------------------- //
  const handleDone = useCallback(
    (meta: {
      chatId: string | null;
      messageId: string | null;
      reply: string;
      provider: string | null;
      model: string | null;
    }) => {
      if (!meta.chatId) return;
      setActiveChatId((prev) => prev ?? meta.chatId);

      // Optimistically reflect the thread in the sidebar.
      setChats((prev) => {
        const now = new Date().toISOString();
        const exists = prev.some((c) => c.id === meta.chatId);
        if (exists) {
          // Bump to top on new activity.
          const bumped = prev.map((c) =>
            c.id === meta.chatId ? { ...c, updatedAt: now } : c
          );
          bumped.sort((a, b) =>
            (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
          );
          return bumped;
        }
        return [
          {
            id: meta.chatId as string,
            title: "New chat",
            active_pdf_id: activePdf?.vectorId ?? null,
            updatedAt: now,
            createdAt: now,
          },
          ...prev,
        ];
      });

      // Auto-title: first turn on a brand-new thread.
      if (needsTitleRef.current) {
        needsTitleRef.current = false;
        void autoTitle(meta.chatId as string);
      }
    },
    [activePdf]
  );

  const autoTitle = useCallback(async (chatId: string) => {
    const seed = latestUserContentRef.current;
    if (!seed) return;
    try {
      const title = await generateChatTitle(seed, chatId);
      if (!title) return;
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, title } : c))
      );
    } catch (err) {
      // Non-fatal — leave the title as "New chat".
      // eslint-disable-next-line no-console
      console.warn("[chat] auto-title failed:", err);
    }
  }, []);

  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    cancel,
    clear,
    clearError,
    loadMessages,
  } = useChat({
    chatId: activeChatId,
    activePdfId: activePdf?.vectorId ?? null,
    onDone: handleDone,
  });

  const handleSend = useCallback(
    async (content: string) => {
      latestUserContentRef.current = content;
      if (activeChatId === null) {
        // Flag this stream so `handleDone` can kick off an auto-title
        // once the server returns the new `chatId`.
        needsTitleRef.current = true;
      }
      await sendMessage(content);
    },
    [sendMessage, activeChatId]
  );

  // If the hook says we're unauthorized even after a refresh attempt,
  // ask the auth context to re-check — that flips status and the
  // chat-layout guard redirects to /login.
  useEffect(() => {
    if (error?.statusCode === 401 || error?.code === "UNAUTHORIZED") {
      void refresh();
    }
  }, [error, refresh]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  // ----------------------------------------------------------- //
  // Sidebar handlers
  // ----------------------------------------------------------- //
  const handleNewChat = useCallback(() => {
    cancel();
    clear();
    setActiveChatId(null);
    setActivePdf(null);
    needsTitleRef.current = false;
    latestUserContentRef.current = "";
    setSidebarOpen(false);
  }, [cancel, clear]);

  const handleSelectChat = useCallback(
    async (chatId: string) => {
      if (chatId === activeChatId) {
        setSidebarOpen(false);
        return;
      }

      cancel();
      clear();
      setActiveChatId(chatId);
      setSidebarOpen(false);
      setIsLoadingHistory(true);
      needsTitleRef.current = false;

      try {
        const chat = await getChatById(chatId);
        const history: Message[] = chat.messages.map((m) => ({
          id: m.id ?? undefined,
          role: m.role,
          content: m.content,
          provider: m.provider ?? undefined,
          model: m.model ?? undefined,
          createdAt: m.createdAt,
        }));
        loadMessages(history);
        // Restore RAG state.
        if (chat.active_pdf_id) {
          setActivePdf({
            vectorId: chat.active_pdf_id,
            filename: "Attached document",
          });
        } else {
          setActivePdf(null);
        }
        // Keep the sidebar title fresh in case the server generated one.
        if (chat.title) {
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId ? { ...c, title: chat.title ?? c.title } : c
            )
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[chat] failed to load history:", err);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [activeChatId, cancel, clear, loadMessages]
  );

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      const confirmed = window.confirm("Delete this chat permanently?");
      if (!confirmed) return;

      // Optimistic UI.
      const snapshot = chats;
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        cancel();
        clear();
        setActiveChatId(null);
        setActivePdf(null);
      }

      try {
        await deleteChatApi(chatId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[chat] failed to delete chat:", err);
        setChats(snapshot); // roll back
      }
    },
    [activeChatId, cancel, chats, clear]
  );

  const handleUploaded = useCallback((result: UploadResult) => {
    setActivePdf({
      vectorId: result.vectorId,
      filename: result.filename,
    });
  }, []);

  const handleClearPdf = useCallback(() => setActivePdf(null), []);

  const errorBanner = error ? formatError(error) : null;

  return (
    <>
      {/* Mobile sidebar overlay */}
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar
          chats={chats}
          activeChatId={activeChatId}
          isLoading={isLoadingChats}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-fg)]"
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <span className="truncate text-sm font-medium text-[var(--color-fg)]">
            {activeChat?.title ?? "New chat"}
          </span>
        </div>

        <ChatWindow
          title={activeChat?.title ?? "New chat"}
          chatId={activeChatId}
          messages={messages}
          isStreaming={isStreaming}
          isLoadingHistory={isLoadingHistory}
          activePdf={activePdf}
          errorBanner={errorBanner}
          onSend={handleSend}
          onStop={cancel}
          onUploaded={handleUploaded}
          onClearPdf={handleClearPdf}
          onDismissError={clearError}
        />
      </div>
    </>
  );
}

function formatError(error: {
  message: string;
  code?: string;
  statusCode?: number;
}): string {
  if (error.statusCode === 401 || error.code === "UNAUTHORIZED") {
    return "Session expired. Please sign in again.";
  }
  if (error.code === "GEMINI_QUOTA_EXHAUSTED") {
    return "Gemini's free-tier quota is exhausted. Try again after it resets or switch the model.";
  }
  if (
    error.code === "AI_SERVICE_UNREACHABLE" ||
    error.code === "AI_SERVICE_UNKNOWN" ||
    error.statusCode === 502 ||
    error.statusCode === 503
  ) {
    return "The AI service is offline. Please try again shortly.";
  }
  return error.message || "Something went wrong. Please try again.";
}
