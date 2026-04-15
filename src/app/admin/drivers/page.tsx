/**
 * /admin/drivers — React-migrated driver management.
 *
 * Server Component:
 *   - Fetches /api/drivers + /api/stats/per-driver in parallel.
 *   - Merges the two into a flat DriverView[] for the client table.
 *   - Renders explicit loading / empty / error UI.
 *
 * All mutations (create / update / delete) happen in the client table
 * via fetch() against the existing API; after success the client calls
 * router.refresh() and this RSC re-runs, so data and UI stay in sync.
 */
import { apiJson } from "@/lib/server-fetch";
import { DriverTable } from "@/components/admin/drivers/driver-table";
import {
  mergeDriverViews,
  type DriverPerfRow,
  type DriverRow,
} from "@/components/admin/drivers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminDriversPage() {
  const [drivers, perf] = await Promise.all([
    apiJson<DriverRow[]>("/api/drivers"),
    apiJson<{ drivers: DriverPerfRow[] }>("/api/stats/per-driver?days=7&limit=500"),
  ]);

  if (!drivers) {
    return (
      <>
        <PageHeader />
        <div className="rounded-lg border border-[rgba(239,68,68,0.22)] bg-[rgba(239,68,68,0.10)] p-6">
          <div className="text-[#ef4444] font-semibold mb-1">
            Could not load drivers
          </div>
          <p className="text-sm text-[#8b96b0]">
            <code className="font-mono">/api/drivers</code> returned an error or is
            unreachable. Refresh to retry; if the problem persists, check the
            database connection.
          </p>
        </div>
      </>
    );
  }

  const rows = mergeDriverViews(drivers, perf?.drivers ?? []);

  return (
    <>
      <PageHeader count={rows.length} />
      <DriverTable initialRows={rows} />
    </>
  );
}

function PageHeader({ count }: { count?: number }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
        <p className="text-sm text-[#8b96b0] mt-1">
          {count == null
            ? "Loading…"
            : `${count} driver${count === 1 ? "" : "s"} · performance metrics over the last 7 days`}
        </p>
      </div>
    </header>
  );
}
