/**
 * /admin/* root layout — server-gated. Resolves the session and
 * bounces non-staff users before any child renders. Delegates the
 * interactive shell (mobile drawer, sidebar highlighting) to the
 * client <AdminShell>.
 */
import { resolveSessionOrRedirect } from "@/lib/server-fetch";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSessionOrRedirect(["admin", "employee"]);

  return (
    <AdminShell
      session={{ email: session.email, role: session.role, name: session.name ?? null }}
      sidebar={<AdminSidebar />}
    >
      {children}
    </AdminShell>
  );
}
