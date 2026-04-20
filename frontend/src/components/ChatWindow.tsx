"use client";

import {
  FileText,
  SendHorizonal,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/Button";
import { FileUpload, type UploadResult } from "@/components/FileUpload";
import { MessageBubble } from "@/components/MessageBubble";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

interface ActivePdf {
  vectorId: string;
  filename: string;
}

interface ChatWindowProps {
  messages: Message[];
  title?: string;
  chatId?: string | null;
  isStreaming?: boolean;
  /** True while the page is hydrating a newly-selected thread. */
  isLoadingHistory?: boolean;
  activePdf?: ActivePdf | null;
  errorBanner?: string | null;
  onSend: (content: string) => void | Promise<void>;
  onStop?: () => void;
  onUploaded: (result: UploadResult) => void;
  onClearPdf?: () => void;
  onDismissError?: () => void;
}

export function ChatWindow({
  messages,
  title = "New chat",
  chatId = null,
  isStreaming = false,
  isLoadingHistory = false,
  activePdf = null,
  errorBanner = null,
  onSend,
  onStop,
  onUploaded,
  onClearPdf,
  onDismissError,
}: ChatWindowProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Track whether the user is "stuck" to the bottom. If they scroll up
  // we stop auto-following, so token streaming doesn't fight them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const threshold = 40;
      stickToBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll as messages grow (streaming tokens, new turns).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? "auto" : "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 200);
    el.style.height = `${next}px`;
  }, [draft]);

  function submit() {
    const content = draft.trim();
    if (!content || isStreaming) return;
    setDraft("");
    stickToBottomRef.current = true;
    void onSend(content);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const showEmpty = messages.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-bg)]">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
          <h2 className="truncate text-sm font-medium text-[var(--color-fg)]">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {activePdf ? (
            <span
              className="flex max-w-[14rem] items-center gap-1.5 rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-[11px] text-[var(--color-accent)]"
              title={activePdf.filename}
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{activePdf.filename}</span>
              {onClearPdf ? (
                <button
                  type="button"
                  onClick={onClearPdf}
                  aria-label="Detach PDF"
                  className="ml-1 rounded-full p-0.5 hover:bg-[var(--color-accent)]/20"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ) : null}
          {isStreaming ? (
            <span className="hidden items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)] sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
              Streaming
            </span>
          ) : null}
        </div>
      </header>

      {errorBanner ? (
        <div className="border-b border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-2 text-xs text-[var(--color-danger)] sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-3">
            <span className="break-words">{errorBanner}</span>
            {onDismissError ? (
              <button
                type="button"
                onClick={onDismissError}
                aria-label="Dismiss error"
                className="shrink-0 rounded p-0.5 hover:bg-[var(--color-danger)]/20"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
      >
        {isLoadingHistory ? (
          <MessagesSkeleton />
        ) : showEmpty ? (
          <EmptyState onUploaded={onUploaded} chatId={chatId} />
        ) : (
          <div className="mx-auto w-full max-w-3xl py-4">
            {messages.map((m, i) => (
              <MessageBubble key={m.id ?? `msg-${i}`} message={m} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-3 sm:px-4 sm:py-4">
        <form
          onSubmit={handleSubmit}
          className={cn(
            "mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 transition-colors",
            "focus-within:border-[var(--color-border-strong)]"
          )}
        >
          <FileUpload compact chatId={chatId} onUploaded={onUploaded} />

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Generating…"
                : activePdf
                  ? "Ask a question about the attached PDF…"
                  : "Send a message… (Shift + Enter for new line)"
            }
            rows={1}
            disabled={isStreaming}
            className={cn(
              "min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-[var(--color-fg)]",
              "placeholder:text-[var(--color-fg-subtle)] focus:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          />

          {isStreaming && onStop ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={isStreaming || draft.trim().length === 0}
              aria-label="Send message"
              title="Send"
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          )}
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-[var(--color-fg-subtle)]">
          Responses are generated by an LLM and may be inaccurate. Verify before
          relying on them.
        </p>
      </div>
    </section>
  );
}

function MessagesSkeleton() {
  const rows = [
    { w: "55%", side: "right" as const },
    { w: "80%", side: "left" as const },
    { w: "40%", side: "right" as const },
    { w: "70%", side: "left" as const },
  ];
  return (
    <div
      className="mx-auto w-full max-w-3xl space-y-4 py-6"
      aria-hidden
      aria-label="Loading conversation"
    >
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-3 px-4",
            r.side === "right" ? "flex-row-reverse" : ""
          )}
        >
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--color-surface)]" />
          <div
            className="h-14 animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-surface)]"
            style={{ width: r.w, animationDelay: `${i * 80}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  onUploaded,
  chatId,
}: {
  onUploaded: (result: UploadResult) => void;
  chatId: string | null;
}) {
  const prompts = [
    "Summarize the key points of the uploaded document.",
    "Explain this concept like I'm a senior engineer.",
    "Draft a concise release note for a new feature.",
  ];

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]">
        <Sparkles className="h-5 w-5 text-[var(--color-accent)]" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-xl font-semibold text-[var(--color-fg)]">
          How can I help you today?
        </h3>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Ask anything, or attach a PDF for grounded answers.
        </p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-3">
        {prompts.map((p) => (
          <div
            key={p}
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left text-xs text-[var(--color-fg-muted)]"
          >
            {p}
          </div>
        ))}
      </div>
      <div className="w-full max-w-md">
        <FileUpload onUploaded={onUploaded} chatId={chatId} />
      </div>
    </div>
  );
}
