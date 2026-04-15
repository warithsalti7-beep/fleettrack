/**
 * /admin/overview — fleet-wide live KPIs.
 * RSC: fetches /api/stats via shared helper, passes plain props down.
 */
import { Suspense } from "react";
import { apiJson } from "@/lib/server-fetch";
import { LiveKpiGrid, LiveKpiGridSkeleton, type Kpis } from "@/components/admin/live-kpi-grid";
import { PageHeader } from "@/components/admin/page-header";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  return (
    <>
      <PageHeader
        title="Live Overview"
        subtitle="Fleet-wide KPIs computed from live trip and fixed-cost data."
      />
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
