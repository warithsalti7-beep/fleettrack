/**
 * /admin/drivers — driver management (React).
 *
 * Server Component fetches /api/drivers + /api/stats/per-driver in
 * parallel, merges them, and hands off to the client table.
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
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">Drivers</h1>
      <p className="text-sm text-muted mt-1">
        {count == null
          ? "Loading…"
          : `${count} driver${count === 1 ? "" : "s"} · performance metrics over the last 7 days`}
      </p>
    </header>
  );
}
