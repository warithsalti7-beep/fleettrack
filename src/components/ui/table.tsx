import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table primitives — token-driven, responsive-friendly.
 *
 * Wrap tables in <TableContainer> for horizontal-scroll on small screens.
 * <Th right> right-aligns and uses tabular-nums automatically.
 * Use <TableEmpty> for consistent empty states.
 */

export function TableContainer({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border-muted bg-surface-1 overflow-hidden",
        className,
      )}
    >
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({ className, ...rest }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full text-sm border-collapse", className)}
      {...rest}
    />
  );
}

export function Thead({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "text-2xs uppercase tracking-wider font-mono text-subtle",
        "bg-surface-2 border-b border-border-subtle",
        className,
      )}
      {...rest}
    />
  );
}

export function Tbody({ className, ...rest }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...rest} />;
}

export function Tr({ className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-t border-border-subtle first:border-t-0",
        "hover:bg-surface-2 transition-colors duration-150",
        className,
      )}
      {...rest}
    />
  );
}

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  right?: boolean;
  /** If supplied the header is rendered as a clickable sort trigger. */
  onSort?: () => void;
  sortActive?: boolean;
  sortDir?: "asc" | "desc";
}

export function Th({
  right, onSort, sortActive, sortDir, className, children, ...rest
}: ThProps) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 font-semibold h-10 align-middle",
        right ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "inline-flex items-center gap-1 -mx-1 px-1 py-0.5 rounded",
            "hover:text-fg transition-colors duration-150",
            sortActive && "text-brand-2",
          )}
        >
          {children}
          <span
            aria-hidden
            className={cn(
              "text-[9px] transition-opacity duration-150",
              sortActive ? "opacity-100" : "opacity-30",
            )}
          >
            {sortActive ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  right?: boolean;
  mono?: boolean;
}

export function Td({ right, mono, className, ...rest }: TdProps) {
  return (
    <td
      className={cn(
        "px-4 py-3 align-middle",
        right ? "text-right tabular-nums" : "",
        mono && "font-mono text-xs",
        className,
      )}
      {...rest}
    />
  );
}

/** Consistent empty-row rendering. */
export function TableEmpty({
  colSpan, children,
}: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-14 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}
