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
    "bg-brand text-white hover:bg-brand-2 border border-brand shadow-sm hover:shadow-md",
  secondary:
    "bg-surface-1 text-muted hover:text-fg border border-border-muted hover:border-border hover:bg-surface-2",
  danger:
    "bg-transparent text-danger border border-danger-border hover:bg-danger-bg hover:border-danger",
  ghost:
    "bg-transparent text-muted hover:text-fg hover:bg-surface-3 border border-transparent",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs rounded-md",
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
        "transition-[background-color,border-color,color,box-shadow,transform]",
        "duration-150 select-none whitespace-nowrap",
        "active:translate-y-[0.5px]",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0",
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
