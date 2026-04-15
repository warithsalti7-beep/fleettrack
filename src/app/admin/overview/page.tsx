/**
 * /admin/overview — first React-rendered dashboard section.
 *
 * Proof-of-concept for the gradual migration away from the 5000-line
 * static dashboard.html. This page fetches /api/stats server-side and
 * renders the top KPI grid. It is rendered as a Server Component — no
 * client-side JS is shipped for the data path.
 *
 * Auth: the page reads the ft_session cookie via the same helper the
 * /api/* routes use; unauthenticated visitors are bounced to /login.
 *
 * Migration pattern (followed by future sections):
 *   1. Server Component fetches from /api/* using the incoming cookie.
 *   2. Passes plain data to pure-render components in src/components/admin.
 *   3. Empty / loading / error states handled explicitly.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth-guard";
import { LiveKpiGrid } from "@/components/admin/live-kpi-grid";
import type { Kpis } from "@/components/admin/live-kpi-grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchStats(cookieHeader: string): Promise<Kpis | null> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const url = `${proto}://${host}/api/stats`;
  const r = await fetch(url, { headers: { cookie: cookieHeader }, cache: "no-store" }).catch(() => null);
  if (!r || !r.ok) return null;
  try { return (await r.json()) as Kpis; } catch { return null; }
}

export default async function AdminOverviewPage() {
  // Build the Cookie header string we'll forward into the API call.
  const store = await cookies();
  const cookieHeader = store.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  // Build a Request-shaped object for readSession so we don't duplicate logic.
  const fakeReq = new Request("http://localhost/admin/overview", {
    headers: { cookie: cookieHeader },
  });
  const session = await readSession(fakeReq);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const kpis = await fetchStats(cookieHeader);

  return (
    <main className="min-h-screen bg-[#07090f] text-[#edf0f8] p-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FleetTrack — Admin Overview</h1>
          <p className="text-sm text-[#8b96b0] mt-1">
            React-rendered version, data live from /api/stats. Signed in as{" "}
            <span className="font-mono text-[#619af8]">{session.email}</span>{" "}
            <span className="inline-block px-2 py-0.5 text-[11px] rounded bg-[#3b7ff540] text-[#619af8] ml-1">{session.role}</span>
          </p>
        </div>
        <a
          href="/dashboard"
          className="text-xs font-mono px-3 py-2 rounded border border-[rgba(255,255,255,0.09)] text-[#8b96b0] hover:text-[#edf0f8] hover:border-[rgba(255,255,255,0.22)] transition-colors"
        >
          ← Back to classic dashboard
        </a>
      </header>

      {kpis ? (
        <LiveKpiGrid kpis={kpis} />
      ) : (
        <div className="rounded-lg border border-[rgba(239,68,68,0.22)] bg-[rgba(239,68,68,0.10)] p-6 text-center">
          <div className="text-[#ef4444] font-semibold mb-1">Could not reach /api/stats</div>
          <div className="text-sm text-[#8b96b0]">
            Check that the server is running and you have a valid session. This page re-renders on every request.
          </div>
        </div>
      )}

      <footer className="mt-12 text-xs text-[#4d5a72] font-mono">
        Migration seed — other sections still live at <code>/dashboard</code>.
      </footer>
    </main>
  );
}
