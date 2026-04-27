"use client";

/**
 * EngineToggle — segmented switch for choosing the active LLM provider.
 *
 *   ┌──────────────┬──────────────┐
 *   │   Groq ⚡    │  Gemini ✨   │
 *   └──────────────┴──────────────┘
 *
 * The toggle is a controlled component: the parent owns the `value`
 * state and decides how to persist it (today: in-memory + sessionStorage
 * via `useEngine`). The component is intentionally compact so it fits
 * into the sidebar footer without crowding the user menu.
 */

import { Sparkles, Zap } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";
import type { EngineId } from "@/types";

interface EngineToggleProps {
  value: EngineId;
  onChange: (next: EngineId) => void;
  /** When true the toggle is disabled (e.g. while a stream is running). */
  disabled?: boolean;
  className?: string;
}

interface Option {
  id: EngineId;
  label: string;
  Icon: typeof Zap;
  /** Tailwind classes to use when this option is the active one. */
  activeClass: string;
}

const OPTIONS: readonly Option[] = [
  {
    id: "groq",
    label: "Groq",
    Icon: Zap,
    // Warm orange/yellow for Groq.
    activeClass:
      "bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/40",
  },
  {
    id: "gemini",
    label: "Gemini",
    Icon: Sparkles,
    // Violet for Gemini.
    activeClass:
      "bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/40",
  },
] as const;

export function EngineToggle({
  value,
  onChange,
  disabled = false,
  className,
}: EngineToggleProps) {
  const groupId = useId();

  return (
    <div
      role="radiogroup"
      aria-label="Model engine"
      aria-disabled={disabled || undefined}
      className={cn(
        "flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] p-1",
        disabled && "pointer-events-none opacity-60",
        className
      )}
    >
      {OPTIONS.map((opt) => {
        const active = opt.id === value;
        const Icon = opt.Icon;
        return (
          <button
            key={opt.id}
            id={`${groupId}-${opt.id}`}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
              active
                ? opt.activeClass
                : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
