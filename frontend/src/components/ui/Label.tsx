"use client";

import { forwardRef, type LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...rest },
  ref
) {
  return (
    <label
      ref={ref}
      className={cn(
        "text-xs font-medium uppercase tracking-wide text-[var(--color-fg-muted)]",
        className
      )}
      {...rest}
    />
  );
});
