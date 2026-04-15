"use client";

/**
 * Error boundary for any /admin/* page. Next.js resets state and
 * re-renders on `reset()`. Logged to Sentry on the client (auth.js loads
 * the SDK globally; we push an error manually so the stack trace is
 * preserved with the current user context).
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

type SentryClient = { captureException?: (e: unknown) => void };
type WindowWithSentry = Window & { Sentry?: SentryClient };

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const w = typeof window !== "undefined" ? (window as WindowWithSentry) : undefined;
    if (w?.Sentry?.captureException) {
      try { w.Sentry.captureException(error); } catch { /* ignore */ }
    }
    // Surface the error to the browser console so support staff have
    // something to copy into a bug report.
    console.error("[/admin] render error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="rounded-lg border border-danger-border bg-danger-bg p-6 max-w-xl"
    >
      <h2 className="text-danger font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted mt-2">
        We hit an unexpected error while rendering this page. The details have
        been reported; you can retry below or go back to the overview.
      </p>
      {error.digest && (
        <p className="mt-2 text-2xs font-mono text-subtle">
          reference: {error.digest}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => { window.location.href = "/admin/overview"; }}>
          Back to Overview
        </Button>
      </div>
    </div>
  );
}
