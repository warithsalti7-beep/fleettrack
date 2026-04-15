"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Modal primitive — focus management, Esc-to-close, click-outside
 * dismiss, responsive layout, accessible dialog semantics.
 *
 * Usage:
 *   <Modal open={open} onClose={close} title="New driver" footer={...}>
 *     …form fields…
 *   </Modal>
 *
 * Pass `footer` for the action row so the body region stays pure for
 * form content.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Max content width in px. Defaults to 480. */
  widthPx?: number;
  /** Render without a default close (×) button when true. */
  hideCloseButton?: boolean;
}

export function Modal({
  open, onClose, title, description, children, footer, widthPx = 480, hideCloseButton,
}: ModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId  = React.useId();

  // Esc to close + initial focus on first focusable element.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Focus the first focusable inside the dialog.
    const t = setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
      );
      first?.focus();
    }, 10);
    // Trap body scroll.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4"
      style={{ animation: "ft-fade-in 150ms ease" }}
      onMouseDown={(e) => {
        // Dismiss only if the click originated on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "w-full border border-border-muted bg-surface-1 shadow-lg",
          "rounded-t-xl md:rounded-xl",
          "max-h-[92vh] overflow-y-auto",
          "flex flex-col",
        )}
        style={{ maxWidth: `${widthPx}px`, animation: "ft-pop-in 180ms cubic-bezier(0.4,0,0.2,1)" }}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border-subtle">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg truncate">{title}</h2>
            {description && (
              <p id={descId} className="mt-1 text-xs text-subtle">{description}</p>
            )}
          </div>
          {!hideCloseButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close dialog"
              className="text-subtle hover:text-fg text-lg leading-none px-2 -mr-1"
            >
              ×
            </Button>
          )}
        </header>
        <div className="px-6 py-5 flex-1">{children}</div>
        {footer && (
          <footer className="px-6 py-4 border-t border-border-subtle flex justify-end gap-2 bg-surface-1">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
