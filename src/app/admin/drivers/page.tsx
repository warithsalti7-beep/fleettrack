/**
 * /admin/drivers — driver management (React).
 *
 * Server Component fetches /api/drivers + /api/stats/per-driver in
 * parallel, merges them, and hands off to the client table.
 */
import { apiJson } from "@/lib/server-fetch";
import { DriverTable } from "@/components/admin/drivers/driver-table";
import { PageHeader } from "@/components/admin/page-header";
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
        <PageHeader title="Drivers" />
        <div
          role="alert"
          className="rounded-lg border border-danger-border bg-danger-bg p-6"
        >
          <div className="text-danger font-semibold mb-1">Could not load drivers</div>
          <p className="text-sm text-muted">
            <code className="font-mono">/api/drivers</code> returned an error or is
            unreachable. Refresh to retry; if the problem persists, check the
            database connection.
          </p>
        </div>
      </>
    );
  }

  const perfAvailable = Boolean(perf);
  const rows = mergeDriverViews(drivers, perf?.drivers ?? []);
  return (
    <>
      <PageHeader
        title="Drivers"
        subtitle={
          rows.length === 0
            ? "No drivers yet. Create one to get started, or bulk-import from the Data Import page."
            : `${rows.length} driver${rows.length === 1 ? "" : "s"} · performance over the last 7 days.`
        }
      />
      {!perfAvailable && (
        <div
          role="status"
          className="mb-4 rounded-md border border-warn-border bg-warn-bg text-warn text-sm px-4 py-2.5"
        >
          Performance metrics (revenue, accept, score) could not be loaded.
          Driver details below are still accurate; refresh to retry.
        </div>
      )}
      <DriverTable initialRows={rows} />
    </>
  );
}
