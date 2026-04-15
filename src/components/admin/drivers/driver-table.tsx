"use client";

/**
 * DriverTable — client table using the shared UI primitives so its
 * look and behaviour match every other /admin/* page.
 *
 * Responsibilities:
 *  - Local UI state: sort, search, status filter, modal.
 *  - Mutation: delete via DELETE /api/drivers/:id, optimistic + rollback.
 *  - After any successful mutation, router.refresh() re-runs the RSC
 *    page so `initialRows` is replaced with authoritative server data.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableContainer, Tbody, Td, Th, Thead, Tr, TableEmpty,
} from "@/components/ui/table";
import { DriverStatusChip, ScoreChip } from "@/components/ui/status-chip";
import { formatDateIso, formatNok, formatPercent } from "@/lib/format";
import type { DriverView, DriverStatus } from "./types";
import { DRIVER_STATUSES } from "./types";
import { DriverFormModal } from "./driver-form-modal";

type SortKey =
  | "name" | "status" | "plate" | "rating"
  | "revenueNok" | "revenuePerHour" | "acceptanceRate"
  | "score" | "totalTrips" | "joinedAt";
type SortDir = "asc" | "desc";
type ModalState = null | { mode: "new" } | { mode: "edit"; row: DriverView };

export function DriverTable({ initialRows }: { initialRows: DriverView[] }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("revenueNok");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DriverStatus | "ALL">("ALL");
  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

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
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  }

  async function handleDelete(row: DriverView) {
    if (!confirm(`Delete driver ${row.name}? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/drivers/${encodeURIComponent(row.id)}`, {
        method: "DELETE", credentials: "same-origin",
      });
      if (!res.ok && res.status !== 204) {
        let detail = "Server error.";
        try { const j = await res.json(); detail = j.detail || j.error || detail; } catch {}
        throw new Error(detail);
      }
      setFlash({ tone: "ok", msg: `Deleted ${row.name}.` });
      startTransition(() => router.refresh());
    } catch (err) {
      setFlash({ tone: "err", msg: err instanceof Error ? err.message : "Could not delete." });
    } finally {
      setBusyId(null);
    }
  }

  function handleSaved(msg: string) {
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
        total={initialRows.length}
        visible={sorted.length}
      />

      {flash && (
        <div
          role="status"
          className={[
            "mb-4 px-4 py-2 rounded-md text-sm flex items-center gap-3",
            flash.tone === "ok"
              ? "bg-success-bg border border-success-border text-success"
              : "bg-danger-bg border border-danger-border text-danger",
          ].join(" ")}
        >
          <span className="flex-1">{flash.msg}</span>
          <button
            type="button"
            onClick={() => setFlash(null)}
            aria-label="Dismiss"
            className="text-subtle hover:text-muted"
          >×</button>
        </div>
      )}

      <TableContainer>
        <Table>
          <Thead>
            <tr>
              <Th onSort={() => toggleSort("name")}        sortActive={sortKey === "name"}        sortDir={sortDir}>Driver</Th>
              <Th onSort={() => toggleSort("plate")}       sortActive={sortKey === "plate"}       sortDir={sortDir}>Vehicle</Th>
              <Th onSort={() => toggleSort("status")}      sortActive={sortKey === "status"}      sortDir={sortDir}>Status</Th>
              <Th onSort={() => toggleSort("revenueNok")}  sortActive={sortKey === "revenueNok"}  sortDir={sortDir} right>Revenue 7d</Th>
              <Th onSort={() => toggleSort("revenuePerHour")} sortActive={sortKey === "revenuePerHour"} sortDir={sortDir} right>Rev/hr</Th>
              <Th onSort={() => toggleSort("acceptanceRate")} sortActive={sortKey === "acceptanceRate"} sortDir={sortDir} right>Accept</Th>
              <Th onSort={() => toggleSort("score")}       sortActive={sortKey === "score"}       sortDir={sortDir} right>Score</Th>
              <Th onSort={() => toggleSort("totalTrips")}  sortActive={sortKey === "totalTrips"}  sortDir={sortDir} right>Trips total</Th>
              <Th onSort={() => toggleSort("rating")}      sortActive={sortKey === "rating"}      sortDir={sortDir} right>Rating</Th>
              <Th onSort={() => toggleSort("joinedAt")}    sortActive={sortKey === "joinedAt"}    sortDir={sortDir} right>Joined</Th>
              <Th right aria-label="Row actions"><span className="sr-only">Actions</span></Th>
            </tr>
          </Thead>
          <Tbody>
            {sorted.length === 0 && initialRows.length === 0 && (
              <TableEmpty colSpan={11}>
                No drivers yet. Create one, or bulk-import via{" "}
                <a href="/dashboard#data-import" className="text-brand-2 underline">Data Import</a>.
              </TableEmpty>
            )}
            {sorted.length === 0 && initialRows.length > 0 && (
              <TableEmpty colSpan={11}>
                No drivers match the current filter.
                <button
                  type="button"
                  onClick={() => { setSearch(""); setStatusFilter("ALL"); }}
                  className="ml-2 text-brand-2 underline"
                >
                  Clear filters
                </button>
              </TableEmpty>
            )}
            {sorted.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <div className="font-medium text-fg">{r.name}</div>
                  <div className="text-2xs font-mono text-subtle">{r.email}</div>
                </Td>
                <Td>
                  {r.plate ? (
                    <>
                      <div className="font-mono text-fg">{r.plate}</div>
                      <div className="text-2xs text-subtle">{r.vehicle ?? "—"}</div>
                    </>
                  ) : <span className="text-subtle">—</span>}
                </Td>
                <Td><DriverStatusChip status={r.status} /></Td>
                <Td right>{formatNok(r.revenueNok)}</Td>
                <Td right>{r.revenuePerHour ? formatNok(r.revenuePerHour) : "—"}</Td>
                <Td right>{r.acceptanceRate > 0 ? formatPercent(r.acceptanceRate, 0) : "—"}</Td>
                <Td right><ScoreChip score={r.score} /></Td>
                <Td right>{r.totalTrips}</Td>
                <Td right>{r.rating?.toFixed(1) ?? "—"}</Td>
                <Td right mono className="text-subtle">{formatDateIso(r.joinedAt)}</Td>
                <Td right className="whitespace-nowrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setModal({ mode: "edit", row: r })}
                    disabled={busyId != null}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="ml-2"
                    onClick={() => handleDelete(r)}
                    loading={busyId === r.id}
                  >
                    Delete
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableContainer>

      {modal?.mode === "new" && (
        <DriverFormModal onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.mode === "edit" && (
        <DriverFormModal initial={modal.row} onClose={() => setModal(null)} onSaved={handleSaved} />
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
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, email, plate, licence…"
        wrapperClassName="flex-1 min-w-[220px]"
        aria-label="Search drivers"
      />
      <Select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as DriverStatus | "ALL")}
        aria-label="Filter by status"
        wrapperClassName="w-[180px]"
      >
        <option value="ALL">All statuses</option>
        {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
      </Select>
      <div className="text-2xs text-subtle font-mono tabular-nums">
        {visible} / {total}
      </div>
      <Button className="ml-auto" onClick={onNew}>+ New driver</Button>
    </div>
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
