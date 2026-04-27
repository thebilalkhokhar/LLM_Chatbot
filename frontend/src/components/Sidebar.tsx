"use client";

import {
  ChevronUp,
  LogOut,
  MessageSquarePlus,
  Plus,
  Search,
  Sparkles,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EngineToggle } from "@/components/EngineToggle";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import { cn, formatTime } from "@/lib/utils";
import type { ChatSummary, EngineId } from "@/types";

interface SidebarProps {
  chats: ChatSummary[];
  activeChatId?: string | null;
  /** True while we're fetching chats for the first time. */
  isLoading?: boolean;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  /** Optional — right-click / menu entry to delete a chat. */
  onDeleteChat?: (chatId: string) => void;
  /** Active LLM toggle (Groq by default, Gemini when toggled). */
  engine: EngineId;
  onEngineChange: (next: EngineId) => void;
  /** When true (e.g. mid-stream) the engine toggle is locked. */
  engineLocked?: boolean;
}

export function Sidebar({
  chats,
  activeChatId,
  isLoading = false,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  engine,
  onEngineChange,
  engineLocked = false,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.title ?? "").toLowerCase().includes(q));
  }, [chats, query]);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[var(--color-fg)]">
          <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
          <span className="text-sm font-medium tracking-wide">AI Gateway</span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          title="New chat"
          onClick={onNewChat}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2 px-3 py-3">
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span>New chat</span>
        </Button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="pl-9"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isLoading ? (
          <SidebarSkeleton />
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
            {chats.length === 0
              ? "No chats yet. Start a new conversation."
              : "No chats match that search."}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((chat) => {
              const active = chat.id === activeChatId;
              return (
                <li key={chat.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => onSelectChat(chat.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors",
                      active
                        ? "bg-[var(--color-surface)] text-[var(--color-fg)]"
                        : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                    )}
                  >
                    <span className="truncate pr-7 text-sm font-medium">
                      {chat.title || "Untitled chat"}
                    </span>
                    <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                      {formatTime(chat.updatedAt ?? chat.createdAt)}
                      {chat.active_pdf_id ? " · PDF attached" : ""}
                    </span>
                  </button>
                  {onDeleteChat ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat.id);
                      }}
                      aria-label="Delete chat"
                      title="Delete chat"
                      className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-fg-subtle)] opacity-0 transition-opacity",
                        "hover:bg-[var(--color-bg)] hover:text-[var(--color-danger)]",
                        "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]",
                        "group-hover/row:opacity-100"
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="space-y-3 border-t border-[var(--color-border)] px-3 py-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Model engine
            </span>
            {engineLocked ? (
              <span
                className="text-[9px] uppercase tracking-wider text-[var(--color-fg-subtle)]"
                title="Locked while a response is streaming"
              >
                Locked
              </span>
            ) : null}
          </div>
          <EngineToggle
            value={engine}
            onChange={onEngineChange}
            disabled={engineLocked}
          />
        </div>
        <UserMenu
          username={user?.username ?? null}
          email={user?.email ?? null}
          onLogout={() => void logout()}
        />
      </div>
    </aside>
  );
}

// ----------------------------------------------------------------- //
// Skeleton / Loading
// ----------------------------------------------------------------- //

function SidebarSkeleton() {
  return (
    <ul className="space-y-0.5 px-1" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="flex flex-col gap-1.5 rounded-[var(--radius-md)] px-3 py-2.5"
        >
          <div
            className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-surface)]"
            style={{ animationDelay: `${i * 60}ms` }}
          />
          <div
            className="h-2 w-1/2 animate-pulse rounded bg-[var(--color-surface)]"
            style={{ animationDelay: `${i * 60 + 30}ms` }}
          />
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------------- //
// User profile dropdown (click to open / close; closes on outside click).
// ----------------------------------------------------------------- //

interface UserMenuProps {
  username: string | null;
  email: string | null;
  onLogout: () => void;
}

function UserMenu({ username, email, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initials =
    (username ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleLogout = useCallback(() => {
    setOpen(false);
    onLogout();
  }, [onLogout]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors",
          "hover:bg-[var(--color-surface)]",
          open && "bg-[var(--color-surface)]"
        )}
      >
        <div
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-fg)]"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--color-fg)]">
            {username ?? "Signed in"}
          </div>
          <div className="truncate text-[11px] text-[var(--color-fg-subtle)]">
            {email ?? ""}
          </div>
        </div>
        <ChevronUp
          className={cn(
            "h-4 w-4 text-[var(--color-fg-subtle)] transition-transform",
            !open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute bottom-[calc(100%+6px)] left-0 right-0 z-10",
            "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-1 shadow-lg"
          )}
        >
          <div className="border-b border-[var(--color-border)] px-3 py-2">
            <div className="truncate text-sm font-medium text-[var(--color-fg)]">
              {username ?? "Signed in"}
            </div>
            <div className="truncate text-[11px] text-[var(--color-fg-subtle)]">
              {email ?? ""}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
          >
            <UserIcon className="h-4 w-4" />
            Profile
            <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
              Soon
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
