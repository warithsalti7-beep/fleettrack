"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        } catch { /* swallow */ }
        window.location.href = "/login";
      }}
      className="w-full justify-start hover:text-danger -mx-1"
    >
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
