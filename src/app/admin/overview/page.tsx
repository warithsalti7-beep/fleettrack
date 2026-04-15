/**
 * /admin/overview — first React-rendered dashboard section.
 *
 * The /admin layout already resolves the session and bounces non-staff
 * users, so this page can focus on rendering. Fetches /api/stats via
 * the shared server-fetch helper (forwards the auth cookie).
 */
import { apiJson } from "@/lib/server-fetch";
import { LiveKpiGrid, type Kpis } from "@/components/admin/live-kpi-grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const kpis = await apiJson<Kpis>("/api/stats");

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Live Overview</h1>
        <p className="text-sm text-[#8b96b0] mt-1">
          Fleet-wide KPIs computed from live trip + fixed-cost data.
        </p>
      </header>

      {kpis ? (
        <LiveKpiGrid kpis={kpis} />
      ) : (
        <div className="rounded-lg border border-[rgba(239,68,68,0.22)] bg-[rgba(239,68,68,0.10)] p-6">
          <div className="text-[#ef4444] font-semibold mb-1">
            Could not reach /api/stats
          </div>
          <p className="text-sm text-[#8b96b0]">
            The server responded with an error or is unavailable. This page
            re-fetches on every request — refresh to retry.
          </p>
        </div>
      )}
    </>
  );
}
