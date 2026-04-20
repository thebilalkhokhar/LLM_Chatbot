"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]",
        "bg-[var(--color-bg-subtle)] px-3 text-sm text-[var(--color-fg)]",
        "placeholder:text-[var(--color-fg-subtle)]",
        "transition-colors",
        "hover:border-[var(--color-border-strong)]",
        "focus:border-[var(--color-accent)] focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...rest}
    />
  );
});
