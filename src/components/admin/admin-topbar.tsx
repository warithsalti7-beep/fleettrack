"use client";

import { RoleChip } from "@/components/ui/status-chip";

/**
 * Topbar — stays thin and unopinionated so the page header below it
 * is the true "hero". Shows identity + (on mobile) the sidebar toggle.
 */
export function AdminTopbar({
  email,
  role,
  name,
  onToggleSidebar,
  sidebarOpen,
}: {
  email: string;
  role: string;
  name: string | null;
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}) {
  const display = name || email;
  const initials = (name || email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "··";

  return (
    <div
      role="banner"
      className="sticky top-0 z-20 h-14 border-b border-border-subtle bg-surface-1/80 backdrop-blur-sm flex items-center justify-between px-4 md:px-6"
    >
      <div className="flex items-center gap-3 min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={Boolean(sidebarOpen)}
            aria-controls="admin-sidebar"
            className="md:hidden size-9 inline-flex items-center justify-center rounded-md border border-border-muted text-muted hover:text-fg hover:border-border transition-colors"
          >
            {sidebarOpen ? "×" : "☰"}
          </button>
        )}
        {/* Brand lockup — visible on mobile where the sidebar is hidden */}
        <div className="flex md:hidden items-center gap-2">
          <div
            aria-hidden
            className="size-7 rounded-md flex items-center justify-center text-[10px] font-mono font-bold text-white"
            style={{
              background: "linear-gradient(135deg,var(--brand-3),var(--brand))",
              boxShadow: "0 2px 8px rgba(59,127,245,0.25)",
            }}
          >
            FT
          </div>
          <span className="font-semibold text-sm text-fg">FleetTrack</span>
        </div>
        <a
          href="/dashboard"
          className="hidden md:inline-flex items-center gap-1.5 text-xs text-subtle hover:text-muted transition-colors"
          title="Go to the classic dashboard"
        >
          <span aria-hidden>←</span>
          <span>Classic dashboard</span>
        </a>
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <RoleChip role={role} />
        <div className="hidden sm:flex items-center gap-2 min-w-0">
          <div
            aria-hidden
            className="size-8 shrink-0 rounded-full bg-surface-3 text-muted flex items-center justify-center text-xs font-mono font-semibold"
          >
            {initials}
          </div>
          <span className="text-xs text-muted truncate max-w-[180px]">{display}</span>
        </div>
      </div>
    </div>
  );
}
