import * as React from "react";
import { cn } from "@/lib/utils";
import type { SemanticTone } from "@/lib/format";

/**
 * Badge primitive — a small status chip. Uses the semantic tone tokens
 * so the same value looks consistent everywhere (driver status chip,
 * score tier, priority, role).
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: SemanticTone;
  /** Render as a subtle pill (low contrast) vs solid (high contrast). */
  solid?: boolean;
  /** Use monospace font — matches status code styling in tables. */
  mono?: boolean;
}

const TONE_CLASS: Record<SemanticTone, { subtle: string; solid: string }> = {
  brand:   { subtle: "bg-brand-bg text-brand-2 border-brand-border",       solid: "bg-brand text-white border-brand" },
  success: { subtle: "bg-success-bg text-success border-success-border",   solid: "bg-success text-white border-success" },
  danger:  { subtle: "bg-danger-bg text-danger border-danger-border",      solid: "bg-danger text-white border-danger" },
  warn:    { subtle: "bg-warn-bg text-warn border-warn-border",            solid: "bg-warn text-white border-warn" },
  info:    { subtle: "bg-info-bg text-info border-info-border",            solid: "bg-info text-white border-info" },
  neutral: { subtle: "bg-surface-3 text-muted border-border-muted",        solid: "bg-surface-5 text-fg border-border-muted" },
};

export function Badge({
  tone = "neutral",
  solid = false,
  mono = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  const toneClass = solid ? TONE_CLASS[tone].solid : TONE_CLASS[tone].subtle;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium",
        mono && "font-mono uppercase tracking-wider",
        toneClass,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
