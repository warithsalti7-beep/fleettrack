"use client";

/**
 * Client-side admin shell — owns the mobile-nav open/closed state so
 * the layout can stay server-rendered. Receives the pre-computed session
 * identity + the nav as plain children props.
 *
 * Responsive behaviour:
 *  - Desktop (md+): sidebar always visible at 240px fixed.
 *  - Mobile / tablet (<md): sidebar slides in from the left; a backdrop
 *    dims the content area; tapping either dismisses.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminTopbar } from "./admin-topbar";

export function AdminShell({
  session,
  sidebar,
  children,
}: {
  session: { email: string; role: string; name: string | null };
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer after navigation. Guarded so the setter is only
  // invoked when the drawer is actually open — avoids the cascading-
  // render pattern the linter flags.
  useEffect(() => {
    if (mobileOpen) setMobileOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close on Esc.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen flex bg-surface-0 text-fg">
      {/* Backdrop for mobile drawer */}
      {mobileOpen && (
        <div
          aria-hidden
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        aria-label="Admin navigation"
        className={[
          "w-[240px] shrink-0 border-r border-border-subtle bg-surface-1 flex flex-col",
          "fixed md:static inset-y-0 left-0 z-40 transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        {sidebar}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopbar
          email={session.email}
          role={session.role}
          name={session.name}
          onToggleSidebar={() => setMobileOpen((v) => !v)}
        />
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
