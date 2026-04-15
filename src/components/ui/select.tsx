import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Select primitive — matches the Input visual language.
 * Native <select> for maximum mobile + a11y compatibility.
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  wrapperClassName?: string;
  children: React.ReactNode;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, id, className, wrapperClassName, children, ...rest },
  ref,
) {
  const autoId = React.useId();
  const selectId = id ?? autoId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("block", wrapperClassName)}>
      {label && (
        <label
          htmlFor={selectId}
          className="block text-2xs uppercase tracking-wider font-mono text-muted mb-1"
        >
          {label}{required && <span className="ml-1 text-danger">*</span>}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-md px-3 py-2 text-sm",
          "bg-surface-0 text-fg",
          "border border-border-muted",
          "focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          error && "border-danger-border focus:border-danger focus:ring-danger",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {hint && !error && <p id={hintId} className="mt-1 text-xs text-subtle">{hint}</p>}
      {error && <p id={errorId} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
});
