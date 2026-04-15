"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./sign-out-button";

/**
 * Sidebar rendered inside AdminShell. Client component so it can
 * highlight the active route via usePathname.
 */
const NAV: Array<{ href: string; label: string; migrated: boolean }> = [
  { href: "/admin/overview", label: "Overview",  migrated: true  },
  { href: "/admin/drivers",  label: "Drivers",   migrated: true  },
  { href: "/dashboard#fleet-register", label: "Vehicles",  migrated: false },
  { href: "/dashboard#financial",      label: "Financial", migrated: false },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <>
      <div className="px-5 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div
            aria-hidden
            className="h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg,var(--brand-3),var(--brand))" }}
          >
            🚖
          </div>
          <div>
            <div className="text-sm font-bold text-fg">FleetTrack</div>
            <div className="text-2xs font-mono text-brand-2">admin · react</div>
          </div>
        </div>
      </div>

      <nav className="p-3 text-sm flex-1">
        {NAV.map((n) => {
          const active = n.migrated && pathname?.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={[
                "group flex items-center justify-between px-3 py-2 rounded-md",
                "transition-colors",
                active
                  ? "bg-brand-bg text-brand-2 border border-brand-border"
                  : "text-muted hover:bg-surface-3 hover:text-fg border border-transparent",
              ].join(" ")}
            >
              <span>{n.label}</span>
              {!n.migrated && (
                <span className="text-[10px] uppercase tracking-wider font-mono text-disabled group-hover:text-muted">
                  legacy
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border-subtle text-2xs font-mono text-subtle">
        <a
          href="/dashboard"
          className="block hover:text-brand-2 transition-colors mb-1"
        >
          ← classic dashboard
        </a>
        <SignOutButton />
      </div>
    </>
  );
}
