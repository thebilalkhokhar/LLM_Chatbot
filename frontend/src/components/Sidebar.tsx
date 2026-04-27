"use client";

import {
  Check,
  ChevronUp,
  LogOut,
  MessageSquarePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "@/components/ui/Button";
import { EngineToggle } from "@/components/EngineToggle";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
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
  /**
   * Optional — commit a new title for a chat. The page is responsible
   * for the optimistic UI update and the actual API call. The Sidebar
   * only manages the inline-edit interaction.
   */
  onRenameChat?: (chatId: string, nextTitle: string) => void | Promise<void>;
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
  onRenameChat,
  engine,
  onEngineChange,
  engineLocked = false,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [editingChatId, setEditingChatId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.title ?? "").toLowerCase().includes(q));
  }, [chats, query]);

  const handleStartEdit = useCallback((chatId: string) => {
    setEditingChatId(chatId);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingChatId(null);
  }, []);

  const handleCommitRename = useCallback(
    async (chatId: string, nextTitle: string) => {
      setEditingChatId(null);
      if (!onRenameChat) return;
      const trimmed = nextTitle.trim();
      // Empty input → caller keeps the original title (no-op).
      if (!trimmed) return;
      const original = chats.find((c) => c.id === chatId)?.title ?? "";
      if (trimmed === original.trim()) return;
      await onRenameChat(chatId, trimmed);
    },
    [chats, onRenameChat]
  );

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[var(--color-fg)]">
          <Logo size="sm" aria-label="AI Gateway logo" />
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
            {filtered.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === activeChatId}
                editing={editingChatId === chat.id}
                canEdit={Boolean(onRenameChat)}
                onSelect={onSelectChat}
                onDelete={onDeleteChat}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onCommitRename={handleCommitRename}
              />
            ))}
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
// Chat row (memoized — high-frequency renders during streaming).
// ----------------------------------------------------------------- //

interface ChatRowProps {
  chat: ChatSummary;
  active: boolean;
  editing: boolean;
  canEdit: boolean;
  onSelect: (chatId: string) => void;
  onDelete?: (chatId: string) => void;
  onStartEdit: (chatId: string) => void;
  onCancelEdit: () => void;
  onCommitRename: (chatId: string, nextTitle: string) => void | Promise<void>;
}

const ChatRow = memo(function ChatRow({
  chat,
  active,
  editing,
  canEdit,
  onSelect,
  onDelete,
  onStartEdit,
  onCancelEdit,
  onCommitRename,
}: ChatRowProps) {
  const handleSelect = useCallback(() => {
    if (editing) return;
    onSelect(chat.id);
  }, [chat.id, editing, onSelect]);

  const handleStartEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEdit(chat.id);
    },
    [chat.id, onStartEdit]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete?.(chat.id);
    },
    [chat.id, onDelete]
  );

  const handleCommit = useCallback(
    (nextTitle: string) => {
      void onCommitRename(chat.id, nextTitle);
    },
    [chat.id, onCommitRename]
  );

  return (
    <li className="group/row relative">
      {editing ? (
        <ChatRowEditor
          initialTitle={chat.title || ""}
          onCommit={handleCommit}
          onCancel={onCancelEdit}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={handleSelect}
            onDoubleClick={canEdit ? handleStartEdit : undefined}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors",
              active
                ? "bg-[var(--color-surface)] text-[var(--color-fg)]"
                : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            )}
          >
            <span
              className={cn(
                "truncate text-sm font-medium",
                // Reserve space for the action buttons that fade in on hover.
                active && (canEdit || onDelete) ? "pr-14" : "pr-7"
              )}
            >
              {chat.title || "Untitled chat"}
            </span>
            <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
              {formatTime(chat.updatedAt ?? chat.createdAt)}
              {chat.active_pdf_id ? " · PDF attached" : ""}
            </span>
          </button>

          <div
            className={cn(
              "absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5",
              // Active row keeps actions visible; others fade in on hover.
              active
                ? "opacity-100"
                : "opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100"
            )}
          >
            {canEdit ? (
              <button
                type="button"
                onClick={handleStartEdit}
                aria-label="Rename chat"
                title="Rename chat"
                className={cn(
                  "rounded p-1 text-[var(--color-fg-subtle)]",
                  "hover:bg-[var(--color-bg)] hover:text-[var(--color-accent)]",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
                )}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                aria-label="Delete chat"
                title="Delete chat"
                className={cn(
                  "rounded p-1 text-[var(--color-fg-subtle)]",
                  "hover:bg-[var(--color-bg)] hover:text-[var(--color-danger)]",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </>
      )}
    </li>
  );
});

// ----------------------------------------------------------------- //
// Inline-edit input (Enter to save, Escape to cancel, blur to save).
// ----------------------------------------------------------------- //

interface ChatRowEditorProps {
  initialTitle: string;
  onCommit: (nextTitle: string) => void;
  onCancel: () => void;
}

function ChatRowEditor({ initialTitle, onCommit, onCancel }: ChatRowEditorProps) {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks whether commit/cancel was already triggered via keyboard or
  // button — prevents the blur handler from firing a second commit.
  const settledRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value);
  }, [onCommit, value]);

  const cancel = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  }, [onCancel]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    },
    [commit, cancel]
  );

  const handleSaveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      commit();
    },
    [commit]
  );

  const handleCancelClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      cancel();
    },
    [cancel]
  );

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-accent)]/40 bg-[var(--color-surface)] px-2 py-1.5",
        "shadow-[0_0_0_1px_var(--color-accent)]/20"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-sm text-[var(--color-fg)]",
          "outline-none placeholder:text-[var(--color-fg-subtle)]"
        )}
        placeholder="Chat title"
        aria-label="Chat title"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleSaveClick}
        aria-label="Save title"
        title="Save (Enter)"
        className={cn(
          "rounded p-1 text-[var(--color-accent)]",
          "hover:bg-[var(--color-accent)]/15",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleCancelClick}
        aria-label="Cancel rename"
        title="Cancel (Esc)"
        className={cn(
          "rounded p-1 text-[var(--color-fg-subtle)]",
          "hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
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
