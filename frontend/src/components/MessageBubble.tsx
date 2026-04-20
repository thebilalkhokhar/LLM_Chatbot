"use client";

import { memo, useState } from "react";
import { Bot, Check, Copy, User as UserIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { cn } from "@/lib/utils";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
}

/**
 * A VS Code-ish dark background behind code blocks. The Prism `oneDark`
 * theme already ships with good syntax colors; we just tweak the
 * wrapper chrome.
 */
function CodeBlock({
  language,
  value,
}: {
  language: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on non-HTTPS; no-op.
    }
  };

  return (
    <div className="group relative mb-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#0b1120] last:mb-0">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-[10px] text-[var(--color-fg-subtle)] transition hover:border-[var(--color-border)] hover:text-[var(--color-fg)]"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "12px 14px",
          background: "transparent",
          fontSize: "0.85em",
          lineHeight: 1.55,
        }}
        codeTagProps={{
          style: { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
        }}
      >
        {value.replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="mb-3 leading-relaxed last:mb-0">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--color-accent)] underline underline-offset-2 hover:text-[var(--color-accent-hover)]"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-6 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-6 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-lg font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-sm font-semibold">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-[var(--color-border-strong)] pl-3 italic text-[var(--color-fg-muted)] last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-[var(--color-border)]" />,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--color-border)] px-2 py-1">
      {children}
    </td>
  ),
  code(props) {
    const { inline, className, children, ...rest } = props as {
      inline?: boolean;
      className?: string;
      children?: React.ReactNode;
    };
    const text = Array.isArray(children)
      ? children.join("")
      : String(children ?? "");

    // `react-markdown` passes `inline: true` for backtick-quoted spans.
    if (inline) {
      return (
        <code
          className="rounded bg-[var(--color-bg-subtle)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--color-fg)]"
          {...rest}
        >
          {children}
        </code>
      );
    }

    const match = /language-([\w-]+)/.exec(className ?? "");
    const language = match?.[1] ?? "";
    return <CodeBlock language={language} value={text} />;
  },
  // Prism builds its own <pre>, so we return children untouched here.
  pre: ({ children }) => <>{children}</>,
};

function MessageBubbleImpl({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex w-full gap-3 px-4 py-4",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[var(--color-fg-muted)]",
          isUser
            ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)]",
          // Subtle pulse while waiting for the first token (TTFT).
          !isUser && message.pending && !message.content
            ? "animate-pulse"
            : ""
        )}
        aria-hidden
      >
        {isUser ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1 sm:max-w-[75%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-[var(--radius-lg)] px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
              : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]"
          )}
        >
          {isUser ? (
            message.content
          ) : message.content ? (
            <div className="markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {message.content}
              </ReactMarkdown>
              {message.pending ? (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-3 w-[2px] translate-y-[2px] animate-pulse bg-current align-baseline"
                />
              ) : null}
            </div>
          ) : message.pending ? (
            <TypingDots />
          ) : null}
        </div>

        {!isUser && (message.provider || message.model) && !message.pending ? (
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
            {message.provider ? <span>{message.provider}</span> : null}
            {message.provider && message.model ? <span>·</span> : null}
            {message.model ? <span>{message.model}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label="Assistant is thinking"
    >
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

/**
 * Re-render only when the message actually changed. This is critical
 * during streaming: every token update triggers a new render of the
 * parent list, but memoized bubbles whose content is unchanged bail
 * out — only the last (streaming) bubble re-renders.
 */
export const MessageBubble = memo(MessageBubbleImpl, (prev, next) => {
  const a = prev.message;
  const b = next.message;
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.content === b.content &&
    a.pending === b.pending &&
    a.provider === b.provider &&
    a.model === b.model
  );
});
