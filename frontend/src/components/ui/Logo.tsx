/**
 * Brand logo.
 *
 * Renders the 🤖 emoji inside a soft amber→violet gradient chip so it
 * reads as a real mark rather than a stray emoji. The component is
 * size-agnostic — pass `size="sm" | "md" | "lg"` (or a number for a
 * one-off pixel size) and it scales the chip and the glyph together.
 *
 * Used in:
 *   - Sidebar header
 *   - Chat window header + empty state
 *   - Login / signup card headers
 *
 * Note: The Gemini-flavored Sparkles icon used by the engine toggle and
 * the "Powered by Gemini" badge is intentionally NOT this logo — those
 * are provider brand marks, not the app's own.
 */

import { cn } from "@/lib/utils";

type LogoSize = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<LogoSize, { box: string; glyph: string; radius: string }> = {
  sm: { box: "h-5 w-5", glyph: "text-[12px]", radius: "rounded-md" },
  md: { box: "h-7 w-7", glyph: "text-[16px]", radius: "rounded-md" },
  lg: { box: "h-10 w-10", glyph: "text-[22px]", radius: "rounded-lg" },
  xl: { box: "h-12 w-12", glyph: "text-[28px]", radius: "rounded-lg" },
};

interface LogoProps {
  size?: LogoSize;
  /** Skip the gradient chip and just render the bare emoji glyph. */
  bare?: boolean;
  className?: string;
  /**
   * Decorative by default. If the logo is the only label for the
   * surrounding control, pass an `aria-label` so screen readers
   * announce it.
   */
  "aria-label"?: string;
}

export function Logo({
  size = "md",
  bare = false,
  className,
  "aria-label": ariaLabel,
}: LogoProps) {
  const { box, glyph, radius } = SIZE_MAP[size];

  if (bare) {
    return (
      <span
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
        className={cn(
          "inline-flex select-none items-center justify-center leading-none",
          glyph,
          className
        )}
      >
        🤖
      </span>
    );
  }

  return (
    <span
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center",
        "border border-[var(--color-border)]",
        // Subtle amber→violet wash that matches the engine-toggle accents.
        "bg-gradient-to-br from-amber-500/15 via-transparent to-violet-500/15",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]",
        box,
        radius,
        className
      )}
    >
      <span className={cn("leading-none", glyph)}>🤖</span>
    </span>
  );
}
