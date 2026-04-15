import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input primitive with optional label, error, and helper text. Pairs
 * naturally with <Field> patterns in forms. A11y-first:
 *  - label + input are linked via id/for
 *  - error surfaces via aria-describedby + aria-invalid
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, id, className, wrapperClassName, ...rest },
  ref,
) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("block", wrapperClassName)}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-2xs uppercase tracking-wider font-mono text-muted mb-1"
        >
          {label}{required && <span className="ml-1 text-danger">*</span>}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-md px-3 py-2 text-sm",
          "bg-surface-0 text-fg placeholder:text-subtle",
          "border border-border-muted",
          "focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          error && "border-danger-border focus:border-danger focus:ring-danger",
          className,
        )}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-subtle">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-danger">{error}</p>
      )}
    </div>
  );
});
