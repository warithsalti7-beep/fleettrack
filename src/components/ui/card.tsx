import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — surface container for grouped content. Token-based so it
 * adapts to the light/dark theme automatically.
 *
 * Layout is opt-in via CardHeader / CardBody / CardFooter. An `accent`
 * prop on Card renders a vertical strip at the top, useful for KPI
 * cards to communicate tone at a glance.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Narrow accent strip at the top. */
  accent?: "brand" | "success" | "danger" | "warn" | "info" | "none";
  /** Tighter layout — use when a card is nested or dense. */
  dense?: boolean;
}

const ACCENT_BG: Record<NonNullable<CardProps["accent"]>, string> = {
  brand:   "bg-brand",
  success: "bg-success",
  danger:  "bg-danger",
  warn:    "bg-warn",
  info:    "bg-info",
  none:    "",
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, children, accent = "none", dense, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "relative rounded-lg border border-border-muted bg-surface-1",
        "shadow-sm overflow-hidden",
        "transition-[border-color,box-shadow] duration-200",
        accent !== "none" && "hover:border-border hover:shadow-md",
        dense ? "p-3" : "p-5",
        className,
      )}
      {...rest}
    >
      {accent !== "none" && (
        <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", ACCENT_BG[accent])} />
      )}
      {children}
    </div>
  );
});

export function CardHeader({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-start justify-between gap-3", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-xs uppercase tracking-wider font-mono text-muted", className)} {...rest} />;
}

export function CardValue({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-2xl font-bold text-fg leading-tight tabular-nums", className)} {...rest} />;
}

export function CardSub({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-xs text-subtle mt-1", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex items-center justify-end gap-2", className)} {...rest} />;
}
