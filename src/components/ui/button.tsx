import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Button primitive — token-driven, responsive, accessible.
 *
 * Variants:
 *  - primary   — brand-coloured main CTA
 *  - secondary — quiet outline for lower-emphasis actions
 *  - danger    — destructive (delete, revoke)
 *  - ghost     — no background; for toolbar / inline controls
 *
 * Sizes:
 *  - sm (28px) / md (36px, default) / lg (44px — touch-friendly)
 *
 * `loading` disables the button and shows a spinner.
 * `leftIcon` is rendered before the label when not loading.
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-2 border border-brand",
  secondary:
    "bg-transparent text-muted hover:text-fg border border-border-muted hover:border-border",
  danger:
    "bg-transparent text-danger border border-danger-border hover:bg-danger-bg",
  ghost:
    "bg-transparent text-muted hover:text-fg hover:bg-surface-3 border border-transparent",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs rounded-sm",
  md: "h-9 px-4 text-sm rounded-md",
  lg: "h-11 px-5 text-sm rounded-md",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, leftIcon, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium",
        "transition-colors duration-100 select-none whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : leftIcon ? <span aria-hidden>{leftIcon}</span> : null}
      <span>{children}</span>
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 rounded-full border-2 border-current border-r-transparent"
      style={{ animation: "ft-spin 0.7s linear infinite" }}
    />
  );
}
