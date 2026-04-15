"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./sign-out-button";

/**
 * Admin sidebar.
 *
 * Visual spec (modern-SaaS language):
 *  - Soft surface-1 panel, no dropshadow; relies on the single-pixel
 *    border for separation.
 *  - Active item: left 2px brand indicator + subtle brand-bg; no
 *    heavy outline. Inactive: muted fg, hover warms to fg + surface-3.
 *  - Sections grouped with a small caps header so users see "Workspace"
 *    vs "Legacy" at a glance.
 */
type NavItem = { href: string; label: string; icon: string };
const WORKSPACE: NavItem[] = [
  { href: "/admin/overview", label: "Overview", icon: "◎" },
  { href: "/admin/drivers",  label: "Drivers",  icon: "◉" },
];
const LEGACY: NavItem[] = [
  { href: "/dashboard#fleet-register", label: "Vehicles",  icon: "◇" },
  { href: "/dashboard#financial",      label: "Financial", icon: "◇" },
  { href: "/dashboard",                label: "More…",     icon: "◇" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="h-9 w-9 rounded-lg flex items-center justify-center text-base font-bold text-white shadow-sm"
            style={{ background: "linear-gradient(135deg,var(--brand-3),var(--brand))" }}
          >
            FT
          </div>
          <div>
            <div className="text-sm font-semibold text-fg leading-none">FleetTrack</div>
            <div className="mt-1 text-2xs font-mono text-subtle">admin</div>
          </div>
        </div>
      </div>

      {/* Workspace group (migrated sections) */}
      <nav className="px-3 py-4 flex-1 overflow-y-auto text-sm">
        <SectionLabel>Workspace</SectionLabel>
        <ul className="mt-1 mb-4 flex flex-col gap-0.5">
          {WORKSPACE.map((n) => (
            <NavLink key={n.href} item={n} active={Boolean(pathname?.startsWith(n.href))} />
          ))}
        </ul>

        <SectionLabel>Legacy dashboard</SectionLabel>
        <ul className="mt-1 flex flex-col gap-0.5">
          {LEGACY.map((n) => (
            <NavLink key={n.href} item={n} active={false} legacy />
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-border-subtle space-y-1">
        <SignOutButton />
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 text-2xs font-mono uppercase tracking-wider text-subtle">
      {children}
    </div>
  );
}

function NavLink({ item, active, legacy }: { item: NavItem; active: boolean; legacy?: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        className={[
          "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm",
          "transition-colors duration-150",
          active
            ? "text-fg bg-brand-bg"
            : "text-muted hover:text-fg hover:bg-surface-3",
        ].join(" ")}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] rounded-r bg-brand"
          />
        )}
        <span aria-hidden className="text-xs opacity-70">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        {legacy && (
          <span className="text-2xs font-mono uppercase tracking-wider text-disabled">
            legacy
          </span>
        )}
      </Link>
    </li>
  );
}
