"use client";

/**
 * Client-side sign-out link. Server components can't attach onClick
 * handlers, so this is broken out so the /admin layout can stay server-
 * rendered while still doing a real POST to /api/auth/logout.
 */
import { useState } from "react";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        } catch { /* swallow */ }
        window.location.href = "/login";
      }}
      className="block w-full text-left hover:text-[#ef4444] transition-colors disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
