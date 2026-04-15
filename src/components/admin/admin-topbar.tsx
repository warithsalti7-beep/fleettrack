"use client";

import { RoleChip } from "@/components/ui/status-chip";

/**
 * Shared topbar — shows session identity and doubles as a mobile
 * sidebar toggle host. The toggle button is exposed via the
 * useSidebar context from the layout.
 */
export function AdminTopbar({
  email,
  role,
  name,
  onToggleSidebar,
}: {
  email: string;
  role: string;
  name: string | null;
  onToggleSidebar?: () => void;
}) {
  return (
    <div
      role="banner"
      className="h-14 border-b border-border-subtle bg-surface-1 flex items-center justify-between px-4 md:px-6"
    >
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="Toggle navigation"
            className="md:hidden size-8 inline-flex items-center justify-center rounded-md border border-border-muted text-muted hover:text-fg"
          >
            ☰
          </button>
        )}
        <div className="text-2xs font-mono text-subtle hidden sm:block">
          FleetTrack · React migration preview
        </div>
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <RoleChip role={role} />
        <span className="text-xs text-muted truncate max-w-[160px] md:max-w-none">
          {name || email}
        </span>
      </div>
    </div>
  );
}
