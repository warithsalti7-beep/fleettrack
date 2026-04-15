/**
 * /admin/* layout — shared shell for the React-migrated sections.
 *
 * Keeps the existing dark-mode visual language so staff can move
 * between classic `/dashboard` and `/admin/*` without a jarring switch.
 * Sidebar lists the sections migrated so far; each link is a real
 * `<a>` because we want server-rendered page changes until the whole
 * thing is React.
 */
import { resolveSessionOrRedirect } from "@/lib/server-fetch";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { SignOutButton } from "@/components/admin/sign-out-button";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin/overview", label: "Overview",    migrated: true },
  { href: "/admin/drivers",  label: "Drivers",     migrated: true },
  { href: "/dashboard#fleet-register",   label: "Vehicles",  migrated: false },
  { href: "/dashboard#financial",        label: "Financial", migrated: false },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate every admin page at the layout level. Drivers and anonymous
  // users never see the shell. Returning the resolved session here
  // also warms the cookie path for nested pages.
  const session = await resolveSessionOrRedirect(["admin", "employee"]);

  return (
    <div className="min-h-screen flex bg-[#07090f] text-[#edf0f8]">
      <aside
        aria-label="Admin navigation"
        className="w-[220px] shrink-0 border-r border-[rgba(255,255,255,0.05)] bg-[#0c0f18] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-[rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-2">
            <div
              aria-hidden
              className="h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold"
              style={{ background: "linear-gradient(135deg,#1a4db8,#3b7ff5)" }}
            >
              🚖
            </div>
            <div>
              <div className="text-sm font-bold">FleetTrack</div>
              <div className="text-[11px] font-mono text-[#619af8]">admin · react</div>
            </div>
          </div>
        </div>
        <nav className="p-3 text-sm flex-1">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="group flex items-center justify-between px-3 py-2 rounded-md text-[#8b96b0] hover:bg-[#171c2b] hover:text-[#edf0f8] transition-colors"
            >
              <span>{n.label}</span>
              {n.migrated ? null : (
                <span className="text-[10px] uppercase tracking-wide font-mono text-[#4d5a72] group-hover:text-[#8b96b0]">
                  legacy
                </span>
              )}
            </a>
          ))}
        </nav>
        <div className="p-3 border-t border-[rgba(255,255,255,0.05)] text-[11px] font-mono text-[#4d5a72]">
          <a
            href="/dashboard"
            className="block hover:text-[#619af8] transition-colors mb-1"
          >
            ← classic dashboard
          </a>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopbar email={session.email} role={session.role} name={session.name ?? null} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
