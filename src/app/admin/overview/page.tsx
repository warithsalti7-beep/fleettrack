/**
 * /admin/overview — fleet-wide live KPIs.
 * RSC: fetches /api/stats via shared helper, passes plain props down.
 */
import { Suspense } from "react";
import { apiJson } from "@/lib/server-fetch";
import { LiveKpiGrid, LiveKpiGridSkeleton, type Kpis } from "@/components/admin/live-kpi-grid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Live Overview</h1>
        <p className="text-sm text-muted mt-1">
          Fleet-wide KPIs computed from live trip + fixed-cost data.
        </p>
      </header>

      <Suspense fallback={<LiveKpiGridSkeleton />}>
        <OverviewKpis />
      </Suspense>
    </>
  );
}

async function OverviewKpis() {
  const kpis = await apiJson<Kpis>("/api/stats");
  if (!kpis) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-danger-border bg-danger-bg p-6"
      >
        <div className="text-danger font-semibold mb-1">Could not reach /api/stats</div>
        <p className="text-sm text-muted">
          The server responded with an error or is unavailable. Refresh to retry.
        </p>
      </div>
    );
  }
  return <LiveKpiGrid kpis={kpis} />;
}
