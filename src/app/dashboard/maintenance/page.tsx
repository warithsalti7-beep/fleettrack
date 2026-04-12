import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, getStatusColor } from "@/lib/utils";
import { getCurrency } from "@/lib/currency-server";
import { formatAmount } from "@/lib/currency";
import { ExportButton } from "@/components/ui/export-button";
import { SortBar } from "@/components/ui/sort-bar";
import { AlertTriangle, CheckCircle2, Clock, Wrench } from "lucide-react";

type MaintSortField = "scheduledAt" | "priority" | "status" | "cost";

const SORT_OPTIONS = [
  { value: "scheduledAt", label: "Scheduled Date" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
  { value: "cost", label: "Cost" },
];

async function getMaintenanceData(sort: MaintSortField, dir: "asc" | "desc") {
  return prisma.maintenance.findMany({
    orderBy: { [sort]: dir },
    include: {
      vehicle: { select: { plateNumber: true, make: true, model: true } },
    },
  });
}

const priorityColors: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-600",
  NORMAL: "bg-blue-100 text-blue-700",
  HIGH: "bg-orange-100 text-orange-700",
  URGENT: "bg-red-100 text-red-700",
};

const typeLabels: Record<string, string> = {
  OIL_CHANGE: "Oil Change",
  TIRE_ROTATION: "Tire Rotation",
  BRAKE_SERVICE: "Brake Service",
  GENERAL: "General Service",
  INSPECTION: "Inspection",
  REPAIR: "Repair",
};

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const params = await searchParams;
  const sort = (SORT_OPTIONS.some((o) => o.value === params.sort) ? params.sort : "scheduledAt") as MaintSortField;
  const dir = params.dir === "desc" ? "desc" : "asc";

  const [records, currency] = await Promise.all([getMaintenanceData(sort, dir), getCurrency()]);

  const stats = {
    scheduled: records.filter((r) => r.status === "SCHEDULED").length,
    inProgress: records.filter((r) => r.status === "IN_PROGRESS").length,
    completed: records.filter((r) => r.status === "COMPLETED").length,
    urgent: records.filter((r) => r.priority === "URGENT" && r.status !== "COMPLETED").length,
    totalCost: records.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + (r.cost ?? 0), 0),
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Topbar title="Maintenance" subtitle="Schedule and track vehicle maintenance" actions={<ExportButton href="/api/export/maintenance" label="Export Records" />} />
      <main className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-5 gap-4">
          <div className="rounded-lg bg-purple-50 p-4">
            <div className="flex items-center gap-2 text-purple-700">
              <Clock className="h-4 w-4" />
              <span className="text-2xl font-bold">{stats.scheduled}</span>
            </div>
            <div className="text-sm font-medium text-purple-700 mt-0.5">Scheduled</div>
          </div>
          <div className="rounded-lg bg-blue-50 p-4">
            <div className="flex items-center gap-2 text-blue-700">
              <Wrench className="h-4 w-4" />
              <span className="text-2xl font-bold">{stats.inProgress}</span>
            </div>
            <div className="text-sm font-medium text-blue-700 mt-0.5">In Progress</div>
          </div>
          <div className="rounded-lg bg-green-50 p-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-2xl font-bold">{stats.completed}</span>
            </div>
            <div className="text-sm font-medium text-green-700 mt-0.5">Completed</div>
          </div>
          <div className="rounded-lg bg-red-50 p-4">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-2xl font-bold">{stats.urgent}</span>
            </div>
            <div className="text-sm font-medium text-red-700 mt-0.5">Urgent</div>
          </div>
          <div className="rounded-lg bg-yellow-50 p-4">
            <div className="text-2xl font-bold text-yellow-700">{formatAmount(stats.totalCost, currency)}</div>
            <div className="text-sm font-medium text-yellow-700 mt-0.5">Total Cost</div>
          </div>
        </div>

        {/* Sort Bar */}
        <SortBar options={SORT_OPTIONS} currentSort={sort} currentDir={dir} />

        {/* Table */}
        <Card className="bg-white">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Technician</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-gray-400">
                      No maintenance records found.
                    </TableCell>
                  </TableRow>
                )}
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-gray-900">
                          {record.vehicle.make} {record.vehicle.model}
                        </div>
                        <div className="font-mono text-xs text-gray-500">{record.vehicle.plateNumber}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-gray-900">
                        {typeLabels[record.type] ?? record.type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600 max-w-[200px] block truncate">{record.description}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${priorityColors[record.priority] ?? "bg-gray-100 text-gray-600"}`}>
                        {record.priority}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusColor(record.status)}`}>
                        {record.status.replace("_", " ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">{formatDate(record.scheduledAt)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {record.completedAt ? formatDate(record.completedAt) : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-gray-900">
                        {record.cost ? formatAmount(record.cost, currency) : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">{record.technicianName ?? "—"}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
