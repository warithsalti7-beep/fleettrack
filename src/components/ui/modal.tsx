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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
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
          "w-full rounded-xl border border-border-muted bg-surface-1 shadow-lg",
          "max-h-[92vh] overflow-y-auto",
          "flex flex-col",
        )}
        style={{ maxWidth: `${widthPx}px` }}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold truncate">{title}</h2>
            {description && (
              <p id={descId} className="mt-0.5 text-xs text-subtle">{description}</p>
            )}
          </div>
          {!hideCloseButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close dialog"
              className="text-subtle text-xl leading-none px-2"
            >
              ×
            </Button>
          )}
        </header>
        <div className="px-5 py-5 flex-1">{children}</div>
        {footer && (
          <footer className="px-5 py-4 border-t border-border-subtle flex justify-end gap-2">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
