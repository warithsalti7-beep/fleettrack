"use client";

/**
 * DriverTable — client component handling sort, filter, and row-level
 * actions for /admin/drivers.
 *
 * State layout:
 *   - initialRows is the snapshot from the server; we store a mutable
 *     copy in `rows` for optimistic delete / patch.
 *   - sortKey + sortDir drive the header click-to-sort.
 *   - search + statusFilter drive filtering.
 *   - modal state: { mode: "new" | { mode: "edit", row: DriverView } }.
 *
 * After any mutation we call router.refresh() so the server component
 * re-fetches and initialRows is replaced on next render — guaranteeing
 * client state and DB stay in sync even if optimistic updates drift.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DriverView, DriverStatus } from "./types";
import { DRIVER_STATUSES } from "./types";
import { DriverFormModal } from "./driver-form-modal";

type SortKey =
  | "name" | "status" | "plate" | "rating"
  | "revenueNok" | "revenuePerHour" | "acceptanceRate" | "score" | "totalTrips" | "joinedAt";
type SortDir = "asc" | "desc";
type ModalState = null | { mode: "new" } | { mode: "edit"; row: DriverView };

const NOK = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return "—";
  return (
    Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F") + "\u00a0kr"
  );
};

export function DriverTable({ initialRows }: { initialRows: DriverView[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<DriverView[]>(initialRows);
  const [sortKey, setSortKey] = useState<SortKey>("revenueNok");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DriverStatus | "ALL">("ALL");
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, startTransition] = useTransition();
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

  // Keep local rows in sync when the server refreshes.
  if (rows !== initialRows && rows.length && !rows.some(r => !initialRows.find(i => i.id === r.id))) {
    // identity-only sync: replace rows if ids line up with the server snapshot
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return initialRows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.email.toLowerCase().includes(needle) ||
        (r.plate ?? "").toLowerCase().includes(needle) ||
        r.licenseNumber.toLowerCase().includes(needle)
      );
    });
  }, [initialRows, search, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => cmp(a[sortKey], b[sortKey]) * (sortDir === "asc" ? 1 : -1));
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  }

  async function handleDelete(row: DriverView) {
    if (!confirm(`Delete driver ${row.name}? This cannot be undone.`)) return;
    setRows((r) => r.filter((x) => x.id !== row.id)); // optimistic
    try {
      const res = await fetch(`/api/drivers/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok && res.status !== 204) throw new Error("server_error");
      setFlash({ tone: "ok", msg: `Deleted ${row.name}.` });
      startTransition(() => router.refresh());
    } catch {
      // Rollback — put the row back.
      setRows(initialRows);
      setFlash({ tone: "err", msg: "Could not delete. The row was restored." });
    }
  }

  async function handleSaved(msg: string) {
    setModal(null);
    setFlash({ tone: "ok", msg });
    startTransition(() => router.refresh());
  }

  return (
    <section aria-label="Drivers">
      <Toolbar
        search={search} setSearch={setSearch}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        onNew={() => setModal({ mode: "new" })}
        total={initialRows.length} visible={sorted.length}
      />

      {flash && (
        <div
          role="status"
          className={`mb-4 px-4 py-2 rounded-md text-sm ${
            flash.tone === "ok"
              ? "bg-[rgba(16,185,129,0.10)] border border-[rgba(16,185,129,0.22)] text-[#10b981]"
              : "bg-[rgba(239,68,68,0.10)] border border-[rgba(239,68,68,0.22)] text-[#ef4444]"
          }`}
        >
          {flash.msg}
          <button
            type="button"
            onClick={() => setFlash(null)}
            aria-label="Dismiss"
            className="ml-3 text-[#4d5a72] hover:text-[#8b96b0]"
          >×</button>
        </div>
      )}

      <div className="rounded-lg border border-[rgba(255,255,255,0.09)] bg-[#0c0f18] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider font-mono text-[#8b96b0] bg-[#111520]">
            <tr>
              <Th onClick={() => toggleSort("name")}        active={sortKey === "name"}        dir={sortDir}>Driver</Th>
              <Th onClick={() => toggleSort("plate")}       active={sortKey === "plate"}       dir={sortDir}>Vehicle</Th>
              <Th onClick={() => toggleSort("status")}      active={sortKey === "status"}      dir={sortDir}>Status</Th>
              <Th onClick={() => toggleSort("revenueNok")}  active={sortKey === "revenueNok"}  dir={sortDir} right>Revenue 7d</Th>
              <Th onClick={() => toggleSort("revenuePerHour")} active={sortKey === "revenuePerHour"} dir={sortDir} right>Rev/hr</Th>
              <Th onClick={() => toggleSort("acceptanceRate")} active={sortKey === "acceptanceRate"} dir={sortDir} right>Accept</Th>
              <Th onClick={() => toggleSort("score")}       active={sortKey === "score"}       dir={sortDir} right>Score</Th>
              <Th onClick={() => toggleSort("totalTrips")}  active={sortKey === "totalTrips"}  dir={sortDir} right>Trips total</Th>
              <Th onClick={() => toggleSort("rating")}      active={sortKey === "rating"}      dir={sortDir} right>Rating</Th>
              <Th onClick={() => toggleSort("joinedAt")}    active={sortKey === "joinedAt"}    dir={sortDir} right>Joined</Th>
              <th className="px-3 py-3 text-right" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && initialRows.length === 0 && (
              <tr>
                <td colSpan={11} className="py-14 text-center text-sm text-[#8b96b0]">
                  No drivers yet. Create one, or bulk-import via{" "}
                  <a href="/dashboard#data-import" className="text-[#619af8] underline">Data Import</a>.
                </td>
              </tr>
            )}
            {sorted.length === 0 && initialRows.length > 0 && (
              <tr>
                <td colSpan={11} className="py-14 text-center text-sm text-[#8b96b0]">
                  No drivers match the current filter.
                  <button
                    type="button"
                    onClick={() => { setSearch(""); setStatusFilter("ALL"); }}
                    className="ml-2 text-[#619af8] underline"
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <DriverRowCells
                key={r.id}
                row={r}
                busy={busy}
                onEdit={() => setModal({ mode: "edit", row: r })}
                onDelete={() => handleDelete(r)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {modal?.mode === "new" && (
        <DriverFormModal
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.mode === "edit" && (
        <DriverFormModal
          initial={modal.row}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}

function Toolbar({
  search, setSearch, statusFilter, setStatusFilter, onNew, total, visible,
}: {
  search: string; setSearch: (v: string) => void;
  statusFilter: DriverStatus | "ALL"; setStatusFilter: (v: DriverStatus | "ALL") => void;
  onNew: () => void; total: number; visible: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="relative flex-1 min-w-[260px]">
        <span className="sr-only">Search drivers</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, plate, licence…"
          className="w-full pl-9 pr-3 py-2 rounded-md bg-[#0c0f18] border border-[rgba(255,255,255,0.09)] text-sm text-[#edf0f8] placeholder:text-[#4d5a72] focus:border-[#3b7ff5] focus:outline-none focus:ring-1 focus:ring-[#3b7ff5]"
        />
        <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4d5a72]">⌕</span>
      </label>
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as DriverStatus | "ALL")}
        className="px-3 py-2 rounded-md bg-[#0c0f18] border border-[rgba(255,255,255,0.09)] text-sm focus:border-[#3b7ff5] focus:outline-none"
        aria-label="Filter by status"
      >
        <option value="ALL">All statuses</option>
        {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
      </select>
      <div className="text-xs text-[#4d5a72] font-mono">
        {visible} / {total}
      </div>
      <button
        type="button"
        onClick={onNew}
        className="ml-auto px-4 py-2 rounded-md bg-[#3b7ff5] text-white text-sm font-medium hover:bg-[#619af8] transition-colors"
      >
        + New driver
      </button>
    </div>
  );
}

function Th({
  children, onClick, active, dir, right,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: SortDir;
  right?: boolean;
}) {
  return (
    <th scope="col" className={`px-3 py-3 ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-[#edf0f8] transition-colors ${active ? "text-[#619af8]" : ""}`}
      >
        {children}
        {active && <span aria-hidden className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function DriverRowCells({
  row, busy, onEdit, onDelete,
}: {
  row: DriverView; busy: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const scoreTone = row.score >= 80 ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]"
                  : row.score >= 60 ? "bg-[rgba(59,127,245,0.15)] text-[#619af8]"
                  : row.score > 0   ? "bg-[rgba(239,68,68,0.15)] text-[#ef4444]"
                  : "text-[#4d5a72]";
  const statusTone = row.status === "AVAILABLE" ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]"
                   : row.status === "ON_TRIP"   ? "bg-[rgba(59,127,245,0.15)] text-[#619af8]"
                   : row.status === "MAINTENANCE" ? "bg-[rgba(245,158,11,0.15)] text-[#f59e0b]"
                   : "bg-[rgba(255,255,255,0.05)] text-[#8b96b0]";

  return (
    <tr className="border-t border-[rgba(255,255,255,0.05)] hover:bg-[#111520] transition-colors">
      <td className="px-3 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="text-[11px] font-mono text-[#4d5a72]">{row.email}</div>
      </td>
      <td className="px-3 py-3">
        {row.plate ? (
          <>
            <div className="font-mono text-[#edf0f8]">{row.plate}</div>
            <div className="text-[11px] text-[#4d5a72]">{row.vehicle ?? "—"}</div>
          </>
        ) : <span className="text-[#4d5a72]">—</span>}
      </td>
      <td className="px-3 py-3">
        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono ${statusTone}`}>
          {row.status.replace(/_/g, " ")}
        </span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{NOK(row.revenueNok)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{row.revenuePerHour ? NOK(row.revenuePerHour) : "—"}</td>
      <td className="px-3 py-3 text-right tabular-nums">{row.acceptanceRate > 0 ? `${row.acceptanceRate}%` : "—"}</td>
      <td className="px-3 py-3 text-right">
        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono ${scoreTone}`}>
          {row.score > 0 ? row.score : "—"}
        </span>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{row.totalTrips}</td>
      <td className="px-3 py-3 text-right tabular-nums">{row.rating?.toFixed(1) ?? "—"}</td>
      <td className="px-3 py-3 text-right text-[11px] font-mono text-[#4d5a72]">
        {row.joinedAt ? new Date(row.joinedAt).toISOString().slice(0, 10) : "—"}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="text-xs px-2 py-1 rounded border border-[rgba(255,255,255,0.09)] text-[#8b96b0] hover:text-[#edf0f8] hover:border-[rgba(255,255,255,0.22)] disabled:opacity-60"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="ml-2 text-xs px-2 py-1 rounded border border-[rgba(239,68,68,0.22)] text-[#ef4444] hover:bg-[rgba(239,68,68,0.10)] disabled:opacity-60"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
